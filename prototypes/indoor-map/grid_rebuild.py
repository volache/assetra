"""Indoor map prototype, take 2: rebuild a clean, mostly right-angled layout.

Isolated from the application: nothing under src/ or supabase/ is touched.

    python prototypes/indoor-map/grid_rebuild.py \
        data/private/floorplans/航廈三樓-修改.dxf \
        data/private/indoor-map/航廈三樓_檢查圖.png

Why this exists
---------------
Thickening CAD wall lines and keeping the empty space left over (take 1)
produced ragged rooms.  This version works the other way round: it keeps only
the structural wall lines, puts them on a clean grid, and lets the rooms fall
out of that grid.

    1. Keep long lines only.  Columns, door frames, furniture and fittings are
       short, so they never become walls.
    2. Straight walls are snapped to exactly horizontal or vertical, and the two
       faces of a double-line wall are merged into one centre line.
    3. Gaps up to a door's width are closed, so a door does not join two rooms.
    4. Big arcs (semicircular rooms, curved facades) and 45 degree walls are kept
       as they are; small arcs (door swings) are dropped.
    5. Loose ends are joined to the nearest wall, then the closed areas are the
       rooms.  Sliver areas between the two faces of a wall are discarded.

The output here is a static check image: the original linework on the left,
the rebuilt rooms on the right.  Units are the drawing's own (centimetres in
the sample plans).
"""
import argparse
import math
import re
import sys
from pathlib import Path

import ezdxf
from ezdxf import path as dxf_path_tools
from shapely.geometry import LineString, Point, box
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

CJK = re.compile(r"[㐀-鿿]")
VOID = re.compile(r"挑空|採光井")

# ---- tuning, in drawing units (cm) ---------------------------------------------
MIN_WALL = 80.0          # a run shorter than this is not a wall
MIN_PIECE = 8.0          # ignore tiny ticks entirely
RUN_GAP = 25.0           # broken pieces of one wall (posts, joints) are joined up to this gap
AXIS_TOLERANCE = 2.5     # degrees from horizontal/vertical that still counts as axis aligned
DIAGONAL_TOLERANCE = 3.0
LONG_OTHER = 200.0       # any other angle needs to be at least this long to count
MERGE_FACES = 30.0       # lines closer than this (double-line walls) become one
DOOR_GAP = 110.0         # openings up to this wide are closed
JOIN = 30.0              # loose ends this close to another wall are joined to it
BIG_ARC_RADIUS = 150.0   # smaller arcs are door swings and fittings
MIN_ROOM_AREA = 8000.0   # 0.8 m2
MIN_ROOM_THICKNESS = 40.0  # 2 * area / perimeter below this is a sliver


def angle_of(dx, dy):
    return math.degrees(math.atan2(dy, dx)) % 180.0


def read(dxf):
    doc = ezdxf.readfile(dxf)
    horizontals, verticals, others, curves, texts, raw = [], [], [], [], [], []
    for entity in doc.modelspace():
        kind = entity.dxftype()
        try:
            if kind == "TEXT":
                value = entity.dxf.text.strip()
                if value:
                    texts.append((value, entity.dxf.insert.x, entity.dxf.insert.y))
                continue
            if kind == "LINE":
                x1, y1, x2, y2 = entity.dxf.start.x, entity.dxf.start.y, entity.dxf.end.x, entity.dxf.end.y
                raw.append(((x1, y1), (x2, y2)))
                length = math.hypot(x2 - x1, y2 - y1)
                if length < MIN_PIECE:
                    continue
                angle = angle_of(x2 - x1, y2 - y1)
                if min(angle, 180 - angle) <= AXIS_TOLERANCE:
                    horizontals.append(((y1 + y2) / 2, min(x1, x2), max(x1, x2)))
                elif abs(angle - 90) <= AXIS_TOLERANCE:
                    verticals.append(((x1 + x2) / 2, min(y1, y2), max(y1, y2)))
                elif length >= MIN_WALL and (
                    abs(angle - 45) <= DIAGONAL_TOLERANCE or abs(angle - 135) <= DIAGONAL_TOLERANCE or length >= LONG_OTHER
                ):
                    others.append(LineString([(x1, y1), (x2, y2)]))
            elif kind in ("ARC", "CIRCLE"):
                points = [(p.x, p.y) for p in dxf_path_tools.make_path(entity).flattening(1.0)]
                if len(points) > 1:
                    raw.append(tuple(points))
                    if entity.dxf.radius >= BIG_ARC_RADIUS:
                        curves.append(LineString(points))
        except Exception:
            continue
    return horizontals, verticals, others, curves, texts, raw


def cluster(items, tolerance):
    """Group (position, a, b) items by position; the strongest line wins each group."""
    remaining = sorted(items, key=lambda it: it[0])
    weight = {}
    for pos, a, b in remaining:
        weight[round(pos)] = weight.get(round(pos), 0.0) + (b - a)
    groups = []
    taken = [False] * len(remaining)
    positions = [it[0] for it in remaining]
    for centre, _ in sorted(weight.items(), key=lambda kv: -kv[1]):
        members = [
            i for i, p in enumerate(positions) if not taken[i] and abs(p - centre) <= tolerance
        ]
        if not members:
            continue
        for i in members:
            taken[i] = True
        total = sum(remaining[i][2] - remaining[i][1] for i in members)
        mean = sum(remaining[i][0] * (remaining[i][2] - remaining[i][1]) for i in members) / total
        groups.append((mean, [(remaining[i][1], remaining[i][2]) for i in members]))
    return groups


def merge_intervals(intervals, gap):
    merged = []
    for a, b in sorted(intervals):
        if merged and a - merged[-1][1] <= gap:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return merged


def runs_of(spans):
    """Join the pieces of one wall into runs, drop short runs, then close door gaps."""
    runs = [r for r in merge_intervals(spans, RUN_GAP) if r[1] - r[0] >= MIN_WALL]
    return merge_intervals([tuple(r) for r in runs], DOOR_GAP)


def axis_walls(horizontals, verticals):
    walls = []
    for pos, spans in cluster(horizontals, MERGE_FACES):
        for a, b in runs_of(spans):
            walls.append(LineString([(a, pos), (b, pos)]))
    for pos, spans in cluster(verticals, MERGE_FACES):
        for a, b in runs_of(spans):
            walls.append(LineString([(pos, a), (pos, b)]))
    return walls


def join_loose_ends(lines):
    """Extend every free end to the nearest wall within JOIN."""
    tree = STRtree(lines)
    connectors = []
    for index, line in enumerate(lines):
        for end in (Point(line.coords[0]), Point(line.coords[-1])):
            hits = tree.query(end.buffer(JOIN))
            best = None
            for other in hits:
                if other == index:
                    continue
                distance = lines[other].distance(end)
                if distance <= 0.5:
                    best = None
                    break
                if distance <= JOIN and (best is None or distance < best[0]):
                    best = (distance, other)
            if best:
                target = lines[best[1]]
                nearest = target.interpolate(target.project(end))
                connectors.append(LineString([end.coords[0], nearest.coords[0]]))
    return connectors


def thickness(polygon):
    return 2.0 * polygon.area / polygon.length if polygon.length else 0.0


def rooms_from_walls(walls):
    """Walls are now clean centre lines, so the old trick works cleanly: thicken
    them just enough to seal doors, keep the empty space between them, and grow
    that space back to the wall.  Neighbouring rooms meet exactly on the wall."""
    seal = DOOR_GAP / 2.0
    solid = unary_union([w.buffer(seal, quad_segs=8) for w in walls])
    minx, miny, maxx, maxy = solid.bounds
    free = box(minx - 50, miny - 50, maxx + 50, maxy + 50).difference(solid)
    outside = Point(minx - 25, miny - 25)
    rooms = []
    for piece in getattr(free, "geoms", [free]):
        if piece.contains(outside):
            continue
        grown = piece.buffer(seal, join_style="mitre", mitre_limit=2.5)
        rooms.extend(g for g in getattr(grown, "geoms", [grown]) if g.geom_type == "Polygon")
    return rooms


def rebuild(dxf):
    horizontals, verticals, others, curves, texts, raw = read(dxf)
    walls = axis_walls(horizontals, verticals) + others + curves
    walls += join_loose_ends(walls)
    faces = rooms_from_walls(walls)
    rooms = []
    for face in faces:
        if face.area < MIN_ROOM_AREA or thickness(face) < MIN_ROOM_THICKNESS:
            continue
        inside = [t for t in texts if face.contains(Point(t[1], t[2]))]
        marks = list(dict.fromkeys(t[0] for t in inside if CJK.search(t[0])))
        rooms.append({"polygon": face, "marks": marks, "void": any(VOID.search(m) for m in marks)})
    return {"rooms": rooms, "walls": walls, "raw": raw, "texts": texts,
            "counts": {"horizontal": len(horizontals), "vertical": len(verticals),
                       "diagonal_or_other": len(others), "curves": len(curves), "faces": len(faces)}}


def draw(result, target, title):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection
    from matplotlib.patches import PathPatch
    from matplotlib.path import Path as MPath

    plt.rcParams["font.sans-serif"] = ["Microsoft JhengHei", "Noto Sans TC", "DejaVu Sans"]
    figure, (left, right) = plt.subplots(2, 1, figsize=(17, 13), dpi=100)

    segments = [list(p) for p in result["raw"]]
    left.add_collection(LineCollection(segments, colors="#4a5470", linewidths=0.3))
    left.set_title(f"{title}｜原始線稿（{len(segments)} 條）", fontsize=11)

    named = 0
    for room in result["rooms"]:
        polygon = room["polygon"]
        rings = [list(polygon.exterior.coords)] + [list(r.coords) for r in polygon.interiors]
        vertices, codes = [], []
        for ring_ in rings:
            vertices += ring_
            codes += [MPath.MOVETO] + [MPath.LINETO] * (len(ring_) - 2) + [MPath.CLOSEPOLY]
        face = "none" if room["void"] else ("#d9e7f7" if room["marks"] else "#f1f4f9")
        right.add_patch(PathPatch(MPath(vertices, codes), facecolor=face, edgecolor="#1f2a44",
                                  linewidth=0.7, linestyle="--" if room["void"] else "-"))
        if room["marks"]:
            named += 1
            anchor = polygon.representative_point()
            label = room["marks"][0] if len(room["marks"]) == 1 else f"{room['marks'][0]}…"
            right.text(anchor.x, anchor.y, label, fontsize=6.5, ha="center", va="center")
    right.add_collection(LineCollection([list(w.coords) for w in result["walls"]], colors="#e0654a", linewidths=0.5, zorder=3))
    right.set_title(
        f"重建後的房間（{len(result['rooms'])} 間，其中 {named} 間有名稱；紅線為保留下來的結構牆 {len(result['walls'])} 條）",
        fontsize=11,
    )

    for axis in (left, right):
        axis.autoscale()
        axis.set_aspect("equal")
        axis.axis("off")
    figure.tight_layout()
    figure.savefig(target, bbox_inches="tight")
    plt.close(figure)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dxf")
    parser.add_argument("image")
    parser.add_argument("--title", default="")
    args = parser.parse_args()
    result = rebuild(args.dxf)
    Path(args.image).parent.mkdir(parents=True, exist_ok=True)
    draw(result, args.image, args.title or Path(args.dxf).stem)
    c = result["counts"]
    print(
        f"axis lines kept: {c['horizontal']} horizontal, {c['vertical']} vertical | "
        f"diagonal/other {c['diagonal_or_other']} | big curves {c['curves']} | "
        f"faces {c['faces']} -> rooms {len(result['rooms'])}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
