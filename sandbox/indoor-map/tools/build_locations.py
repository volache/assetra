#!/usr/bin/env python3
"""Build data/locations.json from the private inventory workbooks.

One entry per 存置地點 (storage location): code, name, asset count, owning
units, a guessed building / floor / kind, and the grouped item list.  Output is
derived from private data and is gitignored (sandbox/indoor-map/data/).

Usage:  python build_locations.py
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[3]
INVENTORY = ROOT / "data" / "private" / "inventory"
OUT = Path(__file__).resolve().parents[1] / "data" / "locations.json"
FILES = {"財產": "財產清冊_使用中_1150922.xlsx", "物品": "物品清冊_使用中_1150922.xlsx"}
FLOORS = {"1": "1F", "2": "2F", "3": "3F"}


def classify(code, name):
    """(building, floor, kind) from the location code and name."""
    if not code.startswith("*"):
        return "舊代碼", "—", "legacy"
    k = code[1:]
    if k.startswith(("V", "X")):
        return ("車輛" if k.startswith("V") else "戶外／外單位"), "—", "vehicle" if k.startswith("V") else "external"
    if k.startswith("H"):
        building = "宿舍"
    elif re.match(r"B[1-3]\d\d|BG|BX", k):
        building = "消防站"
    elif k == "C041":
        building = "污水處理廠"
    elif k.startswith("CB0") and k != "CB00":
        building = "空橋"
    else:
        building = "航廈"
    m = re.search(r"(B1|1F|2F|3F|1樓|2樓|3樓)", name)
    floor = m.group(1) if m else None
    if building == "消防站":
        floor = FLOORS.get(k[1], "1F") if k[0] == "B" and k[1] in "123" else "1F"
    elif building == "宿舍":
        floor = FLOORS.get(k[1], floor)
    elif building == "航廈" and floor is None and k[0] in "CKNRS" and len(k) > 1 and k[1] in "123":
        floor = FLOORS[k[1]]
    if k.startswith(("CB", "CP", "U")) or k.startswith("S19"):
        floor = floor or "B1"
    aggregate = "集合財產" in name or name in ("航廈", "宿舍", "消防班")
    kind = "aggregate" if aggregate else ("toilet" if k.startswith("R") else "room")
    return building, floor or "?", kind


def main():
    locs = {}
    for source, fname in FILES.items():
        ws = openpyxl.load_workbook(INVENTORY / fname, read_only=True, data_only=True).worksheets[0]
        for i, r in enumerate(ws.iter_rows(values_only=True)):
            if i == 0:
                continue
            code = str(r[11] or "").strip()
            name = str(r[12] or "").strip()
            loc = locs.setdefault((code, name), {"code": code, "name": name, "count": 0,
                                                 "units": Counter(), "items": defaultdict(int)})
            qty = r[19] if isinstance(r[19], (int, float)) else 1
            loc["count"] += 1
            loc["units"][r[10] or "—"] += 1
            loc["items"][str(r[6] or r[25] or "—")] += qty
    out = []
    for (code, name), loc in sorted(locs.items()):
        building, floor, kind = classify(code, name)
        out.append({
            "code": code, "name": name, "count": loc["count"], "building": building,
            "floor": floor, "kind": kind, "units": dict(loc["units"]),
            "items": sorted(({"name": n, "qty": q} for n, q in loc["items"].items()),
                            key=lambda x: -x["qty"]),
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(out)} locations, {sum(x['count'] for x in out)} assets -> {OUT}")


if __name__ == "__main__":
    main()
