import { invokeFunction } from "../../lib/functions";

export const requestOwnershipDocument = (body) =>
  invokeFunction("manage-ownership-documents", body, {
    fallback: "權狀文件服務無法連線。",
    genericMessage: "權狀文件服務暫時無法讀取，請重新整理後再試。",
  });
