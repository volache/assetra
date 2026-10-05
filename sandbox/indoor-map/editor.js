// Room editor: select / click-to-cut / draw polygon / closing line, with undo + local save.
import {
  distToSegment, floodRegion, interiorPoint, pathPoints, pointInRing,
  rasterBarrier, ringArea, simplifyRing, traceOuter,
} from "./geometry.js";

const NS = "http://www.w3.org/2000/svg";
const NUMBER = /^[A-Za-z]?\d{2,4}(-\d+)?$/;
const BARRIER_LAYERS = ["wall", "column", "window"];
const $ = (s) => document.querySelector(s);

function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
}
const ringD = (r) => "M" + r.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L") + " Z";
const hueOf = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function createEditor(api) {
  let plan = null;            // { id, meta, svg, unit }
  let rooms = [];             // [{ id, name, number, rings }]  (svg coords)
  let closers = [];           // [[a, b]]
  let selected = null;        // { kind: 'room'|'closer', id|idx }
  let tool = "select";
  let draft = [];
  let hover = null;           // svg point
  let snap = null;
  let drag = null;            // { i }
  let history = [];
  let raster = null;
  let bridgesOn = true;
  let groupRooms, groupOverlay, snapPoints = [], labels = [];

  // ---------- coordinate helpers ----------
  const cadToSvg = (p) => [p[0], -p[1]];
  const px = () => api.pxSize();
  const unitArea = (a) => (plan.unit === "cm" ? a / 10000 : a);
  const storeKey = () => `indoorMap.edits.${plan.id}`;

  // ---------- lifecycle ----------
  function attach(ctx) {
    plan = ctx;
    api.svg.querySelector("#room")?.remove();
    groupRooms = svgEl("g", { id: "room", class: "layer layer-room" });
    api.svg.prepend(groupRooms);
    groupOverlay = svgEl("g", { id: "edit-overlay" }, api.svg);
    labels = plan.meta.labels.map((l) => ({ text: l.text, p: cadToSvg([l.x, l.y]) }));
    snapPoints = BARRIER_LAYERS.flatMap((id) =>
      [...api.svg.querySelectorAll(`g#${id} path`)].flatMap((p) => pathPoints(p.getAttribute("d"))));
    raster = null; selected = null; draft = []; history = [];
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storeKey())); } catch { /* ignore */ }
    if (saved?.rooms) {
      rooms = saved.rooms; closers = saved.closers || []; bridgesOn = saved.bridgesOn ?? true;
      api.toast("已載入本機儲存的編修");
    } else {
      rooms = (plan.meta.rooms || []).map((r) => ({
        id: r.id, name: r.name || "", number: r.number || "",
        rings: r.polygon.map((ring) => ring.map(cadToSvg)),
      }));
      closers = []; bridgesOn = true;
    }
    $("#chk-bridges").checked = bridgesOn;
    setTool("select");
    renderAll();
  }

  function persist() {
    try {
      localStorage.setItem(storeKey(), JSON.stringify({ rooms, closers, bridgesOn }));
    } catch { /* storage unavailable */ }
  }
  const snapshot = () => {
    history.push(JSON.stringify({ rooms, closers }));
    if (history.length > 60) history.shift();
  };
  function commit() { persist(); raster = null; renderAll(); }
  function undo() {
    const s = history.pop();
    if (!s) return api.toast("沒有可復原的動作");
    ({ rooms, closers } = JSON.parse(s));
    selected = null; commit();
  }

  // ---------- rendering ----------
  function renderAll() { renderRooms(); renderOverlay(); renderPanel(); }

  function renderRooms() {
    groupRooms.replaceChildren();
    for (const r of rooms) {
      const p = svgEl("path", {
        class: "room", "data-id": r.id, "fill-rule": "evenodd",
        d: r.rings.map(ringD).join(" "), style: `--h:${hueOf(r.id)}`,
      }, groupRooms);
      if (selected?.kind === "room" && selected.id === r.id) p.classList.add("sel");
      if (!r.name) p.classList.add("noname");
    }
  }

  function renderOverlay() {
    if (!groupOverlay) return;
    groupOverlay.replaceChildren();
    const s = px();
    if (bridgesOn) {
      for (const k of ["door", "gap"]) {
        for (const [a, b] of plan.meta.bridges?.[k] || []) {
          svgEl("line", { x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], class: `bridge ${k}` }, groupOverlay);
        }
      }
    }
    closers.forEach(([a, b], i) => {
      const line = svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "closer" }, groupOverlay);
      if (selected?.kind === "closer" && selected.idx === i) line.classList.add("sel");
    });
    if (selected?.kind === "room") {
      const room = rooms.find((r) => r.id === selected.id);
      room?.rings[0].forEach((p, i) => {
        svgEl("circle", { cx: p[0], cy: p[1], r: 5 * s, class: "vh", "data-i": i }, groupOverlay);
      });
    }
    if (draft.length) {
      const pts = hover ? [...draft, hover] : draft;
      svgEl("polyline", { points: pts.map((p) => p.join(",")).join(" "), class: "draft" }, groupOverlay);
      draft.forEach((p, i) => svgEl("circle", { cx: p[0], cy: p[1], r: (i ? 3.5 : 6) * s, class: "dv" }, groupOverlay));
    }
    if (snap) svgEl("circle", { cx: snap[0], cy: snap[1], r: 7 * s, class: "snap" }, groupOverlay);
  }

  function renderPanel() {
    const room = selected?.kind === "room" ? rooms.find((r) => r.id === selected.id) : null;
    $("#room-edit").hidden = !room;
    if (room) {
      $("#f-name").value = room.name;
      $("#f-number").value = room.number;
      $("#f-area").textContent = `${unitArea(ringArea(room.rings[0])).toFixed(1)} m²`;
    }
    $("#room-count").textContent = rooms.length;
    $("#room-list").innerHTML = rooms.map((r) =>
      `<li data-id="${r.id}" class="${room?.id === r.id ? "on" : ""}${r.name ? "" : " noname"}">
        <b>${r.name || "（未命名）"}</b><span>${r.number || ""}</span>
        <i>${unitArea(ringArea(r.rings[0])).toFixed(1)} m²</i></li>`).join("");
    const orphan = labels.filter((l) => !NUMBER.test(l.text) &&
      !rooms.some((r) => r.rings[0].length && pointInRing(l.p, r.rings[0])));
    $("#orphan-count").textContent = orphan.length;
    $("#orphan-list").innerHTML = orphan.slice(0, 80).map((l, i) =>
      `<li data-x="${l.p[0]}" data-y="${l.p[1]}">${l.text}</li>`).join("");
    for (const b of document.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool === tool);
    $("#btn-undo").disabled = !history.length;
  }

  // ---------- room creation ----------
  function labelsFor(ring) {
    const names = [];
    let number = "";
    for (const l of labels) {
      if (!pointInRing(l.p, ring)) continue;
      if (NUMBER.test(l.text)) number ||= l.text;
      else if (!names.includes(l.text)) names.push(l.text);
    }
    return { name: names.join(" / "), number };
  }
  function nextId() {
    const n = rooms.reduce((m, r) => Math.max(m, parseInt(r.id.slice(1), 10) || 0), 0) + 1;
    return `r${String(n).padStart(3, "0")}`;
  }
  function addRoom(ring) {
    snapshot();
    const room = { id: nextId(), ...labelsFor(ring), rings: [ring] };
    rooms.push(room);
    selected = { kind: "room", id: room.id };
    commit();
    api.toast(room.name ? `已建立「${room.name}」` : "已建立房間（尚未命名）");
  }

  function roomAt(p) {
    let best = null, area = Infinity;
    for (const r of rooms) {
      if (!pointInRing(p, r.rings[0])) continue;
      const a = ringArea(r.rings[0]);
      if (a < area) { area = a; best = r; }
    }
    return best;
  }

  function getRaster() {
    if (raster) return raster;
    const paths = BARRIER_LAYERS.flatMap((id) =>
      [...api.svg.querySelectorAll(`g#${id} path`)].map((p) => p.getAttribute("d")));
    const segments = [...closers];
    if (bridgesOn) {
      for (const k of ["door", "gap"]) for (const [a, b] of plan.meta.bridges?.[k] || []) segments.push([cadToSvg(a), cadToSvg(b)]);
    }
    raster = rasterBarrier({ paths, segments, viewBox: plan.meta.viewBox });
    return raster;
  }

  function cutAt(p) {
    const existing = roomAt(p);
    if (existing) {
      selected = { kind: "room", id: existing.id };
      renderAll();
      return api.toast("這裡已經有房間了（Delete 可刪除後重切）");
    }
    const r = getRaster();
    const res = floodRegion(r, Math.floor((p[0] - r.ox) * r.scale), Math.floor((p[1] - r.oy) * r.scale));
    if (!res) return api.toast("點到牆線了，請點在房間內的空白處");
    if (res.leaked) return api.toast("這個空間有缺口沒封住：用「封口線」補上缺口，再點一次");
    const loop = traceOuter(res.region, r.w, r.h);
    if (!loop) return api.toast("無法取得範圍，請改用「畫多邊形」");
    const ring = simplifyRing(loop.map(([x, y]) => [r.ox + x / r.scale, r.oy + y / r.scale]), 1.2 / r.scale);
    addRoom(ring);
  }

  // ---------- pointer logic ----------
  function snapTo(p) {
    const tol = 10 * px();
    let best = null, bd = tol;
    const test = (q) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } };
    for (const q of snapPoints) test(q);
    for (const r of rooms) for (const q of r.rings[0]) test(q);
    for (const [a, b] of closers) { test(a); test(b); }
    return best;
  }

  function onPointerDown(e, p) {
    const h = e.target.closest?.(".vh");
    if (h && tool === "select") {
      snapshot();
      drag = { i: +h.dataset.i };
      return true;
    }
    return false;
  }
  function onPointerMove(e, p) {
    hover = p;
    if (drag) {
      const room = rooms.find((r) => r.id === selected.id);
      snap = snapTo(p);
      room.rings[0][drag.i] = [...(snap || p)];
      renderRooms(); renderOverlay();
      return true;
    }
    snap = ["draw", "closer"].includes(tool) ? snapTo(p) : null;
    if (tool === "select") {
      const r = roomAt(p);
      for (const el of groupRooms.children) el.classList.toggle("hover", r && el.dataset.id === r.id);
      api.status(r ? `${r.name || "（未命名）"} ${r.number || ""} · ${unitArea(ringArea(r.rings[0])).toFixed(1)} m²` : "");
    }
    if (draft.length || snap) renderOverlay();
    return false;
  }
  function onPointerUp() {
    if (!drag) return false;
    drag = null; snap = null; commit();
    return true;
  }

  function onClick(e, p) {
    if (e.button !== 0) return;
    const at = snap || p;
    if (tool === "cut") return cutAt(p);
    if (tool === "draw") {
      if (draft.length >= 3 && Math.hypot(at[0] - draft[0][0], at[1] - draft[0][1]) < 10 * px()) return finishDraw();
      draft.push([...at]); return renderOverlay();
    }
    if (tool === "closer") {
      draft.push([...at]);
      if (draft.length === 2) {
        snapshot(); closers.push([draft[0], draft[1]]); draft = []; commit();
        api.toast("已加封口線，再點房間內部切房間");
      } else renderOverlay();
      return;
    }
    // select
    const tol = 7 * px();
    const ci = closers.findIndex(([a, b]) => distToSegment(p, a, b).d < tol);
    if (ci >= 0) selected = { kind: "closer", idx: ci };
    else {
      const r = roomAt(p);
      selected = r ? { kind: "room", id: r.id } : null;
    }
    renderAll();
  }

  function onDblClick(e, p) {
    if (tool === "draw") { finishDraw(); return true; }
    if (tool === "select" && selected?.kind === "room") {
      const ring = rooms.find((r) => r.id === selected.id).rings[0];
      let best = null;
      ring.forEach((a, i) => {
        const r = distToSegment(p, a, ring[(i + 1) % ring.length]);
        if (r.d < 8 * px() && (!best || r.d < best.d)) best = { ...r, i };
      });
      if (best) { snapshot(); ring.splice(best.i + 1, 0, best.q); commit(); return true; }
    }
    return false;
  }

  function onContextMenu(e) {
    const h = e.target.closest?.(".vh");
    if (!h) return false;
    const room = rooms.find((r) => r.id === selected?.id);
    if (room && room.rings[0].length > 3) { snapshot(); room.rings[0].splice(+h.dataset.i, 1); commit(); }
    return true;
  }

  function finishDraw() {
    // a double-click also fires two single clicks: drop the duplicate vertices
    const ring = draft.filter((p, i) => i === 0 || Math.hypot(p[0] - draft[i - 1][0], p[1] - draft[i - 1][1]) > 3 * px());
    if (ring.length < 3) return api.toast("至少需要 3 個頂點");
    draft = []; addRoom(ring);
  }

  // ---------- actions ----------
  function setTool(t) {
    tool = t; draft = []; snap = null;
    api.setCursor(t === "select" ? "" : "crosshair");
    renderAll();
    const tips = {
      select: "選取：點房間可改名；選中後拖曳頂點調整，雙擊邊線加頂點，右鍵頂點刪除",
      cut: "點擊切房間：點在牆圍起來的空白處，自動抓出範圍",
      draw: "畫多邊形：逐點點擊，點回起點或雙擊／Enter 完成，Backspace 退一點",
      closer: "封口線：點兩點畫一條線，補上門洞或牆的缺口",
    };
    $("#tool-tip").textContent = tips[t];
  }
  function deleteSelected() {
    if (!selected) return;
    snapshot();
    if (selected.kind === "room") rooms = rooms.filter((r) => r.id !== selected.id);
    else closers.splice(selected.idx, 1);
    selected = null; commit();
  }
  function onKey(e) {
    if (e.target.matches("input, textarea")) return false;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { undo(); return true; }
    if (k === "v") setTool("select");
    else if (k === "c") setTool("cut");
    else if (k === "p") setTool("draw");
    else if (k === "l") setTool("closer");
    else if (k === "delete" || (k === "backspace" && !draft.length)) deleteSelected();
    else if (k === "backspace") { draft.pop(); renderOverlay(); }
    else if (k === "enter" && tool === "draw") finishDraw();
    else if (k === "escape") { draft = []; selected = null; renderAll(); }
    else return false;
    return true;
  }

  // ---------- panel wiring ----------
  for (const b of document.querySelectorAll("[data-tool]")) b.addEventListener("click", () => setTool(b.dataset.tool));
  $("#btn-undo").addEventListener("click", undo);
  $("#btn-delete").addEventListener("click", deleteSelected);
  const rename = (key) => (e) => {
    const room = rooms.find((r) => r.id === selected?.id);
    if (!room || room[key] === e.target.value) return;
    snapshot(); room[key] = e.target.value.trim(); commit();
  };
  $("#f-name").addEventListener("change", rename("name"));
  $("#f-number").addEventListener("change", rename("number"));
  $("#chk-bridges").addEventListener("change", (e) => { bridgesOn = e.target.checked; commit(); });
  $("#room-list").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    selected = { kind: "room", id: li.dataset.id };
    const room = rooms.find((r) => r.id === li.dataset.id);
    api.focus(interiorPoint(room.rings[0]), Math.sqrt(ringArea(room.rings[0])) * 3);
    renderAll();
  });
  $("#orphan-list").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (li) api.focus([+li.dataset.x, +li.dataset.y], 600);
  });
  $("#btn-reset").addEventListener("click", () => {
    if (!confirm("放棄本機編修，回到自動抽取的結果？")) return;
    try { localStorage.removeItem(storeKey()); } catch { /* ignore */ }
    attach(plan);
  });
  $("#btn-export").addEventListener("click", () => {
    const data = {
      planId: plan.id, name: plan.meta.name, unit: plan.unit, exportedAt: new Date().toISOString(),
      rooms: rooms.map((r) => ({
        id: r.id, name: r.name, number: r.number,
        areaM2: +unitArea(ringArea(r.rings[0])).toFixed(2),
        polygon: r.rings.map((ring) => ring.map(([x, y]) => [+x.toFixed(1), +(-y).toFixed(1)])),
      })),
      closers: closers.map(([a, b]) => [[a[0], -a[1]], [b[0], -b[1]]]),
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `${plan.id}-rooms.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#file-import").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      snapshot();
      rooms = data.rooms.map((r) => ({ id: r.id, name: r.name || "", number: r.number || "",
        rings: r.polygon.map((ring) => ring.map(cadToSvg)) }));
      closers = (data.closers || []).map(([a, b]) => [cadToSvg(a), cadToSvg(b)]);
      selected = null; commit(); api.toast(`已匯入 ${rooms.length} 個房間`);
    } catch { api.toast("匯入失敗：不是有效的房間 JSON"); }
    e.target.value = "";
  });

  return {
    attach, onPointerDown, onPointerMove, onPointerUp, onClick, onDblClick, onContextMenu, onKey,
    onViewChange: () => groupOverlay && renderOverlay(),
    get dragging() { return !!drag; },
    get roomCount() { return rooms.length; },
  };
}
