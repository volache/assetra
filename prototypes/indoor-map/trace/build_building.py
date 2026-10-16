"""Indoor map prototype: build ONE tracing page that holds every floor of a building.

Isolated from the application: nothing under src/ or supabase/ is touched.

    python prototypes/indoor-map/trace/build_building.py data/private/indoor-map/buildings/航廈.json

The config is a small JSON file (kept with the private data):

    {
      "name": "航廈",
      "output": "data/private/indoor-map/buildings/航廈_描圖.html",
      "locations": "data/private/indoor-map/locations.json",
      "reference": "航廈二樓",
      "floors": [
        {"title": "航廈地下一樓", "label": "地下一樓", "dxf": "data/private/floorplans/航廈地下一樓.dxf"},
        {"title": "航廈三樓", "label": "三樓", "dxf": "data/private/floorplans/航廈三樓-修改.dxf",
         "seed": "data/private/indoor-map/航廈三樓.rooms.json"},
        {"title": "宿舍二樓", "label": "二樓", "dxf": "...", "crop": [9550, 2200, 14900, 10600]}
      ]
    }

Floors are listed from the lowest up.  `reference` names the floor whose drawing the others are lined up with:
each floor's outline is matched against it (or against a floor that already matched) so shapes can be shown and
copied from one floor to another.  `seed` is an earlier export that is loaded the first time a floor is opened
in a browser that has nothing saved for it.
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from align_floors import align  # noqa: E402
from build_tracer import floor_record, load_locations, write_page  # noqa: E402

MIN_SCORE = 0.4


def clear_match(result):
    return result["score"] >= MIN_SCORE and result["score"] >= result["runnerUp"] * 1.1


def solve_offsets(configs, reference_title):
    """Where each floor's drawing sits in the reference floor's coordinates: [dx, dy, score] or None."""
    by_title = {c["title"]: c for c in configs}
    if reference_title not in by_title:
        raise SystemExit(f"reference floor {reference_title!r} is not in the floor list")
    solved = {reference_title: [0, 0, 1.0]}
    pending = [c["title"] for c in configs if c["title"] != reference_title]
    progress = True
    while pending and progress:
        progress = False
        for title in list(pending):
            moving = by_title[title]
            for anchor_title, (adx, ady, _) in list(solved.items()):
                anchor = by_title[anchor_title]
                result = align(anchor["dxf"], moving["dxf"], anchor.get("crop"), moving.get("crop"))
                note = f"{title} -> {anchor_title}: dx {result['dx']}, dy {result['dy']}, score {result['score']} (next {result['runnerUp']})"
                if clear_match(result):
                    solved[title] = [result["dx"] + adx, result["dy"] + ady, result["score"]]
                    print("aligned  " + note, file=sys.stderr)
                    pending.remove(title)
                    progress = True
                    break
                print("unclear  " + note, file=sys.stderr)
    for title in pending:
        print(f"WARNING: {title} could not be lined up with the other floors", file=sys.stderr)
    return {c["title"]: solved.get(c["title"]) for c in configs}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    floors_config = config["floors"]
    offsets = solve_offsets(floors_config, config.get("reference") or floors_config[0]["title"]) if len(floors_config) > 1 else {}
    floors = []
    for item in floors_config:
        floor = floor_record(item["dxf"], item["title"], item.get("crop"), item.get("label"))
        found = offsets.get(item["title"], [0, 0, 1.0])
        floor["offset"] = [found[0], found[1]] if found else None
        floor["alignScore"] = found[2] if found else 0
        if item.get("seed") and Path(item["seed"]).exists():
            floor["seed"] = json.loads(Path(item["seed"]).read_text(encoding="utf-8"))
        floors.append(floor)
        print(f"{item['title']}: {len(floor['segments'])} segments, {len(floor['texts'])} texts", file=sys.stderr)
    building = {"name": config["name"], "locations": load_locations(config.get("locations")), "floors": floors}
    out = write_page(building, config["output"])
    print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB, {len(floors)} floors)", file=sys.stderr)


if __name__ == "__main__":
    main()
