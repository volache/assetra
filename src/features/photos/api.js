import { invokeFunction } from "../../lib/functions";

export const requestAssetPhoto = (body) =>
  invokeFunction("manage-asset-photos", body, { fallback: "財物照片服務無法連線。" });
