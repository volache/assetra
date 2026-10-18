"""Indoor map prototype: build ONE tracing page that holds every building and every floor.

Isolated from the application: nothing under src/ or supabase/ is touched.

    python prototypes/indoor-map/trace/build_building.py data/private/indoor-map/buildings/*.json         --title 花蓮航空站平面圖製作工具 --key 航廈平面圖製作工具 --output data/private/indoor-map/花蓮航空站平面圖製作工具.html

Each JSON file is one building; the page lets you switch between buildings and between the floors of each.
The page holds only the drawings.  Nothing the user traced and no 存置地點 list is built in: that is all read from
the browser's own storage (and the project folder), so the page never has to be rebuilt for it.

A building config is a small JSON file (kept with the private data):

    {
      "name": "航廈",
      "reference": "航廈二樓",
      "floors": [
        {"title": "航廈地下一樓", "label": "地下一樓", "dxf": "data/private/floorplans/航廈地下一樓.dxf"},
        {"title": "航廈淺漥區", "label": "淺漥區", "dxf": "data/private/floorplans/航廈淺漥區.dxf",
         "sameFrameAs": "航廈地下一樓"},
        {"title": "宿舍二樓", "label": "二樓", "dxf": "...", "crop": [9550, 2200, 14900, 10600]}
      ]
    }

Floors are listed from the lowest up.  `reference` names the floor whose drawing the others are lined up with:
each floor's outline is matched against it (or against a floor that already matched) so shapes can be shown and
copied from one floor to another.  `sameFrameAs` says a drawing shares its coordinates with another floor (a second
sheet of the same level), so it takes that floor's position.  `extra` adds more drawings to one floor (same
coordinates); `crop` keeps one region of a file that holds several floors.
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from align_floors import align  # noqa: E402
from build_tracer import floor_record, write_page  # noqa: E402

MIN_SCORE = 0.4


def clear_match(result):
    return result["score"] >= MIN_SCORE and result["score"] >= result["runnerUp"] * 1.1


def solve_offsets(configs, reference_title):
    """Where each floor's drawing sits in the reference floor's coordinates: [dx, dy, score] or None."""
    by_title = {c["title"]: c for c in configs}
    if reference_title not in by_title:
        raise SystemExit(f"reference floor {reference_title!r} is not in the floor list")
    solved = {reference_title: [0, 0, 1.0]}
    same = {c["title"]: c["sameFrameAs"] for c in configs if c.get("sameFrameAs")}
    pending = [c["title"] for c in configs if c["title"] != reference_title and c["title"] not in same]
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
    for title, other in same.items():
        solved[title] = solved.get(other)
    return {c["title"]: solved.get(c["title"]) for c in configs}


def build_one(config):
    """One building of the page: its floors, lined up with each other."""
    floors_config = config["floors"]
    offsets = solve_offsets(floors_config, config.get("reference") or floors_config[0]["title"]) if len(floors_config) > 1 else {}
    floors = []
    for item in floors_config:
        extra = [(e["dxf"], e.get("crop")) for e in item.get("extra", [])]
        floor = floor_record(item["dxf"], item["title"], item.get("crop"), item.get("label"), extra)
        found = offsets.get(item["title"], [0, 0, 1.0])
        floor["offset"] = [found[0], found[1]] if found else None
        floor["alignScore"] = found[2] if found else 0
        floors.append(floor)
        print(f"{item['title']}: {len(floor['segments'])} segments, {len(floor['texts'])} texts", file=sys.stderr)
    return {"name": config["name"], "floors": floors}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("configs", nargs="+", help="one JSON config per building")
    parser.add_argument("--title", default="", help="page title (default: the first building's name)")
    parser.add_argument("--key", default="", help="name the browser saves this project under (default: the title); keep it when only the title changes, or the saved work will not be found")
    parser.add_argument("--output", default="", help="output HTML (default: the first config's output)")
    args = parser.parse_args()
    configs = [json.loads(Path(c).read_text(encoding="utf-8")) for c in args.configs]
    buildings = [build_one(config) for config in configs]
    title = args.title or buildings[0]["name"]
    campus = {"title": title, "key": args.key or title, "buildings": buildings}
    out = write_page(campus, args.output or configs[0]["output"])
    print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB, {len(buildings)} buildings, {sum(len(b['floors']) for b in buildings)} floors)", file=sys.stderr)


if __name__ == "__main__":
    main()
