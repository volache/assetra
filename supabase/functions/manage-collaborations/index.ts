import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "http://localhost:5173",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
}

const text = (value: unknown) => String(value ?? "").trim();
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "無法處理協作紀錄。";

async function authorizeIdentity(
  admin: ReturnType<typeof createClient>,
  userId: string,
  identityId: string,
) {
  const [
    { data: profile },
    { data: roles },
    { data: custodians },
    { data: units },
    { data: asset, error: assetError },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, display_name, status")
      .eq("id", userId)
      .maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin
      .from("user_custodians")
      .select("custodian_code")
      .eq("user_id", userId),
    admin.from("user_units").select("unit_code").eq("user_id", userId),
    admin
      .from("asset_records")
      .select("identity_id, custodian_code, unit_code")
      .eq("identity_id", identityId)
      .eq("is_current", true)
      .maybeSingle(),
  ]);
  if (assetError) throw assetError;
  if (!profile || profile.status !== "active")
    throw new Error("帳號尚未啟用。");
  if (!asset) throw new Error("找不到目前可協作的財物資料。");
  const roleSet = new Set((roles ?? []).map((row) => row.role));
  const allowed =
    roleSet.has("admin") ||
    (roleSet.has("custodian") &&
      (custodians ?? []).some(
        (row) => row.custodian_code === asset.custodian_code,
      )) ||
    (roleSet.has("chief") &&
      (units ?? []).some((row) => row.unit_code === asset.unit_code));
  if (!allowed) throw new Error("你沒有處理此財物協作紀錄的權限。");
  return { profile, isAdmin: roleSet.has("admin") };
}

async function viewerContext(
  admin: ReturnType<typeof createClient>,
  userId: string,
) {
  const [
    { data: profile },
    { data: roles },
    { data: custodians },
    { data: units },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, display_name, status")
      .eq("id", userId)
      .maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin
      .from("user_custodians")
      .select("custodian_code")
      .eq("user_id", userId),
    admin.from("user_units").select("unit_code").eq("user_id", userId),
  ]);
  if (!profile || profile.status !== "active")
    throw new Error("帳號尚未啟用。");
  const roleSet = new Set((roles ?? []).map((row) => row.role));
  return {
    profile,
    isAdmin: roleSet.has("admin"),
    custodianCodes: new Set((custodians ?? []).map((row) => row.custodian_code)),
    unitCodes: new Set((units ?? []).map((row) => row.unit_code)),
    canUseCustodianScope: roleSet.has("custodian"),
    canUseUnitScope: roleSet.has("chief"),
  };
}

function canAccessAsset(
  viewer: Awaited<ReturnType<typeof viewerContext>>,
  asset: { custodian_code: string | null; unit_code: string | null },
) {
  return (
    viewer.isAdmin ||
    (viewer.canUseCustodianScope && viewer.custodianCodes.has(asset.custodian_code)) ||
    (viewer.canUseUnitScope && viewer.unitCodes.has(asset.unit_code))
  );
}

async function accessibleAssets(
  admin: ReturnType<typeof createClient>,
  viewer: Awaited<ReturnType<typeof viewerContext>>,
) {
  const { data, error } = await admin
    .from("asset_records")
    .select(
      "identity_id, asset_no, serial_no, name, source_type, custodian_code, unit_code",
    )
    .eq("is_current", true);
  if (error) throw error;
  return (data ?? []).filter((asset) => canAccessAsset(viewer, asset));
}

async function summariesForIdentities(
  admin: ReturnType<typeof createClient>,
  identityIds: string[],
) {
  if (!identityIds.length) return [];
  const { data, error } = await admin
    .from("asset_collaborations")
    .select("asset_identity_id, status, updated_at")
    .in("asset_identity_id", identityIds)
    .in("status", ["open", "in_progress"])
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const grouped = new Map<
    string,
    { identityId: string; openCount: number; inProgressCount: number; updatedAt: string | null }
  >();
  for (const row of data ?? []) {
    const current = grouped.get(row.asset_identity_id) ?? {
      identityId: row.asset_identity_id,
      openCount: 0,
      inProgressCount: 0,
      updatedAt: null,
    };
    if (row.status === "in_progress") current.inProgressCount += 1;
    else current.openCount += 1;
    if (!current.updatedAt || row.updated_at > current.updatedAt)
      current.updatedAt = row.updated_at;
    grouped.set(row.asset_identity_id, current);
  }
  return [...grouped.values()];
}

async function taskListForViewer(
  admin: ReturnType<typeof createClient>,
  viewer: Awaited<ReturnType<typeof viewerContext>>,
  status: string,
) {
  const assets = await accessibleAssets(admin, viewer);
  if (!assets.length) return [];
  const { data: collaborations, error } = await admin
    .from("asset_collaborations")
    .select("id, asset_identity_id, kind, status, body, created_by, created_at, updated_at")
    .in(
      "status",
      status === "all" ? ["open", "in_progress", "resolved"] : [status],
    )
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const assetByIdentity = new Map(
    assets.map((asset) => [asset.identity_id, asset]),
  );
  const creatorIds = [
    ...new Set((collaborations ?? []).map((row) => row.created_by).filter(Boolean)),
  ];
  const { data: profiles, error: profileError } = creatorIds.length
    ? await admin.from("profiles").select("id, display_name").in("id", creatorIds)
    : { data: [], error: null };
  if (profileError) throw profileError;
  const names = new Map((profiles ?? []).map((row) => [row.id, row.display_name]));
  return (collaborations ?? []).flatMap((row) => {
    const asset = assetByIdentity.get(row.asset_identity_id);
    if (!asset) return [];
    return [{
      ...row,
      created_by_name: names.get(row.created_by) ?? "系統",
      asset: {
        identityId: row.asset_identity_id,
        assetNo: asset.asset_no,
        serialNo: asset.serial_no,
        name: asset.name,
        sourceType: asset.source_type,
        custodianCode: asset.custodian_code,
        unitCode: asset.unit_code,
      },
    }];
  });
}

async function responseForIdentity(
  admin: ReturnType<typeof createClient>,
  identityId: string,
) {
  const { data: collaborations, error } = await admin
    .from("asset_collaborations")
    .select(
      "id, kind, status, body, created_by, updated_by, created_at, updated_at, resolved_at, resolved_by",
    )
    .eq("asset_identity_id", identityId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const ids = [
    ...new Set(
      (collaborations ?? [])
        .flatMap((row) => [row.created_by, row.updated_by, row.resolved_by])
        .filter(Boolean),
    ),
  ];
  const { data: profiles, error: profileError } = ids.length
    ? await admin.from("profiles").select("id, display_name").in("id", ids)
    : { data: [], error: null };
  if (profileError) throw profileError;
  const names = new Map(
    (profiles ?? []).map((row) => [row.id, row.display_name]),
  );
  const collaborationIds = (collaborations ?? []).map((row) => row.id);
  const { data: events, error: eventError } = collaborationIds.length
    ? await admin
        .from("asset_collaboration_events")
        .select(
          "id, collaboration_id, event_type, payload, actor_id, created_at",
        )
        .in("collaboration_id", collaborationIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (eventError) throw eventError;
  const eventsByCollaboration = new Map<string, unknown[]>();
  for (const event of events ?? []) {
    const row = { ...event, actor_name: names.get(event.actor_id) ?? "系統" };
    eventsByCollaboration.set(event.collaboration_id, [
      ...(eventsByCollaboration.get(event.collaboration_id) ?? []),
      row,
    ]);
  }
  return (collaborations ?? []).map((row) => ({
    ...row,
    created_by_name: names.get(row.created_by) ?? "系統",
    resolved_by_name: row.resolved_by
      ? (names.get(row.resolved_by) ?? "系統")
      : null,
    events: eventsByCollaboration.get(row.id) ?? [],
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders(req),
    });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");
    const body = await req.json();
    const action = text(body.action || "list");
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // These two read paths are deliberately handled before the single-asset
    // authorization below.  They still derive their result from the caller's
    // custodian/unit scope, so the service-role client never exposes a global
    // collaboration list to an ordinary user.
    if (action === "summaries") {
      const requestedIds = Array.isArray(body.identityIds)
        ? body.identityIds.map(text).filter(Boolean).slice(0, 100)
        : [];
      const viewer = await viewerContext(admin, user.id);
      const accessible = await accessibleAssets(admin, viewer);
      const allowedIds = new Set(
        accessible.map((asset) => asset.identity_id).filter(Boolean),
      );
      const identityIds = requestedIds.filter((id) => allowedIds.has(id));
      return new Response(
        JSON.stringify({ summaries: await summariesForIdentities(admin, identityIds) }),
        { headers: corsHeaders(req) },
      );
    }
    if (action === "list_tasks") {
      const status = ["all", "open", "in_progress", "resolved"].includes(text(body.status))
        ? text(body.status)
        : "all";
      const viewer = await viewerContext(admin, user.id);
      return new Response(
        JSON.stringify({
          tasks: await taskListForViewer(admin, viewer, status),
          actor: { id: user.id, name: viewer.profile.display_name, isAdmin: viewer.isAdmin },
        }),
        { headers: corsHeaders(req) },
      );
    }
    const identityId = text(body.identityId);
    if (!identityId) throw new Error("缺少財物識別資料。");
    const { profile, isAdmin } = await authorizeIdentity(
      admin,
      user.id,
      identityId,
    );

    if (action === "create") {
      const bodyText = text(body.body);
      if (!bodyText) throw new Error("請輸入筆記內容。");
      if (bodyText.length > 2000)
        throw new Error("筆記內容不可超過 2,000 字。");
      const { data: collaboration, error } = await admin
        .from("asset_collaborations")
        .insert({
          asset_identity_id: identityId,
          kind: "note",
          status: "open",
          body: bodyText,
          created_by: user.id,
          updated_by: user.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: eventError } = await admin
        .from("asset_collaboration_events")
        .insert({
          collaboration_id: collaboration.id,
          event_type: "created",
          payload: { body: bodyText },
          actor_id: user.id,
        });
      if (eventError) throw eventError;
    } else if (action === "comment") {
      const collaborationId = text(body.collaborationId);
      const bodyText = text(body.body);
      if (!collaborationId || !bodyText) throw new Error("請輸入補充內容。");
      if (bodyText.length > 2000)
        throw new Error("補充內容不可超過 2,000 字。");
      const { data: collaboration, error } = await admin
        .from("asset_collaborations")
        .select("id, status")
        .eq("id", collaborationId)
        .eq("asset_identity_id", identityId)
        .maybeSingle();
      if (error) throw error;
      if (!collaboration) throw new Error("找不到此協作紀錄。");
      if (
        collaboration.status === "resolved" ||
        collaboration.status === "cancelled"
      )
        throw new Error("已結案的筆記不能再補充內容。");
      const { error: eventError } = await admin
        .from("asset_collaboration_events")
        .insert({
          collaboration_id: collaborationId,
          event_type: "commented",
          payload: { body: bodyText },
          actor_id: user.id,
        });
      if (eventError) throw eventError;
      const { error: updateError } = await admin
        .from("asset_collaborations")
        .update({ updated_by: user.id, updated_at: new Date().toISOString() })
        .eq("id", collaborationId);
      if (updateError) throw updateError;
    } else if (action === "resolve") {
      const collaborationId = text(body.collaborationId);
      if (!collaborationId) throw new Error("缺少協作紀錄。");
      const { data: collaboration, error } = await admin
        .from("asset_collaborations")
        .select("id, created_by, status")
        .eq("id", collaborationId)
        .eq("asset_identity_id", identityId)
        .maybeSingle();
      if (error) throw error;
      if (!collaboration) throw new Error("找不到此協作紀錄。");
      if (!isAdmin && collaboration.created_by !== user.id)
        throw new Error("只有建立者或系統管理員可以結案。");
      if (collaboration.status !== "resolved") {
        const now = new Date().toISOString();
        const { error: updateError } = await admin
          .from("asset_collaborations")
          .update({
            status: "resolved",
            updated_by: user.id,
            updated_at: now,
            resolved_by: user.id,
            resolved_at: now,
          })
          .eq("id", collaborationId);
        if (updateError) throw updateError;
        const { error: eventError } = await admin
          .from("asset_collaboration_events")
          .insert({
            collaboration_id: collaborationId,
            event_type: "resolved",
            actor_id: user.id,
          });
        if (eventError) throw eventError;
      }
    } else if (action !== "list") {
      throw new Error("不支援的協作操作。");
    }
    return new Response(
      JSON.stringify({
        collaborations: await responseForIdentity(admin, identityId),
        actor: { id: user.id, name: profile.display_name, isAdmin },
      }),
      { headers: corsHeaders(req) },
    );
  } catch (error) {
    const status = message(error) === "Unauthorized" ? 401 : 400;
    return new Response(JSON.stringify({ error: message(error) }), {
      status,
      headers: corsHeaders(req),
    });
  }
});
