import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../supabase";
import { CapsuleSpinner } from "../../components/FeedbackCenter";
import { deleteSpace, importTracedFiles, loadIndoor, saveSpace } from "./indoorData";
import { CATEGORIES, SPACE_TYPE_LABELS, categoryOf, labelPoint, project, screenBounds, spacePath, spaceTitle } from "./geometry";
import { RoomEditorDialog } from "./RoomEditorDialog";

const SLAB = 120;               // thickness of the floor slab in the angled view, in drawing units
const MARGIN = 0.07;
const CATEGORY_ICONS = {
  office: <path d="M4 8h16v11H4zM9 8V5.5h6V8M4 13h16" />,
  machine: <path d="M5 4h14v6H5zM5 14h14v6H5zM8 7h.01M8 17h.01M12 7h4M12 17h4" />,
  toilet: <path d="M8 4.5a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4ZM5.5 20v-7l-1-3.5h7L10.5 13v7M16 4.5a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4ZM13.5 20l2.5-6 2.5 6M13.5 11.5h5" />,
  storage: <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5zM4 7.5l8 3.5 8-3.5M12 11v9" />,
};
const fmt = (number, digits = 0) => Number(number || 0).toLocaleString("zh-TW", { maximumFractionDigits: digits, minimumFractionDigits: digits });

function useIndoorData(client) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const reload = useCallback(async () => {
    if (!client) { setState({ loading: false, error: "尚未設定 Supabase 連線。", data: null }); return; }
    try { setState({ loading: false, error: "", data: await loadIndoor(client) }); }
    catch (cause) { setState({ loading: false, error: cause.message, data: null }); }
  }, [client]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

export function IndoorPlans({ canAdmin, client = supabase }) {
  const { loading, error, data, reload } = useIndoorData(client);
  const [building, setBuilding] = useState("");
  const [floorId, setFloorId] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [term, setTerm] = useState("");
  const [mode, setMode] = useState("iso");
  const [editingId, setEditingId] = useState(null);
  const [view, setView] = useState(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState(null);
  const svgRef = useRef(null);
  const fileRef = useRef(null);
  const dragRef = useRef(null);

  const floors = data?.floors || [];
  const buildings = useMemo(() => [...new Set(floors.map((floor) => floor.building))], [floors]);
  const floorsHere = useMemo(() => floors.filter((floor) => floor.building === building), [floors, building]);
  const floor = floors.find((item) => item.id === floorId) || null;

  // first load: open the first building on its ground floor
  useEffect(() => {
    if (!floors.length || floors.some((item) => item.id === floorId)) return;
    const first = floors[0].building;
    const here = floors.filter((item) => item.building === first);
    const start = here.find((item) => /^一樓/.test(item.label)) || here[0];
    setBuilding(first); setFloorId(start.id);
  }, [floors, floorId]);

  const countByCode = useMemo(() => new Map((data?.summary || []).map((row) => [row.location_code, row.asset_count])), [data]);
  const linksBySpace = useMemo(() => {
    const map = new Map();
    for (const link of data?.links || []) { if (!map.has(link.space_id)) map.set(link.space_id, []); map.get(link.space_id).push(link); }
    for (const list of map.values()) list.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    return map;
  }, [data]);
  const spaces = useMemo(() => (data?.spaces || []).filter((space) => space.floor_id === floorId), [data, floorId]);
  const assetsOf = useCallback((space) => (linksBySpace.get(space.id) || []).reduce((sum, link) => sum + (countByCode.get(link.location_code) || 0), 0), [linksBySpace, countByCode]);

  const stats = useMemo(() => {
    const codes = new Set();
    const counts = Object.fromEntries(CATEGORIES.map((category) => [category.id, 0]));
    let area = 0, rooms = 0;
    for (const space of spaces) {
      if (space.space_type === "void") continue;
      area += Number(space.area_m2) || 0;
      if (space.space_type === "room") rooms += 1;
      const category = categoryOf(space);
      if (category) counts[category] += 1;
      for (const link of linksBySpace.get(space.id) || []) codes.add(link.location_code);
    }
    let assets = 0;
    for (const code of codes) assets += countByCode.get(code) || 0;
    return { area, rooms, locations: codes.size, assets, counts, all: spaces.filter((space) => space.space_type !== "void").length };
  }, [spaces, linksBySpace, countByCode]);

  const query = term.trim().toLowerCase();
  const matches = useCallback((space) => {
    if (!query) return true;
    const codes = (linksBySpace.get(space.id) || []).map((link) => `${link.location_code} ${link.location_name || ""}`).join(" ");
    return `${space.name || ""} ${space.usage || ""} ${space.tool_id || ""} ${codes}`.toLowerCase().includes(query);
  }, [query, linksBySpace]);
  const listed = useMemo(() => spaces.filter((space) => space.space_type !== "void" && matches(space)).sort((a, b) => {
    const rank = (space) => ((linksBySpace.get(space.id) || []).length ? 0 : space.name ? 1 : space.usage ? 2 : 3);
    return rank(a) - rank(b) || spaceTitle(a).localeCompare(spaceTitle(b), "zh-Hant");
  }), [spaces, matches, linksBySpace]);

  const selected = spaces.find((space) => space.id === selectedId) || null;
  const editing = (data?.spaces || []).find((space) => space.id === editingId) || null;

  // fit the floor into the frame whenever the floor or the angle changes
  const fit = useCallback(() => {
    const [x0, y0, x1, y1] = screenBounds(spaces, mode, mode === "iso" ? SLAB : 0);
    const w = Math.max(x1 - x0, 1), h = Math.max(y1 - y0, 1), m = Math.max(w, h) * MARGIN;
    setView({ x: x0 - m, y: y0 - m, w: w + 2 * m, h: h + 2 * m, full: Math.max(w + 2 * m, h + 2 * m) });
  }, [spaces, mode]);
  useEffect(() => { fit(); setSelectedId(null); setHoverId(null); }, [floorId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fit(); }, [spaces, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = useCallback((factor, clientX, clientY) => {
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
    const start = { x: event.clientX, y: event.clientY, view, moved: false };
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
  const clicked = (id) => { if (!dragRef.current?.moved) setSelectedId((current) => (current === id ? null : id)); };

  const changeFloor = (next) => { if (next) setFloorId(next.id); };
  const index = floorsHere.findIndex((item) => item.id === floorId);
  const chooseBuilding = (name) => {
    const here = floors.filter((item) => item.building === name);
    setBuilding(name); setFloorId((here.find((item) => /^一樓/.test(item.label)) || here[0]).id); setTerm("");
  };

  async function runImport(files) {
    if (!files.length) return;
    if (!window.confirm(`要匯入 ${files.length} 個檔案嗎？\n\n每個檔案會取代對應樓層的房間資料，包含在這個頁面上做過的修改。`)) return;
    setImporting(true); setReport(null);
    try { setReport(await importTracedFiles(client, files, floors)); await reload(); }
    catch (cause) { setReport([{ name: "匯入", ok: false, text: cause.message }]); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const ordered = ["void", "public", "room"].flatMap((type) => spaces.filter((space) => space.space_type === type));
  const showLabels = view && view.full / view.w >= 2.4;
  const tag = selected || spaces.find((space) => space.id === hoverId) || null;

  return (
    <section className="page geographic-page indoor-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">INDOOR FLOOR PLANS</p>
          <h1>室內平面圖</h1>
          <p>依描圖工具整理的房間範圍，對照存置地點與財物筆數；點選房間可查看對應的代碼與面積。</p>
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
      {loading ? <p className="muted">正在讀取平面圖…</p> : error ? <p className="form-error" role="alert">{error}</p> : !floors.length || !data.spaces.length ? (
        <p className="muted">尚未匯入平面圖資料。{canAdmin ? "請按右上角「匯入平面圖資料」，選取描圖工具存出的 .rooms.json。" : "請洽系統管理員。"}</p>
      ) : (
        <section className="geo-workbench indoor-workbench">
          <aside className="geo-list-panel">
            <header>
              <h2>房間清單</h2>
              <div className="geo-list-header-actions"><strong>{listed.length} 筆</strong>{canAdmin && selected && <button className="row-action" onClick={() => setEditingId(selected.id)} type="button">編輯</button>}</div>
            </header>
            <label className="geo-search">
              <span className="sr-only">搜尋房間</span>
              <input onChange={(event) => setTerm(event.target.value)} placeholder="名稱、代碼、空間用途…" value={term} />
            </label>
            <div className="geo-list-scroll">
              {listed.length ? listed.map((space) => {
                const links = linksBySpace.get(space.id) || [];
                return (
                  <button aria-pressed={selectedId === space.id} className={`geo-list-item ${selectedId === space.id ? "is-selected" : ""}`} key={space.id} onClick={() => setSelectedId(space.id)} onMouseEnter={() => setHoverId(space.id)} onMouseLeave={() => setHoverId(null)} type="button">
                    <span aria-hidden="true" className="geo-list-map-icon"><svg fill="none" viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 11h8M12 5v14" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /></svg></span>
                    <div>
                      <strong>{spaceTitle(space)}</strong>
                      <small>{links.length ? links.map((link) => link.location_code).join("、") : space.name && space.usage ? space.usage : "未對應存置地點"}</small>
                    </div>
                    <em>{fmt(space.area_m2, 1)} m²</em>
                  </button>
                );
              }) : <p className="geo-no-result">沒有符合的房間。</p>}
            </div>
            <footer>
              <div><span>目前筆數</span><strong>{listed.length} 筆</strong></div>
              <div><span>樓層面積</span><strong>{fmt(stats.area, 1)} m²</strong></div>
              <div><span>對應財物</span><strong>{fmt(stats.assets)} 筆</strong></div>
            </footer>
          </aside>

          <section aria-label="室內平面圖" className="geo-map-panel indoor-map-panel">
            <header>
              <div>
                <span className="geo-live-dot" />
                {floor ? `${floor.building} ${floor.label}` : "平面圖"}
              </div>
              <div className="geo-map-actions">
                <span aria-label="選擇建築物" className="geo-basemap-toggle">
                  {buildings.map((name) => <button aria-pressed={building === name} className={building === name ? "is-active" : ""} key={name} onClick={() => chooseBuilding(name)} type="button">{name}</button>)}
                </span>
                <span aria-label="檢視角度" className="geo-basemap-toggle">
                  <button aria-pressed={mode === "iso"} className={mode === "iso" ? "is-active" : ""} onClick={() => setMode("iso")} type="button">立體</button>
                  <button aria-pressed={mode === "flat"} className={mode === "flat" ? "is-active" : ""} onClick={() => setMode("flat")} type="button">平面</button>
                </span>
              </div>
            </header>
            <div className="indoor-stage">
              <button aria-label="上一層" className="indoor-arrow is-prev" disabled={index <= 0} onClick={() => changeFloor(floorsHere[index - 1])} type="button">‹</button>
              <button aria-label="下一層" className="indoor-arrow is-next" disabled={index < 0 || index >= floorsHere.length - 1} onClick={() => changeFloor(floorsHere[index + 1])} type="button">›</button>
              <div className="indoor-card">
                <header className="indoor-card-head">
                  <h2>{floor?.building} {floor?.label}</h2>
                  <span>{stats.all} 個空間</span>
                </header>
                <div className="indoor-plan">
                  {view && (
                    <svg aria-label={`${floor?.building || ""}${floor?.label || ""}平面圖`} onMouseDown={startDrag} preserveAspectRatio="xMidYMid meet" ref={svgRef} role="img" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}>
                      {mode === "iso" && <g className="indoor-slab">{ordered.filter((space) => space.space_type !== "void").map((space) => <path d={spacePath(space, mode, SLAB)} fillRule="evenodd" key={space.id} />)}</g>}
                      <g className="indoor-edge">{ordered.filter((space) => space.space_type !== "void").map((space) => <path d={spacePath(space, mode)} key={space.id} />)}</g>
                      <g className="indoor-rooms">
                        {ordered.map((space) => (
                          <path
                            className={`indoor-room is-${space.space_type} ${selectedId === space.id ? "is-selected" : ""} ${hoverId === space.id ? "is-hover" : ""} ${query && !matches(space) ? "is-dim" : ""}`}
                            d={spacePath(space, mode)} fillRule="evenodd" key={space.id}
                            onClick={() => clicked(space.id)} onMouseEnter={() => setHoverId(space.id)} onMouseLeave={() => setHoverId(null)}
                          />
                        ))}
                      </g>
                      <g className="indoor-labels">
                        {(showLabels ? spaces.filter((space) => space.space_type !== "void" && (space.name || space.usage)) : tag ? [tag] : []).map((space) => {
                          const [x, y] = project(labelPoint(space), mode);
                          return <text fontSize={view.w / (showLabels ? 70 : 52)} key={space.id} x={x} y={y}>{spaceTitle(space)}</text>;
                        })}
                      </g>
                    </svg>
                  )}
                  <div className="indoor-zoom" role="group" aria-label="縮放">
                    <button aria-label="放大" onClick={() => zoomAt(1 / 1.4)} type="button">+</button>
                    <button aria-label="縮小" onClick={() => zoomAt(1.4)} type="button">−</button>
                    <button aria-label="符合視窗" onClick={fit} type="button">⤢</button>
                  </div>
                  {selected && (
                    <article aria-live="polite" className="indoor-detail">
                      <button aria-label="關閉" className="indoor-detail-close" onClick={() => setSelectedId(null)} type="button">×</button>
                      <p>{SPACE_TYPE_LABELS[selected.space_type]}{selected.tool_id ? ` ・ ${selected.tool_id}` : ""}</p>
                      <h3>{spaceTitle(selected)}</h3>
                      {selected.name && selected.usage && <span className="indoor-note">{selected.usage}</span>}
                      <dl>
                        <div><dt>面積</dt><dd>{fmt(selected.area_m2, 1)} m²</dd></div>
                        <div><dt>財物</dt><dd>{fmt(assetsOf(selected))} 筆</dd></div>
                      </dl>
                      <ul className="indoor-codes">
                        {(linksBySpace.get(selected.id) || []).map((link) => (
                          <li key={link.location_code}><strong>{link.location_code}</strong><span>{link.location_name || "—"}</span><em>{fmt(countByCode.get(link.location_code) || 0)} 筆</em></li>
                        ))}
                        {!(linksBySpace.get(selected.id) || []).length && <li className="is-empty">尚未對應存置地點</li>}
                      </ul>
                      {canAdmin && <button className="indoor-edit" onClick={() => setEditingId(selected.id)} type="button">編輯這個房間</button>}
                    </article>
                  )}
                </div>
                <div className="indoor-stats">
                  <dl className="indoor-totals">
                    <div><dt>樓層面積</dt><dd>{fmt(stats.area, 1)} m²</dd></div>
                    <div><dt>房間數</dt><dd>{fmt(stats.rooms)}</dd></div>
                    <div><dt>存置地點</dt><dd>{fmt(stats.locations)}</dd></div>
                    <div><dt>財物筆數</dt><dd>{fmt(stats.assets)}</dd></div>
                  </dl>
                  <ul className="indoor-categories">
                    {CATEGORIES.map((category) => (
                      <li key={category.id}>
                        <b>{stats.counts[category.id]}</b>
                        <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24">{CATEGORY_ICONS[category.id]}</svg>
                        <span>{category.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <footer className="indoor-card-actions">
                  <span className="indoor-floor-name">{floor ? `${index + 1} / ${floorsHere.length}　${floor.label}` : ""}</span>
                  <div>
                    <button className="indoor-pill" disabled={index <= 0} onClick={() => changeFloor(floorsHere[index - 1])} type="button">‹ 上一層</button>
                    <button className="indoor-pill is-primary" disabled={index < 0 || index >= floorsHere.length - 1} onClick={() => changeFloor(floorsHere[index + 1])} type="button">下一層 ›</button>
                  </div>
                </footer>
              </div>
              <nav aria-label="樓層" className="indoor-dots">
                {floorsHere.map((item) => <button aria-current={item.id === floorId} aria-label={`${item.building} ${item.label}`} className={item.id === floorId ? "is-active" : ""} key={item.id} onClick={() => setFloorId(item.id)} title={item.label} type="button" />)}
              </nav>
            </div>
            <footer>
              <span><i className="indoor-legend-room" />房間</span>
              <span><i className="indoor-legend-public" />公共區域</span>
              <span><i className="indoor-legend-selected" />已選取</span>
              <span className="geo-building-note">滾輪縮放、拖曳平移；放大後會顯示房間名稱</span>
            </footer>
          </section>
        </section>
      )}
      {editing && canAdmin && (
        <RoomEditorDialog
          links={linksBySpace.get(editing.id) || []} locations={data.summary} onClose={() => setEditingId(null)}
          onDelete={async () => { await deleteSpace(client, editing.id); setEditingId(null); setSelectedId(null); await reload(); }}
          onSave={async (draft) => { await saveSpace(client, editing.id, draft); setEditingId(null); await reload(); }}
          space={editing}
        />
      )}
    </section>
  );
}
