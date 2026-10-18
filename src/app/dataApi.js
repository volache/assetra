import { fromDatabaseAsset, fromDatabaseImport } from "../lib/inventory";
import { fetchFunction } from "../lib/functions";
import { supabase } from "../supabase";

const listOf = (rows, key) => (rows || []).map((row) => row[key]);

// The signed-in person's profile, roles, units and custodian codes; null when nobody
// is signed in or the account is not active.
export async function loadSignedInUser() {
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;
  const [{ data: profile }, { data: roles }, { data: units }, { data: custodians }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, account_code, display_name, title, contact_email, status")
        .eq("id", authUser.id)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", authUser.id),
      supabase.from("user_units").select("unit_code").eq("user_id", authUser.id),
      supabase.from("user_custodians").select("custodian_code").eq("user_id", authUser.id),
    ]);
  if (!profile || profile.status !== "active") return null;
  return {
    id: profile.id,
    accountCode: profile.account_code,
    name: profile.display_name,
    title: profile.title,
    email: profile.contact_email,
    status: profile.status,
    roles: listOf(roles, "role"),
    unitCodes: listOf(units, "unit_code"),
    custodianCodes: listOf(custodians, "custodian_code"),
  };
}

// Every account, for administrators (the manage-users function checks the caller's role).
export async function loadUsers() {
  const { users = [] } = await fetchFunction("manage-users", { method: "GET" });
  return users.map((u) => ({
    id: u.id,
    accountCode: u.account_code,
    name: u.display_name,
    title: u.title,
    email: u.contact_email,
    status: u.status,
    roles: listOf(u.user_roles, "role"),
    unitCodes: listOf(u.user_units, "unit_code"),
    custodianCodes: listOf(u.user_custodians, "custodian_code"),
  }));
}

async function loadAllRecords() {
  const pageSize = 1000;
  const records = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("asset_records")
      .select("*")
      .eq("is_current", true)
      .order("category_type_code")
      .order("asset_no")
      .order("serial_no")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    records.push(...(data || []));
    if (!data || data.length < pageSize) return records;
  }
}

// The current inventory and the list of committed import batches.
export async function loadInventory() {
  const [records, { data: imports, error: importError }] = await Promise.all([
    loadAllRecords(),
    supabase
      .from("imports")
      .select("id, file_name, source_type, record_count, summary, imported_at, committed_at")
      .eq("status", "committed")
      .order("committed_at", { ascending: false }),
  ]);
  return {
    assets: records.map(fromDatabaseAsset),
    imports: importError ? [] : (imports || []).map(fromDatabaseImport),
  };
}
