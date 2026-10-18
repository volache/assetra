// Plain functions for the indoor floor plans: drawing coordinates (centimetres, y up) to the screen, outlines to SVG paths,
// and the traced floor files (the tracing tool's `.rooms.json`) to rows for the indoor_* tables.

const ISO_ANGLE = (22 * Math.PI) / 180;
const ISO_SQUASH = 0.62;

/**
 * A drawing point on screen.  `mode` is "flat" (the plain top view), "iso" (the plan laid down at an angle) or a number from
 * 0 to 1 in between, which is what lets the view turn from one to the other.
 */
export function project([x, y], mode) {
  const t = mode === "iso" ? 1 : mode === "flat" ? 0 : mode;
  const angle = ISO_ANGLE * t, squash = 1 - (1 - ISO_SQUASH) * t;
  return [x * Math.cos(angle) - y * Math.sin(angle), -(x * Math.sin(angle) + y * Math.cos(angle)) * squash];
}

/** The drawing point that `project` puts at this place on screen. */
export function unproject([sx, sy], mode) {
  const t = mode === "iso" ? 1 : mode === "flat" ? 0 : mode;
  const angle = ISO_ANGLE * t, squash = 1 - (1 - ISO_SQUASH) * t;
  const u = -sy / squash;
  return [sx * Math.cos(angle) + u * Math.sin(angle), -sx * Math.sin(angle) + u * Math.cos(angle)];
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

/** A floor's name: the building and the floor, "航廈｜二樓" (a site that is one floor just shows its name). */
export const floorName = (floor) => (!floor ? "" : floor.building === floor.label ? floor.label : `${floor.building}｜${floor.label}`);

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

/** The side of the floor slab under loose segments: each segment and the same segment `lift` lower, as a closed shape. */
export function wallsPath(segments, mode, lift) {
  return segments.map(([a, b]) => {
    const [ax, ay] = project(a, mode), [bx, by] = project(b, mode);
    return `M${ax.toFixed(1)} ${ay.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}L${bx.toFixed(1)} ${(by + lift).toFixed(1)}L${ax.toFixed(1)} ${(ay + lift).toFixed(1)}Z`;
  }).join("");
}

/** Loose segments as one SVG path (each its own sub-path). */
export function segmentsPath(segments, mode, lift = 0) {
  return segments.map(([a, b]) => {
    const [ax, ay] = project(a, mode), [bx, by] = project(b, mode);
    return `M${ax.toFixed(1)} ${(ay + lift).toFixed(1)}L${bx.toFixed(1)} ${(by + lift).toFixed(1)}`;
  }).join("");
}

// ---- walls ------------------------------------------------------------------------------------------------------------
// Walls grow out of the room outlines.  Between two public areas (a hall cut in two by a line) there is no wall, so nothing
// is built there; every other side of a room is.  The angled view looks at the plan from one side, so a wall on the far side
// of a room is built full height and one on the near side low, which keeps the inside of a room in sight.
const toViewer = [-Math.sin(ISO_ANGLE), -Math.cos(ISO_ANGLE)];   // in the drawing, pointing at whoever looks at the angled plan
const sunlight = [-0.7, 0.7];

const signedRingArea = (ring) => ring.reduce((sum, [x1, y1], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return sum + (x1 * y2 - x2 * y1); }, 0) / 2;

/**
 * Every wall of a floor as { a, b, height, tone, rooms }: `height` is a share of the full wall height, `tone` is "l" or "d"
 * (the side lit or in shade), `rooms` the ids of the rooms the wall belongs to (to colour the walls of the chosen room).
 */
export function wallEdges(spaces, tolerance = 4) {
  const rings = [];
  for (const space of spaces) for (const ring of [space.ring, ...(space.holes || [])]) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      rings.push({ id: space.id, type: space.space_type, a, b, minX: Math.min(a[0], b[0]) - tolerance, maxX: Math.max(a[0], b[0]) + tolerance, minY: Math.min(a[1], b[1]) - tolerance, maxY: Math.max(a[1], b[1]) + tolerance });
    });
  }
  const touching = (p, owner) => rings.filter((edge) => edge.id !== owner && p[0] >= edge.minX && p[0] <= edge.maxX && p[1] >= edge.minY && p[1] <= edge.maxY && nearSegment(p, edge.a, edge.b, tolerance));
  const out = [];
  const add = (a, b, height, outward, rooms) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
    let n = [dy / length, -dx / length];                               // one of the two sides of the wall
    if (n[0] * outward[0] + n[1] * outward[1] < 0) n = [-n[0], -n[1]];
    const visible = n[0] * toViewer[0] + n[1] * toViewer[1] > 0 ? n : [-n[0], -n[1]];   // the side the viewer sees
    out.push({ a, b, height, tone: visible[0] * sunlight[0] + visible[1] * sunlight[1] > 0 ? "l" : "d", rooms });
  };
  for (const space of spaces) {
    if (space.space_type === "void") continue;
    const ccw = signedRingArea(space.ring) > 0;
    space.ring.forEach((a, i) => {
      const b = space.ring[(i + 1) % space.ring.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
      const outward = ccw ? [dy / length, -dx / length] : [-dy / length, dx / length];   // away from the room
      const near = new Map();
      for (const t of [0.25, 0.5, 0.75]) for (const edge of touching([a[0] + dx * t, a[1] + dy * t], space.id)) near.set(edge.id, edge.type);
      if (!near.size) {                                                                     // the edge of the floor
        const front = outward[0] * toViewer[0] + outward[1] * toViewer[1] > 0;
        add(a, b, front ? 0.2 : 1, outward, [space.id]);
        return;
      }
      const types = [...near.values()];
      if (space.space_type !== "room" && !types.includes("room")) return;                  // open: nothing stands there
      const solid = [...near].filter(([, type]) => type !== "void").map(([id]) => id);
      if (solid.some((id) => id < space.id)) return;                                       // the neighbour builds this one
      add(a, b, 0.5, outward, [space.id, ...solid]);
    });
  }
  // where a void reaches the edge of the floor only a low parapet stands
  for (const [id, edges] of voidEdgeKinds(spaces, tolerance)) {
    const space = spaces.find((item) => item.id === id);
    const ccw = signedRingArea(space.ring) > 0;
    for (const [a, b] of edges.outer) {
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
      add(a, b, 0.22, ccw ? [dy / length, -dx / length] : [-dy / length, dx / length], [id]);
    }
  }
  return out;
}

/** The walls as loose shapes from the drawing's own scale: runs of walls in drawing order (far to near) that share a colour. */
export function wallRuns(edges, mode, fullHeight, tilt, selectedId) {
  const lift = fullHeight * tilt;
  const items = edges.map((edge) => {
    const [ax, ay] = project(edge.a, mode), [bx, by] = project(edge.b, mode), up = lift * edge.height;
    const chosen = selectedId && edge.rooms.includes(selectedId);
    return {
      depth: (ay + by) / 2, tone: chosen ? (edge.tone === "l" ? "sl" : "sd") : edge.tone,
      d: `M${ax.toFixed(1)} ${ay.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}L${bx.toFixed(1)} ${(by - up).toFixed(1)}L${ax.toFixed(1)} ${(ay - up).toFixed(1)}Z`,
    };
  }).sort((p, q) => p.depth - q.depth);
  const runs = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (last && last.tone === item.tone) last.d += item.d; else runs.push({ tone: item.tone, d: item.d });
  }
  return runs;
}
