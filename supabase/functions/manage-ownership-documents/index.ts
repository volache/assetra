import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AwsClient } from "npm:aws4fetch";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["http://localhost:5173", "http://localhost:5174", "https://volache.github.io"]);
const maxPdfBytes = 20 * 1024 * 1024;

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "http://localhost:5173",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
}

function reply(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function objectUrl(endpoint: string, bucket: string, key: string, expiresIn = 300) {
  const safeKey = key.split("/").map(encodeURIComponent).join("/");
  return `${endpoint.replace(/\/$/, "")}/${bucket}/${safeKey}?X-Amz-Expires=${expiresIn}`;
}

async function isActiveAdmin(admin: ReturnType<typeof createClient>, userId: string) {
  const [{ data: profile }, { data: roles }] = await Promise.all([
    admin.from("profiles").select("status").eq("id", userId).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId),
  ]);
  return profile?.status === "active" && (roles ?? []).some((role) => role.role === "admin");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, { error: "只接受 POST 請求。" }, 405);

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const requester = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await requester.auth.getUser();
    if (userError || !user) return reply(req, { error: "請先登入後再使用權狀文件。" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    if (!await isActiveAdmin(admin, user.id)) return reply(req, { error: "你沒有存取權狀文件的權限。" }, 403);
    const body = await req.json();
    const action = cleanText(body.action);

    if (action === "list") {
      const landParcelId = cleanText(body.landParcelId);
      if (!landParcelId) return reply(req, { error: "缺少土地識別碼。" }, 400);
      const { data, error } = await admin
        .from("ownership_documents")
        .select("id, document_type, original_filename, file_size, created_at")
        .eq("land_parcel_id", landParcelId).eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return reply(req, { documents: data ?? [] });
    }

    if (action === "list_summary") {
      const { data, error } = await admin
        .from("ownership_documents")
        .select("id, land_parcel_id, original_filename, created_at")
        .eq("document_type", "land").eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return reply(req, { documents: data ?? [] });
    }

    if (action === "create_download") {
      const documentId = cleanText(body.documentId);
      const { data: document, error } = await admin
        .from("ownership_documents")
        .select("id, r2_key, original_filename").eq("id", documentId).eq("status", "active").maybeSingle();
      if (error) throw error;
      if (!document) return reply(req, { error: "找不到可讀取的權狀文件。" }, 404);
      const accountId = Deno.env.get("R2_ACCOUNT_ID") ?? "";
      const endpoint = Deno.env.get("R2_ENDPOINT") || `https://${accountId}.r2.cloudflarestorage.com`;
      const bucket = Deno.env.get("R2_OWNERSHIP_BUCKET") || Deno.env.get("R2_BUCKET") || "";
      const r2 = new AwsClient({
        accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "",
        secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "",
        service: "s3", region: "auto",
      });
      const signed = await r2.sign(new Request(objectUrl(endpoint, bucket, document.r2_key), { method: "GET" }), { aws: { signQuery: true } });
      await admin.from("ownership_document_access_logs").insert({ document_id: document.id, actor_id: user.id, action: "view" });
      return reply(req, { url: signed.url, filename: document.original_filename });
    }

    if (action === "create_upload") {
      const documentType = cleanText(body.documentType);
      const landParcelId = cleanText(body.landParcelId);
      const buildingNumber = cleanText(body.buildingNumber);
      const replacesDocumentId = cleanText(body.replacesDocumentId);
      const originalFilename = cleanText(body.originalFilename);
      const fileSize = Number(body.fileSize);
      if (!['land', 'building'].includes(documentType) || !originalFilename.toLowerCase().endsWith('.pdf') || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > maxPdfBytes || (documentType === 'land' && !landParcelId) || (documentType === 'building' && !buildingNumber)) {
        return reply(req, { error: "請上傳小於 20 MB 的 PDF，並填寫正確的權狀歸屬。" }, 400);
      }
      const keyPart = documentType === 'land' ? landParcelId : buildingNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (replacesDocumentId) {
        const { data: previous, error: previousError } = await admin
          .from("ownership_documents")
          .select("id, document_type, land_parcel_id, building_number")
          .eq("id", replacesDocumentId).eq("status", "active").maybeSingle();
        if (previousError) throw previousError;
        if (!previous || previous.document_type !== documentType ||
          (documentType === "land" && previous.land_parcel_id !== landParcelId) ||
          (documentType === "building" && previous.building_number !== buildingNumber)) {
          return reply(req, { error: "原權狀與指定的財產不相符。" }, 400);
        }
      }
      const r2Key = `${documentType}/${keyPart}/${crypto.randomUUID()}.pdf`;
      const { data: document, error } = await admin.from("ownership_documents").insert({
        document_type: documentType, land_parcel_id: documentType === 'land' ? landParcelId : null,
        building_number: documentType === 'building' ? buildingNumber : null, r2_key: r2Key,
        original_filename: originalFilename, file_size: fileSize, created_by: user.id,
        replaces_document_id: replacesDocumentId || null,
      }).select("id").single();
      if (error) throw error;
      const accountId = Deno.env.get("R2_ACCOUNT_ID") ?? "";
      const endpoint = Deno.env.get("R2_ENDPOINT") || `https://${accountId}.r2.cloudflarestorage.com`;
      const bucket = Deno.env.get("R2_OWNERSHIP_BUCKET") || Deno.env.get("R2_BUCKET") || "";
      const r2 = new AwsClient({ accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "", secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "", service: "s3", region: "auto" });
      const signed = await r2.sign(new Request(objectUrl(endpoint, bucket, r2Key), { method: "PUT", headers: { "Content-Type": "application/pdf" } }), { aws: { signQuery: true } });
      return reply(req, { documentId: document.id, uploadUrl: signed.url });
    }

    if (action === "complete_upload") {
      const documentId = cleanText(body.documentId);
      const { data: document, error } = await admin.from("ownership_documents").select("id, r2_key, replaces_document_id").eq("id", documentId).eq("status", "pending").maybeSingle();
      if (error) throw error;
      if (!document) return reply(req, { error: "找不到待完成的上傳。" }, 404);
      const accountId = Deno.env.get("R2_ACCOUNT_ID") ?? "";
      const endpoint = Deno.env.get("R2_ENDPOINT") || `https://${accountId}.r2.cloudflarestorage.com`;
      const bucket = Deno.env.get("R2_OWNERSHIP_BUCKET") || Deno.env.get("R2_BUCKET") || "";
      const r2 = new AwsClient({ accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "", secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "", service: "s3", region: "auto" });
      const object = await r2.fetch(objectUrl(endpoint, bucket, document.r2_key), { method: "HEAD" });
      if (!object.ok) return reply(req, { error: "R2 尚未收到文件，請重新上傳。" }, 409);
      const { error: updateError } = await admin.from("ownership_documents").update({ status: "active", activated_at: new Date().toISOString(), activated_by: user.id }).eq("id", document.id);
      if (updateError) throw updateError;
      if (document.replaces_document_id) {
        const { error: supersedeError } = await admin
          .from("ownership_documents")
          .update({ status: "superseded" })
          .eq("id", document.replaces_document_id).eq("status", "active");
        if (supersedeError) throw supersedeError;
      }
      await admin.from("ownership_document_access_logs").insert({ document_id: document.id, actor_id: user.id, action: "upload" });
      return reply(req, { ok: true });
    }

    if (action === "delete") {
      const documentId = cleanText(body.documentId);
      const { data: document, error } = await admin.from("ownership_documents")
        .select("id, r2_key").eq("id", documentId).eq("status", "active").maybeSingle();
      if (error) throw error;
      if (!document) return reply(req, { error: "找不到可刪除的權狀文件。" }, 404);
      const accountId = Deno.env.get("R2_ACCOUNT_ID") ?? "";
      const endpoint = Deno.env.get("R2_ENDPOINT") || `https://${accountId}.r2.cloudflarestorage.com`;
      const bucket = Deno.env.get("R2_OWNERSHIP_BUCKET") || Deno.env.get("R2_BUCKET") || "";
      const r2 = new AwsClient({ accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "", secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "", service: "s3", region: "auto" });
      const deletion = await r2.fetch(objectUrl(endpoint, bucket, document.r2_key), { method: "DELETE" });
      if (!deletion.ok && deletion.status !== 404) throw new Error("R2 object deletion failed");
      const { error: updateError } = await admin.from("ownership_documents")
        .update({ status: "deleted", deleted_at: new Date().toISOString(), deleted_by: user.id })
        .eq("id", document.id);
      if (updateError) throw updateError;
      await admin.from("ownership_document_access_logs").insert({ document_id: document.id, actor_id: user.id, action: "delete" });
      return reply(req, { ok: true });
    }
    return reply(req, { error: "不支援的文件操作。" }, 400);
  } catch (error) {
    console.error("manage-ownership-documents failed", error);
    return reply(req, { error: "權狀文件服務暫時無法使用，請稍後再試。" }, 500);
  }
});
