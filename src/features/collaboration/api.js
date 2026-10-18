import { invokeFunction } from "../../lib/functions";

export const requestCollaboration = (body) => invokeFunction("manage-collaborations", body);
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
