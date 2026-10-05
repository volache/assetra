import { createEditor } from "./editor.js";

const $ = (s) => document.querySelector(s);
const stage = $("#stage");
const status = $("#status");
const state = { vb: null, home: null, svg: null, baseStatus: "" };

const api = {
  get svg() { return state.svg; },
  pxSize() {
    const rect = state.svg.getBoundingClientRect();
    return Math.max(state.vb[2] / rect.width, state.vb[3] / rect.height);
  },
  toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(api._t);
    api._t = setTimeout(() => t.classList.remove("show"), 3200);
  },
  status(text) { status.textContent = text || state.baseStatus; },
  setCursor(c) { stage.style.cursor = c; },
  focus([x, y], size) {
    const rect = state.svg.getBoundingClientRect();
    const h = size, w = size * (rect.width / rect.height);
    state.vb = [x - w / 2, y - h / 2, w, h];
    applyViewBox();
  },
};
const editor = createEditor(api);

async function loadIndex() {
  const res = await fetch("data/index.json");
  if (!res.ok) throw new Error("data/index.json 不存在，請先執行 tools/build_index.py");
  return res.json();
}

async function loadPlan(id) {
  status.textContent = "載入中…";
  const [meta, svgText] = await Promise.all([
    fetch(`data/${id}.json`).then((r) => r.json()),
    fetch(`data/${id}.svg`).then((r) => r.text()),
  ]);
  stage.querySelector("svg")?.remove();
  stage.insertAdjacentHTML("afterbegin", svgText);
  state.svg = stage.querySelector("svg");
  state.home = [...meta.viewBox];
  state.vb = [...meta.viewBox];
  applyViewBox();
  meta.labels ||= [];
  editor.attach({ id, meta, svg: state.svg, unit: meta.unit });
  renderLayers(meta);
  renderReport(meta);
  state.baseStatus = `${meta.name}（單位：${meta.unit}）`;
  status.textContent = state.baseStatus;
}

function applyViewBox() {
  state.svg.setAttribute("viewBox", state.vb.join(" "));
  editor.onViewChange();
}

function renderLayers(meta) {
  const box = $("#layers");
  box.innerHTML = "";
  const layers = [{ id: "room", label: "房間範圍", visible: true, count: editor.roomCount },
    ...meta.layers.filter((l) => l.id !== "room")];
  for (const l of layers) {
    const row = document.createElement("label");
    row.className = "layer-row";
    row.innerHTML = `<input type="checkbox" ${l.visible ? "checked" : ""}>
      <span class="swatch" style="background:var(--${l.id}, var(--muted))"></span>
      <span>${l.label}</span><span class="n">${l.count}</span>`;
    const g = state.svg.querySelector(`#${l.id}`);
    const toggle = (on) => g && (g.style.display = on ? "" : "none");
    toggle(l.visible);
    row.querySelector("input").addEventListener("change", (e) => toggle(e.target.checked));
    box.append(row);
  }
}

function renderReport(meta) {
  const r = meta.report;
  const kept = Object.values(r.kept).reduce((a, b) => a + b, 0);
  const rows = [
    ["原始圖元", r.read], ["裁切範圍外", r.outsideCrop],
    ["過短線段", r.tooShort], ["重複線段", r.duplicate], ["保留", kept],
    ["原始大小", `${(r.sourceBytes / 1024).toFixed(0)} KB`],
    ["SVG 大小", `${(r.svgBytes / 1024).toFixed(0)} KB`],
  ];
  $("#report").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
}

// ---------- pointer: pan / zoom / editor hand-off ----------
function toSvg(e) {
  const pt = state.svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const q = pt.matrixTransform(state.svg.getScreenCTM().inverse());
  return [q.x, q.y];
}

stage.addEventListener("wheel", (e) => {
  if (!state.svg) return;
  e.preventDefault();
  const k = Math.exp(e.deltaY * 0.0015);
  const [px, py] = toSvg(e);
  const [x, y, w, h] = state.vb;
  state.vb = [px - (px - x) * k, py - (py - y) * k, w * k, h * k];
  applyViewBox();
}, { passive: false });

let pan = null;
stage.addEventListener("pointerdown", (e) => {
  if (!state.svg || e.button !== 0) return;
  stage.setPointerCapture(e.pointerId);
  if (editor.onPointerDown(e, toSvg(e))) return;
  pan = { x: e.clientX, y: e.clientY, vb: [...state.vb], moved: false };
});
stage.addEventListener("pointermove", (e) => {
  if (!state.svg) return;
  if (editor.dragging) { editor.onPointerMove(e, toSvg(e)); return; }
  if (pan) {
    if (!pan.moved && Math.hypot(e.clientX - pan.x, e.clientY - pan.y) < 4) return;
    pan.moved = true;
    stage.classList.add("drag");
    const s = api.pxSize();
    state.vb = [pan.vb[0] - (e.clientX - pan.x) * s, pan.vb[1] - (e.clientY - pan.y) * s, pan.vb[2], pan.vb[3]];
    applyViewBox();
    return;
  }
  editor.onPointerMove(e, toSvg(e));
});
const endPan = (e) => {
  if (editor.onPointerUp()) { pan = null; return; }
  if (pan && !pan.moved && e.type === "pointerup") editor.onClick(e, toSvg(e));
  pan = null;
  stage.classList.remove("drag");
};
stage.addEventListener("pointerup", endPan);
stage.addEventListener("pointercancel", endPan);
stage.addEventListener("dblclick", (e) => {
  if (!state.svg || editor.onDblClick(e, toSvg(e))) return;
  state.vb = [...state.home];
  applyViewBox();
});
stage.addEventListener("contextmenu", (e) => { if (editor.onContextMenu(e)) e.preventDefault(); });
window.addEventListener("keydown", (e) => { if (editor.onKey(e)) e.preventDefault(); });

(async () => {
  try {
    const plans = await loadIndex();
    const sel = $("#plan");
    sel.innerHTML = plans.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
    sel.addEventListener("change", () => loadPlan(sel.value));
    await loadPlan(plans[0].id);
  } catch (err) {
    status.textContent = String(err.message || err);
  }
})();
