"""Turn wall / column / beam line work into solid filled polygons.

CAD walls are drawn as two parallel lines (often broken at columns and doors).
The result here is one connected solid shape:

  1. nearby dangling ends are bridged (T-junction gaps and end-to-end gaps),
  2. lines are thickened and unioned,
  3. the narrow cavities between double lines and the hollow insides of column
     squares are filled (faces that are too narrow or too small to be a room),
  4. a small morphological closing joins what is still hairline-apart.

Real door openings (~90 cm) are wider than every tolerance here and stay open.
"""
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import unary_union

from rooms import _gap_bridges


def _rings(geom, simplify):
    polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    out = []
    for p in polys:
        if p.is_empty or not isinstance(p, Polygon):
            continue
        p = p.simplify(simplify)
        if p.is_empty:
            continue
        out.append([list(p.exterior.coords)] + [list(i.coords) for i in p.interiors])
    return out


def solidify(polylines, thickness=5.0, snap=15.0, join=20.0, close=6.0,
             min_width=50.0, min_area=15000.0, simplify=1.0):
    """polylines: [(pts, closed)].  Returns [[ring, hole, ...], ...] (one entry per polygon)."""
    lines = [LineString(p + ([p[0]] if closed and p[0] != p[-1] else []))
             for p, closed in polylines if len(p) >= 2]
    lines = [ln for ln in lines if ln.length > 0]
    if not lines:
        return []
    bridges = [LineString(b) for b in _gap_bridges(lines, snap, join)]
    net = unary_union(lines + bridges).buffer(thickness)

    env = net.envelope.buffer(300)
    free = env.difference(net)
    faces = list(free.geoms) if hasattr(free, "geoms") else [free]
    fill = []
    for f in faces:
        if f.intersects(env.exterior):
            continue
        if f.area < min_area or f.buffer(-min_width / 2).is_empty:
            fill.append(f.buffer(thickness))

    solid = unary_union([net] + fill)
    if close:
        solid = solid.buffer(close).buffer(-close)
    return _rings(solid, simplify)
