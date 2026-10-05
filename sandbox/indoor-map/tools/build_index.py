#!/usr/bin/env python3
"""Write data/index.json listing every cleaned plan (id + name) for the viewer."""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
plans = []
for p in sorted(DATA.glob("*.json")):
    if p.name == "index.json":
        continue
    meta = json.loads(p.read_text(encoding="utf-8"))
    plans.append({"id": meta["id"], "name": meta["name"]})
(DATA / "index.json").write_text(json.dumps(plans, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"index.json: {len(plans)} plan(s)")
