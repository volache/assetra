import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:5173",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const text = (value: unknown) => String(value ?? "").trim();
const message = (error: unknown) =>
  error instanceof Error ? error.message : "無法處理協作紀錄。";

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
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
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
    const identityId = text(body.identityId);
    if (!identityId) throw new Error("缺少財物識別資料。");
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { profile, isAdmin } = await authorizeIdentity(
      admin,
      user.id,
      identityId,
    );

    if (body.action === "create") {
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
    } else if (body.action === "comment") {
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
    } else if (body.action === "resolve") {
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
    } else if (body.action !== "list") {
      throw new Error("不支援的協作操作。");
    }
    return new Response(
      JSON.stringify({
        collaborations: await responseForIdentity(admin, identityId),
        actor: { id: user.id, name: profile.display_name, isAdmin },
      }),
      { headers: corsHeaders },
    );
  } catch (error) {
    const status = message(error) === "Unauthorized" ? 401 : 400;
    return new Response(JSON.stringify({ error: message(error) }), {
      status,
      headers: corsHeaders,
    });
  }
});
