// Plain functions for the indoor floor plans: drawing coordinates (centimetres, y up) to the screen, outlines to SVG paths,
// and the traced floor files (the tracing tool's `.rooms.json`) to rows for the indoor_* tables.

const ISO_ANGLE = (22 * Math.PI) / 180;
const ISO_SQUASH = 0.62;

/** A drawing point on screen.  "iso" lays the plan down at an angle, "flat" is the plain top view. */
export function project([x, y], mode) {
  if (mode === "flat") return [x, -y];
  return [
    x * Math.cos(ISO_ANGLE) - y * Math.sin(ISO_ANGLE),
    -(x * Math.sin(ISO_ANGLE) + y * Math.cos(ISO_ANGLE)) * ISO_SQUASH,
  ];
}

export function ringPath(ring, mode, lift = 0) {
  return (
    ring
      .map((point, index) => {
        const [x, y] = project(point, mode);
        return `${index ? "L" : "M"}${x.toFixed(1)} ${(y + lift).toFixed(1)}`;
      })
      .join("") + "Z"
  );
}

/** Outline plus holes as one path; the holes are cut out with the even-odd rule. */
export function spacePath(space, mode, lift = 0) {
  return [space.ring, ...(space.holes || [])].map((ring) => ringPath(ring, mode, lift)).join("");
}

export function ringCentroid(ring) {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    area += cross; cx += (x1 + x2) * cross; cy += (y1 + y2) * cross;
  }
  if (Math.abs(area) < 1e-6) return ring[0];
  return [cx / (3 * area), cy / (3 * area)];
}

export function pointInRing(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A point that is really inside the room (the centroid of an L shape can fall outside it). */
export function labelPoint(space) {
  const c = ringCentroid(space.ring);
  const free = (p) => pointInRing(space.ring, p) && !(space.holes || []).some((h) => pointInRing(h, p));
  if (free(c)) return c;
  const ys = space.ring.map((p) => p[1]);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  const xs = [];
  for (let i = 0; i < space.ring.length; i += 1) {
    const [x1, y1] = space.ring[i], [x2, y2] = space.ring[(i + 1) % space.ring.length];
    if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
  }
  xs.sort((a, b) => a - b);
  let best = [xs[0] ?? c[0], xs[1] ?? xs[0] ?? c[0]];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
  return [(best[0] + best[1]) / 2, y];
}

/** The box around a floor's outlines, in screen units: [minX, minY, maxX, maxY]. */
export function screenBounds(spaces, mode, extra = 0) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const space of spaces) for (const point of space.ring) {
    const [x, y] = project(point, mode);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y + extra);
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : [0, 0, 100, 100];
}

export const SPACE_TYPE_LABELS = { room: "房間", public: "公共區域", void: "挑空／採光" };

/** The kinds of room counted at the bottom of the plan, from what the room is called. */
export const CATEGORIES = [
  { id: "office", label: "辦公室", test: /辦公|櫃臺|櫃檯|服務臺|服務台|值日|會議|接待/ },
  { id: "machine", label: "機房", test: /機房|機電|變電|水箱|配電|電氣|電信|空調|灑水|MCC|發電/ },
  { id: "toilet", label: "廁所", test: /廁所|盥洗|親子廁|哺乳/ },
  { id: "storage", label: "倉儲", test: /倉庫|儲藏|備品|工具間|器材|報廢|裝備室/ },
];

export function categoryOf(space) {
  if (space.space_type === "void") return null;
  const text = `${space.name || ""} ${space.usage || ""}`;
  return CATEGORIES.find((category) => category.test.test(text))?.id || null;
}

/** A room's title: the matched name, else the note it was given, else its id in the tracing tool. */
export const spaceTitle = (space) => space.name || space.usage || space.tool_id || "未命名空間";

// ---- reading the tracing tool's files -------------------------------------------------------------------------------
const ringArea = (ring) => Math.abs(ring.reduce((sum, [x1, y1], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return sum + (x1 * y2 - x2 * y1); }, 0)) / 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toCm = (point) => [Math.round(point[0]), Math.round(point[1])];

/**
 * One traced floor as rows: its bounds, the rooms (coordinates to the centimetre) and their 存置地點 links.
 * Throws when a room has no permanent uid, because the uid is what keeps a re-import from duplicating rooms.
 */
export function floorFromTracedFile(data) {
  if (!Array.isArray(data?.rooms)) throw new Error("格式不正確：找不到 rooms。");
  const seen = new Set();
  const spaces = [], links = [];
  for (const room of data.rooms) {
    if (!UUID.test(room.uid || "")) throw new Error(`房間 ${room.id} 沒有永久編號（uid）；請先用描圖工具開啟這個樓層一次。`);
    if (seen.has(room.uid)) throw new Error(`房間 ${room.id} 的永久編號重複。`);
    seen.add(room.uid);
    const holes = room.holes || [];
    spaces.push({
      id: room.uid, tool_id: room.id, name: room.name || null, usage: room.usage || null, space_type: room.type || "room",
      ring: room.ring.map(toCm), holes: holes.map((hole) => hole.map(toCm)),
      area_m2: Number(((ringArea(room.ring) - holes.reduce((sum, hole) => sum + ringArea(hole), 0)) / 10000).toFixed(2)),
    });
    if (room.locationCode) links.push({ space_id: room.uid, location_code: room.locationCode, location_name: room.name || null, is_primary: true });
    for (const extra of room.alsoLocations || []) {
      if (extra.code && extra.code !== room.locationCode) links.push({ space_id: room.uid, location_code: extra.code, location_name: extra.name || null, is_primary: false });
    }
  }
  const xs = data.rooms.flatMap((room) => room.ring.map((p) => p[0])), ys = data.rooms.flatMap((room) => room.ring.map((p) => p[1]));
  const bounds = xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
  return { title: data.title, unit: data.unit || "cm", bounds, spaces, links };
}

// ---- looks ----------------------------------------------------------------------------------------------------------
/** The box around one room on screen: [minX, minY, maxX, maxY]. */
export function spaceBounds(space, mode) {
  return screenBounds([space], mode);
}

/** Pale cream for no assets up to the system's coral for the busiest room on the floor (log scale, so one crowded room does not wash out the rest). */
export function heatFill(count, max) {
  if (!count || !max) return null;
  const t = Math.min(1, Math.log1p(count) / Math.log1p(max));
  return `oklch(${(95 - 27 * t).toFixed(1)}% ${(0.035 + 0.12 * t).toFixed(3)} ${(75 - 38 * t).toFixed(0)})`;
}

// ---- void (挑空) outlines ---------------------------------------------------------------------------------------------
const nearSegment = (p, a, b, tolerance) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) <= tolerance;
};

/**
 * Splits the outline of every void into the sides that another room shares or touches (`inner`: those stay dashed, the
 * void is in the middle of the floor there) and the sides nothing else touches (`outer`: the edge of the floor, drawn as a
 * solid line like any other room).  Returns Map(void id -> { inner, outer }) with segments as [[x, y], [x, y]].
 */
export function voidEdgeKinds(spaces, tolerance = 4) {
  const edges = [];
  for (const space of spaces) for (const ring of [space.ring, ...(space.holes || [])]) {
    ring.forEach((a, i) => edges.push({ id: space.id, a, b: ring[(i + 1) % ring.length] }));
  }
  const result = new Map();
  for (const space of spaces) {
    if (space.space_type !== "void") continue;
    const inner = [], outer = [];
    space.ring.forEach((a, i) => {
      const b = space.ring[(i + 1) % space.ring.length];
      const touching = [0.25, 0.5, 0.75].filter((t) => {
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        return edges.some((edge) => edge.id !== space.id && nearSegment(p, edge.a, edge.b, tolerance));
      }).length;
      (touching >= 2 ? inner : outer).push([a, b]);
    });
    result.set(space.id, { inner, outer });
  }
  return result;
}

/** Loose segments as one SVG path (each its own sub-path). */
export function segmentsPath(segments, mode, lift = 0) {
  return segments.map(([a, b]) => {
    const [ax, ay] = project(a, mode), [bx, by] = project(b, mode);
    return `M${ax.toFixed(1)} ${(ay + lift).toFixed(1)}L${bx.toFixed(1)} ${(by + lift).toFixed(1)}`;
  }).join("");
}
