"""Find how one floor's drawing lines up with another's.

Different DXF files do not share an origin, so rooms traced on one floor land
in the wrong place on another floor's underlay.  The outer walls of a building
are nearly the same on every floor, so this lays the long wall lines of both
drawings on a raster and finds the shift that makes them overlap the most.

    python prototypes/indoor-map/trace/align_floors.py \
        data/private/floorplans/航廈二樓不含外部.dxf \
        data/private/floorplans/航廈三樓-修改.dxf

Prints the offset that moves the second drawing's coordinates onto the first's
(add dx, dy to its x, y), with a score: the share of the second drawing's wall
pixels that land on the first drawing's walls.
"""
import argparse
import io
import sys

import ezdxf
import numpy as np
from ezdxf import path as dxf_path_tools
from PIL import Image, ImageDraw

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
RES = 20.0          # drawing units per pixel
MIN_LINE = 150.0    # only long lines are walls worth matching


def long_lines(path, crop=None):
    doc = ezdxf.readfile(path)
    lines = []
    inside = lambda x, y: crop is None or (crop[0] <= x <= crop[2] and crop[1] <= y <= crop[3])
    for entity in doc.modelspace():
        kind = entity.dxftype()
        try:
            if kind == "LINE":
                a = (entity.dxf.start.x, entity.dxf.start.y)
                b = (entity.dxf.end.x, entity.dxf.end.y)
                if np.hypot(a[0] - b[0], a[1] - b[1]) >= MIN_LINE and inside((a[0] + b[0]) / 2, (a[1] + b[1]) / 2):
                    lines.append([a, b])
            elif kind in ("ARC", "LWPOLYLINE"):
                points = [(p.x, p.y) for p in dxf_path_tools.make_path(entity).flattening(20.0)]
                if len(points) > 1 and inside(*points[len(points) // 2]):
                    lines.append(points)
        except Exception:
            continue
    return lines


def raster(lines):
    xs = [p[0] for line in lines for p in line]
    ys = [p[1] for line in lines for p in line]
    x0, y1 = min(xs), max(ys)
    width = int((max(xs) - x0) / RES) + 4
    height = int((y1 - min(ys)) / RES) + 4
    image = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(image)
    for line in lines:
        draw.line([((x - x0) / RES + 1, (y1 - y) / RES + 1) for x, y in line], fill=255, width=3)
    return (np.asarray(image, dtype=np.float32) / 255.0), x0, y1


def best_shifts(a, b, top=4):
    rows, cols = a.shape[0] + b.shape[0], a.shape[1] + b.shape[1]
    corr = np.fft.irfft2(np.fft.rfft2(a, (rows, cols)) * np.conj(np.fft.rfft2(b, (rows, cols))), (rows, cols))
    # A index = B index + shift.  Real shifts run from -(size of B) up to +(size of A), so an index
    # inside A's size is a positive shift and anything past it wrapped around to a negative one.
    valid = np.full(corr.shape, False)
    valid[: a.shape[0], : a.shape[1]] = True
    valid[rows - b.shape[0] + 1:, :] |= False
    work = np.where(valid, corr, -1.0)
    # negative shifts live at the far end of each axis
    work[rows - b.shape[0] + 1:, : a.shape[1]] = corr[rows - b.shape[0] + 1:, : a.shape[1]]
    work[: a.shape[0], cols - b.shape[1] + 1:] = corr[: a.shape[0], cols - b.shape[1] + 1:]
    work[rows - b.shape[0] + 1:, cols - b.shape[1] + 1:] = corr[rows - b.shape[0] + 1:, cols - b.shape[1] + 1:]
    found = []
    for _ in range(top):
        r, c = np.unravel_index(np.argmax(work), work.shape)
        sy = int(r) if r < a.shape[0] else int(r) - rows
        sx = int(c) if c < a.shape[1] else int(c) - cols
        found.append((float(work[r, c]) / float(b.sum()), sx, sy))
        work[max(0, r - 15): r + 16, max(0, c - 15): c + 16] = -1.0
    return found


def align(reference_path, moving_path, reference_crop=None):
    """Offset (dx, dy) that moves the moving drawing onto the reference one, with its score and the runner-up's."""
    a, ax0, ay1 = raster(long_lines(reference_path, reference_crop))
    b, bx0, by1 = raster(long_lines(moving_path))
    found = best_shifts(a, b, top=2)
    score, sx, sy = found[0]
    return {
        "dx": round(ax0 - bx0 + sx * RES),
        "dy": round(ay1 - by1 - sy * RES),
        "score": round(score, 3),
        "runnerUp": round(found[1][0], 3) if len(found) > 1 else 0,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("reference")
    parser.add_argument("moving")
    args = parser.parse_args()
    a, ax0, ay1 = raster(long_lines(args.reference))
    b, bx0, by1 = raster(long_lines(args.moving))
    print(f"reference raster {a.shape[::-1]}, moving raster {b.shape[::-1]}")
    for rank, (score, sx, sy) in enumerate(best_shifts(a, b), 1):
        dx = ax0 - bx0 + sx * RES
        dy = ay1 - by1 - sy * RES
        print(f"#{rank}: score {score:.2f}  dx {dx:.0f}  dy {dy:.0f}")


if __name__ == "__main__":
    main()
