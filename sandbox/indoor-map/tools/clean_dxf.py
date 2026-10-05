#!/usr/bin/env python3
"""Clean a CAD floor-plan DXF into semantic SVG layers for the indoor-map sandbox.

Usage:  python clean_dxf.py configs/dormitory-12f.json

One config describes one source DXF: the shared layer mapping plus a list of
`plans`, each a crop window around one floor drawing (CAD sheets usually hold
several floors, a title block and unrelated details).  Source layers that are
not mapped are dropped.  Layers listed in `geometryLayers` mix everything
together, so their entities are classified from shape (see geom_classify.py).
Output per plan: <out>/<id>.svg and <id>.json (meta + labels + cleaning report).

Layer spec options:  from, label, visible, dropTypes (entity types to discard),
drop (classify but do not output, e.g. hatching noise).
"""
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import ezdxf

from geom_classify import classify
from rooms import build as build_rooms

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = Path(__file__).resolve().parents[1] / "data"
ARC_STEP_DEG = 6
AXIS_TOLERANCE_DEG = 3
SURROGATES = re.compile("[" + chr(0xD800) + "-" + chr(0xDFFF) + "]")


def primitives(entity):
    """Yield drawable primitives, exploding block inserts recursively."""
    if entity.dxftype() == "INSERT":
        try:
            for sub in entity.virtual_entities():
                yield from primitives(sub)
        except Exception:
            return
    else:
        yield entity


def arc_points(cx, cy, r, a0, a1):
    if a1 <= a0:
        a1 += 360
    n = max(2, int(math.ceil((a1 - a0) / ARC_STEP_DEG)))
    return [
        (cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
         cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n)))
        for i in range(n + 1)
    ]


def to_polylines(e):
    """Return list of (points, closed) in CAD coordinates, or [] if unsupported."""
    t = e.dxftype()
    try:
        if t == "LINE":
            return [([(e.dxf.start.x, e.dxf.start.y), (e.dxf.end.x, e.dxf.end.y)], False)]
        if t == "LWPOLYLINE":
            if any(p[4] for p in e.get_points("xyseb")):  # bulge => arc segments
                return [pl for sub in e.virtual_entities() for pl in to_polylines(sub)]
            pts = [(p[0], p[1]) for p in e.get_points()]
            return [(pts, bool(e.closed))] if len(pts) >= 2 else []
        if t == "POLYLINE":
            pts = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
            return [(pts, bool(e.is_closed))] if len(pts) >= 2 else []
        if t == "CIRCLE":
            c, r = e.dxf.center, e.dxf.radius
            return [(arc_points(c.x, c.y, r, 0, 360)[:-1], True)]
        if t == "ARC":
            c = e.dxf.center
            return [(arc_points(c.x, c.y, e.dxf.radius, e.dxf.start_angle, e.dxf.end_angle), False)]
        if t in ("ELLIPSE", "SPLINE"):
            pts = [(v.x, v.y) for v in e.flattening(3.0)]
            closed = t == "ELLIPSE" and abs(e.dxf.end_param - e.dxf.start_param - math.tau) < 1e-6
            return [(pts, closed)] if len(pts) >= 2 else []
    except Exception:
        return []
    return []


def length(pts):
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


def in_window(x, y, crop):
    return crop[0] <= x <= crop[2] and crop[1] <= y <= crop[3]


def centroid(pts):
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def is_projection_line(p, pts, min_len):
    """Long off-axis LINE: the leader/projection lines CAD sheets use to relate floors."""
    if not min_len or p.dxftype() != "LINE" or length(pts) < min_len:
        return False
    ang = math.degrees(math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])) % 90
    return AXIS_TOLERANCE_DEG < ang < 90 - AXIS_TOLERANCE_DEG


def text_record(p):
    """(text, x, y, height, rotation, anchor) for TEXT/MTEXT, else None."""
    t = p.dxftype()
    if t == "MTEXT":
        txt, h, rot = p.plain_text(), p.dxf.get("char_height", 0), p.dxf.get("rotation", 0)
        pos, anchor = p.dxf.insert, "start"
    elif t == "TEXT":
        txt, h, rot = p.dxf.text, p.dxf.height, p.dxf.get("rotation", 0)
        halign = p.dxf.get("halign", 0)
        aligned = halign or p.dxf.get("valign", 0)
        pos = p.dxf.align_point if aligned and p.dxf.hasattr("align_point") else p.dxf.insert
        anchor = {1: "middle", 4: "middle", 5: "middle", 2: "end"}.get(halign, "start")
    else:
        return None
    # drop AutoCAD %%codes and bytes cp950 could not decode (lone surrogates)
    txt = SURROGATES.sub("", re.sub(r"%%[a-zA-Z]", "", txt)).strip()
    return (txt, pos.x, pos.y, h, rot, anchor) if txt else None


def escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def clean_plan(doc_items, cfg, plan, layer_of):
    crop = plan["crop"]
    min_len = cfg.get("minLength", 2.0)
    snap = cfg.get("snap", 0.5)
    proj = plan.get("dropProjectionLines", cfg.get("dropProjectionLines", 0))
    label_cfg = cfg.get("labels", {})
    label_layers = set(label_cfg.get("from", []))
    label_drop = [re.compile(x) for x in label_cfg.get("exclude", [])]
    geometry_layers = set(cfg.get("geometryLayers", []))

    report = {"read": 0, "outsideCrop": 0, "tooShort": 0, "projectionLines": 0,
              "duplicate": 0, "droppedByType": 0, "droppedAsNoise": 0,
              "unmapped": Counter(), "kept": Counter(), "labelsDropped": 0}
    seen = set()
    out = defaultdict(list)
    pending = []
    labels = []
    seen_labels = set()

    def emit(sem, p, pts, closed):
        spec = cfg["layers"].get(sem, {})
        if spec.get("drop"):
            report["droppedAsNoise"] += 1
            return
        if p.dxftype() in spec.get("dropTypes", ()):
            report["droppedByType"] += 1
            return
        q = [(round(x / snap) * snap, round(y / snap) * snap) for x, y in pts]
        key = (sem, tuple(q), closed)
        if key in seen or (sem, tuple(reversed(q)), closed) in seen:
            report["duplicate"] += 1
            return
        seen.add(key)
        out[sem].append((pts, closed))
        report["kept"][sem] += 1

    for p, geoms, rec in doc_items:
        layer = p.dxf.layer
        if rec is not None:
            if layer not in label_layers:
                continue
            txt, x, y, h, rot, anchor = rec
            if not in_window(x, y, crop):
                continue
            if any(rx.search(txt) for rx in label_drop):
                report["labelsDropped"] += 1
                continue
            key = (txt, round(x), round(y))
            if key in seen_labels:
                continue
            seen_labels.add(key)
            labels.append({"text": txt, "x": round(x, 1), "y": round(y, 1),
                           "h": round(h, 1), "rot": round(rot, 1), "anchor": anchor})
            continue
        for pts, closed in geoms:
            report["read"] += 1
            cx, cy = centroid(pts)
            if not in_window(cx, cy, crop):
                report["outsideCrop"] += 1
                continue
            geometric = layer in geometry_layers
            sem = None if geometric else layer_of.get(layer)
            if sem is None and not geometric:
                report["unmapped"][layer] += 1
                continue
            if length(pts) < min_len:
                report["tooShort"] += 1
                continue
            if is_projection_line(p, pts, proj):
                report["projectionLines"] += 1
                continue
            if geometric:
                pending.append((p, pts, closed))
            else:
                emit(sem, p, pts, closed)

    if pending:
        for i, sem in classify(pending).items():
            emit(sem, *pending[i])
    return out, labels, report


def write_plan(cfg, plan, out, labels, report, src, rooms=(), bridges=None):
    allpts = [pt for polys in out.values() for pts, _ in polys for pt in pts]
    allpts += [pt for r in rooms for ring in r["polygon"] for pt in ring]
    minx, maxx = min(x for x, _ in allpts), max(x for x, _ in allpts)
    miny, maxy = min(y for _, y in allpts), max(y for _, y in allpts)
    pad = cfg.get("padding", 200)
    vb = [minx - pad, -(maxy + pad), (maxx - minx) + 2 * pad, (maxy - miny) + 2 * pad]

    def path_d(polys):
        parts = []
        for pts, closed in polys:
            parts.append("M" + " L".join(f"{x:.1f} {-y:.1f}" for x, y in pts) + (" Z" if closed else ""))
        return " ".join(parts)

    order = list(cfg["layers"].keys())
    groups = []
    if rooms:
        rp = []
        for r in rooms:
            d = " ".join("M" + " L".join(f"{x:.1f} {-y:.1f}" for x, y in ring) + " Z" for ring in r["polygon"])
            rp.append(f'<path class="room" data-id="{r["id"]}" data-name="{escape(r["name"])}" '
                      f'data-number="{r["number"] or ""}" data-area="{r["area"]}" d="{d}"/>')
        groups.append(f'<g id="room" class="layer layer-room">{"".join(rp)}</g>')
    groups += [f'<g id="{s}" class="layer layer-{s}"><path d="{path_d(out[s])}"/></g>'
               for s in order if s in out]
    if labels:
        texts = []
        for lb in labels:
            rot = f' transform="rotate({-lb["rot"]:.1f} {lb["x"]:.1f} {-lb["y"]:.1f})"' if lb["rot"] else ""
            texts.append(f'<text x="{lb["x"]:.1f}" y="{-lb["y"]:.1f}" font-size="{lb["h"]:.1f}" '
                         f'text-anchor="{lb["anchor"]}"{rot}>{escape(lb["text"])}</text>')
        groups.append(f'<g id="label" class="layer layer-label">{"".join(texts)}</g>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb[0]:.1f} {vb[1]:.1f} '
           f'{vb[2]:.1f} {vb[3]:.1f}" data-id="{plan["id"]}">' + "".join(groups) + "</svg>")

    layers_meta = []
    if rooms:
        layers_meta.append({"id": "room", "label": "房間範圍", "visible": True, "count": len(rooms)})
    layers_meta += [{"id": s, "label": cfg["layers"][s].get("label", s),
                     "visible": cfg["layers"][s].get("visible", True),
                     "count": report["kept"][s]} for s in order if s in out]
    if labels:
        layers_meta.append({"id": "label", "label": cfg.get("labels", {}).get("label", "文字標籤"),
                            "visible": True, "count": len(labels)})
    meta = {
        "id": plan["id"], "name": plan["name"], "unit": cfg.get("unit", "cm"),
        "source": cfg["source"], "viewBox": vb, "layers": layers_meta, "labels": labels,
        "rooms": list(rooms), "bridges": bridges or {"door": [], "gap": []},
        "report": {**{k: v for k, v in report.items() if k not in ("unmapped", "kept")},
                   "unmappedInCrop": dict(report["unmapped"]), "kept": dict(report["kept"]),
                   "labels": len(labels), "svgBytes": len(svg.encode("utf-8")),
                   "sourceBytes": src.stat().st_size},
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"{plan['id']}.svg").write_text(svg, encoding="utf-8")
    (OUT_DIR / f"{plan['id']}.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def clean(cfg_path):
    cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    src = ROOT / "data" / "private" / "floorplans" / cfg["source"]
    doc = ezdxf.readfile(str(src), encoding=cfg.get("encoding", "cp950"))
    layer_of = {sl: sem for sem, spec in cfg["layers"].items() for sl in spec["from"]}

    # Explode and flatten once; every plan crops from the same primitives.
    items = []
    for ent in doc.modelspace():
        for p in primitives(ent):
            rec = text_record(p)
            geoms = [] if rec else to_polylines(p)
            if rec or geoms:
                items.append((p, geoms, rec))

    for plan in cfg["plans"]:
        out, labels, report = clean_plan(items, cfg, plan, layer_of)
        rooms, bridges = [], None
        if "rooms" in cfg:
            # room mode: keep only room polygons + simplified walls + labels
            rooms, walls, bridges = build_rooms(items, cfg, plan, labels, in_window, centroid)
            out = {"wall": [(w, False) for w in walls]}
            report["kept"] = Counter({"wall": len(walls)})
        meta = write_plan(cfg, plan, out, labels, report, src, rooms, bridges)
        r = meta["report"]
        print(f"[{plan['id']}] {plan['name']}: kept={sum(r['kept'].values())} labels={r['labels']} "
              f"outside={r['outsideCrop']} dup={r['duplicate']} type={r['droppedByType']} "
              f"noise={r['droppedAsNoise']} proj={r['projectionLines']} rooms={len(rooms)} "
              f"svg={r['svgBytes'] // 1024}KB (src {r['sourceBytes'] // 1024}KB)")
        print("   kept:", r["kept"], "| unmapped in crop:", r["unmappedInCrop"])


if __name__ == "__main__":
    clean(sys.argv[1])
