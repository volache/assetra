# Private source data

Place locally supplied, non-versioned source material under `data/private/`:

```text
data/private/
├─ inventory/
│  ├─ 財產清冊_使用中_1150922.xlsx
│  └─ 物品清冊_使用中_1150922.xlsx
├─ geospatial/
│  └─ land-properties.geojson
└─ ownership/
   ├─ 土地所有權狀/
   └─ 建物所有權狀/
```

`data/private/` is intentionally ignored by Git. The local GeoJSON is retained only as
an import source: run `node scripts/generate-land-parcel-import-sql.mjs` when preparing
an approved cadastral refresh. The application reads published parcel features from
Supabase at runtime, so it no longer bundles this private file into the frontend.
Do not place ownership documents or full source registers in `public/` or `src/`.
