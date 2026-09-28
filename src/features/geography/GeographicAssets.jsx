import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import mapboxgl from "mapbox-gl";
import { money } from "../../lib/formatters";
import { normalized } from "../inventory/search";

const landPropertyFiles = import.meta.glob(
  "../../../data/private/geospatial/land-properties.geojson",
  { eager: true, import: "default", query: "?raw" },
);
const landPropertiesText =
  Object.values(landPropertyFiles)[0] ||
  '{"type":"FeatureCollection","features":[]}';
const landProperties = JSON.parse(landPropertiesText);

function landAssetNumberParts(value) {
  const parts = String(value || "")
    .split("-")
    .filter(Boolean);
  if (parts.length >= 3)
    return { primary: parts.slice(-3, -1).join("-"), serial: parts.at(-1) };
  return { primary: String(value || "—"), serial: "" };
}

function GeoListViewContent({
  activeFilterCount,
  appliedTerm,
  clearFilters,
  compactFilters,
  compactFiltersOpen,
  currentPage,
  filters,
  filtered,
  geoFilterSentinelRef,
  onCompactFiltersOpenChange,
  onOpenMap,
  onPageChange,
  onPageSizeChange,
  onSearch,
  onTermChange,
  onViewMap,
  pageRows,
  pageSize,
  term,
  totalArea,
  totalPages,
  totalValue,
}) {
  return (
    <section className="page geographic-page is-list-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">GEOSPATIAL ASSET DIRECTORY</p>
          <h1>地理圖資</h1>
          <p>
            以 Mapbox
            底圖與地籍範圍檢視花蓮航空站土地財產，並與財產編號、面積及帳面價值交叉核對。
          </p>
        </div>
        <button
          className="button button-primary"
          onClick={onViewMap}
          type="button"
        >
          地圖檢視
        </button>
      </div>
      <div
        aria-hidden="true"
        className="filter-sentinel"
        ref={geoFilterSentinelRef}
      />
      {compactFilters && (
        <div className="compact-filter-bar compact-filter-bar-fixed">
          <button
            aria-expanded={compactFiltersOpen}
            className="compact-filter-trigger"
            onClick={() => onCompactFiltersOpenChange((open) => !open)}
            type="button"
          >
            篩選條件{activeFilterCount ? <b>{activeFilterCount}</b> : null}
          </button>
          <label className="compact-search">
            <span className="sr-only">全局關鍵字搜尋</span>
            <input
              onChange={(event) => onTermChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearch();
              }}
              placeholder="輸入後按 Enter 搜尋…"
              value={term}
            />
          </label>
          <button
            className="compact-clear"
            disabled={!activeFilterCount}
            onClick={clearFilters}
            type="button"
          >
            清除
          </button>
          {compactFiltersOpen && (
            <div className="compact-filter-popover">{filters("compact-")}</div>
          )}
        </div>
      )}
      <section aria-label="篩選條件" className="search-panel geo-filter-panel">
        <div className="filter-panel-heading">
          <div>
            <h2>篩選條件</h2>
            <p>可直接輸入文字，或由土地資料中的選項挑選。</p>
          </div>
          <button
            className="button button-secondary filter-reset"
            onClick={clearFilters}
            type="button"
          >
            清除篩選
          </button>
        </div>
        {filters("geo-")}
        <div className="advanced-search">
          <label className="search-field">
            全局關鍵字搜尋
            <input
              onChange={(event) => onTermChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearch();
              }}
              placeholder="輸入地段、地號、財產名稱或編號"
              value={term}
            />
          </label>
          <div className="advanced-search-actions">
            <button
              className={`button button-primary search-submit ${term !== appliedTerm ? "pending" : ""}`}
              onClick={onSearch}
              type="button"
            >
              搜尋
            </button>
          </div>
        </div>
      </section>
      <section className="geo-table-panel">
        <div className="result-summary geo-result-summary">
          <p className="result-count">
            查詢結果：<strong>{filtered.length.toLocaleString()}</strong> 筆
          </p>
          <p>土地總面積：{totalArea.toLocaleString()} m²</p>
          <p>帳面價值：NT$ {money(totalValue)}</p>
          <label className="page-size">
            每頁顯示
            <select
              aria-label="每頁顯示土地筆數"
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              value={pageSize}
            >
              <option value="25">25 筆</option>
              <option value="50">50 筆</option>
              <option value="100">100 筆</option>
            </select>
          </label>
          <p>
            第 {currentPage}／{totalPages} 頁
          </p>
        </div>
        <div className="geo-table-wrap">
          <table>
            <thead>
              <tr>
                <th>段小段</th>
                <th>地號</th>
                <th>面積 (M²)</th>
                <th>使用資訊</th>
                <th>公告土地現值</th>
                <th>公告地價</th>
                <th>財產編號</th>
                <th>財產名稱</th>
                <th>財產價值 (元)</th>
                <th>關聯建號</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((land) => {
                const [number, serial] = String(land.id).split("\n");
                return (
                  <tr key={land.id}>
                    <td>
                      {land.section}
                      <small>{land.sectionCode}</small>
                    </td>
                    <td>{land.landNumber}</td>
                    <td className="money">{land.area.toLocaleString()}</td>
                    <td>
                      <strong>{land.zoningLabel}</strong>
                      <small>{land.landUseType}</small>
                    </td>
                    <td className="money">
                      {land.announcedLandValue.toLocaleString()}
                    </td>
                    <td className="money">
                      {land.announcedLandPrice.toLocaleString()}
                    </td>
                    <td className="mono">
                      <strong>{number}</strong>
                      {serial && <small>{serial}</small>}
                    </td>
                    <td>
                      <strong>{land.name}</strong>
                      <small>
                        {land.section}
                        {land.landNumber}
                      </small>
                    </td>
                    <td className="money">{money(land.price)}</td>
                    <td>{land.relatedBuildingNumbers}</td>
                    <td>
                      <button
                        className="row-action"
                        onClick={() => onOpenMap(land)}
                        type="button"
                      >
                        查看地圖
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <nav aria-label="土地列表分頁" className="pagination">
            <button
              className="button button-secondary"
              disabled={currentPage === 1}
              onClick={() => onPageChange(currentPage - 1)}
              type="button"
            >
              上一頁
            </button>
            <span>
              第 {currentPage}／{totalPages} 頁
            </span>
            <button
              className="button button-secondary"
              disabled={currentPage === totalPages}
              onClick={() => onPageChange(currentPage + 1)}
              type="button"
            >
              下一頁
            </button>
          </nav>
        )}
      </section>
    </section>
  );
}

function GeoListView({
  activeFilterCount,
  appliedTerm,
  clearFilters,
  compactFilters,
  compactFiltersOpen,
  currentPage,
  filtered,
  geoFilterSentinelRef,
  landFilters,
  landUseTypes,
  onCompactFiltersOpenChange,
  onFilterChange,
  onOpenFilterChange,
  onOpenMap,
  onPageChange,
  onPageSizeChange,
  onSearch,
  onTermChange,
  onViewMap,
  openFilterId,
  pageRows,
  pageSize,
  sections,
  term,
  totalArea,
  totalPages,
  totalValue,
  zonings,
}) {
  const filterFields = [
    ["section", "地段", sections],
    ["zoning", "使用分區", zonings],
    ["landUseType", "使用地類別", landUseTypes],
  ];
  const filters = (prefix = "") => (
    <div className="filter-grid">
      {filterFields.map(([key, label, options]) => (
        <FilterCombo
          id={`${prefix}${key}`}
          key={key}
          label={label}
          onChange={(value) => onFilterChange(key, value)}
          onOpenChange={onOpenFilterChange}
          open={openFilterId === `${prefix}${key}`}
          options={options}
          value={landFilters[key]}
        />
      ))}
    </div>
  );
  return (
    <GeoListViewContent
      activeFilterCount={activeFilterCount}
      appliedTerm={appliedTerm}
      clearFilters={clearFilters}
      compactFilters={compactFilters}
      compactFiltersOpen={compactFiltersOpen}
      currentPage={currentPage}
      filters={filters}
      filtered={filtered}
      geoFilterSentinelRef={geoFilterSentinelRef}
      onCompactFiltersOpenChange={onCompactFiltersOpenChange}
      onOpenMap={onOpenMap}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      onSearch={onSearch}
      onTermChange={onTermChange}
      onViewMap={onViewMap}
      pageRows={pageRows}
      pageSize={pageSize}
      term={term}
      totalArea={totalArea}
      totalPages={totalPages}
      totalValue={totalValue}
    />
  );
  return (
    <section className="page geographic-page is-list-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">GEOSPATIAL ASSET DIRECTORY</p>
          <h1>地理圖資</h1>
          <p>
            以 Mapbox
            底圖與地籍範圍檢視花蓮航空站土地財產，並與財產編號、面積及帳面價值交叉核對。
          </p>
        </div>
        <button
          className="button button-primary"
          onClick={onViewMap}
          type="button"
        >
          地圖檢視
        </button>
      </div>
      <div
        aria-hidden="true"
        className="filter-sentinel"
        ref={geoFilterSentinelRef}
      />
      {compactFilters && (
        <div className="compact-filter-bar compact-filter-bar-fixed">
          <button
            aria-expanded={compactFiltersOpen}
            className="compact-filter-trigger"
            onClick={() => onCompactFiltersOpenChange((open) => !open)}
            type="button"
          >
            篩選條件{activeFilterCount ? <b>{activeFilterCount}</b> : null}
          </button>
          <label className="compact-search">
            <span className="sr-only">全局關鍵字搜尋</span>
            <input
              onChange={(event) => onTermChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearch();
              }}
              placeholder="輸入後按 Enter 搜尋…"
              value={term}
            />
          </label>
          <button
            className="compact-clear"
            disabled={!activeFilterCount}
            onClick={clearFilters}
            type="button"
          >
            清除
          </button>
          {compactFiltersOpen && (
            <div className="compact-filter-popover">{filters("compact-")}</div>
          )}
        </div>
      )}
      <section aria-label="篩選條件" className="search-panel geo-filter-panel">
        <div className="filter-panel-heading">
          <div>
            <h2>篩選條件</h2>
            <p>可直接輸入文字，或由土地資料中的選項挑選。</p>
          </div>
          <button
            className="button button-secondary filter-reset"
            onClick={clearFilters}
            type="button"
          >
            清除篩選
          </button>
        </div>
        {filters("geo-")}
        <div className="advanced-search">
          <label className="search-field">
            全局關鍵字搜尋
            <input
              onChange={(event) => onTermChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearch();
              }}
              placeholder="輸入地段、地號、財產名稱或編號"
              value={term}
            />
          </label>
          <div className="advanced-search-actions">
            <button
              className={`button button-primary search-submit ${term !== appliedTerm ? "pending" : ""}`}
              onClick={onSearch}
              type="button"
            >
              搜尋
            </button>
          </div>
        </div>
      </section>
      <section className="geo-table-panel">
        <div className="result-summary">
          <p className="result-count">
            查詢結果：<strong>{filtered.length.toLocaleString()}</strong> 筆
          </p>
          <p>土地總面積：{totalArea.toLocaleString()} m²</p>
          <p>帳面價值：NT$ {money(totalValue)}</p>
        </div>
        <div className="geo-table-wrap">
          <table>
            <thead>
              <tr>
                <th>段小段</th>
                <th>地號</th>
                <th>面積 (M²)</th>
                <th>使用資訊</th>
                <th>公告土地現值</th>
                <th>公告地價</th>
                <th>財產編號</th>
                <th>財產名稱</th>
                <th>財產價值 (元)</th>
                <th>關聯建號</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((land) => {
                const [number, serial] = String(land.id).split("\n");
                return (
                  <tr key={land.id}>
                    <td>
                      {land.section}
                      <small>{land.sectionCode}</small>
                    </td>
                    <td>{land.landNumber}</td>
                    <td className="money">{land.area.toLocaleString()}</td>
                    <td>
                      <strong>{land.zoningLabel}</strong>
                      <small>{land.landUseType}</small>
                    </td>
                    <td className="money">
                      {land.announcedLandValue.toLocaleString()}
                    </td>
                    <td className="money">
                      {land.announcedLandPrice.toLocaleString()}
                    </td>
                    <td className="mono">
                      <strong>{number}</strong>
                      {serial && <small>{serial}</small>}
                    </td>
                    <td>
                      <strong>{land.name}</strong>
                      <small>
                        {land.section}
                        {land.landNumber}
                      </small>
                    </td>
                    <td className="money">{money(land.price)}</td>
                    <td>{land.relatedBuildingNumbers}</td>
                    <td>
                      <button
                        className="row-action"
                        onClick={() => onOpenMap(land)}
                        type="button"
                      >
                        查看地圖
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

export function GeographicAssets() {
  const lands = useMemo(
    () =>
      landProperties.features.map((feature, index) => {
        const basic = feature.properties?.basic_info || {};
        const property = feature.properties?.property_info || {};
        const propertyNumber =
          property.property_number ||
          `${basic.section_code}-${basic.land_number}-${index}`;
        const number = landAssetNumberParts(propertyNumber);
        return {
          announcedLandPrice: Number(basic.announced_land_price) || 0,
          announcedLandValue: Number(basic.announced_land_value) || 0,
          area: Number(basic.area) || 0,
          feature,
          id: number.serial
            ? `${number.primary}\n${number.serial}`
            : number.primary,
          landNumber: basic.land_number || "—",
          landUseType: basic.land_use_type || "—",
          name: property.property_name || "未命名土地",
          price: Number(property.property_value) || 0,
          relatedBuildingNumbers:
            feature.properties?.related_building_numbers?.join("、") || "—",
          section: basic.section_name || "未分類段",
          sectionCode: basic.section_code || "—",
          zoning: `${basic.zoning || "未分類"}\n${basic.land_use_type || "—"}`,
          zoningLabel: basic.zoning || "未分類",
        };
      }),
    [],
  );
  const [term, setTerm] = useState("");
  const [appliedTerm, setAppliedTerm] = useState("");
  const [landFilters, setLandFilters] = useState({
    section: "",
    zoning: "",
    landUseType: "",
  });
  const [openGeoFilterId, setOpenGeoFilterId] = useState(null);
  const [compactGeoFilters, setCompactGeoFilters] = useState(false);
  const [compactGeoFiltersOpen, setCompactGeoFiltersOpen] = useState(false);
  const [geoPage, setGeoPage] = useState(1);
  const [geoPageSize, setGeoPageSize] = useState(25);
  const geoFilterSentinelRef = useRef(null);
  const [selectedId, setSelectedId] = useState(() => lands[0]?.id || "");
  const [mapFailure, setMapFailure] = useState("");
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState("map");
  const [mapStyle, setMapStyle] = useState("standard");
  const [is3D, setIs3D] = useState(false);
  const mapContainerRef = useRef(null);
  const mapPanelRef = useRef(null);
  const mapRef = useRef(null);
  const mapToken = import.meta.env.VITE_MAPBOX_TOKEN;
  const filtered = useMemo(
    () =>
      lands.filter(
        (land) =>
          normalized(
            `${land.section}${land.landNumber} ${land.name} ${land.id} ${land.zoning}`,
          ).includes(normalized(viewMode === "list" ? appliedTerm : term)) &&
          (!landFilters.section || land.section === landFilters.section) &&
          (!landFilters.zoning || land.zoningLabel === landFilters.zoning) &&
          (!landFilters.landUseType ||
            land.landUseType === landFilters.landUseType),
      ),
    [lands, term, appliedTerm, landFilters, viewMode],
  );
  const selected =
    filtered.find((land) => land.id === selectedId) ||
    lands.find((land) => land.id === selectedId) ||
    filtered[0] ||
    lands[0];
  const fullBounds = useMemo(() => {
    const coordinates = lands.flatMap((land) =>
      land.feature.geometry.type === "Polygon"
        ? land.feature.geometry.coordinates.flat()
        : land.feature.geometry.coordinates.flat(2),
    );
    const xs = coordinates.map(([x]) => x);
    const ys = coordinates.map(([, y]) => y);
    return [
      [Math.min(...xs), Math.min(...ys)],
      [Math.max(...xs), Math.max(...ys)],
    ];
  }, [lands]);
  const mapData = useMemo(
    () => ({
      type: "FeatureCollection",
      features: lands.map((land) => ({
        ...land.feature,
        properties: { geoId: land.id },
      })),
    }),
    [lands],
  );
  const boundsFor = (feature) => {
    const coordinates =
      feature.geometry.type === "Polygon"
        ? feature.geometry.coordinates.flat()
        : feature.geometry.coordinates.flat(2);
    const xs = coordinates.map(([x]) => x);
    const ys = coordinates.map(([, y]) => y);
    return [
      [Math.min(...xs), Math.min(...ys)],
      [Math.max(...xs), Math.max(...ys)],
    ];
  };
  const mapStyleUrl =
    mapStyle === "satellite"
      ? "mapbox://styles/mapbox/standard-satellite"
      : "mapbox://styles/mapbox/standard";
  useEffect(() => {
    if (
      viewMode !== "map" ||
      !mapToken ||
      !mapContainerRef.current ||
      mapRef.current
    )
      return undefined;
    mapboxgl.accessToken = mapToken;
    let flyInTimer;
    const map = new mapboxgl.Map({
      center: [120.95, 23.7],
      config: { basemap: { show3dObjects: is3D } },
      container: mapContainerRef.current,
      fitBoundsOptions: { padding: 64 },
      maxBounds: [
        [119, 21],
        [123, 26],
      ],
      style: mapStyleUrl,
      zoom: 6.2,
    });
    mapRef.current = map;
    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.on("load", () => {
      map.addSource("land-properties", { data: mapData, type: "geojson" });
      map.addLayer({
        id: "land-fill",
        paint: { "fill-color": "#16a36b", "fill-opacity": 0.32 },
        source: "land-properties",
        type: "fill",
      });
      map.addLayer({
        id: "land-outline",
        paint: { "line-color": "#087a4a", "line-width": 2 },
        source: "land-properties",
        type: "line",
      });
      flyInTimer = window.setTimeout(
        () =>
          map.fitBounds(fullBounds, {
            duration: 2200,
            essential: true,
            padding: 64,
          }),
        420,
      );
      map.on("click", "land-fill", (event) => {
        const id = event.features?.[0]?.properties?.geoId;
        if (id) setSelectedId(id);
      });
      map.on("mouseenter", "land-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "land-fill", () => {
        map.getCanvas().style.cursor = "";
      });
    });
    map.on("error", (event) => {
      if (event.error?.status === 401 || event.error?.status === 403)
        setMapFailure("Mapbox 權杖無效或尚未允許此網址使用。");
    });
    return () => {
      window.clearTimeout(flyInTimer);
      map.remove();
      mapRef.current = null;
    };
  }, [fullBounds, is3D, mapData, mapStyleUrl, mapToken, viewMode]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !map.getLayer("land-fill")) return;
    const visibleIds = filtered.map((land) => land.id);
    map.setPaintProperty("land-fill", "fill-color", [
      "case",
      ["==", ["get", "geoId"], selectedId],
      "#ef7356",
      "#16a36b",
    ]);
    map.setPaintProperty("land-fill", "fill-opacity", [
      "case",
      ["==", ["get", "geoId"], selectedId],
      0.54,
      ["in", ["get", "geoId"], ["literal", visibleIds]],
      0.32,
      0.08,
    ]);
    map.setPaintProperty("land-outline", "line-color", [
      "case",
      ["==", ["get", "geoId"], selectedId],
      "#b53d24",
      "#087a4a",
    ]);
    map.setPaintProperty("land-outline", "line-width", [
      "case",
      ["==", ["get", "geoId"], selectedId],
      3,
      2,
    ]);
  }, [filtered, selectedId]);
  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === mapPanelRef.current;
      setIsMapFullscreen(active);
      window.setTimeout(() => mapRef.current?.resize(), 80);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);
  function selectLand(land, moveMap = true) {
    setSelectedId(land.id);
    if (moveMap && mapRef.current?.isStyleLoaded())
      mapRef.current.fitBounds(boundsFor(land.feature), {
        maxZoom: 17,
        padding: 90,
      });
  }
  function showFullExtent() {
    setSelectedId(lands[0]?.id || "");
    if (mapRef.current?.isStyleLoaded())
      mapRef.current.fitBounds(fullBounds, { padding: 64 });
  }
  function toggleMapFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else mapPanelRef.current?.requestFullscreen?.();
  }
  useEffect(() => {
    const updateCompactMode = () => {
      if (
        viewMode !== "list" ||
        window.innerWidth < 960 ||
        !geoFilterSentinelRef.current
      )
        return setCompactGeoFilters(false);
      setCompactGeoFilters(
        geoFilterSentinelRef.current.getBoundingClientRect().bottom <= 0,
      );
    };
    updateCompactMode();
    window.addEventListener("scroll", updateCompactMode, { passive: true });
    window.addEventListener("resize", updateCompactMode);
    return () => {
      window.removeEventListener("scroll", updateCompactMode);
      window.removeEventListener("resize", updateCompactMode);
    };
  }, [viewMode]);
  useEffect(() => {
    setGeoPage(1);
  }, [appliedTerm, landFilters, geoPageSize]);
  useEffect(() => {
    const closeMenus = (event) => {
      if (!(event.target instanceof Element)) return;
      if (
        !event.target.closest(".geo-filter-panel .filter-combobox") &&
        !event.target.closest(".compact-filter-bar .filter-combobox")
      )
        setOpenGeoFilterId(null);
      if (!event.target.closest(".compact-filter-bar"))
        setCompactGeoFiltersOpen(false);
    };
    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
  }, []);
  function openMapForLand(land) {
    setSelectedId(land.id);
    setViewMode("map");
  }
  const totalArea = filtered.reduce((sum, land) => sum + land.area, 0);
  const totalValue = filtered.reduce((sum, land) => sum + land.price, 0);
  const geoTotalPages = Math.max(1, Math.ceil(filtered.length / geoPageSize));
  const geoCurrentPage = Math.min(geoPage, geoTotalPages);
  const geoPageRows = filtered.slice(
    (geoCurrentPage - 1) * geoPageSize,
    geoCurrentPage * geoPageSize,
  );
  const sections = [...new Set(lands.map((land) => land.section))].sort(
    (a, b) => a.localeCompare(b, "zh-TW"),
  );
  const zonings = [...new Set(lands.map((land) => land.zoningLabel))].sort(
    (a, b) => a.localeCompare(b, "zh-TW"),
  );
  const landUseTypes = [...new Set(lands.map((land) => land.landUseType))].sort(
    (a, b) => a.localeCompare(b, "zh-TW"),
  );
  const setLandFilter = (key, value) =>
    setLandFilters((current) => ({ ...current, [key]: value }));
  const clearLandFilters = () => {
    setTerm("");
    setAppliedTerm("");
    setLandFilters({ section: "", zoning: "", landUseType: "" });
    setOpenGeoFilterId(null);
    setCompactGeoFiltersOpen(false);
  };
  const activeLandFilterCount =
    Object.values(landFilters).filter(Boolean).length +
    Number(Boolean(appliedTerm));
  const runLandSearch = () => setAppliedTerm(term.trim());
  if (viewMode === "list")
    return (
      <GeoListView
        activeFilterCount={activeLandFilterCount}
        appliedTerm={appliedTerm}
        clearFilters={clearLandFilters}
        compactFilters={compactGeoFilters}
        compactFiltersOpen={compactGeoFiltersOpen}
        currentPage={geoCurrentPage}
        filtered={filtered}
        geoFilterSentinelRef={geoFilterSentinelRef}
        landFilters={landFilters}
        landUseTypes={landUseTypes}
        onCompactFiltersOpenChange={setCompactGeoFiltersOpen}
        onFilterChange={setLandFilter}
        onOpenFilterChange={setOpenGeoFilterId}
        onOpenMap={openMapForLand}
        onPageChange={setGeoPage}
        onPageSizeChange={setGeoPageSize}
        onSearch={runLandSearch}
        onTermChange={setTerm}
        onViewMap={() => setViewMode("map")}
        openFilterId={openGeoFilterId}
        pageRows={geoPageRows}
        pageSize={geoPageSize}
        sections={sections}
        term={term}
        totalArea={totalArea}
        totalPages={geoTotalPages}
        totalValue={totalValue}
        zonings={zonings}
      />
    );
  if (viewMode === "list")
    return (
      <section className="page geographic-page is-list-view">
        <div className="page-heading">
          <div>
            <p className="eyebrow">GEOSPATIAL ASSET DIRECTORY</p>
            <h1>地理圖資</h1>
            <p>
              以 Mapbox
              底圖與地籍範圍檢視花蓮航空站土地財產，並與財產編號、面積及帳面價值交叉核對。
            </p>
          </div>
          <button
            className="button button-primary"
            onClick={() => setViewMode("map")}
            type="button"
          >
            地圖檢視
          </button>
        </div>
        <section className="geo-table-panel">
          <section
            aria-label="篩選條件"
            className="search-panel geo-filter-panel"
          >
            <div className="filter-panel-heading">
              <div>
                <h2>篩選條件</h2>
                <p>可依土地標示、使用資訊或財產資料篩選。</p>
              </div>
              <button
                className="button button-secondary filter-reset"
                onClick={clearLandFilters}
                type="button"
              >
                清除篩選
              </button>
            </div>
            <div className="filter-grid">
              <label className="filter-field">
                地段
                <select
                  onChange={(event) =>
                    setLandFilter("section", event.target.value)
                  }
                  value={landFilters.section}
                >
                  <option value="">全部地段</option>
                  {sections.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                使用分區
                <select
                  onChange={(event) =>
                    setLandFilter("zoning", event.target.value)
                  }
                  value={landFilters.zoning}
                >
                  <option value="">全部使用分區</option>
                  {zonings.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                使用地類別
                <select
                  onChange={(event) =>
                    setLandFilter("landUseType", event.target.value)
                  }
                  value={landFilters.landUseType}
                >
                  <option value="">全部使用地類別</option>
                  {landUseTypes.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="advanced-search">
              <label className="search-field">
                全局關鍵字搜尋
                <input
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="輸入地段、地號、財產名稱或編號"
                  value={term}
                />
              </label>
            </div>
          </section>
          <div className="result-summary">
            <p className="result-count">
              查詢結果：<strong>{filtered.length.toLocaleString()}</strong> 筆
            </p>
            <p>土地總面積：{totalArea.toLocaleString()} m²</p>
            <p>帳面價值：NT$ {money(totalValue)}</p>
          </div>
          <div className="geo-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>段小段</th>
                  <th>地號</th>
                  <th>面積 (M²)</th>
                  <th>使用資訊</th>
                  <th>公告土地現值</th>
                  <th>公告地價</th>
                  <th>財產編號</th>
                  <th>財產名稱</th>
                  <th>財產價值 (元)</th>
                  <th>關聯建號</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((land) => {
                  const [number, serial] = String(land.id).split("\n");
                  return (
                    <tr key={land.id}>
                      <td>
                        {land.section}
                        <small>{land.sectionCode}</small>
                      </td>
                      <td>{land.landNumber}</td>
                      <td className="money">{land.area.toLocaleString()}</td>
                      <td>
                        <strong>{land.zoningLabel}</strong>
                        <small>{land.landUseType}</small>
                      </td>
                      <td className="money">
                        {land.announcedLandValue.toLocaleString()}
                      </td>
                      <td className="money">
                        {land.announcedLandPrice.toLocaleString()}
                      </td>
                      <td className="mono">
                        <strong>{number}</strong>
                        {serial && <small>{serial}</small>}
                      </td>
                      <td>
                        <strong>{land.name}</strong>
                        <small>
                          {land.section}
                          {land.landNumber}
                        </small>
                      </td>
                      <td className="money">{money(land.price)}</td>
                      <td>{land.relatedBuildingNumbers}</td>
                      <td>
                        <button
                          className="row-action"
                          onClick={() => openMapForLand(land)}
                          type="button"
                        >
                          查看地圖
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    );
  return (
    <section
      className={`page geographic-page ${viewMode === "list" ? "is-list-view" : ""}`}
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">GEOSPATIAL ASSET DIRECTORY</p>
          <h1>地理圖資</h1>
          <p>
            以 Mapbox
            底圖與地籍範圍檢視花蓮航空站土地財產，並與財產編號、面積及帳面價值交叉核對。
          </p>
        </div>
        <button
          className="button button-primary"
          onClick={() =>
            setViewMode((current) => (current === "map" ? "list" : "map"))
          }
          type="button"
        >
          {viewMode === "map" ? "列表檢視" : "地圖檢視"}
        </button>
      </div>
      {viewMode === "map" ? (
        <section className="geo-workbench">
          <aside className="geo-list-panel">
            <header>
              <h2>土地清單</h2>
              <strong>{filtered.length} 筆</strong>
            </header>
            <label className="geo-search">
              <span className="sr-only">搜尋土地</span>
              <input
                onChange={(event) => setTerm(event.target.value)}
                placeholder="地段、地號、財產編號…"
                value={term}
              />
            </label>
            <div className="geo-list-scroll">
              {filtered.length ? (
                filtered.map((land) => (
                  <button
                    aria-pressed={selected?.id === land.id}
                    className={`geo-list-item ${selected?.id === land.id ? "is-selected" : ""}`}
                    key={land.id}
                    onClick={() => selectLand(land)}
                    type="button"
                  >
                    <span aria-hidden="true" className="geo-list-map-icon">
                      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                        <path
                          d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"
                          stroke="currentColor"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                        />
                        <path
                          d="M9 3v15m6-12v15"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeWidth="1.8"
                        />
                      </svg>
                    </span>
                    <div>
                      <strong>
                        {land.section} {land.landNumber}
                      </strong>
                      <small>{land.id}</small>
                    </div>
                    <em>{land.area.toLocaleString()} m²</em>
                  </button>
                ))
              ) : (
                <p className="geo-no-result">沒有符合的土地資料。</p>
              )}
            </div>
            <footer>
              <div>
                <span>目前筆數</span>
                <strong>{filtered.length} 筆</strong>
              </div>
              <div>
                <span>土地總面積</span>
                <strong>{totalArea.toLocaleString()} m²</strong>
              </div>
              <div>
                <span>帳面價值</span>
                <strong>NT$ {money(totalValue)}</strong>
              </div>
            </footer>
          </aside>
          <section
            aria-label="土地地籍範圍圖"
            className="geo-map-panel"
            ref={mapPanelRef}
          >
            <header>
              <div>
                <span className="geo-live-dot" />
                Mapbox 地籍範圍圖層
              </div>
              <div className="geo-map-actions">
                <span aria-label="選擇底圖" className="geo-basemap-toggle">
                  <button
                    aria-pressed={mapStyle === "standard"}
                    className={mapStyle === "standard" ? "is-active" : ""}
                    onClick={() => setMapStyle("standard")}
                    type="button"
                  >
                    標準
                  </button>
                  <button
                    aria-pressed={mapStyle === "satellite"}
                    className={mapStyle === "satellite" ? "is-active" : ""}
                    onClick={() => setMapStyle("satellite")}
                    type="button"
                  >
                    衛星
                  </button>
                </span>
                <button
                  aria-pressed={is3D}
                  className={`geo-3d-toggle ${is3D ? "is-active" : ""}`}
                  onClick={() => setIs3D((enabled) => !enabled)}
                  type="button"
                >
                  3D
                </button>
                <button
                  className="text-button"
                  onClick={showFullExtent}
                  type="button"
                >
                  回到全區
                </button>
                <button
                  aria-pressed={isMapFullscreen}
                  className="text-button"
                  onClick={toggleMapFullscreen}
                  type="button"
                >
                  {isMapFullscreen ? "離開全螢幕" : "全螢幕"}
                </button>
              </div>
            </header>
            <div className="geo-map-stage">
              {mapToken ? (
                <div
                  aria-label="花蓮航空站土地地籍範圍 Mapbox 地圖"
                  className="geo-mapbox"
                  ref={mapContainerRef}
                />
              ) : (
                <div className="geo-map-config">
                  <strong>尚未設定 Mapbox 權杖</strong>
                  <p>
                    請在專案根目錄的 <code>.env</code> 設定{" "}
                    <code>VITE_MAPBOX_TOKEN</code>，然後重新啟動開發伺服器。
                  </p>
                </div>
              )}
              {mapFailure && (
                <p className="geo-map-error" role="alert">
                  {mapFailure}
                </p>
              )}
              {selected && (
                <article className="geo-map-detail">
                  <p>
                    {selected.section}
                    {selected.landNumber}
                  </p>
                  <h2>{selected.name}</h2>
                  <dl>
                    <div>
                      <dt>面積</dt>
                      <dd>{selected.area.toLocaleString()} m²</dd>
                    </div>
                    <div>
                      <dt>帳面價值</dt>
                      <dd>NT$ {money(selected.price)}</dd>
                    </div>
                    <div>
                      <dt>使用分區</dt>
                      <dd>{selected.zoning}</dd>
                    </div>
                  </dl>
                  <a
                    href={selected.feature.properties?.cadastral_link}
                    rel="noreferrer"
                    target="_blank"
                  >
                    開啟地籍資料 ↗
                  </a>
                </article>
              )}
            </div>
            <footer>
              <span>
                <i className="geo-legend-land" />
                土地範圍
              </span>
              <span>
                <i className="geo-legend-selected" />
                目前選取
              </span>
              <span className="geo-building-note">
                建物圖徵：待後續匯入座標或範圍資料
              </span>
            </footer>
          </section>
        </section>
      ) : (
        <section className="geo-table-panel">
          <header>
            <div>
              <h2>土地列表</h2>
              <p>共 {filtered.length} 筆土地財產</p>
            </div>
            <label className="geo-search">
              <span className="sr-only">搜尋土地</span>
              <input
                onChange={(event) => setTerm(event.target.value)}
                placeholder="地段、地號、財產編號…"
                value={term}
              />
            </label>
          </header>
          <div className="geo-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>段小段</th>
                  <th>地號</th>
                  <th>面積 (M²)</th>
                  <th>使用分區</th>
                  <th>使用地類別</th>
                  <th>公告土地現值</th>
                  <th>公告地價</th>
                  <th>財產編號</th>
                  <th>財產名稱</th>
                  <th>財產價值 (元)</th>
                  <th>關聯建號</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((land) => (
                  <tr key={land.id}>
                    <td>
                      {land.section}
                      <small>{land.sectionCode}</small>
                    </td>
                    <td>{land.landNumber}</td>
                    <td className="money">{land.area.toLocaleString()}</td>
                    <td>{land.zoning}</td>
                    <td>{land.landUseType}</td>
                    <td className="money">
                      {land.announcedLandValue.toLocaleString()}
                    </td>
                    <td className="money">
                      {land.announcedLandPrice.toLocaleString()}
                    </td>
                    <td className="mono">{land.id}</td>
                    <td>{land.name}</td>
                    <td className="money">{money(land.price)}</td>
                    <td>{land.relatedBuildingNumbers}</td>
                    <td>
                      <button
                        className="row-action"
                        onClick={() => openMapForLand(land)}
                        type="button"
                      >
                        查看地圖
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
