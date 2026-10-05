#!/usr/bin/env python3
"""Place the terminal's storage locations on its floor plans (schematic source).

The terminal CAD has no room list that matches the asset register, so each
location is matched to a CAD room label (or a hand-picked point) and given a
shape:  (1) an explicit rectangle, (2) the auto-detected room face containing the
seed, or (3) a clipped Voronoi cell around the seed.  Everything except exact
room-number matches is flagged provisional.

Usage:  python place_terminal.py      ->  schematic/terminal.json
"""
import json
import math
import re
import sys
from pathlib import Path

from shapely.geometry import MultiPoint, Point, Polygon, box
from shapely.ops import unary_union
from shapely.ops import voronoi_diagram

sys.stdout.reconfigure(encoding="utf-8")
BASE = Path(__file__).resolve().parents[1]
DATA = BASE / "data"
RADIUS = {"toilet": 230, "small": 330, "office": 520, "zone": 900}
MIN_AREA = 12000.0


# ---------------------------------------------------------------- floors ----
# s(code, kind, find, ...)  find = ("text", x, y) label nearest (x, y) | ("at", x, y) | ("num", "060")
def s(code, kind, find=None, rect=None, guess=True, radius=None, name=None, face=True):
    return {"code": code, "kind": kind, "find": find, "rect": rect, "guess": guess,
            "radius": radius, "name": name, "face": face}


T = lambda text, x, y: ("text", x, y, text)
A = lambda x, y: ("at", x, y)
N = lambda num: ("num", num)

FLOORS = [
    {"id": "term-b2", "plan": "terminal-b2", "floor": "B1 停車場", "spaces": [
        s("*CP02", "zone", rect=[9700, 7650, 27700, 12300]),
        s("*CP04", "zone", rect=[25300, 15250, 33100, 16500]),
        s("*CP03", "zone", rect=[5000, 14700, 8300, 15700]),
        s("*CP05", "small", T("旅客停車入口", 25344, 13910)),
        s("*CP06", "small", T("旅客停車出口", 7373, 10170)),
        s("*C007", "office", T("車輛調度室", 8708, 14662)),
        s("*C061", "office", T("自設變電室", 18716, 14929)),
        s("*S197", "small", N("197"), guess=False),
        s("*S198", "small", N("198"), guess=False),
        s("*RB01", "toilet", T("男廁", 6470, 13245)),
        s("*RB02", "toilet", T("女廁", 6493, 13534)),
        s("*RB03", "toilet", A(6480, 13900)),
    ]},
    {"id": "term-b1", "plan": "terminal-b1", "floor": "淺挖區", "spaces": [
        s("*U001", "zone", rect=[5400, 16400, 39200, 20100]),
        s("*U179", "office", N("179"), guess=False, radius=700),
        s("*U180", "office", N("180"), guess=False, radius=700),
        s("*U182", "office", N("182"), guess=False, radius=700),
        s("*U184", "office", N("184"), guess=False, radius=700),
        s("*U192", "office", N("192"), guess=False, radius=700),
    ]},
    {"id": "term-1f", "plan": "terminal-1f", "floor": "1F", "spaces": [
        s("*B001", "office", T("航務組", 17413, 20478), guess=False),
        s("*B004", "office", T("緊急醫療室", 22708, 16263)),
        s("*C006", "office", T("接待室", 23330, 17806)),
        s("*C051", "office", T("服務台", 13564, 17166)),
        s("*C131", "small", T("公務門兼緊急逃生門", 7792, 17349)),
        s("*C101", "zone", rect=[15700, 14600, 20800, 16700]),
        s("*C102", "zone", rect=[15700, 12700, 20800, 14600]),
        s("*C111", "small", T("國內線入境出口", 17330, 17263)),
        s("*C112", "small", T("國際線入境出口", 15998, 15862)),
        s("*C121", "zone", T("國內線入境長廊", 17607, 19112), radius=800),
        s("*C103", "zone", T("國際線入境長廊", 8260, 19169), radius=800),
        s("*C152", "office", T("入境海關証照檢查櫃台", 9131, 16912)),
        s("*C153", "office", T("檢查櫃台", 13459, 16426)),
        s("*C108", "small", A(11300, 16500)),
        s("*C151", "zone", rect=[9600, 17000, 12600, 18600]),
        s("*C141", "zone", rect=[17000, 17300, 21400, 18700]),
        s("*K101", "small", T("茶水間", 23478, 18168)),
        s("*N101", "small", T("哺乳室", 22698, 16017)),
        s("*C008", "zone", rect=[34200, 17300, 37300, 19700]),
    ]},
    {"id": "term-2f", "plan": "terminal-2f", "floor": "2F", "spaces": [
        s("*C201", "zone", rect=[12500, 14150, 22500, 16000]),
        s("*C202", "zone", rect=[12500, 12300, 22500, 14150]),
        s("*C221", "zone", rect=[14000, 17400, 25800, 19100]),
        s("*C231", "zone", rect=[6000, 17000, 13500, 19200]),
        s("*C211", "office", T("國內線安檢室", 20125, 16613)),
        s("*C241", "office", T("轉機室", 7584, 18089), guess=False),
        s("*C004", "office", T("貴賓室", 22117, 16859)),
        s("*C005", "office", T("貴賓室", 10646, 15768)),
        s("*B002", "office", T("值班室", 6227, 16613), radius=330, face=False),
        s("*B003", "office", T("噪音管制室", 6817, 16676), guess=False, radius=330, face=False),
        s("*S060", "small", N("060"), guess=False),
        s("*K201", "small", T("茶水間", 11676, 16906)),
        s("*K202", "small", T("茶水間", 14117, 15325)),
        s("*N201", "small", T("哺乳室", 22794, 17034)),
        s("*N202", "small", T("哺乳室", 14408, 15326)),
        s("*N203", "small", T("哺乳室", 24112, 15338)),
        s("*CB01", "zone", rect=[10400, 19500, 11800, 22300]),
        s("*CB02", "zone", rect=[15900, 19500, 17300, 22300]),
        s("*CB03", "zone", rect=[21000, 19500, 22400, 22300]),
        s("*CB04", "zone", rect=[25000, 19500, 26400, 21500]),
    ]},
    {"id": "term-3f", "plan": "terminal-3f", "floor": "3F", "spaces": [
        s("*A001", "office", T("主任辦公室", 4686, 4748), guess=False),
        s("*B006", "office", T("應變中心", 6660, 4925)),
        s("*C001", "office", T("業務組", 8788, 2661), guess=False),
        s("*E001", "office", T("會計室", 9277, 2671)),
        s("*D001", "office", T("總務組", 9773, 2666), guess=False),
        s("*F001", "office", T("人事室", 6960, 3742), guess=False),
        s("*G001", "office", T("政風室", 6609, 3736), guess=False),
        s("*C012", "office", T("資訊室", 19610, 4392)),
        s("*C011", "office", T("中央管制中心", 19212, 5620)),
        s("*C002", "office", T("會議室", 19332, 3624)),
        s("*CA02", "office", T("檔案室", 9842, 3922)),
        s("*CA04", "office", T("圖檔室", 8784, 3906)),
        s("*C062", "small", T("水箱機房", 9068, 5573)),
        s("*F005", "office", T("休息室", 7812, 5020)),
        s("*K301", "small", T("茶水間", 6843, 4527)),
        s("*S008", "small", N("008"), guess=False),
        s("*S019", "small", N("019"), guess=False),
        s("*S031", "small", N("031"), guess=False),
        s("*F002", "small", T("值日室", 9707, 4560), radius=230),
        s("*F003", "small", T("職員", 9753, 4800), radius=230),
        s("*F004", "small", T("值日室", 10249, 4633)),
        s("*C010", "zone", T("餐廳", 16602, 4587), radius=1000),
    ]},
]

# toilets are placed by cluster (CAD toilet labels grouped by proximity, west -> east)
TOILET_SETS = {
    "term-1f": [["*R113", "*R114", "*R115"], ["*R110", "*R111", "*R112"],
                ["*R107", "*R108", "*R109"], ["*R101", "*R102", "*R103"]],
    "term-2f": [["*R215"], ["*R201", "*R202", "*R203"], ["*R204", "*R205", "*R206"],
                ["*R207", "*R208", "*R209", "*R210", "*R211", "*R212"], ["*R213", "*R214"]],
    "term-3f": [["*R301", "*R302"], ["*R303", "*R304"]],
}


TOILET_MAX_X = {"term-1f": 30000}  # the cargo building at the east end has its own toilets


# ---------------------------------------------------------------- helpers ----
def load_plan(plan):
    return json.loads((DATA / f"{plan}.json").read_text(encoding="utf-8"))


def find_seed(meta, spec):
    f = spec["find"]
    if f is None:
        return None
    if f[0] == "at":
        return (f[1], f[2])
    if f[0] == "num":
        hits = [l for l in meta["labels"] if l["text"] == f[1]]
        return (hits[0]["x"], hits[0]["y"]) if hits else None
    _, x, y, text = f
    hits = [l for l in meta["labels"] if text in l["text"]]
    if not hits:
        return (x, y)
    best = min(hits, key=lambda l: math.dist((l["x"], l["y"]), (x, y)))
    return (best["x"], best["y"])


def face_polygons(meta):
    out = []
    for r in meta.get("rooms", []):
        ring = r["polygon"][0]
        if len(ring) >= 4:
            poly = Polygon(ring)
            if poly.is_valid and 20000 <= poly.area <= 5_000_000:
                out.append(poly)
    return out


def footprint_of(plan):
    svg = (DATA / f"{plan}.svg").read_text(encoding="utf-8")
    m = re.search(r'<g id="wall"[^>]*><path[^>]*d="([^"]*)"', svg)
    polys = []
    for sub in m.group(1).split("M")[1:]:
        try:
            pts = [tuple(float(v) for v in p.replace("Z", "").split()) for p in sub.strip().split(" L")]
        except ValueError:
            continue
        pts = [(x, -y) for x, y in pts]
        if len(pts) >= 4:
            g = Polygon(pts)
            if g.is_valid and g.area > 5000:
                polys.append(g)
    # filled outline of the walls (holes closed) = building area
    u = unary_union(polys).buffer(400).buffer(-400)
    parts = list(u.geoms) if hasattr(u, "geoms") else [u]
    parts = [Polygon(p.exterior) for p in parts if p.area > 2_000_000]
    return unary_union(parts).simplify(120) if parts else None


def regularise(poly):
    if poly.is_empty:
        return poly
    bb = poly.envelope
    return bb if poly.area / bb.area >= 0.62 else poly.simplify(40)


def build_floor(fl):
    meta = load_plan(fl["plan"])
    faces = face_polygons(meta)
    foot = footprint_of(fl["plan"])
    seeds = {}
    placed = []  # (code, geom, spec, how)

    # toilets: cluster -> sets
    sets = TOILET_SETS.get(fl["id"], [])
    if sets:
        tl = [l for l in meta["labels"] if re.fullmatch(r"(男廁|女廁|殘障廁所|男特別|女特別)", l["text"])
              and l["x"] < TOILET_MAX_X.get(fl["id"], 1e9)]
        clusters = []
        for l in sorted(tl, key=lambda l: l["x"]):
            for c in clusters:
                if math.dist((l["x"], l["y"]), (c["x"], c["y"])) < 1200:
                    c["items"].append(l); c["x"] = sum(i["x"] for i in c["items"]) / len(c["items"])
                    c["y"] = sum(i["y"] for i in c["items"]) / len(c["items"]); break
            else:
                clusters.append({"x": l["x"], "y": l["y"], "items": [l]})
        clusters.sort(key=lambda c: c["x"])
        for codes, cl in zip(sets, clusters):
            male = [i for i in cl["items"] if i["text"].startswith("男")]
            fem = [i for i in cl["items"] if i["text"].startswith("女")]
            other = [i for i in cl["items"] if i["text"].startswith("殘")]
            pts = [(male[0]["x"], male[0]["y"]) if male else None, (fem[0]["x"], fem[0]["y"]) if fem else None,
                   (other[0]["x"], other[0]["y"]) if other else None]
            for k, code in enumerate(codes):
                seed = pts[k] if k < 3 and pts[k] else (cl["x"] + 160 * (k + 1), cl["y"] - 200)
                fl["spaces"].append(s(code, "toilet", A(*seed)))

    specs = []
    for sp in fl["spaces"]:
        seed = None if sp["rect"] else find_seed(meta, sp)
        if sp["rect"] is None and seed is None:
            print(f"  ! {fl['id']} {sp['code']}: no seed -> unplaced")
            continue
        specs.append((sp, seed))
    seed_pts = [Point(sd) for _, sd in specs if sd]
    cells = {}
    if len(seed_pts) >= 3:
        env = (foot.envelope if foot else MultiPoint(seed_pts).envelope).buffer(3000)
        for cell in voronoi_diagram(MultiPoint(seed_pts), envelope=env).geoms:
            for sp, sd in specs:
                if sd and cell.contains(Point(sd)):
                    cells[sp["code"]] = cell
    taken = []
    out = []
    under = lambda sp: bool(sp["rect"]) and sp["kind"] == "zone"  # big areas sit underneath smaller rooms
    order = sorted(specs, key=lambda t: (2 if under(t[0]) else (0 if t[0]["guess"] is False else 1)))
    for sp, sd in order:
        how = "rect"
        if sp["rect"]:
            g = box(*sp["rect"])
        else:
            pt = Point(sd)
            face = min((f for f in faces if f.contains(pt) and f.area <= 4_000_000),
                       key=lambda f: f.area, default=None)
            r = sp["radius"] or RADIUS[sp["kind"]]
            if face is not None and sp["face"] and face.area <= (6 * r * r) and sp["kind"] != "toilet":
                g, how = face, "face"
            else:
                g, how = (cells.get(sp["code"], pt.buffer(r)).intersection(pt.buffer(r * 1.6))), "cell"
            if foot is not None and not foot.is_empty:
                clipped = g.intersection(foot.buffer(60))
                g = clipped if not clipped.is_empty else g
            g = regularise(g)
        if taken and not under(sp):
            g = g.difference(unary_union(taken).buffer(25))
        parts = list(g.geoms) if hasattr(g, "geoms") else [g]
        parts = [p for p in parts if isinstance(p, Polygon) and not p.is_empty]
        if not parts:
            print(f"  ! {fl['id']} {sp['code']}: covered by other spaces -> unplaced")
            continue
        g = max(parts, key=lambda p: p.area)
        if g.area < MIN_AREA:
            g = (sd and Point(sd).buffer(math.sqrt(MIN_AREA) / 1.6).envelope) or g
            g = g.difference(unary_union(taken).buffer(25)) if taken else g
            if g.is_empty:
                continue
        if not under(sp):
            taken.append(g)
        out.append((sp, g, how))
    out.sort(key=lambda t: 0 if under(t[0]) else 1)  # underlay first so rooms draw on top
    return meta, foot, out


def main():
    locs = {x["code"]: x for x in json.loads((DATA / "locations.json").read_text(encoding="utf-8"))}
    floors, placed_codes = [], set()
    for fl in FLOORS:
        meta, foot, placed = build_floor(fl)
        spaces = []
        for sp, g, how in placed:
            ring = lambda poly: [[round(x), round(y)] for x, y in list(poly.exterior.coords)[:-1]]
            d = {"code": sp["code"], "kind": {"zone": "public", "toilet": "toilet"}.get(sp["kind"], "room"),
                 "provisional": bool(sp["guess"])}
            if g.geom_type == "Polygon" and g.equals(g.envelope):
                x0, y0, x1, y1 = g.bounds
                d["rects"] = [[round(x0), round(y0), round(x1), round(y1)]]
            else:
                d["polygons"] = [ring(g)]
            spaces.append(d)
            placed_codes.add(sp["code"])
        entry = {"id": fl["id"], "name": fl["floor"], "spaces": spaces}
        if foot is not None:
            polys = list(foot.geoms) if hasattr(foot, "geoms") else [foot]
            entry["footprint"] = [[[round(x), round(y)] for x, y in list(p.exterior.coords)[:-1]] for p in polys]
        floors.append(entry)
        print(f"[{fl['id']}] {len(spaces)} placed")
    # everything else in the terminal buildings goes to the unplaced tile floor
    rest = [x for x in locs.values() if x["building"] in ("航廈", "空橋") and x["code"] not in placed_codes]
    rest.sort(key=lambda x: (x["floor"], x["code"]))
    print(f"unplaced: {len(rest)} locations / {sum(x['count'] for x in rest)} assets")
    doc = {"building": "航廈", "unit": "cm", "floors": floors,
           "unplaced": [x["code"] for x in rest]}
    (BASE / "schematic" / "terminal.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
