// Turns the floor plans traced with prototypes/indoor-map into SQL for the indoor_* tables.
//
//   node scripts/generate-indoor-import-sql.mjs <folder with the *.rooms.json files> [output folder]
//
// One SQL file per floor is written (default: <folder>/../import-sql), so each can be run on its own.  Re-running an
// import updates the rooms in place (the key is each room's permanent uid) and removes rooms that no longer exist in the
// file.  The floors' order comes from the building configs in data/private/indoor-map/buildings.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const folder = resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("Usage: node scripts/generate-indoor-import-sql.mjs <folder> [output folder]");
const outFolder = resolve(process.argv[3] || join(folder, "..", "import-sql"));
const buildingsFolder = join(folder, "..", "buildings");

const sqlText = (value) => (value === null || value === undefined || value === "" ? "null" : `'${String(value).replaceAll("'", "''")}'`);
const jsonValue = (value) => `${sqlText(JSON.stringify(value))}::jsonb`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// building -> floors, in display order
const BUILDING_ORDER = ["航廈", "宿舍", "消防站", "汙水處理廠"];
const floors = [];
const configs = readdirSync(buildingsFolder).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(buildingsFolder, f), "utf8")));
configs.sort((a, b) => BUILDING_ORDER.indexOf(a.name) - BUILDING_ORDER.indexOf(b.name));
// floors within a building, lowest first (the plan lists them from the top down, so the reverse); others keep the config order
const FLOOR_ORDER = {
  航廈: ["航廈地下一樓", "航廈淺漥區", "航廈貨運站", "航廈一樓", "航廈二樓", "航廈三樓"],
  宿舍: ["宿舍機房", "宿舍一樓", "宿舍二樓", "宿舍三樓"],
};
for (const config of configs) {
  const rank = (floor) => { const at = (FLOOR_ORDER[config.name] || []).indexOf(floor.title); return at < 0 ? 1e6 : at; };
  const ordered = [...config.floors].sort((a, b) => rank(a) - rank(b));
  for (const floor of ordered) floors.push({ key: floor.title, building: config.name, label: floor.label || floor.title });
}

const ringArea = (ring) => Math.abs(ring.reduce((sum, [x1, y1], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return sum + (x1 * y2 - x2 * y1); }, 0)) / 2;

mkdirSync(outFolder, { recursive: true });
const seenUids = new Set();
let order = 0, roomTotal = 0;
for (const floor of floors) {
  const file = join(folder, `${floor.key}.rooms.json`);
  let data;
  try { data = JSON.parse(readFileSync(file, "utf8")); } catch { console.warn(`skipped ${floor.key}: no ${basename(file)}`); continue; }
  order += 1;
  const xs = data.rooms.flatMap((r) => r.ring.map((p) => p[0])), ys = data.rooms.flatMap((r) => r.ring.map((p) => p[1]));
  const bounds = xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
  const lines = ["begin;"];
  lines.push(
    `insert into public.indoor_floors (floor_key, building, label, sort_order, unit, bounds) values (${sqlText(floor.key)}, ${sqlText(floor.building)}, ${sqlText(floor.label)}, ${order}, ${sqlText(data.unit || "cm")}, ${bounds ? jsonValue(bounds) : "null"})` +
    ` on conflict (floor_key) do update set building = excluded.building, label = excluded.label, sort_order = excluded.sort_order, unit = excluded.unit, bounds = excluded.bounds, updated_at = now();`,
  );
  // the floor's rooms travel as one JSON document (coordinates to the centimetre) and are written with set-based statements
  const cm = (p) => [Math.round(p[0]), Math.round(p[1])];
  const rooms = data.rooms.map((room) => {
    if (!UUID.test(room.uid || "")) throw new Error(`${floor.key} ${room.id} has no uid; open the floor in the tool once so it is assigned.`);
    if (seenUids.has(room.uid)) throw new Error(`Duplicate uid ${room.uid} (${floor.key} ${room.id}).`);
    seenUids.add(room.uid);
    const holes = room.holes || [];
    return {
      u: room.uid, i: room.id, n: room.name || null, s: room.usage || null, t: room.type || "room",
      r: room.ring.map(cm), h: holes.map((h) => h.map(cm)),
      m: Number(((ringArea(room.ring) - holes.reduce((sum, h) => sum + ringArea(h), 0)) / 10000).toFixed(2)),   // cm² -> m²
      c: room.locationCode ? [room.locationCode, room.name || null] : null,
      a: (room.alsoLocations || []).filter((x) => x.code && x.code !== room.locationCode).map((x) => [x.code, x.name || null]),
    };
  });
  const floorId = `(select id from public.indoor_floors where floor_key = ${sqlText(floor.key)})`;
  const payload = `${jsonValue(rooms)}`;
  lines.push(`create temporary table _indoor_import on commit drop as select * from jsonb_to_recordset(${payload}) as x(u uuid, i text, n text, s text, t text, r jsonb, h jsonb, m numeric, c jsonb, a jsonb);`);
  lines.push(`delete from public.indoor_spaces where floor_id = ${floorId} and id not in (select u from _indoor_import);`);
  lines.push(
    `insert into public.indoor_spaces (id, floor_id, tool_id, name, usage, space_type, ring, holes, area_m2) select u, ${floorId}, i, n, s, t, r, h, m from _indoor_import` +
    ` on conflict (id) do update set floor_id = excluded.floor_id, tool_id = excluded.tool_id, name = excluded.name, usage = excluded.usage, space_type = excluded.space_type, ring = excluded.ring, holes = excluded.holes, area_m2 = excluded.area_m2, updated_at = now();`,
  );
  lines.push(`delete from public.indoor_space_locations where space_id in (select u from _indoor_import);`);
  lines.push(`insert into public.indoor_space_locations (space_id, location_code, location_name, is_primary) select u, c ->> 0, c ->> 1, true from _indoor_import where c is not null;`);
  lines.push(`insert into public.indoor_space_locations (space_id, location_code, location_name, is_primary) select u, e ->> 0, e ->> 1, false from _indoor_import, jsonb_array_elements(a) e on conflict do nothing;`);
  lines.push("commit;");
  writeFileSync(join(outFolder, `${String(order).padStart(2, "0")}-${floor.key}.sql`), lines.join("\n") + "\n");
  roomTotal += data.rooms.length;
  console.log(`${floor.building} ${floor.label}: ${data.rooms.length} rooms`);
}
console.log(`wrote ${order} files to ${outFolder} (${roomTotal} rooms)`);
