// Lookups over the floor plans and the inventory: which rooms hold a 存置地點 code, which assets a room holds, and which
// assets sit at a code that has no room on any plan.

const byAssetNo = (a, b) => String(a.assetNo || "").localeCompare(String(b.assetNo || ""), "zh-Hant", { numeric: true }) || String(a.serialNo || "").localeCompare(String(b.serialNo || ""), "zh-Hant", { numeric: true });

/**
 * `assets` is the inventory the signed-in person may see (the same list 財物查詢 shows).  When it is not given, the counts
 * come from the per-code summary and rooms cannot list their assets.
 */
export function buildPlanIndex(data, assets) {
  const floors = data?.floors || [];
  const spaces = data?.spaces || [];
  const floorById = new Map(floors.map((floor) => [floor.id, floor]));
  const spaceById = new Map(spaces.map((space) => [space.id, space]));
  const spacesByFloor = new Map(floors.map((floor) => [floor.id, []]));
  for (const space of spaces) spacesByFloor.get(space.floor_id)?.push(space);

  const linksBySpace = new Map();
  const spacesByCode = new Map();
  for (const link of data?.links || []) {
    if (!linksBySpace.has(link.space_id)) linksBySpace.set(link.space_id, []);
    linksBySpace.get(link.space_id).push(link);
    if (!spacesByCode.has(link.location_code)) spacesByCode.set(link.location_code, []);
    spacesByCode.get(link.location_code).push(link.space_id);
  }
  for (const list of linksBySpace.values()) list.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));

  const assetsByCode = new Map();
  const countByCode = new Map();
  const nameByCode = new Map();
  if (assets) {
    for (const asset of assets) {
      if (!asset.locationCode) continue;
      if (!assetsByCode.has(asset.locationCode)) { assetsByCode.set(asset.locationCode, []); nameByCode.set(asset.locationCode, asset.locationName || ""); }
      assetsByCode.get(asset.locationCode).push(asset);
    }
    for (const list of assetsByCode.values()) list.sort(byAssetNo);
    for (const [code, list] of assetsByCode) countByCode.set(code, list.length);
  } else {
    for (const row of data?.summary || []) { countByCode.set(row.location_code, row.asset_count); nameByCode.set(row.location_code, row.location_name || ""); }
  }

  /** Assets of a room: every code it carries, each asset once. */
  const assetsOfSpace = (spaceId) => {
    const seen = new Set(), list = [];
    for (const link of linksBySpace.get(spaceId) || []) for (const asset of assetsByCode.get(link.location_code) || []) {
      if (!seen.has(asset.id)) { seen.add(asset.id); list.push(asset); }
    }
    return list;
  };
  const countOfSpace = (spaceId) => {
    if (assets) return assetsOfSpace(spaceId).length;
    return (linksBySpace.get(spaceId) || []).reduce((sum, link) => sum + (countByCode.get(link.location_code) || 0), 0);
  };

  // codes that hold assets but have no room on any plan
  const unlocated = [];
  for (const [code, count] of countByCode) if (!spacesByCode.has(code)) unlocated.push({ code, name: nameByCode.get(code) || "", count });
  unlocated.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  return {
    floors, spaces, floorById, spaceById, spacesByFloor, linksBySpace, spacesByCode, assetsByCode, countByCode, nameByCode,
    assetsOfSpace, countOfSpace, unlocated, unlocatedCount: unlocated.reduce((sum, item) => sum + item.count, 0), hasAssets: Boolean(assets),
  };
}

/** The rooms that hold a code, as { space, floor }, ground floor first. */
export function roomsOfCode(index, code) {
  return (index.spacesByCode.get(code) || [])
    .map((id) => index.spaceById.get(id)).filter(Boolean)
    .map((space) => ({ space, floor: index.floorById.get(space.floor_id) }))
    .filter((item) => item.floor)
    .sort((a, b) => a.floor.sort_order - b.floor.sort_order);
}

/** Assets matching a search term in their name, numbers, category, place or custodian. */
export function searchAssets(index, term, limit = 40) {
  const query = term.trim().toLowerCase();
  if (!query || !index.hasAssets) return { list: [], total: 0 };
  const list = [];
  let total = 0;
  for (const assets of index.assetsByCode.values()) for (const asset of assets) {
    const text = `${asset.name || ""} ${asset.assetNo || ""}-${asset.serialNo || ""} ${asset.categoryName || ""} ${asset.locationName || ""} ${asset.custodianName || ""} ${asset.brand || ""} ${asset.model || ""}`.toLowerCase();
    if (text.includes(query)) { total += 1; if (list.length < limit) list.push(asset); }
  }
  return { list, total };
}
