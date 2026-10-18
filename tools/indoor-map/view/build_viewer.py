"""Indoor map prototype: isometric floor viewer built from the traced rooms.

Isolated from the application: nothing under src/ or supabase/ is touched.

    python tools/indoor-map/view/build_viewer.py \
        data/private/indoor-map/航廈三樓_等角檢視.html \
        --floor "3F|航廈三樓=data/private/indoor-map/航廈三樓.rooms.json" \
        --stats data/private/indoor-map/location-stats.json

Each --floor is `label|title=path` (the label is optional); give it once per
floor and the viewer gets previous/next buttons.  --stats is an optional JSON
object keyed by 存置地點代碼:
    { "*C001": { "count": 92, "original": 123, "net": 45, "classes": { "什項設備": 80 } } }
It is aggregated from the main system's 財物清冊 and kept out of version control.
"""
import argparse
import json
import sys
from pathlib import Path

from shapely.geometry import Polygon
from shapely.ops import unary_union

HERE = Path(__file__).parent


def ring_out(coords):
    return [[round(x, 1), round(-y, 1)] for x, y in coords]  # drawing y points up, the screen's points down


def load_floor(spec):
    head, _, path = spec.partition("=")
    label, _, title = head.rpartition("|")
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    unit = {"cm": 0.01, "mm": 0.001, "m": 1.0}.get(data.get("unit", "cm"), 0.01)
    rooms, shapes = [], []
    for room in data["rooms"]:
        if len(room["ring"]) < 3:
            continue
        holes = [h for h in room.get("holes", []) if len(h) >= 3]
        polygon = Polygon(room["ring"], holes)
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        anchor = polygon.representative_point()
        rooms.append(
            {
                "id": room["id"],
                "code": room.get("locationCode", ""),
                "name": room.get("name", ""),
                "type": room.get("type", "room"),
                "area": round(polygon.area * unit * unit, 1),
                "outer": ring_out(room["ring"]),
                "holes": [ring_out(h) for h in holes],
                "anchor": [round(anchor.x, 1), round(-anchor.y, 1)],
            }
        )
        if room.get("type") != "void":
            shapes.append(Polygon(room["ring"]).buffer(0))
    footprint = unary_union(shapes).buffer(1.0).buffer(-1.0)
    outline = [ring_out(p.exterior.coords) for p in getattr(footprint, "geoms", [footprint])]
    xs = [p[0] for ring in outline for p in ring]
    ys = [p[1] for ring in outline for p in ring]
    return {
        "label": label or "",
        "title": title or data.get("title", ""),
        "source": data.get("source", ""),
        "unitToMeters": unit,
        "bounds": [min(xs), min(ys), max(xs), max(ys)],
        "outline": outline,
        "rooms": rooms,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output")
    parser.add_argument("--floor", action="append", required=True, help="[label|]title=path-to-rooms.json (repeat per floor)")
    parser.add_argument("--stats", default="")
    args = parser.parse_args()

    floors = [load_floor(spec) for spec in args.floor]
    stats = {}
    if args.stats and Path(args.stats).exists():
        stats = json.loads(Path(args.stats).read_text(encoding="utf-8"))
    template = (HERE / "viewer.template.html").read_text(encoding="utf-8")
    html = template.replace("/*__VIEW_DATA__*/null", json.dumps({"floors": floors, "stats": stats}, ensure_ascii=False, separators=(",", ":")))
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    rooms = sum(len(f["rooms"]) for f in floors)
    print(f"wrote {out} | floors {len(floors)}, rooms {rooms}, stats for {len(stats)} locations", file=sys.stderr)


if __name__ == "__main__":
    main()
