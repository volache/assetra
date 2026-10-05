const $ = (s) => document.querySelector(s);
const stage = $("#stage");
const status = $("#status");
const state = { vb: null, home: null, svg: null };

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
  renderLayers(meta);
  renderReport(meta);
  status.textContent = `${meta.name}（單位：${meta.unit}）`;
}

function applyViewBox() {
  state.svg.setAttribute("viewBox", state.vb.join(" "));
}

function renderLayers(meta) {
  const box = $("#layers");
  box.innerHTML = "";
  for (const l of meta.layers) {
    const row = document.createElement("label");
    row.className = "layer-row";
    row.innerHTML = `<input type="checkbox" ${l.visible ? "checked" : ""}>
      <span class="swatch" style="background:var(--${l.id})"></span>
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
    ["原始圖元", r.read], ["裁切範圍外（圖框／他圖／標題欄）", r.outsideCrop],
    ["過短線段", r.tooShort], ["重複線段", r.duplicate], ["保留", kept],
    ["原始大小", `${(r.sourceBytes / 1024).toFixed(0)} KB`],
    ["SVG 大小", `${(r.svgBytes / 1024).toFixed(0)} KB`],
  ];
  $("#report").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
}

// pan / zoom on viewBox
stage.addEventListener("wheel", (e) => {
  if (!state.svg) return;
  e.preventDefault();
  const k = Math.exp(e.deltaY * 0.0015);
  const rect = state.svg.getBoundingClientRect();
  const [x, y, w, h] = state.vb;
  // preserveAspectRatio meet: compute scale + offset
  const s = Math.max(w / rect.width, h / rect.height);
  const ox = (rect.width - w / s) / 2, oy = (rect.height - h / s) / 2;
  const px = x + (e.clientX - rect.left - ox) * s;
  const py = y + (e.clientY - rect.top - oy) * s;
  state.vb = [px - (px - x) * k, py - (py - y) * k, w * k, h * k];
  applyViewBox();
}, { passive: false });

let drag = null;
stage.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, vb: [...state.vb] };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add("drag");
});
stage.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const rect = state.svg.getBoundingClientRect();
  const s = Math.max(drag.vb[2] / rect.width, drag.vb[3] / rect.height);
  state.vb = [drag.vb[0] - (e.clientX - drag.x) * s, drag.vb[1] - (e.clientY - drag.y) * s,
    drag.vb[2], drag.vb[3]];
  applyViewBox();
});
const end = () => { drag = null; stage.classList.remove("drag"); };
stage.addEventListener("pointerup", end);
stage.addEventListener("pointercancel", end);
stage.addEventListener("dblclick", () => { state.vb = [...state.home]; applyViewBox(); });

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
