// Adds the land source and its two layers (or refreshes them when they exist).
// A basemap switch wipes custom layers, so this runs again after style.load.
export function addLandLayers(map, data) {
  const source = map.getSource("land-properties");
  if (source) source.setData(data);
  else map.addSource("land-properties", { data, type: "geojson" });
  if (!map.getLayer("land-fill"))
    map.addLayer({
      id: "land-fill",
      paint: { "fill-color": "#16a36b", "fill-opacity": 0.32 },
      source: "land-properties",
      type: "fill",
    });
  if (!map.getLayer("land-outline"))
    map.addLayer({
      id: "land-outline",
      paint: { "line-color": "#087a4a", "line-width": 2 },
      source: "land-properties",
      type: "line",
    });
}
