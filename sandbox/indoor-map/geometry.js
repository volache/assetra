// Pure geometry helpers for the room editor. All coordinates are SVG user units (y down).

export function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function centroidOf(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

/** Point inside a ring that is also well inside (used to place name labels). */
export function interiorPoint(ring) {
  const c = centroidOf(ring);
  if (pointInRing(c, ring)) return c;
  const ys = ring.map((p) => p[1]);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  const xs = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
  }
  xs.sort((a, b) => a - b);
  return xs.length >= 2 ? [(xs[0] + xs[1]) / 2, y] : ring[0];
}

export function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + t * dx, a[1] + t * dy];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q, t };
}

function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  let idx = -1, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const { d } = distToSegment(pts[i], a, b);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return dp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(dp(pts.slice(idx), eps));
}

/** Douglas-Peucker for a closed ring (split at the two most distant points). */
export function simplifyRing(ring, eps) {
  if (ring.length < 4) return ring;
  let i0 = 0, i1 = 0, best = -1;
  const step = Math.max(1, Math.floor(ring.length / 200));
  for (let i = 0; i < ring.length; i += step) {
    for (let j = i + 1; j < ring.length; j += step) {
      const d = Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
      if (d > best) { best = d; i0 = i; i1 = j; }
    }
  }
  const a = ring.slice(i0, i1 + 1);
  const b = ring.slice(i1).concat(ring.slice(0, i0 + 1));
  return dp(a, eps).slice(0, -1).concat(dp(b, eps).slice(0, -1));
}

/** All coordinate pairs of an SVG path made only of M/L/Z commands. */
export function pathPoints(d) {
  const pts = [];
  const re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(d))) pts.push([+m[1], +m[2]]);
  return pts;
}

/**
 * Rasterise the barrier geometry: wall paths (SVG `d` strings), extra segments
 * (user closers, auto bridges). Returns the mask plus the px<->unit mapping.
 */
export function rasterBarrier({ paths, segments, viewBox, maxPx = 4000, maxScale = 0.2, linePx = 3 }) {
  const [vx, vy, vw, vh] = viewBox;
  const scale = Math.min(maxScale, maxPx / Math.max(vw, vh));
  const w = Math.ceil(vw * scale), h = Math.ceil(vh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.setTransform(scale, 0, 0, scale, -vx * scale, -vy * scale);
  ctx.lineWidth = linePx / scale;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.strokeStyle = "#000";
  for (const d of paths) ctx.stroke(new Path2D(d));
  ctx.beginPath();
  for (const [a, b] of segments) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  ctx.stroke();
  const data = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 40 ? 1 : 0;
  return { mask, w, h, scale, ox: vx, oy: vy };
}

/** 4-connected flood fill over free cells. Returns { region, count, leaked }. */
export function floodRegion({ mask, w, h }, sx, sy, limit = 4_000_000) {
  const region = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || mask[sy * w + sx]) return null;
  const stack = [sy * w + sx];
  region[stack[0]] = 1;
  let count = 0, leaked = false;
  while (stack.length) {
    const i = stack.pop();
    count++;
    if (count > limit) return { region, count, leaked: true };
    const x = i % w, y = (i / w) | 0;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) leaked = true;
    if (x > 0 && !mask[i - 1] && !region[i - 1]) { region[i - 1] = 1; stack.push(i - 1); }
    if (x < w - 1 && !mask[i + 1] && !region[i + 1]) { region[i + 1] = 1; stack.push(i + 1); }
    if (y > 0 && !mask[i - w] && !region[i - w]) { region[i - w] = 1; stack.push(i - w); }
    if (y < h - 1 && !mask[i + w] && !region[i + w]) { region[i + w] = 1; stack.push(i + w); }
  }
  return { region, count, leaked };
}

/** Outer boundary of a filled mask as pixel-corner coordinates. */
export function traceOuter(region, w, h) {
  const W = w + 1;
  const next = new Map();
  const add = (a, b) => { const l = next.get(a); if (l) l.push(b); else next.set(a, [b]); };
  const filled = (x, y) => x >= 0 && y >= 0 && x < w && y < h && region[y * w + x] === 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!region[y * w + x]) continue;
      const tl = y * W + x, tr = tl + 1, bl = tl + W, br = bl + 1;
      if (!filled(x, y - 1)) add(tl, tr);
      if (!filled(x + 1, y)) add(tr, br);
      if (!filled(x, y + 1)) add(br, bl);
      if (!filled(x - 1, y)) add(bl, tl);
    }
  }
  let best = null, bestArea = 0;
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const loop = [];
      let v = start;
      do {
        const outs = next.get(v);
        if (!outs || !outs.length) break;
        loop.push([v % W, (v / W) | 0]);
        v = outs.pop();
      } while (v !== start);
      if (loop.length >= 4) {
        const area = ringArea(loop);
        if (area > bestArea) { bestArea = area; best = loop; }
      }
    }
  }
  if (!best) return null;
  // drop collinear grid points
  const out = [];
  for (let i = 0; i < best.length; i++) {
    const p = best[(i + best.length - 1) % best.length], c = best[i], n = best[(i + 1) % best.length];
    if ((c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0]) !== 0) out.push(c);
  }
  return out;
}
