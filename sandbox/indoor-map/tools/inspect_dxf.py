#!/usr/bin/env python3
"""Profile a DXF before writing a clean config.

Usage:  python inspect_dxf.py <file.dxf> <out.png> [--crop x0 y0 x1 y1] [--text KEYWORD ...]

Prints per-layer primitive counts and the position of every TEXT/MTEXT whose
content contains a keyword (default: 平面圖), then renders a colour-by-layer
overview PNG so crop windows and layer mappings can be chosen by eye.
"""
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import ezdxf
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection

sys.path.insert(0, str(Path(__file__).parent))
from clean_dxf import primitives, to_polylines  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")


def main():
    path, out = sys.argv[1], sys.argv[2]
    keys = ["平面圖"]
    crop = None
    argv = sys.argv[3:]
    if "--crop" in argv:
        i = argv.index("--crop")
        crop = [float(v) for v in argv[i + 1:i + 5]]
        argv = argv[:i] + argv[i + 5:]
    if "--text" in argv:
        keys = argv[argv.index("--text") + 1:]
    doc = ezdxf.readfile(path, encoding="cp950")
    counts = defaultdict(Counter)
    segs = defaultdict(list)
    for ent in doc.modelspace():
        for p in primitives(ent):
            t = p.dxftype()
            counts[p.dxf.layer][t] += 1
            if t in ("TEXT", "MTEXT"):
                txt = p.dxf.text if t == "TEXT" else p.text
                if any(k in txt for k in keys):
                    ins = p.dxf.insert
                    print(f"TEXT[{p.dxf.layer}] {txt!r} at ({ins.x:.0f}, {ins.y:.0f})")
            for pts, closed in to_polylines(p):
                if closed:
                    pts = pts + [pts[0]]
                segs[p.dxf.layer].append(pts)
    print("--- layers")
    for layer, c in sorted(counts.items(), key=lambda kv: -sum(kv[1].values())):
        print(f"{layer!r:28} {dict(c)}")

    cmap = plt.get_cmap("tab20")
    fig, ax = plt.subplots(figsize=(18, 12))
    for i, (layer, polys) in enumerate(sorted(segs.items(), key=lambda kv: -len(kv[1]))):
        ax.add_collection(LineCollection(polys, colors=[cmap(i % 20)], linewidths=0.4, label=layer))
    ax.autoscale()
    if crop:
        ax.set_xlim(crop[0], crop[2])
        ax.set_ylim(crop[1], crop[3])
    ax.set_aspect("equal")
    ax.legend(fontsize=6, ncol=2, loc="upper right")
    fig.savefig(out, dpi=70)


if __name__ == "__main__":
    main()
