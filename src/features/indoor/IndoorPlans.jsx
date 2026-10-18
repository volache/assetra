import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../supabase";
import { CapsuleSpinner } from "../../components/FeedbackCenter";
import { AssetList } from "./AssetList";
import { deleteSpace, importTracedFiles, saveSpace } from "./indoorData";
import { useIndoorStore } from "./indoorStore";
import { SPACE_TYPE_LABELS, floorName, heatFill, labelPoint, project, ringPath, screenBounds, segmentsPath, spaceBounds, spacePath, spaceTitle, unproject, voidEdgeKinds, wallsPath } from "./geometry";
import { buildPlanIndex, roomsOfCode, searchAssets } from "./planIndex";
import { RoomEditorDialog } from "./RoomEditorDialog";

const SLAB = 120;               // thickness of the floor slab in the angled view, in drawing units
const MARGIN = 0.06;
const DRAWER_PX = 408;          // the room panel (24rem) plus its gaps, used to keep a room clear of it
const FLY_MS = 620;
const TURN_MS = 780;
const fmt = (number, digits = 0) => Number(number || 0).toLocaleString("zh-TW", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const wide = () => window.matchMedia?.("(min-width: 52.0625rem)").matches;

/**
 * 室內平面圖.  The whole page fits one screen height like 地理圖資: a room list on the left (it scrolls inside) and the plan
 * filling the rest.  Picking a room slides the plan to it and opens its assets in a panel over the right edge.
 *
 * assets            the inventory this person may see (the same list 財物查詢 uses)
 * focus             { code, assetId, requestId }: open on the room(s) of a 存置地點 code, from 財物查詢
 * onOpenAsset       show one asset in 財物查詢
 * onOpenInQuery     list a 存置地點's assets in 財物查詢
 */
export function IndoorPlans({ canAdmin, assets, focus, onFocusHandled, onOpenAsset, onOpenInQuery, client = supabase }) {
  const { loading, error, data, reload } = useIndoorStore({ client });
  const index = useMemo(() => (data ? buildPlanIndex(data, assets) : null), [data, assets]);

  const [building, setBuilding] = useState("");
  const [floorId, setFloorId] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [highlightAsset, setHighlightAsset] = useState(null);
  const [unlocated, setUnlocated] = useState(null);            // null = closed, "" = the list of codes, else one code
  const [term, setTerm] = useState("");
  const [mode, setMode] = useState("iso");              // what was asked for; `tilt` follows it a little at a time
  const [tilt, setTilt] = useState(1);                  // 0 = plain top view, 1 = angled view
  const [colorBy, setColorBy] = useState("type");
  const [editingId, setEditingId] = useState(null);
  const [view, setView] = useState(null);
  const [flyId, setFlyId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const svgRef = useRef(null);
  const fileRef = useRef(null);
  const dragRef = useRef(null);
  const workbenchRef = useRef(null);
  const viewRef = useRef(null);
  const tiltRef = useRef(1);
  const animRef = useRef(0);
  const flyFresh = useRef(false);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { tiltRef.current = tilt; }, [tilt]);

  const floors = index?.floors || [];
  const buildings = useMemo(() => [...new Set(floors.map((floor) => floor.building))], [floors]);
  const floorsHere = useMemo(() => floors.filter((floor) => floor.building === building), [floors, building]);
  const floor = index?.floorById.get(floorId) || null;

  // first load: open the first building on its ground floor
  useEffect(() => {
    if (!floors.length || floors.some((item) => item.id === floorId)) return;
    const first = floors[0].building;
    const here = floors.filter((item) => item.building === first);
    setBuilding(first); setFloorId((here.find((item) => /^一樓/.test(item.label)) || here[0]).id);
  }, [floors, floorId]);

  const spaces = useMemo(() => index?.spacesByFloor.get(floorId) || [], [index, floorId]);
  const countOf = useCallback((space) => index?.countOfSpace(space.id) || 0, [index]);
  const maxCount = useMemo(() => Math.max(0, ...spaces.filter((space) => space.space_type !== "void").map(countOf)), [spaces, countOf]);

  const stats = useMemo(() => {
    if (!index) return { area: 0, rooms: 0, assets: 0, all: 0 };
    const codes = new Set();
    let area = 0, rooms = 0;
    for (const space of spaces) {
      if (space.space_type === "void") continue;
      area += Number(space.area_m2) || 0;
      if (space.space_type === "room") rooms += 1;
      for (const link of index.linksBySpace.get(space.id) || []) codes.add(link.location_code);
    }
    let count = 0;
    for (const code of codes) count += index.countByCode.get(code) || 0;
    return { area, rooms, assets: count, all: spaces.filter((space) => space.space_type !== "void").length };
  }, [index, spaces]);

  // ---- search: rooms by name or code, assets by name or number
  const query = term.trim().toLowerCase();
  const matches = useCallback((space) => {
    if (!query) return true;
    const codes = (index?.linksBySpace.get(space.id) || []).map((link) => `${link.location_code} ${link.location_name || ""}`).join(" ");
    return `${space.name || ""} ${space.usage || ""} ${space.tool_id || ""} ${codes}`.toLowerCase().includes(query);
  }, [query, index]);
  const listed = useMemo(() => spaces.filter((space) => space.space_type !== "void" && matches(space)).sort((a, b) => {
    const rank = (space) => ((index.linksBySpace.get(space.id) || []).length ? 0 : space.name ? 1 : space.usage ? 2 : 3);
    return rank(a) - rank(b) || spaceTitle(a).localeCompare(spaceTitle(b), "zh-Hant");
  }), [spaces, matches, index]);
  const assetHits = useMemo(() => (index ? searchAssets(index, term) : { list: [], total: 0 }), [index, term]);
  const hitSpaces = useMemo(() => {
    const ids = new Set();
    if (index && query) for (const asset of assetHits.list) for (const id of index.spacesByCode.get(asset.locationCode) || []) ids.add(id);
    return ids;
  }, [index, query, assetHits]);

  const selected = selectedId ? index?.spaceById.get(selectedId) || null : null;
  const editing = editingId ? index?.spaceById.get(editingId) || null : null;
  const drawerOpen = Boolean(selected) || unlocated !== null;

  // The panel keeps showing the last thing while it slides out, instead of emptying first.
  const [shown, setShown] = useState({ selectedId: null, unlocated: null });
  useLayoutEffect(() => { if (drawerOpen) setShown({ selectedId, unlocated }); }, [drawerOpen, selectedId, unlocated]);
  const shownRoom = shown.selectedId ? index?.spaceById.get(shown.selectedId) || null : null;
  const shownCode = shown.unlocated;
  const shownAssets = useMemo(() => (shownRoom ? index.assetsOfSpace(shownRoom.id) : []), [index, shownRoom]);
  const shownLinks = shownRoom ? index.linksBySpace.get(shownRoom.id) || [] : [];
  const unlocatedAssets = shownCode ? index?.assetsByCode.get(shownCode) || [] : [];

  // ---- the view: fit the floor, zoom, pan, and slide to a room
  const frameAt = useCallback((angle) => {
    const [x0, y0, x1, y1] = screenBounds(spaces, angle, SLAB * angle);
    const w = Math.max(x1 - x0, 1), h = Math.max(y1 - y0, 1), m = Math.max(w, h) * MARGIN;
    return { x: x0 - m, y: y0 - m, w: w + 2 * m, h: h + 2 * m, full: Math.max(w + 2 * m, h + 2 * m) };
  }, [spaces]);
  const frame = useCallback(() => frameAt(tiltRef.current), [frameAt]);

  /** Glide from where the plan is now (or from `from`) to `target`, zooming and panning together. */
  const animateView = useCallback((target, from = null, ms = FLY_MS) => {
    cancelAnimationFrame(animRef.current);
    const start = from || viewRef.current;
    if (!start || ms <= 0 || reduceMotion()) { setView(target); return; }
    const c0 = [start.x + start.w / 2, start.y + start.h / 2], c1 = [target.x + target.w / 2, target.y + target.h / 2];
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms), e = ease(t);
      const w = start.w * (target.w / start.w) ** e, h = start.h * (target.h / start.h) ** e;
      const cx = c0[0] + (c1[0] - c0[0]) * e, cy = c0[1] + (c1[1] - c0[1]) * e;
      setView({ x: cx - w / 2, y: cy - h / 2, w, h, full: target.full });
      if (t < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const fit = useCallback(() => animateView(frame()), [animateView, frame]);
  useEffect(() => { cancelAnimationFrame(animRef.current); setView(frame()); }, [spaces]); // eslint-disable-line react-hooks/exhaustive-deps

  // Turning between the angled and the plain view: the angle changes a little each frame while the camera keeps looking at
  // the same spot of the floor at the same zoom, so it reads as the camera moving rather than the drawing being swapped.
  useEffect(() => {
    const target = mode === "iso" ? 1 : 0;
    const from = tiltRef.current, current = viewRef.current;
    if (from === target) return undefined;
    cancelAnimationFrame(animRef.current);
    if (!current || reduceMotion()) { setTilt(target); setView(frameAt(target)); return undefined; }
    const ratio = current.w / frameAt(from).w;
    const spot = unproject([current.x + current.w / 2, current.y + current.h / 2], from);
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / TURN_MS), k = from + (target - from) * ease(t);
      const fit = frameAt(k), [cx, cy] = project(spot, k), w = fit.w * ratio, h = fit.h * ratio;
      tiltRef.current = k; setTilt(k);
      setView({ x: cx - w / 2, y: cy - h / 2, w, h, full: fit.full });
      if (t < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animRef.current);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The view that shows a room, with the room kept in the part of the plan the panel does not cover. */
  const viewForRoom = useCallback((space) => {
    const whole = frame();
    const rect = svgRef.current?.getBoundingClientRect();
    const aspect = rect && rect.height ? rect.width / rect.height : 1.6;
    const covered = rect && wide() ? Math.min(DRAWER_PX, rect.width * 0.6) / rect.width : 0;
    const [x0, y0, x1, y1] = spaceBounds(space, tiltRef.current);
    const size = Math.max(x1 - x0, y1 - y0) * 1.8;
    const fitW = Math.max(whole.w, whole.h * aspect);
    const w = Math.min(fitW, Math.max(size / (1 - covered), size * aspect, fitW / 7)), h = w / aspect;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return { x: cx - (w * (1 - covered)) / 2, y: cy - h / 2, w, h, full: whole.full };
  }, [frame]);
  // after the floor has changed (the effect above ran first), slide to the room that was asked for
  useEffect(() => {
    if (!flyId) return;
    const space = index?.spaceById.get(flyId);
    if (space && space.floor_id === floorId) animateView(viewForRoom(space), flyFresh.current ? frame() : null);
    flyFresh.current = false;
    setFlyId(null);
  }, [flyId, spaces]); // eslint-disable-line react-hooks/exhaustive-deps
  // a click on the plan only pans when the room would end up under the panel
  const keepClear = useCallback((space) => {
    const svg = svgRef.current, current = viewRef.current;
    if (!svg || !current || !wide()) return;
    const rect = svg.getBoundingClientRect(), ctm = svg.getScreenCTM();
    if (!ctm) return;
    const [x0, y0, x1, y1] = spaceBounds(space, tiltRef.current);
    const point = svg.createSVGPoint(); point.x = (x0 + x1) / 2; point.y = (y0 + y1) / 2;
    const at = point.matrixTransform(ctm);
    const limit = rect.right - Math.min(DRAWER_PX, rect.width * 0.6);
    if (at.x < limit - 24) return;
    const dx = (at.x - (rect.left + (limit - rect.left) / 2)) / ctm.a;
    animateView({ ...current, x: current.x + dx });
  }, [animateView]);

  const zoomAt = useCallback((factor, clientX, clientY) => {
    cancelAnimationFrame(animRef.current);
    setView((current) => {
      if (!current) return current;
      const svg = svgRef.current;
      let cx = current.x + current.w / 2, cy = current.y + current.h / 2;
      if (svg && clientX !== undefined) {
        const point = svg.createSVGPoint(); point.x = clientX; point.y = clientY;
        const mapped = point.matrixTransform(svg.getScreenCTM().inverse()); cx = mapped.x; cy = mapped.y;
      }
      const w = Math.min(Math.max(current.w * factor, current.full / 40), current.full * 1.6);
      const real = w / current.w;
      return { ...current, x: cx - (cx - current.x) * real, y: cy - (cy - current.y) * real, w: current.w * real, h: current.h * real };
    });
  }, []);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (event) => { event.preventDefault(); zoomAt(event.deltaY > 0 ? 1.15 : 1 / 1.15, event.clientX, event.clientY); };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  });
  function startDrag(event) {
    if (event.button !== 0 || !view) return;
    cancelAnimationFrame(animRef.current);
    const start = { x: event.clientX, y: event.clientY, view: viewRef.current || view, moved: false };
    dragRef.current = start;
    const move = (e) => {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 4) return;
      start.moved = true;
      const rect = svgRef.current.getBoundingClientRect();
      const scale = Math.max(start.view.w / rect.width, start.view.h / rect.height);
      setView({ ...start.view, x: start.view.x - dx * scale, y: start.view.y - dy * scale });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.setTimeout(() => { dragRef.current = null; }, 0); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  // ---- choosing things
  const changeFloor = useCallback((id) => { setFloorId(id); setSelectedId(null); setHoverId(null); setHighlightAsset(null); }, []);
  const pickRoom = useCallback((id, { fly = false, asset = null } = {}) => {
    const space = index?.spaceById.get(id);
    if (!space) return;
    const target = index.floorById.get(space.floor_id);
    if (target) { setBuilding(target.building); if (target.id !== floorId) setFloorId(target.id); }
    setUnlocated(null); setSelectedId(id); setHighlightAsset(asset);
    if (fly) { flyFresh.current = Boolean(target && target.id !== floorId); setFlyId(id); }
    else keepClear(space);
  }, [index, floorId, keepClear]);
  const clickRoom = (id) => { if (!dragRef.current?.moved) { if (selectedId === id) setSelectedId(null); else pickRoom(id); } };
  const chooseBuilding = (name) => {
    const here = floors.filter((item) => item.building === name);
    setBuilding(name); changeFloor((here.find((item) => /^一樓/.test(item.label)) || here[0]).id); setTerm(""); setUnlocated(null);
  };
  const goToCode = useCallback((code, assetId = null) => {
    const places = roomsOfCode(index, code);
    if (!places.length) { setSelectedId(null); setUnlocated(code); setHighlightAsset(assetId); return; }
    const here = places.find((item) => item.floor.id === floorId) || places[0];
    pickRoom(here.space.id, { fly: true, asset: assetId });
  }, [index, floorId, pickRoom]);

  // opened from 財物查詢
  useEffect(() => {
    if (!focus?.requestId || !index) return;
    goToCode(focus.code, focus.assetId || null);
    onFocusHandled?.();
  }, [focus?.requestId, index]); // eslint-disable-line react-hooks/exhaustive-deps

  // fullscreen
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === workbenchRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else workbenchRef.current?.requestFullscreen?.()?.catch?.(() => {}); };

  async function runImport(files) {
    if (!files.length) return;
    if (!window.confirm(`要匯入 ${files.length} 個檔案嗎？\n\n每個檔案會取代對應樓層的房間資料，包含在這個頁面上做過的修改。`)) return;
    setImporting(true); setReport(null);
    try { setReport(await importTracedFiles(client, files, floors)); await reload(); }
    catch (cause) { setReport([{ name: "匯入", ok: false, text: cause.message }]); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const ordered = ["void", "public", "room"].flatMap((type) => spaces.filter((space) => space.space_type === type));
  const solid = ordered.filter((space) => space.space_type !== "void");
  // a void is dashed where it sits among other rooms, and solid like any room where it reaches the edge of the floor
  const voidEdges = useMemo(() => voidEdgeKinds(spaces), [spaces]);
  const lift = SLAB * tilt;
  const showLabels = view && view.full / view.w >= 2.4;
  const tag = selected || spaces.find((space) => space.id === hoverId) || null;
  const position = floorsHere.findIndex((item) => item.id === floorId);

  return (
    <section className="page geographic-page indoor-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">INDOOR FLOOR PLANS</p>
          <h1>室內平面圖</h1>
          <p>在平面圖上點選房間，就能看到存放在那裡的所有財物；也可以直接搜尋財物，找出它在哪個房間。</p>
        </div>
        {canAdmin && (
          <div className="geo-page-actions">
            <input accept="application/json,.json" hidden multiple onChange={(event) => runImport([...event.target.files])} ref={fileRef} type="file" />
            <button className="button button-secondary" disabled={importing || !floors.length} onClick={() => fileRef.current?.click()} type="button">
              {importing && <CapsuleSpinner compact />}{importing ? "匯入中…" : "匯入平面圖資料"}
            </button>
          </div>
        )}
      </div>
      {report && (
        <div className="indoor-report" role="status">
          <ul>{report.map((line) => <li className={line.ok ? "is-ok" : "is-error"} key={line.name}><strong>{line.name}</strong> {line.text}</li>)}</ul>
          <button className="text-button" onClick={() => setReport(null)} type="button">關閉</button>
        </div>
      )}
      {loading ? <p className="muted">正在讀取平面圖…</p> : error && !index ? <p className="form-error" role="alert">{error}</p> : !index || !floors.length || !data.spaces.length ? (
        <p className="muted">尚未匯入平面圖資料。{canAdmin ? "請按右上角「匯入平面圖資料」，選取描圖工具存出的 .rooms.json。" : "請洽系統管理員。"}</p>
      ) : (
        <section className="geo-workbench indoor-workbench" ref={workbenchRef}>
          <aside className="geo-list-panel">
            <header>
              <h2>房間清單</h2>
              <div className="geo-list-header-actions"><strong>{listed.length} 間</strong>{canAdmin && selected && <button className="row-action" onClick={() => setEditingId(selected.id)} type="button">編輯</button>}</div>
            </header>
            <label className="geo-search">
              <span className="sr-only">搜尋房間或財物</span>
              <input onChange={(event) => setTerm(event.target.value)} placeholder="房間、代碼，或財物名稱、編號…" value={term} />
            </label>
            <div className="geo-list-scroll">
              {query && <p className="indoor-list-heading">房間 {listed.length}</p>}
              {listed.length ? listed.map((space) => {
                const links = index.linksBySpace.get(space.id) || [];
                const count = countOf(space);
                return (
                  <button aria-pressed={selectedId === space.id} className={`geo-list-item ${selectedId === space.id ? "is-selected" : ""}`} key={space.id} onClick={() => pickRoom(space.id, { fly: true })} onMouseEnter={() => setHoverId(space.id)} onMouseLeave={() => setHoverId(null)} type="button">
                    <span aria-hidden="true" className="geo-list-map-icon"><svg fill="none" viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 11h8M12 5v14" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /></svg></span>
                    <div>
                      <strong>{spaceTitle(space)}</strong>
                      <small>{links.length ? links.map((link) => link.location_code).join("、") : "未對應存置地點"}</small>
                    </div>
                    <em>{count ? `${fmt(count)} 筆` : "—"}</em>
                  </button>
                );
              }) : !query && <p className="geo-no-result">這一層沒有房間。</p>}
              {query && assetHits.total > 0 && (
                <>
                  <p className="indoor-list-heading">財物 {assetHits.total > assetHits.list.length ? `${assetHits.list.length}+（共 ${fmt(assetHits.total)}）` : assetHits.total}</p>
                  {assetHits.list.map((asset) => {
                    const places = roomsOfCode(index, asset.locationCode);
                    const here = places.find((item) => item.floor.id === floorId) || places[0];
                    return (
                      <button className="geo-list-item indoor-asset-hit" key={asset.id} onClick={() => goToCode(asset.locationCode, asset.id)} type="button">
                        <span aria-hidden="true" className="geo-list-map-icon"><svg fill="none" viewBox="0 0 24 24"><path d="m4 7.5 8-3.5 8 3.5v9l-8 3.5-8-3.5zM4 7.5l8 3.5 8-3.5M12 11v9" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /></svg></span>
                        <div><strong>{asset.name || "未命名財物"}</strong><small>{asset.assetNo}{asset.serialNo ? `-${asset.serialNo}` : ""}</small></div>
                        <em>{here ? `${here.floor.label}${places.length > 1 ? " 等" : ""}` : "未定位"}</em>
                      </button>
                    );
                  })}
                </>
              )}
              {query && !listed.length && !assetHits.total && <p className="geo-no-result">沒有符合的房間或財物。</p>}
            </div>
            <footer>
              <div><span>樓層面積</span><strong>{fmt(stats.area, 1)} m²</strong></div>
              <div><span>對應財物</span><strong>{fmt(stats.assets)} 筆</strong></div>
              {index.hasAssets && index.unlocated.length > 0 && (
                <button className="indoor-unlocated" onClick={() => { setSelectedId(null); setUnlocated(unlocated === null ? "" : null); }} type="button">
                  <span>未定位財物</span><strong>{fmt(index.unlocatedCount)} 筆 ›</strong>
                </button>
              )}
            </footer>
          </aside>

          <section aria-label="室內平面圖" className="geo-map-panel indoor-map-panel">
            <header>
              <div><span className="geo-live-dot" />{floor ? floorName(floor) : "平面圖"}</div>
              <div className="geo-map-actions">
                <span aria-label="選擇建築物" className="geo-basemap-toggle">
                  {buildings.map((name) => <button aria-pressed={building === name} className={building === name ? "is-active" : ""} key={name} onClick={() => chooseBuilding(name)} type="button">{name}</button>)}
                </span>
                <span aria-label="檢視角度" className="geo-basemap-toggle">
                  <button aria-pressed={mode === "iso"} className={mode === "iso" ? "is-active" : ""} onClick={() => setMode("iso")} type="button">立體</button>
                  <button aria-pressed={mode === "flat"} className={mode === "flat" ? "is-active" : ""} onClick={() => setMode("flat")} type="button">平面</button>
                </span>
                <span aria-label="顏色依據" className="geo-basemap-toggle">
                  <button aria-pressed={colorBy === "type"} className={colorBy === "type" ? "is-active" : ""} onClick={() => setColorBy("type")} type="button">空間類型</button>
                  <button aria-pressed={colorBy === "assets"} className={colorBy === "assets" ? "is-active" : ""} onClick={() => setColorBy("assets")} type="button">財物筆數</button>
                </span>
                <button className="text-button" onClick={fit} type="button">回到全區</button>
                <button className="text-button" onClick={toggleFullscreen} type="button">{fullscreen ? "離開全螢幕" : "全螢幕"}</button>
              </div>
            </header>
            <div className="indoor-stage">
              {view && (
                <svg aria-label={`${floorName(floor)}平面圖`} className="indoor-svg" onMouseDown={startDrag} preserveAspectRatio="xMidYMid meet" ref={svgRef} role="img" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}>
                  <defs>
                    {[...voidEdges].map(([id, edges]) => (edges.outer.length ? (
                      // keeps only the outer half of a void's edge line, so it is as thick as the line of a room beside it
                      <clipPath id={`indoor-void-${id}`} key={id}><path clipRule="evenodd" d={`M-1e7 -1e7H1e7V1e7H-1e7Z${ringPath(spaces.find((space) => space.id === id).ring, tilt)}`} /></clipPath>
                    ) : null))}
                  </defs>
                  <g className="indoor-scene" key={floorId}>
                    {tilt > 0.01 && (
                      <g className="indoor-slab">
                        {solid.map((space) => <path d={spacePath(space, tilt, lift)} fillRule="evenodd" key={space.id} />)}
                        {[...voidEdges].map(([id, edges]) => (edges.outer.length ? <path d={wallsPath(edges.outer, tilt, lift)} key={id} /> : null))}
                      </g>
                    )}
                    <g className="indoor-edge">
                      {solid.map((space) => <path d={spacePath(space, tilt)} key={space.id} />)}
                      {[...voidEdges].map(([id, edges]) => (edges.outer.length ? <path clipPath={`url(#indoor-void-${id})`} d={segmentsPath(edges.outer, tilt)} key={id} /> : null))}
                    </g>
                    <g className="indoor-rooms">
                      {ordered.map((space) => {
                        const heat = colorBy === "assets" && space.space_type !== "void" ? heatFill(countOf(space), maxCount) : null;
                        return (
                          <path
                            className={`indoor-room is-${space.space_type} ${selectedId === space.id ? "is-selected" : ""} ${hoverId === space.id ? "is-hover" : ""} ${query && !matches(space) && !hitSpaces.has(space.id) ? "is-dim" : ""} ${hitSpaces.has(space.id) ? "is-hit" : ""}`}
                            d={spacePath(space, tilt)} fillRule="evenodd" key={space.id}
                            onClick={() => clickRoom(space.id)} onMouseEnter={() => setHoverId(space.id)} onMouseLeave={() => setHoverId(null)}
                            style={heat && selectedId !== space.id ? { fill: heat } : undefined}
                          />
                        );
                      })}
                    </g>
                    <g className="indoor-void-dash">{[...voidEdges].map(([id, edges]) => (edges.inner.length ? <path d={segmentsPath(edges.inner, tilt)} key={id} /> : null))}</g>
                    <g className="indoor-void-line">{[...voidEdges].map(([id, edges]) => (edges.outer.length ? <path d={segmentsPath(edges.outer, tilt)} key={id} /> : null))}</g>
                    <g className="indoor-labels">
                      {(showLabels ? spaces.filter((space) => space.space_type !== "void" && (space.name || space.usage)) : tag ? [tag] : []).map((space) => {
                        const [x, y] = project(labelPoint(space), tilt);
                        return <text fontSize={view.w / (showLabels ? 70 : 52)} key={space.id} x={x} y={y}>{spaceTitle(space)}</text>;
                      })}
                    </g>
                  </g>
                </svg>
              )}
              <nav aria-label="樓層" className="indoor-floors">
                {[...floorsHere].reverse().map((item) => <button aria-current={item.id === floorId} className={item.id === floorId ? "is-active" : ""} key={item.id} onClick={() => changeFloor(item.id)} title={floorName(item)} type="button">{item.label}</button>)}
              </nav>
              <div className="indoor-zoom" role="group" aria-label="縮放">
                <button aria-label="放大" onClick={() => zoomAt(1 / 1.4)} type="button">+</button>
                <button aria-label="縮小" onClick={() => zoomAt(1.4)} type="button">−</button>
              </div>
              <p className="indoor-hint">{position >= 0 && floorsHere.length > 1 ? `${position + 1} / ${floorsHere.length} 層・` : ""}{stats.all} 個空間・{fmt(stats.area)} m²・財物 {fmt(stats.assets)} 筆</p>

              <aside aria-hidden={!drawerOpen} aria-label={shownRoom ? "房間財物" : "未定位財物"} className={`indoor-drawer ${drawerOpen ? "is-open" : ""}`} inert={!drawerOpen}>
                {shownRoom ? (
                  <div className="indoor-drawer-body" key={shownRoom.id}>
                    <header>
                      <div>
                        <p>{SPACE_TYPE_LABELS[shownRoom.space_type]}・{fmt(shownRoom.area_m2, 1)} m²{shownRoom.tool_id ? `・${shownRoom.tool_id}` : ""}</p>
                        <h2>{spaceTitle(shownRoom)}</h2>
                        {shownRoom.name && shownRoom.usage && <span className="indoor-note">{shownRoom.usage}</span>}
                      </div>
                      <button aria-label="關閉" className="indoor-close" onClick={() => setSelectedId(null)} type="button">×</button>
                    </header>
                    <ul className="indoor-codes">
                      {shownLinks.map((link) => {
                        const shared = (index.spacesByCode.get(link.location_code) || []).length > 1;
                        return (
                          <li key={link.location_code}>
                            <strong>{link.location_code}</strong><span>{link.location_name || "—"}</span>
                            <em>{fmt(index.countByCode.get(link.location_code) || 0)} 筆{shared ? "・共用" : ""}</em>
                            {onOpenInQuery && <button className="row-action" onClick={() => onOpenInQuery({ code: link.location_code, name: link.location_name })} title="在財物查詢中列出這個存置地點的財物" type="button">查詢</button>}
                          </li>
                        );
                      })}
                      {!shownLinks.length && <li className="is-empty">尚未對應存置地點，所以沒有財物。{canAdmin ? "可以按「編輯」指派。" : ""}</li>}
                    </ul>
                    {shownLinks.some((link) => (index.spacesByCode.get(link.location_code) || []).length > 1) && (
                      <p className="indoor-shared">共用代碼的財物只記錄存置地點，無法分辨在哪一間，所以每個共用的房間都會列出同一批財物。</p>
                    )}
                    {index.hasAssets
                      ? <AssetList assets={shownAssets} empty="這個房間目前沒有財物。" highlightId={highlightAsset} onOpenAsset={onOpenAsset} />
                      : <p className="indoor-empty">財物清單尚未載入。</p>}
                    {canAdmin && <button className="indoor-edit" onClick={() => setEditingId(shownRoom.id)} type="button">編輯這個房間</button>}
                  </div>
                ) : shown.unlocated !== null ? (
                  <div className="indoor-drawer-body" key={`unlocated-${shownCode}`}>
                    <header>
                      <div>
                        <p>這些存置地點還沒有對應到平面圖上的房間</p>
                        <h2>{shownCode ? `${shownCode}　${index.nameByCode.get(shownCode) || ""}` : "未定位財物"}</h2>
                      </div>
                      <button aria-label="關閉" className="indoor-close" onClick={() => setUnlocated(null)} type="button">×</button>
                    </header>
                    {shownCode ? (
                      <>
                        <button className="indoor-back" onClick={() => setUnlocated("")} type="button">‹ 全部未定位的存置地點</button>
                        {onOpenInQuery && <button className="row-action indoor-query" onClick={() => onOpenInQuery({ code: shownCode, name: index.nameByCode.get(shownCode) })} type="button">在財物查詢中列出</button>}
                        <AssetList assets={unlocatedAssets} highlightId={highlightAsset} onOpenAsset={onOpenAsset} />
                      </>
                    ) : (
                      <ul className="indoor-unlocated-list">
                        {index.unlocated.map((item) => (
                          <li key={item.code}><button onClick={() => setUnlocated(item.code)} type="button"><strong>{item.code}</strong><span>{item.name || "—"}</span><em>{fmt(item.count)} 筆</em></button></li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </aside>
            </div>
            <footer>
              {colorBy === "assets"
                ? <><span><i className="indoor-legend-none" />沒有財物</span><span className="indoor-gradient">少<i />多</span></>
                : <><span><i className="indoor-legend-room" />房間</span><span><i className="indoor-legend-public" />公共區域</span></>}
              <span><i className="indoor-legend-selected" />已選取</span>
              <span className="geo-building-note">滾輪縮放、拖曳平移；放大後會顯示房間名稱</span>
            </footer>
          </section>
        </section>
      )}
      {editing && canAdmin && (
        <RoomEditorDialog
          links={index.linksBySpace.get(editing.id) || []} locations={data.summary} onClose={() => setEditingId(null)}
          onDelete={async () => { await deleteSpace(client, editing.id); setEditingId(null); setSelectedId(null); await reload(); }}
          onSave={async (draft) => { await saveSpace(client, editing.id, draft); setEditingId(null); await reload(); }}
          space={editing}
        />
      )}
    </section>
  );
}
