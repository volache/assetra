import { supabase } from "../../supabase";

export async function requestCollaboration(body) {
  const { data, error } = await supabase.functions.invoke(
    "manage-collaborations",
    { body },
  );
  if (error) {
    const detail = await error.context?.json().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

export const collaborationKindLabels = {
  note: "共同筆記",
  tag_missing: "標籤遺失",
  disposal_candidate: "待報廢",
  transfer_request: "異動申請",
};

export function collaborationStatusLabel(status) {
  if (status === "resolved") return "已完成";
  if (status === "in_progress") return "處理中";
  return "待處理";
}
