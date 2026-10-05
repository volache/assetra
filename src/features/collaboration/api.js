import { supabase } from "../../supabase";

export async function requestCollaboration(body) {
  const { data, error } = await supabase.functions.invoke(
    "manage-collaborations",
    { body },
  );
  if (error) {
    // Edge Function errors do not always carry a Fetch Response.  For example,
    // a network failure can provide a plain context object instead.
    let detail = null;
    if (typeof error.context?.json === "function") {
      try {
        detail = await error.context.json();
      } catch {
        // Keep the original Supabase error when its response body is unreadable.
      }
    }
    throw new Error(detail?.error || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

export const collaborationKindLabels = {
  note: "一般筆記",
  tag_missing: "標籤缺失",
  disposal_candidate: "報廢評估",
  custodian_change: "保管人異動",
  location_change: "存置地點異動",
  other: "其他",
  transfer_request: "其他",
};

export const collaborationNoteCategoryLabels = {
  general: "一般筆記",
  location_hint: "實際位置",
};

export function collaborationKindIsTask(kind) {
  return kind !== "note";
}

export function collaborationStatusLabel(status) {
  if (status === "resolved") return "已完成";
  if (status === "cancelled") return "已撤回";
  if (status === "in_progress") return "處理中";
  return "待處理";
}

export const collaborationProgressSteps = [
  ["open", "待處理"],
  ["in_progress", "處理中"],
  ["resolved", "已完成"],
];
