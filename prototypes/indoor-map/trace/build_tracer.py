"""Indoor map prototype: build a tracing tool from a DXF floor plan.

Isolated from the application: nothing under src/ or supabase/ is touched.

    python prototypes/indoor-map/trace/build_tracer.py \
        data/private/floorplans/航廈三樓-修改.dxf \
        data/private/indoor-map/航廈三樓_描圖.html --title 航廈三樓

The DXF becomes a grey underlay inside one standalone HTML page.  You trace the
rooms you want on top of it; the page saves them as a small JSON file that the
next steps (tidying, isometric view, linking to 存置地點) read.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import ezdxf
from ezdxf import path as dxf_path_tools

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
MAJOR_LINE = 60.0        # straight lines at least this long are drawn as main linework
MAJOR_RADIUS = 150.0     # arcs at least this big are main linework; smaller ones are door swings
SNAP_MIN_PIECE = 12.0    # shorter pieces are not worth snapping to


def number(value):
    text = f"{value:.1f}"
    return text[:-2] if text.endswith(".0") else text


def path_data(segments):
    """Segments are lists of (x, y) points in drawing coordinates; y is flipped for the screen."""
    parts = []
    for points in segments:
        parts.append("M" + "L".join(f"{number(x)} {number(-y)}" for x, y in points))
    return "".join(parts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dxf")
    parser.add_argument("output")
    parser.add_argument("--title", default="")
    parser.add_argument(
        "--locations",
        default="",
        help='JSON list of existing 存置地點: [{"code": "*C001", "name": "業務組辦公室", "count": 92}]',
    )
    parser.add_argument(
        "--crop",
        default="",
        help="x0,y0,x1,y1 in drawing units: keep only what lies inside (one floor of a file that holds several)",
    )
    parser.add_argument(
        "--align",
        action="append",
        default=[],
        help="another floor's DXF: work out how its coordinates line up with this drawing (repeatable)",
    )
    parser.add_argument("--regions", action="store_true", help="list the separate drawings in the file and exit")
    args = parser.parse_args()
    crop = [float(v) for v in args.crop.split(",")] if args.crop else None
    inside = lambda x, y: crop is None or (crop[0] <= x <= crop[2] and crop[1] <= y <= crop[3])

    locations = []
    if args.locations and Path(args.locations).exists():
        locations = json.loads(Path(args.locations).read_text(encoding="utf-8"))

    doc = ezdxf.readfile(args.dxf)
    major, minor, snap_segments, points, texts = [], [], [], set(), []
    xs, ys = [], []
    for entity in doc.modelspace():
        kind = entity.dxftype()
        try:
            if kind == "TEXT":
                # Some drawings carry text bytes that are not valid characters; drop those.
                value = "".join(c for c in entity.dxf.text if not 0xD800 <= ord(c) <= 0xDFFF).strip()
                if value and inside(entity.dxf.insert.x, entity.dxf.insert.y):
                    texts.append({"t": value, "x": round(entity.dxf.insert.x, 1), "y": round(-entity.dxf.insert.y, 1)})
                continue
            if kind == "LINE":
                a = (entity.dxf.start.x, entity.dxf.start.y)
                b = (entity.dxf.end.x, entity.dxf.end.y)
                if not inside((a[0] + b[0]) / 2, (a[1] + b[1]) / 2):
                    continue
                length = math.dist(a, b)
                (major if length >= MAJOR_LINE else minor).append([a, b])
                if length >= SNAP_MIN_PIECE:
                    snap_segments.append([a, b])
                    points.update([(round(a[0]), round(a[1])), (round(b[0]), round(b[1]))])
            elif kind in ("ARC", "CIRCLE", "LWPOLYLINE", "POLYLINE", "ELLIPSE"):
                curve = [(p.x, p.y) for p in dxf_path_tools.make_path(entity).flattening(2.0)]
                if len(curve) < 2 or not inside(*curve[len(curve) // 2]):
                    continue
                big = kind in ("LWPOLYLINE", "POLYLINE") or getattr(entity.dxf, "radius", 0) >= MAJOR_RADIUS
                (major if big else minor).append(curve)
                for p, q in zip(curve, curve[1:]):
                    if math.dist(p, q) >= 4.0:
                        snap_segments.append([p, q])
                points.update([(round(curve[0][0]), round(curve[0][1])), (round(curve[-1][0]), round(curve[-1][1]))])
        except Exception:
            continue
    if args.regions:
        from shapely.geometry import LineString
        from shapely.ops import unary_union

        near = unary_union([LineString(seg).buffer(400) for seg in major if len(seg) > 1])
        found = []
        for area in getattr(near, "geoms", [near]):
            x0, y0, x1, y1 = area.bounds
            weight = sum(1 for seg in major if x0 <= seg[0][0] <= x1 and y0 <= seg[0][1] <= y1)
            if weight >= 80 and (x1 - x0) > 2000 and (y1 - y0) > 1000:
                found.append((weight, [round(x0 + 400), round(y0 + 400), round(x1 - 400), round(y1 - 400)]))
        for weight, box in sorted(found, key=lambda f: -f[0]):
            print(f"{weight:6d} lines  crop {box[0]},{box[1]},{box[2]},{box[3]}  size {(box[2]-box[0])/100:.0f} x {(box[3]-box[1])/100:.0f} m")
        return
    for group in (major, minor):
        for segment in group:
            for x, y in segment:
                xs.append(x)
                ys.append(-y)

    alignments = {}
    for other in args.align:
        if Path(other).name == Path(args.dxf).name:
            continue
        from align_floors import align

        result = align(args.dxf, other, crop)
        # A weak or ambiguous match is not worth applying on its own.
        if result["score"] >= 0.4 and result["score"] >= result["runnerUp"] * 1.1:
            alignments[Path(other).name] = result
            print(f"aligned {Path(other).name}: dx {result['dx']}, dy {result['dy']}, score {result['score']}", file=sys.stderr)
        else:
            print(f"no clear match for {Path(other).name} (score {result['score']}, next {result['runnerUp']})", file=sys.stderr)

    data = {
        "title": args.title or Path(args.dxf).stem,
        "source": Path(args.dxf).name,
        "unit": "cm",
        "bounds": [min(xs), min(ys), max(xs), max(ys)],
        "major": path_data(major),
        "minor": path_data(minor),
        "segments": [[round(p[0], 1), round(-p[1], 1), round(q[0], 1), round(-q[1], 1)] for p, q in snap_segments],
        "points": [[x, -y] for x, y in sorted(points)],
        "texts": texts,
        "locations": locations,
        "alignments": alignments,
    }
    template = (HERE / "tracer.template.html").read_text(encoding="utf-8")
    html = template.replace("/*__TRACE_DATA__*/null", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(
        f"wrote {out} | main lines {len(major)}, minor {len(minor)}, "
        f"snap segments {len(data['segments'])}, snap points {len(data['points'])}, texts {len(texts)}, "
        f"locations {len(locations)}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
