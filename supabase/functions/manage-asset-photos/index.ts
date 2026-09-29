import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AwsClient } from "npm:aws4fetch";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["http://localhost:5173", "http://localhost:5174"]);
const maxPhotoBytes = 10 * 1024 * 1024;
const maxPhotosPerAsset = 12;
const allowedContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedCategories = new Set(["general", "location", "identification", "composition", "tag", "evidence"]);

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

const cleanText = (value: unknown) => String(value ?? "").trim();

function extensionFor(contentType: string) {
  return contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
}

function r2Config() {
  const accountId = Deno.env.get("R2_ACCOUNT_ID") ?? "";
  const bucket = Deno.env.get("R2_PHOTOS_BUCKET") ?? "";
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("尚未設定財物照片儲存空間。");
  }
  return {
    bucket,
    endpoint: (Deno.env.get("R2_ENDPOINT") || `https://${accountId}.r2.cloudflarestorage.com`).replace(/\/$/, ""),
    client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
  };
}

function objectUrl(endpoint: string, bucket: string, key: string, expiresIn?: number) {
  const safeKey = key.split("/").map(encodeURIComponent).join("/");
  const expiry = expiresIn ? `?X-Amz-Expires=${expiresIn}` : "";
  return `${endpoint}/${bucket}/${safeKey}${expiry}`;
}

async function authorizeIdentity(admin: ReturnType<typeof createClient>, userId: string, identityId: string) {
  const [
    { data: profile },
    { data: roles },
    { data: custodians },
    { data: units },
    { data: asset, error: assetError },
  ] = await Promise.all([
    admin.from("profiles").select("id, status").eq("id", userId).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin.from("user_custodians").select("custodian_code").eq("user_id", userId),
    admin.from("user_units").select("unit_code").eq("user_id", userId),
    admin.from("asset_records").select("identity_id, custodian_code, unit_code").eq("identity_id", identityId).eq("is_current", true).maybeSingle(),
  ]);
  if (assetError) throw assetError;
  if (!profile || profile.status !== "active") throw new Error("帳號尚未啟用。");
  if (!asset) throw new Error("找不到目前可存取的財物資料。");
  const roleSet = new Set((roles ?? []).map((row) => row.role));
  const allowed = roleSet.has("admin") ||
    (roleSet.has("custodian") && (custodians ?? []).some((row) => row.custodian_code === asset.custodian_code)) ||
    (roleSet.has("chief") && (units ?? []).some((row) => row.unit_code === asset.unit_code));
  if (!allowed) throw new Error("你沒有存取此財物照片的權限。");
  return { isAdmin: roleSet.has("admin") };
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
    if (userError || !user) return reply(req, { error: "請先登入後再使用財物照片。" }, 401);

    const isMultipart = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
    const form = isMultipart ? await req.formData() : null;
    const body = isMultipart ? null : await req.json();
    const field = (name: string) => cleanText(form ? form.get(name) : body?.[name]);
    const action = field("action");
    const identityId = field("identityId");
    if (!identityId) return reply(req, { error: "缺少財物識別碼。" }, 400);
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const permission = await authorizeIdentity(admin, user.id, identityId);

    // The browser uploads through this function so the private R2 bucket does not
    // need to expose a CORS policy to each application origin.
    if (action === "upload") {
      const file = form?.get("file");
      const category = field("category") || "general";
      if (!(file instanceof File) || !allowedContentTypes.has(file.type) || file.size <= 0 || file.size > maxPhotoBytes || !allowedCategories.has(category)) {
        return reply(req, { error: "請上傳 JPEG、PNG 或 WebP 圖片；單檔不可超過 10 MB。" }, 400);
      }
      const { count, error: countError } = await admin
        .from("asset_photos").select("id", { count: "exact", head: true }).eq("asset_identity_id", identityId);
      if (countError) throw countError;
      if ((count ?? 0) >= maxPhotosPerAsset) return reply(req, { error: `每筆財物最多可保留 ${maxPhotosPerAsset} 張照片。` }, 400);
      const objectKey = `assets/${identityId}/${crypto.randomUUID()}.${extensionFor(file.type)}`;
      const { client, endpoint, bucket } = r2Config();
      const upload = await client.fetch(objectUrl(endpoint, bucket, objectKey), {
        method: "PUT", headers: { "Content-Type": file.type }, body: await file.arrayBuffer(),
      });
      if (!upload.ok) {
        const detail = (await upload.text()).replace(/\s+/g, " ").slice(0, 300);
        console.error("R2 photo upload rejected", { status: upload.status, detail });
        throw new Error(`R2 儲存空間拒絕寫入（HTTP ${upload.status}）。`);
      }
      const { data: photo, error } = await admin.from("asset_photos").insert({
        asset_identity_id: identityId, object_key: objectKey, original_filename: file.name,
        content_type: file.type, file_size: file.size, category, created_by: user.id,
      }).select("id, original_filename, content_type, file_size, category, created_by, created_at").single();
      if (error) throw error;
      return reply(req, { photo });
    }

    if (action === "list") {
      const { data, error } = await admin
        .from("asset_photos")
        .select("id, original_filename, content_type, file_size, category, created_by, created_at")
        .eq("asset_identity_id", identityId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return reply(req, { photos: data ?? [] });
    }

    if (action === "create_download") {
      const photoId = cleanText(body.photoId);
      const { data: photo, error } = await admin
        .from("asset_photos")
        .select("id, object_key, original_filename")
        .eq("id", photoId).eq("asset_identity_id", identityId).maybeSingle();
      if (error) throw error;
      if (!photo) return reply(req, { error: "找不到可讀取的照片。" }, 404);
      const { client, endpoint, bucket } = r2Config();
      const signed = await client.sign(new Request(objectUrl(endpoint, bucket, photo.object_key, 600), { method: "GET" }), { aws: { signQuery: true } });
      return reply(req, { url: signed.url, filename: photo.original_filename });
    }

    if (action === "create_upload") {
      const originalFilename = field("originalFilename");
      const contentType = field("contentType").toLowerCase();
      const fileSize = Number(body?.fileSize);
      const category = field("category") || "general";
      if (!originalFilename || !allowedContentTypes.has(contentType) || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > maxPhotoBytes || !allowedCategories.has(category)) {
        return reply(req, { error: "請上傳 JPEG、PNG 或 WebP 圖片；單檔不可超過 10 MB。" }, 400);
      }
      const { count, error: countError } = await admin
        .from("asset_photos").select("id", { count: "exact", head: true }).eq("asset_identity_id", identityId);
      if (countError) throw countError;
      if ((count ?? 0) >= maxPhotosPerAsset) return reply(req, { error: `每筆財物最多可保留 ${maxPhotosPerAsset} 張照片。` }, 400);
      const objectKey = `assets/${identityId}/${crypto.randomUUID()}.${extensionFor(contentType)}`;
      const { client, endpoint, bucket } = r2Config();
      const signed = await client.sign(new Request(objectUrl(endpoint, bucket, objectKey, 300), { method: "PUT", headers: { "Content-Type": contentType } }), { aws: { signQuery: true } });
      return reply(req, { objectKey, uploadUrl: signed.url });
    }

    if (action === "complete_upload") {
      const objectKey = field("objectKey");
      const originalFilename = field("originalFilename");
      const contentType = field("contentType").toLowerCase();
      const fileSize = Number(body?.fileSize);
      const category = field("category") || "general";
      if (!objectKey.startsWith(`assets/${identityId}/`) || !originalFilename || !allowedContentTypes.has(contentType) || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > maxPhotoBytes || !allowedCategories.has(category)) {
        return reply(req, { error: "上傳資料不正確，請重新選擇照片。" }, 400);
      }
      const { client, endpoint, bucket } = r2Config();
      const object = await client.fetch(objectUrl(endpoint, bucket, objectKey), { method: "HEAD" });
      const objectSize = Number(object.headers.get("content-length"));
      if (!object.ok || !Number.isFinite(objectSize) || objectSize <= 0 || objectSize > maxPhotoBytes) {
        return reply(req, { error: "儲存空間尚未收到有效圖片，請重新上傳。" }, 409);
      }
      const { data: photo, error } = await admin.from("asset_photos").insert({
        asset_identity_id: identityId, object_key: objectKey, original_filename: originalFilename,
        content_type: contentType, file_size: objectSize, category, created_by: user.id,
      }).select("id, original_filename, content_type, file_size, category, created_by, created_at").single();
      if (error) throw error;
      return reply(req, { photo });
    }

    if (action === "delete") {
      const photoId = cleanText(body.photoId);
      const { data: photo, error } = await admin.from("asset_photos")
        .select("id, object_key, created_by").eq("id", photoId).eq("asset_identity_id", identityId).maybeSingle();
      if (error) throw error;
      if (!photo) return reply(req, { error: "找不到可刪除的照片。" }, 404);
      if (!permission.isAdmin && photo.created_by !== user.id) return reply(req, { error: "只有上傳者或系統管理員可以刪除照片。" }, 403);
      const { client, endpoint, bucket } = r2Config();
      const deletion = await client.fetch(objectUrl(endpoint, bucket, photo.object_key), { method: "DELETE" });
      if (!deletion.ok && deletion.status !== 404) throw new Error("R2 object deletion failed");
      const { error: deleteError } = await admin.from("asset_photos").delete().eq("id", photo.id);
      if (deleteError) throw deleteError;
      return reply(req, { ok: true });
    }

    return reply(req, { error: "不支援的照片操作。" }, 400);
  } catch (error) {
    console.error("manage-asset-photos failed", error);
    const detail = error instanceof Error ? error.message : "財物照片服務暫時無法使用，請稍後再試。";
    return reply(req, { error: detail }, 500);
  }
});
