import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "https://volache.github.io",
]);
const validRoles = new Set(["custodian", "chief", "admin"]);
const validStatuses = new Set(["active", "inactive"]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "http://localhost:5173",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
      : "無法處理使用者資料。";

function accountEmail(accountCode: string) {
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(accountCode))
    throw new Error("帳號格式不正確。");
  return `${accountCode}@assetra.app`;
}

function optionalEmail(value: unknown) {
  const email = text(value).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("聯絡信箱格式不正確。");
  return email || null;
}

function codes(value: unknown, fieldName: string) {
  if (!Array.isArray(value)) return [];
  const result = [...new Set(value.map(text).filter(Boolean))];
  if (result.some((code) => code.length > 100))
    throw new Error(`${fieldName}不可超過 100 個字元。`);
  return result;
}

async function authorizeAdmin(
  admin: ReturnType<typeof createClient>,
  userId: string,
) {
  const [{ data: profile, error: profileError }, { data: roles, error: roleError }] =
    await Promise.all([
      admin.from("profiles").select("id, status").eq("id", userId).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", userId),
    ]);
  if (profileError) throw profileError;
  if (roleError) throw roleError;
  if (!profile || profile.status !== "active" || !(roles ?? []).some((row) => row.role === "admin"))
    throw new Error("你沒有管理使用者的權限。");
}

async function replaceAssignments(
  admin: ReturnType<typeof createClient>,
  userId: string,
  unitCodes: string[],
  custodianCodes: string[],
) {
  const { error: deleteUnitError } = await admin.from("user_units").delete().eq("user_id", userId);
  if (deleteUnitError) throw deleteUnitError;
  const { error: deleteCustodianError } = await admin.from("user_custodians").delete().eq("user_id", userId);
  if (deleteCustodianError) throw deleteCustodianError;
  if (unitCodes.length) {
    const { error } = await admin.from("user_units").insert(unitCodes.map((unit_code) => ({ user_id: userId, unit_code })));
    if (error) throw error;
  }
  if (custodianCodes.length) {
    const { error } = await admin.from("user_custodians").insert(custodianCodes.map((custodian_code) => ({ user_id: userId, custodian_code })));
    if (error) throw error;
  }
}

async function replaceRoles(
  admin: ReturnType<typeof createClient>,
  userId: string,
  roles: string[],
) {
  const { error: deleteError } = await admin.from("user_roles").delete().eq("user_id", userId);
  if (deleteError) throw deleteError;
  const { error: insertError } = await admin.from("user_roles").insert(roles.map((role) => ({ user_id: userId, role })));
  if (insertError) throw insertError;
}

async function listUsers(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, account_code, display_name, title, contact_email, status, user_roles(role), user_units(unit_code), user_custodians(custodian_code)")
    .order("account_code");
  if (error) throw error;
  return data ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders(req) });
  if (!["GET", "POST"].includes(req.method))
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders(req),
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey)
      throw new Error("缺少 Supabase Function 必要設定。");
    const authHeader = req.headers.get("Authorization") ?? "";
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");
    const admin = createClient(supabaseUrl, serviceRoleKey);
    await authorizeAdmin(admin, user.id);

    if (req.method === "GET")
      return new Response(JSON.stringify({ users: await listUsers(admin) }), {
        headers: corsHeaders(req),
      });

    const body = await req.json();
    const action = text(body.action);
    const accountCode = text(body.accountCode).toLowerCase();
    const displayName = text(body.displayName);
    const title = text(body.title) || null;
    const contactEmail = optionalEmail(body.contactEmail);
    const password = text(body.password);
    const roles = [...new Set(Array.isArray(body.roles) ? body.roles.map(text) : [])];
    const status = text(body.status || "active");
    const unitCodes = codes(body.unitCodes, "單位代碼");
    const custodianCodes = codes(body.custodianCodes, "保管人代碼");

    if (!accountCode || !displayName || !roles.length)
      throw new Error("請填寫帳號、姓名與至少一項權限。");
    const email = accountEmail(accountCode);
    if (displayName.length > 100 || (title?.length ?? 0) > 100)
      throw new Error("姓名或職稱不可超過 100 個字元。");
    if (roles.some((role) => !validRoles.has(role)))
      throw new Error("包含不支援的權限。");
    if (!validStatuses.has(status)) throw new Error("包含不支援的帳號狀態。");
    if (password && password.length < 8) throw new Error("密碼至少需要 8 個字元。");

    let targetId = text(body.id);
    if (action === "create") {
      if (!password) throw new Error("請設定初始密碼。");
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createError || !created.user) throw createError ?? new Error("無法建立登入帳號。");
      targetId = created.user.id;
      try {
        const { error: profileError } = await admin.from("profiles").insert({
          id: targetId,
          account_code: accountCode,
          display_name: displayName,
          title,
          contact_email: contactEmail,
          status,
        });
        if (profileError) throw profileError;
        await replaceRoles(admin, targetId, roles);
        await replaceAssignments(admin, targetId, unitCodes, custodianCodes);
      } catch (error) {
        await admin.auth.admin.deleteUser(targetId);
        throw error;
      }
    } else if (action === "update") {
      if (!targetId) throw new Error("缺少使用者識別資料。");
      const { data: target, error: targetError } = await admin
        .from("profiles")
        .select("id, account_code")
        .eq("id", targetId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) throw new Error("找不到指定的使用者。");
      const authChanges: { email?: string; password?: string } = {};
      if (target.account_code !== accountCode) authChanges.email = email;
      if (password) authChanges.password = password;
      if (Object.keys(authChanges).length) {
        const { error } = await admin.auth.admin.updateUserById(targetId, authChanges);
        if (error) throw error;
      }
      const { error: profileError } = await admin
        .from("profiles")
        .update({ account_code: accountCode, display_name: displayName, title, contact_email: contactEmail, status, updated_at: new Date().toISOString() })
        .eq("id", targetId);
      if (profileError) throw profileError;
      await replaceRoles(admin, targetId, roles);
      await replaceAssignments(admin, targetId, unitCodes, custodianCodes);
    } else {
      throw new Error("不支援的使用者操作。");
    }

    const { error: auditError } = await admin.from("audit_logs").insert({
      actor_id: user.id,
      target_user_id: targetId,
      action: action === "create" ? "user_created" : "user_updated",
      detail: { accountCode, roles, status, unitCodes, custodianCodes },
    });
    if (auditError) throw auditError;

    return new Response(JSON.stringify({ users: await listUsers(admin) }), {
      headers: corsHeaders(req),
    });
  } catch (error) {
    const status = message(error) === "Unauthorized" ? 401 : 400;
    return new Response(JSON.stringify({ error: message(error) }), {
      status,
      headers: corsHeaders(req),
    });
  }
});
