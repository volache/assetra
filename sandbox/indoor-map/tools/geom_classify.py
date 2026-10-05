"""Geometry-based classification for DXF layers that mix everything together.

The terminal drawings put walls, doors, fixtures and hatching on one layer with
no colour or lineweight to tell them apart, so entities are classified from
shape alone.  All thresholds are in drawing units (cm).

    wall     : LINE/ARC with a parallel/concentric partner 6-45 apart (double-line wall)
    stair    : LINE in a run of 4+ equally spaced parallel lines (stair treads, escalators, louvres)
    door     : ~90 degree ARC, radius 50-140, plus the leaf LINE from its hinge
    column   : small closed rectangle (25-150 per side)
    outline  : long LINE with no wall partner (single-line walls, edges, stair stringers)
    fixture  : small closed shapes, circles and small arcs (toilets, seats, furniture)
    detail   : everything short or fragmentary (hatching, tread lines, tick marks)
"""
import math
from bisect import bisect_left
from functools import lru_cache
from collections import defaultdict

WALL_GAP = (6.0, 45.0)
WALL_MIN_LEN = 30.0
OUTLINE_MIN_LEN = 150.0
DOOR_RADIUS = (50.0, 140.0)
DOOR_SWEEP = (75.0, 105.0)
COLUMN_SIDE = (25.0, 150.0)
ANGLE_STEP = 1.0  # degrees per orientation bucket
PATTERN_LINES = 4      # equally spaced parallel lines that make a stair/louvre run
PATTERN_MIN_GAP = 12.0  # closer than this it is a multi-layer wall, not treads


def _line_params(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    ang = math.degrees(math.atan2(dy, dx)) % 180.0
    ux, uy = dx / ln, dy / ln
    if ang >= 180.0 - 1e-9:
        ang = 0.0
    off = -a[0] * uy + a[1] * ux  # signed perpendicular offset from origin
    s0, s1 = sorted((a[0] * ux + a[1] * uy, b[0] * ux + b[1] * uy))
    return ang, off, s0, s1, ln


def _arc_sweep(e):
    a0, a1 = e.dxf.start_angle, e.dxf.end_angle
    return (a1 - a0) % 360.0 or 360.0


def classify(entries):
    """entries: list of (entity, pts, closed). Returns {entry_index: semantic}."""
    out = {}
    lines = []   # (idx, a, b)
    arcs = []    # (idx, entity)
    for i, (e, pts, closed) in enumerate(entries):
        t = e.dxftype()
        if t == "LINE":
            if math.dist(pts[0], pts[1]) > 0:
                lines.append((i, pts[0], pts[1]))
        elif t == "ARC":
            arcs.append((i, e))
        elif t == "CIRCLE":
            out[i] = "fixture" if e.dxf.radius < 150 else "detail"
        elif t in ("LWPOLYLINE", "POLYLINE", "ELLIPSE", "SPLINE"):
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            w, h = max(xs) - min(xs), max(ys) - min(ys)
            n = len(pts) - (1 if closed and pts[0] == pts[-1] else 0)
            if (closed and n <= 5 and COLUMN_SIDE[0] <= w <= COLUMN_SIDE[1]
                    and COLUMN_SIDE[0] <= h <= COLUMN_SIDE[1] and t != "ELLIPSE"):
                out[i] = "column"
            elif closed and max(w, h) <= 400:
                out[i] = "fixture"
            else:
                out[i] = "detail"

    # --- doors: quarter-circle arcs + their leaf lines -------------------
    door_arcs = {}
    for i, e in arcs:
        r = e.dxf.radius
        if DOOR_RADIUS[0] <= r <= DOOR_RADIUS[1] and DOOR_SWEEP[0] <= _arc_sweep(e) <= DOOR_SWEEP[1]:
            door_arcs[i] = e
            out[i] = "door"
    hinges = defaultdict(list)  # rounded hinge -> radii
    for i, e in door_arcs.items():
        c = e.dxf.center
        hinges[(round(c.x / 3), round(c.y / 3))].append(e.dxf.radius)
    door_lines = set()
    for i, a, b in lines:
        ln = math.dist(a, b)
        for p in (a, b):
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for r in hinges.get((round(p[0] / 3) + dx, round(p[1] / 3) + dy), ()):
                        if abs(ln - r) <= 4:
                            door_lines.add(i)
    for i in door_lines:
        out[i] = "door"

    # --- double-line walls: parallel LINEs --------------------------------
    buckets = defaultdict(list)  # angle bucket -> [(off, s0, s1, idx)]
    for i, a, b in lines:
        if i in door_lines:
            continue
        ang, off, s0, s1, ln = _line_params(a, b)
        if ln < WALL_MIN_LEN:
            continue
        buckets[round(ang / ANGLE_STEP) % int(180 / ANGLE_STEP)].append((off, s0, s1, i))
    wall = set()
    nxt = defaultdict(list)  # i -> [(k, gap)] partners on the positive-offset side
    prv = defaultdict(list)
    for key, items in buckets.items():
        pool = items + buckets.get((key + 1) % int(180 / ANGLE_STEP), [])
        pool = sorted(pool)
        offs = [p[0] for p in pool]
        for off, s0, s1, i in items:
            lo = bisect_left(offs, off + WALL_GAP[0])
            for j in range(lo, len(pool)):
                o2, t0, t1, k = pool[j]
                if o2 - off > WALL_GAP[1]:
                    break
                overlap = min(s1, t1) - max(s0, t0)
                if overlap >= min(0.5 * (s1 - s0), 0.5 * (t1 - t0), 200) and overlap >= 20:
                    wall.add(i)
                    wall.add(k)
                    nxt[i].append((k, o2 - off))
                    prv[k].append((i, o2 - off))
    def similar(g1, g2):
        return abs(g1 - g2) <= max(2.0, 0.15 * g1)

    @lru_cache(maxsize=None)
    def fwd(k, g):
        return max((1 + fwd(m, round(g2, 1)) for m, g2 in nxt[k] if similar(g, g2)), default=0)

    @lru_cache(maxsize=None)
    def back(i, g):
        return max((1 + back(h, round(g0, 1)) for h, g0 in prv[i] if similar(g, g0)), default=0)

    stair = set()
    for i, pairs in list(nxt.items()):
        for k, g in pairs:
            # equally spaced run of >= PATTERN_LINES lines = treads / escalator / louvres
            if g >= PATTERN_MIN_GAP and back(i, round(g, 1)) + 2 + fwd(k, round(g, 1)) >= PATTERN_LINES:
                stair.update((i, k))
    for i in wall:
        out[i] = "stair" if i in stair else "wall"

    # --- remaining lines ---------------------------------------------------
    for i, a, b in lines:
        if i in out:
            continue
        out[i] = "outline" if math.dist(a, b) >= OUTLINE_MIN_LEN else "detail"

    # --- concentric arcs = curved walls; leftovers --------------------------
    by_center = defaultdict(list)
    for i, e in arcs:
        if i in out:
            continue
        c = e.dxf.center
        by_center[(round(c.x / 4), round(c.y / 4))].append((e.dxf.radius, i))
    curved = set()
    for group in by_center.values():
        group.sort()
        for (r1, i1), (r2, i2) in zip(group, group[1:]):
            if WALL_GAP[0] <= r2 - r1 <= WALL_GAP[1]:
                curved.update((i1, i2))
    for i, e in arcs:
        if i in out:
            continue
        if i in curved:
            out[i] = "wall"
        else:
            out[i] = "fixture" if e.dxf.radius < 50 else "detail"
    return out
