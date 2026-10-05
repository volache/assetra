#!/usr/bin/env python3
"""Generate minimalist schematic floor maps from hand-placed space rectangles.

Usage:  python build_schematic.py schematic/dormitory.json

Source: a list of floors, each a list of spaces {code, kind, short, rects|polygons}.
A space is one 存置地點 (location code) and may consist of several shapes.  Walls
are not drawn from CAD: every space is inset by half a wall thickness, so the gap
between neighbours (and the rim around the building) reads as a thick wall.

Output (sandbox/indoor-map/data/schematic/):
  <floor id>.svg    one path per space + a short label
  <floor id>.json   space list (code, name, short, kind, count, area, label point)
  index.json        all buildings / floors for the viewer
"""
import json
import re
import sys
from pathlib import Path

from shapely.geometry import Polygon, box
from shapely.ops import unary_union

sys.stdout.reconfigure(encoding="utf-8")
BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "data" / "schematic"
WALL = 30.0  # cm, drawn wall thickness


def shapes(space):
    out = [box(*r) for r in space.get("rects", [])]
    out += [Polygon(p) for p in space.get("polygons", [])]
    return unary_union(out)


def path_d(geom):
    polys = geom.geoms if hasattr(geom, "geoms") else [geom]
    parts = []
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            parts.append("M" + " L".join(f"{x:.0f} {-y:.0f}" for x, y in list(ring.coords)[:-1]) + " Z")
    return " ".join(parts)


def label_point(geom):
    polys = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
    biggest = max(polys, key=lambda p: p.area)
    return biggest.representative_point(), biggest


def escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build(src_path):
    src = json.loads(Path(src_path).read_text(encoding="utf-8"))
    locs = {x["code"]: x for x in json.loads((BASE / "data" / "locations.json").read_text(encoding="utf-8"))}
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for fl in src["floors"]:
        for n, s in enumerate(fl["spaces"]):
            s.setdefault("id", s.get("code") or f"_{fl['id']}-{n}")
        geoms = {s["id"]: shapes(s) for s in fl["spaces"]}
        footprint = unary_union(list(geoms.values())).buffer(WALL / 2, join_style=2)
        minx, miny, maxx, maxy = footprint.bounds
        pad = 150
        vb = [minx - pad, -(maxy + pad), maxx - minx + 2 * pad, maxy - miny + 2 * pad]
        body, rooms = [], []
        for s in fl["spaces"]:
            g = geoms[s["id"]].buffer(-WALL / 2, join_style=2)
            loc = locs.get(s.get("code"), {})
            name = loc.get("name") or s.get("name") or s["id"]
            pt, big = label_point(g)
            minside = min(big.bounds[2] - big.bounds[0], big.bounds[3] - big.bounds[1])
            size = max(45.0, min(105.0, minside / 4.2))
            count = loc.get("count", 0)
            short = s.get("short") or re.sub(r"^(消防班[123]F|消防班)", "", name) or name
            body.append(
                f'<g class="space kind-{s["kind"]}{" prov" if s.get("provisional") else ""}" data-code="{s["id"]}">'
                f'<path d="{path_d(g)}"/>'
                f'<text x="{pt.x:.0f}" y="{-pt.y:.0f}" font-size="{size:.0f}" class="nm">{escape(short)}</text>'
                + (f'<text x="{pt.x:.0f}" y="{-pt.y + size * 1.25:.0f}" font-size="{size * .72:.0f}" class="ct">{count} 件</text>'
                   if count else "")
                + "</g>")
            rooms.append({"code": s["id"], "name": name, "provisional": bool(s.get("provisional")), "short": short, "kind": s["kind"],
                          "count": count, "units": loc.get("units", {}), "items": loc.get("items", []),
                          "areaM2": round(g.area / 10000, 1)})
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb[0]:.0f} {vb[1]:.0f} {vb[2]:.0f} {vb[3]:.0f}">'
               f'<path class="wall" d="{path_d(footprint)}"/>' + "".join(body) + "</svg>")
        (OUT / f"{fl['id']}.svg").write_text(svg, encoding="utf-8")
        meta = {"id": fl["id"], "building": src["building"], "floor": fl["name"], "unit": src["unit"],
                "viewBox": vb, "rooms": rooms}
        (OUT / f"{fl['id']}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        index.append({"id": fl["id"], "building": src["building"], "floor": fl["name"],
                      "rooms": len(rooms), "assets": sum(r["count"] for r in rooms)})
        print(f"[{fl['id']}] {src['building']} {fl['name']}: {len(rooms)} spaces, "
              f"{sum(r['count'] for r in rooms)} assets, svg {len(svg) // 1024}KB")
    # merge into index.json (keep other buildings)
    idx_path = OUT / "index.json"
    old = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else []
    keep = [x for x in old if x["building"] != src["building"]]
    idx_path.write_text(json.dumps(keep + index, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    build(sys.argv[1])
