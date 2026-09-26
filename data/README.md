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

`data/private/` is intentionally ignored by Git. The geographic module reads the local
GeoJSON when present; without it, the application remains buildable and displays no
land parcels. Do not place ownership documents or full source registers in `public/`
or `src/`.
