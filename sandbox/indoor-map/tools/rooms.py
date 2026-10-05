"""Room-polygon extraction for the indoor-map sandbox.

Rooms are the free space left once walls, columns, windows and door openings are
treated as barriers.  Door arcs are closed with a straight "threshold" line from
the hinge to the closed-leaf end so that a room does not leak into the corridor.

Config block (per source file):
    "rooms": {
        "barrier":   ["WALL", ...],      # layers whose geometry bounds rooms
        "partition": {"DOOR": 100},      # layer -> min LINE length counted as a wall
        "doorLayers": ["DOOR", ...],     # layers holding door arcs + leaf lines
        "closeGap": 3,                   # cm, barrier thickness used to seal hairline gaps
        "minWidth": 50,                  # cm, narrower faces (wall cavities) are dropped
        "minArea": 15000                 # cm^2 (1.5 m^2)
    }
"""
import math
import re
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points, unary_union
from shapely.strtree import STRtree

DOOR_RADIUS = (50.0, 140.0)
DOOR_SWEEP = (75.0, 105.0)
NUMBER = re.compile(r"^[A-Za-z]?\d{2,4}(-\d+)?$")


def _is_projection(pts, min_len):
    if _length(pts) < min_len:
        return False
    ang = math.degrees(math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])) % 90
    return 3 < ang < 87


def _length(pts):
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


def _door_bridges(arcs, leaves, tol=3.0):
    """Return (bridge lines, ids of leaf lines to exclude from walls)."""
    bridges, used = [], set()
    for arc in arcs:
        c, r = arc.dxf.center, arc.dxf.radius
        ends = [(c.x + r * math.cos(math.radians(a)), c.y + r * math.sin(math.radians(a)))
                for a in (arc.dxf.start_angle, arc.dxf.end_angle)]
        open_end = None
        for idx, ln in leaves:
            a = (ln.dxf.start.x, ln.dxf.start.y)
            b = (ln.dxf.end.x, ln.dxf.end.y)
            for hinge, tip in ((a, b), (b, a)):
                if math.dist(hinge, (c.x, c.y)) <= tol:
                    for k, e in enumerate(ends):
                        if math.dist(tip, e) <= tol * 2:
                            open_end = k
                            used.add(idx)
        for k, e in enumerate(ends):
            if open_end is None or k != open_end:
                bridges.append([(c.x, c.y), e])
    return bridges, used


def _gap_bridges(lines, snap, door_gap):
    """Bridge dangling wall ends: to a nearby wall (<= snap) or to another dangling end (<= door_gap)."""
    tree = STRtree(lines)
    dangling = []
    for i, ln in enumerate(lines):
        coords = list(ln.coords)
        if len(coords) < 2 or coords[0] == coords[-1]:
            continue
        for end in (coords[0], coords[-1]):
            pt = Point(end)
            near = [j for j in tree.query(pt.buffer(2.0)) if j != i and lines[j].distance(pt) <= 2.0]
            if not near:
                dangling.append((i, end))
    bridges = []
    for i, end in dangling:
        pt = Point(end)
        best, best_d = None, door_gap + 1
        for j, other in dangling:
            if j == i:
                continue
            d = math.dist(end, other)
            if d < best_d:
                best, best_d = other, d
        wall_d, wall_pt = None, None
        for j in tree.query(pt.buffer(snap)):
            if j == i:
                continue
            d = lines[j].distance(pt)
            if wall_d is None or d < wall_d:
                wall_d, wall_pt = d, nearest_points(lines[j], pt)[0]
        if wall_d is not None and wall_d <= snap and (best is None or wall_d <= best_d):
            bridges.append([end, (wall_pt.x, wall_pt.y)])
        elif best is not None and best_d <= door_gap:
            bridges.append([end, best])
    return bridges


def build(items, cfg, plan, labels, in_window, centroid):
    rc = cfg["rooms"]
    crop = plan["crop"]
    barrier_layers = set(rc["barrier"])
    partition = rc.get("partition", {})
    door_layers = set(rc.get("doorLayers", []))
    gap = rc.get("closeGap", 3.0)
    proj = plan.get("dropProjectionLines", cfg.get("dropProjectionLines", 0))

    barrier, arcs, leaves = [], [], []
    for p, geoms, rec in items:
        if rec is not None:
            continue
        layer, t = p.dxf.layer, p.dxftype()
        if layer in door_layers:
            cx, cy = (p.dxf.center.x, p.dxf.center.y) if t == "ARC" else (None, None)
            if t == "ARC" and in_window(cx, cy, crop):
                sweep = (p.dxf.end_angle - p.dxf.start_angle) % 360
                if DOOR_RADIUS[0] <= p.dxf.radius <= DOOR_RADIUS[1] and DOOR_SWEEP[0] <= sweep <= DOOR_SWEEP[1]:
                    arcs.append(p)
            elif t == "LINE" and in_window(*centroid(geoms[0][0]), crop):
                leaves.append((len(leaves), p))
        for pts, closed in geoms:
            if not in_window(*centroid(pts), crop):
                continue
            if t == "LINE" and proj and _is_projection(pts, proj):
                continue
            if layer in barrier_layers:
                barrier.append(pts + ([pts[0]] if closed else []))
            elif layer in partition and t in ("LINE", "LWPOLYLINE") and _length(pts) >= partition[layer]:
                barrier.append(pts + ([pts[0]] if closed else []))
    bridges, used = _door_bridges(arcs, leaves)
    # drop door-leaf stubs that were counted as partitions
    leaf_pts = {tuple(map(lambda q: (round(q[0]), round(q[1])), [(ln.dxf.start.x, ln.dxf.start.y), (ln.dxf.end.x, ln.dxf.end.y)])) for i, ln in leaves if i in used}
    barrier = [b for b in barrier
               if len(b) != 2 or tuple((round(q[0]), round(q[1])) for q in b) not in leaf_pts]

    lines = [LineString(b) for b in barrier if len(b) >= 2] + [LineString(b) for b in bridges]
    extra = _gap_bridges(lines, rc.get("snapGap", 30.0), rc.get("doorGap", 130.0))
    lines += [LineString(b) for b in extra]
    network = unary_union(lines).buffer(gap)
    env = network.envelope.buffer(300)
    free = env.difference(network)
    faces = list(free.geoms) if hasattr(free, "geoms") else [free]

    rooms = []
    for f in faces:
        if f.intersects(env.exterior):
            continue
        if f.area < rc.get("minArea", 15000):
            continue
        if f.buffer(-rc.get("minWidth", 50) / 2).is_empty:
            continue
        poly = f.buffer(gap).simplify(1.5)
        rooms.append(poly)

    out = []
    for n, poly in enumerate(sorted(rooms, key=lambda g: (-g.centroid.y // 400, g.centroid.x)), 1):
        names, number = [], None
        for lb in labels:
            if poly.contains(Point(lb["x"], lb["y"])):
                if NUMBER.match(lb["text"]):
                    number = number or lb["text"]
                elif lb["text"] not in names:
                    names.append(lb["text"])
        out.append({
            "id": f"r{n:03d}", "name": " / ".join(names), "number": number,
            "area": round(poly.area / 10000, 1),
            "polygon": [list(poly.exterior.coords)] + [list(i.coords) for i in poly.interiors],
        })
    return out, barrier, {"door": bridges, "gap": extra}
