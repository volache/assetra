// Reading and writing the indoor_* tables.  Everyone signed in may read; the database only lets administrators write.
import { floorFromTracedFile, floorName } from "./geometry";

const CHUNK = 80;
const chunks = (list) => Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, (i + 1) * CHUNK));

function check({ error }, what) {
  if (error) throw new Error(`${what}：${error.message}`);
}

export async function loadIndoor(supabase) {
  const [floors, spaces, links, summary] = await Promise.all([
    supabase.from("indoor_floors").select("id,floor_key,building,label,sort_order,unit,bounds").order("sort_order"),
    supabase.from("indoor_spaces").select("id,floor_id,tool_id,name,usage,space_type,ring,holes,area_m2").limit(5000),
    supabase.from("indoor_space_locations").select("space_id,location_code,location_name,is_primary").limit(5000),
    supabase.from("indoor_location_summary").select("location_code,location_name,asset_count").limit(5000),
  ]);
  check(floors, "讀取樓層失敗"); check(spaces, "讀取房間失敗"); check(links, "讀取存置地點對應失敗"); check(summary, "讀取財物筆數失敗");
  return { floors: floors.data || [], spaces: spaces.data || [], links: links.data || [], summary: summary.data || [] };
}

/** Name, note, kind and 存置地點 codes of one room.  `codes` is [{ code, name }]; the first one is the main code. */
export async function saveSpace(supabase, spaceId, draft) {
  const update = await supabase.from("indoor_spaces").update({
    name: draft.name.trim() || null, usage: draft.usage.trim() || null, space_type: draft.spaceType, updated_at: new Date().toISOString(),
  }).eq("id", spaceId).select("id");
  check(update, "儲存房間失敗");
  if (!update.data?.length) throw new Error("儲存房間失敗：找不到這個房間，或您沒有編輯權限。");
  check(await supabase.from("indoor_space_locations").delete().eq("space_id", spaceId), "更新存置地點失敗");
  const seen = new Set();
  const rows = draft.codes.filter((item) => item.code && !seen.has(item.code) && seen.add(item.code)).map((item, index) => ({
    space_id: spaceId, location_code: item.code, location_name: item.name || null, is_primary: index === 0,
  }));
  if (rows.length) check(await supabase.from("indoor_space_locations").insert(rows), "更新存置地點失敗");
}

export async function deleteSpace(supabase, spaceId) {
  const result = await supabase.from("indoor_spaces").delete().eq("id", spaceId).select("id");
  check(result, "刪除房間失敗");
  if (!result.data?.length) throw new Error("刪除房間失敗：找不到這個房間，或您沒有編輯權限。");
}

/**
 * Replace each listed floor with what the traced file holds (rooms are matched by their permanent uid, rooms missing from
 * the file are removed).  Returns one line per file.  Floors must already exist in indoor_floors.
 */
export async function importTracedFiles(supabase, files, floors) {
  const report = [];
  for (const file of files) {
    let parsed;
    try { parsed = floorFromTracedFile(JSON.parse(await file.text())); }
    catch (cause) { report.push({ name: file.name, ok: false, text: cause.message }); continue; }
    const floor = floors.find((item) => item.floor_key === parsed.title);
    if (!floor) { report.push({ name: file.name, ok: false, text: `系統裡沒有「${parsed.title}」這個樓層，請先新增樓層。` }); continue; }
    try {
      check(await supabase.from("indoor_floors").update({ bounds: parsed.bounds, unit: parsed.unit, updated_at: new Date().toISOString() }).eq("id", floor.id), "更新樓層失敗");
      for (const part of chunks(parsed.spaces)) check(await supabase.from("indoor_spaces").upsert(part.map((space) => ({ ...space, floor_id: floor.id, updated_at: new Date().toISOString() })), { onConflict: "id" }), "寫入房間失敗");
      const existing = await supabase.from("indoor_spaces").select("id").eq("floor_id", floor.id).limit(5000);
      check(existing, "讀取既有房間失敗");
      const keep = new Set(parsed.spaces.map((space) => space.id));
      const stale = (existing.data || []).map((row) => row.id).filter((id) => !keep.has(id));
      for (const part of chunks(stale)) check(await supabase.from("indoor_spaces").delete().in("id", part), "移除已刪除的房間失敗");
      for (const part of chunks(parsed.spaces.map((space) => space.id))) check(await supabase.from("indoor_space_locations").delete().in("space_id", part), "更新存置地點失敗");
      for (const part of chunks(parsed.links)) check(await supabase.from("indoor_space_locations").insert(part), "寫入存置地點失敗");
      report.push({ name: file.name, ok: true, text: `${floorName(floor)}：${parsed.spaces.length} 個房間${stale.length ? `，移除 ${stale.length} 個已不存在的房間` : ""}` });
    } catch (cause) {
      report.push({ name: file.name, ok: false, text: cause.message });
    }
  }
  return report;
}
