# Private source data

Everything under `data/private/` is ignored by Git. Only this README is versioned, so it is
safe to push the whole repository: registers, ownership documents, CAD files and generated
SQL stay on the local machine.

```text
data/private/
├─ inventory/                 Source registers (.xlsx) used by the import page
├─ geospatial/
│  └─ land-properties.geojson Cadastral source; see "Land parcels" below
├─ ownership/
│  ├─ 土地所有權狀/
│  └─ 建物所有權狀/
├─ floorplans/                Original CAD drawings (.dxf / .ai), never edited
├─ indoor-map/                Working files of the floor-plan tools (tools/indoor-map)
│  ├─ buildings/              Building configs, plus the combined tracer .html (rebuild after template changes)
│  ├─ rooms/                  Traced rooms, one `<floor>.rooms.json` per floor (the real work product)
│  ├─ import-sql/             SQL generated from `rooms/` (regenerable)
│  ├─ locations.json          Location codes offered by the tracer
│  └─ location-stats.json     Per-location asset totals shown in the viewer
└─ _archive/                  Old backups and superseded tracer pages; delete once no longer needed
```

## Regenerating

- **Land parcels** – run `node scripts/generate-land-parcel-import-sql.mjs` when preparing an
  approved cadastral refresh. The application reads published parcels from Supabase at
  runtime, so the GeoJSON is an import source only and is not bundled into the frontend.
- **Indoor floor plans** – see `tools/indoor-map/README.md`. After tracing, run
  `node scripts/generate-indoor-import-sql.mjs data/private/indoor-map/rooms` to rebuild
  `import-sql/`.

Do not place ownership documents or full source registers in `public/` or `src/`.
