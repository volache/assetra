import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import mapboxgl from "mapbox-gl";
import { money } from "../../lib/formatters";
import { supabase } from "../../supabase";
import { requestOwnershipDocument } from "../ownership/api";
import { normalized } from "../inventory/search";
import { CapsuleSpinner } from "../../components/FeedbackCenter";
import { LandEditorDialog } from "./LandEditorDialog";

import { GeoListView } from "./GeoListView";
import { landAssetNumberParts, parcelLabel } from "./landLabels";
import { addLandLayers } from "./mapLayers";
import { OwnershipDeleteDialog } from "./OwnershipDeleteDialog";

const emptyFeatureCollection = { type: "FeatureCollection", features: [] };

export function GeographicAssets() {
  const [landProperties, setLandProperties] = useState(emptyFeatureCollection);
  const [isLoadingLandProperties, setIsLoadingLandProperties] = useState(true);
  const [landPropertiesError, setLandPropertiesError] = useState("");
  const [landEditorTarget, setLandEditorTarget] = useState(undefined);
  const [landReloadKey, setLandReloadKey] = useState(0);
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
          documentLandParcelId: feature.properties?.land_parcel_id || null,
          // Identity of the parcel on the map and in the lists.  The 財產編號 is
          // not unique here: 120-1040103-0001-0000004 and 200-1040103-0001-0000004
          // both shorten to the same displayed number.
          id:
            feature.properties?.land_parcel_id ||
            `${basic.section_code}-${basic.land_number}`,
          assetNumber: number.serial
            ? `${number.primary}\n${number.serial}`
            : number.primary,
          propertyNumber: String(property.property_number || ""),
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
    [landProperties],
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
  const [hasChangedView, setHasChangedView] = useState(false);
  const [mapStyle, setMapStyle] = useState("standard");
  const [is3D, setIs3D] = useState(false);
  const [ownershipDocuments, setOwnershipDocuments] = useState([]);
  const [ownershipDocumentsByLandId, setOwnershipDocumentsByLandId] = useState({});
  const [isLoadingOwnershipDocuments, setIsLoadingOwnershipDocuments] = useState(false);
  const [ownershipDocumentsError, setOwnershipDocumentsError] = useState("");
  const [openingDocumentId, setOpeningDocumentId] = useState("");
  const [ownershipUploadSummary, setOwnershipUploadSummary] = useState("");
  const [isUploadingOwnershipDocuments, setIsUploadingOwnershipDocuments] = useState(false);
  const [ownershipReloadKey, setOwnershipReloadKey] = useState(0);
  const [ownershipUploadTargetLand, setOwnershipUploadTargetLand] = useState(null);
  const [ownershipDeleteTarget, setOwnershipDeleteTarget] = useState(null);
  const ownershipUploadInputRef = useRef(null);
  const mapContainerRef = useRef(null);
  const mapPanelRef = useRef(null);
  const mapRef = useRef(null);
  const mapToken = import.meta.env.VITE_MAPBOX_TOKEN;
  useEffect(() => {
    if (!ownershipUploadSummary) return undefined;
    const timer = window.setTimeout(() => setOwnershipUploadSummary(""), 3500);
    return () => window.clearTimeout(timer);
  }, [ownershipUploadSummary]);
  useEffect(() => {
    let isCurrent = true;

    async function loadLandProperties() {
      if (!supabase) {
        if (isCurrent) {
          setLandPropertiesError("尚未設定 Supabase 連線，無法讀取地籍資料。");
          setIsLoadingLandProperties(false);
        }
        return;
      }

      setIsLoadingLandProperties(true);
      setLandPropertiesError("");
      const { data, error } = await supabase
        .from("land_parcel_features")
        .select("id, feature")
        .order("parcel_key");

      if (!isCurrent) return;
      if (error) {
        setLandPropertiesError("地籍資料讀取失敗，請重新整理後再試。");
        setLandProperties(emptyFeatureCollection);
      } else {
        setLandProperties({
          type: "FeatureCollection",
          features: (data || []).flatMap((row) => {
            if (!row.feature) return [];
            return [{
              ...row.feature,
              properties: { ...row.feature.properties, land_parcel_id: row.id },
            }];
          }),
        });
      }
      setIsLoadingLandProperties(false);
    }

    loadLandProperties();
    return () => {
      isCurrent = false;
    };
  }, [landReloadKey]);
  useEffect(() => {
    if (lands.length && !lands.some((land) => land.id === selectedId))
      setSelectedId(lands[0].id);
  }, [lands, selectedId]);
  const filtered = useMemo(
    () =>
      lands.filter(
        (land) =>
          normalized(
            `${land.section}${land.landNumber} ${land.name} ${land.assetNumber} ${land.propertyNumber} ${land.zoning}`,
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
  useEffect(() => {
    let isCurrent = true;
    async function loadOwnershipDocuments() {
      if (!selected?.documentLandParcelId || !supabase) {
        if (isCurrent) {
          setOwnershipDocuments([]);
          setOwnershipDocumentsError("");
          setIsLoadingOwnershipDocuments(false);
        }
        return;
      }
      setIsLoadingOwnershipDocuments(true);
      setOwnershipDocumentsError("");
      // A selected parcel must never briefly show the previous parcel's
      // private document names while its own lookup is still in flight.
      setOwnershipDocuments([]);
      try {
        const data = await requestOwnershipDocument({
          action: "list",
          landParcelId: selected.documentLandParcelId,
        });
        if (isCurrent) setOwnershipDocuments(data.documents || []);
      } catch (error) {
        if (isCurrent) {
          setOwnershipDocuments([]);
          setOwnershipDocumentsError(error.message || "無法讀取權狀文件。");
        }
      } finally {
        if (isCurrent) setIsLoadingOwnershipDocuments(false);
      }
    }
    loadOwnershipDocuments();
    return () => { isCurrent = false; };
  }, [selected?.documentLandParcelId, ownershipReloadKey]);
  useEffect(() => {
    let isCurrent = true;
    async function loadOwnershipDocumentSummaries() {
      if (!lands.length || !supabase) return;
      try {
        const data = await requestOwnershipDocument({ action: "list_summary" });
        const grouped = (data.documents || []).reduce((result, document) => {
          if (!document.land_parcel_id) return result;
          (result[document.land_parcel_id] ||= []).push(document);
          return result;
        }, {});
        if (isCurrent) setOwnershipDocumentsByLandId(grouped);
      } catch {
        if (isCurrent) setOwnershipDocumentsByLandId({});
      }
    }
    loadOwnershipDocumentSummaries();
    return () => { isCurrent = false; };
  }, [lands, ownershipReloadKey]);

  async function openOwnershipDocument(document) {
    const target = window.open("about:blank", "_blank");
    if (!target) {
      setOwnershipDocumentsError("瀏覽器封鎖了新分頁，請允許此網站開啟分頁後再試。 ");
      return;
    }
    target.opener = null;
    setOpeningDocumentId(document.id);
    try {
      const data = await requestOwnershipDocument({
        action: "create_download",
        documentId: document.id,
      });
      target.location.replace(data.url);
    } catch (error) {
      target.close();
      setOwnershipDocumentsError(error.message || "無法開啟權狀文件。");
    } finally {
      setOpeningDocumentId("");
    }
  }

  async function uploadLandOwnershipDocuments(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;

    const target = ownershipUploadTargetLand;
    const file = files[0];
    if (!target?.land?.documentLandParcelId || !file?.name.toLowerCase().endsWith(".pdf")) {
      setOwnershipDocumentsError("請選擇 PDF 格式的權狀檔案。 ");
      setOwnershipUploadTargetLand(null);
      return;
    }

    setIsUploadingOwnershipDocuments(true);
    setOwnershipDocumentsError("");
    setOwnershipUploadSummary("");
    try {
      const upload = await requestOwnershipDocument({
        action: "create_upload", documentType: "land", landParcelId: target.land.documentLandParcelId,
        originalFilename: file.name, fileSize: file.size, replacesDocumentId: target.replacesDocumentId,
      });
      const response = await fetch(upload.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: file });
      if (!response.ok) throw new Error("R2 上傳未成功。請確認 bucket 已設定 CORS。 ");
      await requestOwnershipDocument({ action: "complete_upload", documentId: upload.documentId });
      setOwnershipUploadSummary(target.replacesDocumentId ? "權狀已更新。" : "權狀已上傳。 ");
      setOwnershipReloadKey((value) => value + 1);
    } catch (error) {
      setOwnershipDocumentsError(error.message || "權狀上傳失敗。 ");
    } finally {
      setIsUploadingOwnershipDocuments(false);
      setOwnershipUploadTargetLand(null);
    }
  }

  function beginOwnershipUpload(land, replacesDocumentId = "") {
    setOwnershipUploadTargetLand({ land, replacesDocumentId });
    requestAnimationFrame(() => ownershipUploadInputRef.current?.click());
  }

  async function deleteOwnershipDocument(document) {
    setOwnershipDocumentsError("");
    try {
      await requestOwnershipDocument({ action: "delete", documentId: document.id });
      setOwnershipUploadSummary("權狀已刪除。 ");
      setOwnershipReloadKey((value) => value + 1);
    } catch (error) {
      setOwnershipDocumentsError(error.message || "權狀刪除失敗。 ");
    }
  }

  function requestOwnershipDeletion(document) {
    setOwnershipDeleteTarget(document);
  }

  async function confirmOwnershipDeletion() {
    const document = ownershipDeleteTarget;
    if (!document) return;
    setOwnershipDeleteTarget(null);
    await deleteOwnershipDocument(document);
  }

  const fullBounds = useMemo(() => {
    const coordinates = lands.flatMap((land) =>
      land.feature.geometry.type === "Polygon"
        ? land.feature.geometry.coordinates.flat()
        : land.feature.geometry.coordinates.flat(2),
    );
    const xs = coordinates.map(([x]) => x);
    const ys = coordinates.map(([, y]) => y);
    if (!coordinates.length) return null;
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
  // The map instance is created once per visit to the map view and then kept:
  // switching the basemap, 3D or the data updates it in place, so the camera
  // is never sent back to the whole-Taiwan view and flown in again.
  const mapDataRef = useRef(mapData);
  const fullBoundsRef = useRef(fullBounds);
  const mapStyleUrlRef = useRef(mapStyleUrl);
  const is3DRef = useRef(is3D);
  const appliedStyleUrlRef = useRef(mapStyleUrl);
  const landPaintRef = useRef(null);
  const cameraRef = useRef(null);
  const hasFlownInRef = useRef(false);
  mapDataRef.current = mapData;
  fullBoundsRef.current = fullBounds;
  mapStyleUrlRef.current = mapStyleUrl;
  is3DRef.current = is3D;
  const hasLands = lands.length > 0;
  useEffect(() => {
    if (
      viewMode !== "map" ||
      !hasLands ||
      !mapToken ||
      !mapContainerRef.current ||
      mapRef.current
    )
      return undefined;
    mapboxgl.accessToken = mapToken;
    let flyInTimer;
    const saved = cameraRef.current;
    appliedStyleUrlRef.current = mapStyleUrlRef.current;
    const map = new mapboxgl.Map({
      bearing: saved?.bearing ?? 0,
      center: saved?.center ?? [120.95, 23.7],
      config: { basemap: { show3dObjects: is3DRef.current } },
      container: mapContainerRef.current,
      fitBoundsOptions: { padding: 64 },
      maxBounds: [
        [119, 21],
        [123, 26],
      ],
      pitch: saved?.pitch ?? (is3DRef.current ? 58 : 0),
      style: mapStyleUrlRef.current,
      zoom: saved?.zoom ?? 6.2,
    });
    mapRef.current = map;
    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.on("load", () => {
      addLandLayers(map, mapDataRef.current);
      landPaintRef.current?.(map);
      // Only the first arrival on this page flies in from the Taiwan view.
      if (!hasFlownInRef.current && fullBoundsRef.current) {
        hasFlownInRef.current = true;
        flyInTimer = window.setTimeout(
          () =>
            map.fitBounds(fullBoundsRef.current, {
              duration: 2200,
              essential: true,
              padding: 64,
            }),
          420,
        );
      }
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
      // Remember where the user was, so coming back to the map keeps the view.
      cameraRef.current = {
        bearing: map.getBearing(),
        center: map.getCenter().toArray(),
        pitch: map.getPitch(),
        zoom: map.getZoom(),
      };
      map.remove();
      mapRef.current = null;
    };
  }, [hasLands, mapToken, viewMode]);
  // Basemap switch: swap the style in place and put the land layers back.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedStyleUrlRef.current === mapStyleUrl) return;
    appliedStyleUrlRef.current = mapStyleUrl;
    map.setStyle(mapStyleUrl);
    map.once("style.load", () => {
      try {
        map.setConfigProperty("basemap", "show3dObjects", is3DRef.current);
      } catch {
        // The style has no basemap import to configure.
      }
      addLandLayers(map, mapDataRef.current);
      landPaintRef.current?.(map);
    });
  }, [mapStyleUrl]);
  // 立體／平面: the camera tilts over (or back to the plain top view) and the 3D buildings follow it.  Tilting by hand with the
  // right mouse button also flips the switch, so it always says what the map is showing.
  const tiltAnimatingRef = useRef(false);
  const tiltSkipFirstRef = useRef(true);
  const show3dObjects = (map, on) => {
    try {
      map.setConfigProperty("basemap", "show3dObjects", on);
    } catch {
      // The style has no basemap import to configure.
    }
  };
  useEffect(() => {
    if (tiltSkipFirstRef.current) {
      tiltSkipFirstRef.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const duration = reduced ? 0 : 900;
    tiltAnimatingRef.current = true;
    map.once("moveend", () => {
      tiltAnimatingRef.current = false;
      if (!is3DRef.current) show3dObjects(map, false);
    });
    if (is3D) {
      show3dObjects(map, true);
      map.easeTo({ duration, essential: true, pitch: 58 });
    } else {
      map.easeTo({ bearing: 0, duration, essential: true, pitch: 0 });
    }
  }, [is3D]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const sync = () => {
      if (tiltAnimatingRef.current) return;
      const tilted = map.getPitch() > 10;
      if (tilted !== is3DRef.current) {
        if (tilted) show3dObjects(map, true);
        setIs3D(tilted);
      }
    };
    map.on("pitchend", sync);
    return () => map.off("pitchend", sync);
  }, [hasLands, mapToken, viewMode]);
  // New land data: update the source in place.
  useEffect(() => {
    const source = mapRef.current?.getSource?.("land-properties");
    if (source) source.setData(mapData);
  }, [mapData]);
  // Picking a parcel on the map (or anywhere) brings its row into view in the
  // list.  Only the list scrolls, never the page, and a row that is already
  // fully visible is left where it is.
  const landListRef = useRef(null);
  useEffect(() => {
    const container = landListRef.current;
    if (!container || viewMode !== "map" || !selectedId) return;
    const row = [...container.children].find(
      (element) => element.dataset?.landId === selectedId,
    );
    if (!row) return;
    const box = container.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (rowBox.top >= box.top && rowBox.bottom <= box.bottom) return;
    const centered =
      container.scrollTop + (rowBox.top - box.top) - (box.height - rowBox.height) / 2;
    container.scrollTo({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      top: Math.max(0, centered),
    });
  }, [selectedId, viewMode]);
  landPaintRef.current = (map) => {
    if (!map.getLayer("land-fill")) return;
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
  };
  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) landPaintRef.current(map);
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
    if (fullBounds && mapRef.current?.isStyleLoaded())
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
    setHasChangedView(true);
    setViewMode("map");
  }
  const changeViewMode = (mode) => {
    setHasChangedView(true);
    setViewMode(mode);
  };
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
      <>
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
        onCreateLand={() => setLandEditorTarget(null)}
        onEditLand={setLandEditorTarget}
        onFilterChange={setLandFilter}
        onOpenFilterChange={setOpenGeoFilterId}
        onOpenMap={openMapForLand}
        onOpenOwnership={openOwnershipDocument}
        onDeleteOwnership={requestOwnershipDeletion}
        onReplaceOwnership={(land, document) => beginOwnershipUpload(land, document.id)}
        onUploadOwnership={(land) => beginOwnershipUpload(land)}
        onOwnershipUploadChange={uploadLandOwnershipDocuments}
        onPageChange={setGeoPage}
        onPageSizeChange={setGeoPageSize}
        onSearch={runLandSearch}
        onTermChange={setTerm}
        onViewMap={() => changeViewMode("map")}
        openFilterId={openGeoFilterId}
        pageRows={geoPageRows}
        pageSize={geoPageSize}
        ownershipDocumentsByLandId={ownershipDocumentsByLandId}
        ownershipUploadInputRef={ownershipUploadInputRef}
        isUploadingOwnershipDocuments={isUploadingOwnershipDocuments}
        sections={sections}
        term={term}
        totalArea={totalArea}
        totalPages={geoTotalPages}
        totalValue={totalValue}
        viewTransition={hasChangedView}
        zonings={zonings}
      />
      <LandEditorDialog
        land={landEditorTarget}
        onClose={() => setLandEditorTarget(undefined)}
        onSaved={() => { setLandEditorTarget(undefined); setLandReloadKey((key) => key + 1); }}
        supabase={supabase}
      />
      <OwnershipDeleteDialog document={ownershipDeleteTarget} onCancel={() => setOwnershipDeleteTarget(null)} onConfirm={confirmOwnershipDeletion} />
      </>
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
                  const [number, serial] = String(land.assetNumber).split("\n");
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
      className={`page geographic-page ${viewMode === "list" ? "is-list-view" : ""} ${hasChangedView ? "geo-view-transition" : ""}`}
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
        <div className="geo-page-actions">
          <button className="button button-secondary" onClick={() => setLandEditorTarget(null)} type="button">新增土地</button>
          <button className="button button-primary" onClick={() => changeViewMode(viewMode === "map" ? "list" : "map")} type="button">
            {viewMode === "map" ? "列表檢視" : "地圖檢視"}
          </button>
        </div>
      </div>
      {viewMode === "map" ? (
        <section className="geo-workbench">
          <aside className="geo-list-panel">
            <header>
              <h2>土地清單</h2>
              <div className="geo-list-header-actions"><strong>{filtered.length} 筆</strong>{selected && <button className="row-action" onClick={() => setLandEditorTarget(selected)} type="button">編輯</button>}</div>
            </header>
            <label className="geo-search">
              <span className="sr-only">搜尋土地</span>
              <input
                onChange={(event) => setTerm(event.target.value)}
                placeholder="地段、地號、財產編號…"
                value={term}
              />
            </label>
            <div className="geo-list-scroll" ref={landListRef}>
              {isLoadingLandProperties ? (
                <p className="geo-no-result">正在讀取地籍資料…</p>
              ) : landPropertiesError ? (
                <p className="geo-no-result" role="alert">
                  {landPropertiesError}
                </p>
              ) : filtered.length ? (
                filtered.map((land) => (
                  <button
                    aria-pressed={selected?.id === land.id}
                    className={`geo-list-item ${selected?.id === land.id ? "is-selected" : ""}`}
                    data-land-id={land.id}
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
                      <small>{land.assetNumber}</small>
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
                <span aria-label="檢視角度" className="geo-basemap-toggle" title="立體：鏡頭傾斜並顯示 3D 建築物；平面：回到正上方的視角">
                  <button
                    aria-pressed={is3D}
                    className={is3D ? "is-active" : ""}
                    onClick={() => setIs3D(true)}
                    type="button"
                  >
                    立體
                  </button>
                  <button
                    aria-pressed={!is3D}
                    className={!is3D ? "is-active" : ""}
                    onClick={() => setIs3D(false)}
                    type="button"
                  >
                    平面
                  </button>
                </span>
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
              {(mapFailure || landPropertiesError) && (
                <p className="geo-map-error" role="alert">
                  {mapFailure || landPropertiesError}
                </p>
              )}
              {selected && (
                <article className="geo-map-detail">
                  <p>
                    {parcelLabel(selected.section, selected.landNumber)}
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
                  <section className="geo-ownership-documents" aria-live="polite">
                    <h3>權狀文件</h3>
                    {isLoadingOwnershipDocuments ? <p>讀取中…</p> : null}
                    {!isLoadingOwnershipDocuments && ownershipDocuments.length === 0 ? (
                      <p>尚未建立可供查閱的土地權狀。</p>
                    ) : null}
                    {ownershipDocuments.map((document) => (
                      <button
                        key={document.id}
                        onClick={() => openOwnershipDocument(document)}
                        type="button"
                      >
                        {openingDocumentId === document.id ? "開啟中…" : document.original_filename}
                      </button>
                    ))}
                    <input
                      accept="application/pdf,.pdf"
                      className="sr-only"
                      onChange={uploadLandOwnershipDocuments}
                      ref={ownershipUploadInputRef}
                      type="file"
                    />
                    {ownershipUploadSummary ? <p className="geo-document-success" role="status">{ownershipUploadSummary}</p> : null}
                    {!isLoadingOwnershipDocuments && ownershipDocuments.length ? (
                      <div className="geo-ownership-actions">
                        <button className="geo-ownership-upload" disabled={isUploadingOwnershipDocuments} onClick={() => beginOwnershipUpload(selected, ownershipDocuments[0].id)} type="button">更新權狀</button>
                        <button className="geo-ownership-delete" onClick={() => requestOwnershipDeletion(ownershipDocuments[0])} type="button">刪除權狀</button>
                      </div>
                    ) : !isLoadingOwnershipDocuments ? (
                      <button className="geo-ownership-upload" disabled={isUploadingOwnershipDocuments} onClick={() => beginOwnershipUpload(selected)} type="button">
                        {isUploadingOwnershipDocuments && <CapsuleSpinner compact />}
                        {isUploadingOwnershipDocuments ? "權狀上傳中…" : "上傳權狀"}
                      </button>
                    ) : null}
                    {ownershipDocumentsError ? <p className="geo-document-error" role="alert">{ownershipDocumentsError}</p> : null}
                  </section>
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
                底圖的道路與建物為示意，位置以土地範圍與衛星檢視為準
              </span>
            </footer>
          </section>
          <OwnershipDeleteDialog document={ownershipDeleteTarget} onCancel={() => setOwnershipDeleteTarget(null)} onConfirm={confirmOwnershipDeletion} />
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
                    <td className="mono">{land.assetNumber}</td>
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
                      <button
                        className="row-action"
                        disabled={isUploadingOwnershipDocuments}
                        onClick={() => beginOwnershipUpload(land)}
                        type="button"
                      >
                        匯入權狀
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <input
            accept="application/pdf,.pdf"
            className="sr-only"
            multiple
            onChange={uploadLandOwnershipDocuments}
            ref={ownershipUploadInputRef}
            type="file"
          />
        </section>
      )}
      <LandEditorDialog
        land={landEditorTarget}
        onClose={() => setLandEditorTarget(undefined)}
        onSaved={() => { setLandEditorTarget(undefined); setLandReloadKey((key) => key + 1); }}
        supabase={supabase}
      />
    </section>
  );
}
