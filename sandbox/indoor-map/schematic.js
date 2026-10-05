const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const KIND = { dorm: "宿舍房間", public: "公共區域", laundry: "洗衣區", special: "多房間宿舍",
  recreation: "康樂空間", room: "空間", toilet: "廁所", garage: "車庫", other: "其他" };

const state = { index: [], metas: new Map(), floor: null, code: null, vb: null, home: null, svg: null };

async function load() {
  const res = await fetch("data/schematic/index.json");
  if (!res.ok) throw new Error("找不到 data/schematic/index.json，請先執行 tools/build_schematic.py");
  state.index = await res.json();
  await Promise.all(state.index.map(async (f) => {
    state.metas.set(f.id, await fetch(`data/schematic/${f.id}.json`).then((r) => r.json()));
  }));
  const [floorId, code] = decodeURIComponent(location.hash.slice(1)).split("/");
  await showFloor(state.metas.has(floorId) ? floorId : state.index[0].id, code);
}

function renderTabs() {
  const groups = new Map();
  for (const f of state.index) (groups.get(f.building) ?? groups.set(f.building, []).get(f.building)).push(f);
  $("#tabs").innerHTML = [...groups].map(([b, fs]) =>
    `<div class="group"><span>${esc(b)}</span>${fs.map((f) =>
      `<button class="pill ${f.id === state.floor ? "on" : ""}" data-floor="${f.id}">${esc(f.floor)}</button>`).join("")}</div>`).join("");
}

async function showFloor(id, code = null) {
  state.floor = id;
  const meta = state.metas.get(id);
  const svgText = await fetch(`data/schematic/${id}.svg`).then((r) => r.text());
  $("#map").innerHTML = svgText;
  state.svg = $("#map svg");
  state.home = [...meta.viewBox];
  state.vb = [...meta.viewBox];
  applyVb();
  renderTabs();
  const kinds = [...new Set(meta.rooms.map((r) => r.kind))];
  $("#legend").innerHTML = kinds.map((k) => `<span><i style="background:var(--k-${k})"></i>${KIND[k] ?? k}</span>`).join("");
  select(code && meta.rooms.some((r) => r.code === code) ? code : null, { focus: !!code });
}

function applyVb() { state.svg.setAttribute("viewBox", state.vb.join(" ")); }

function select(code, { focus = false } = {}) {
  state.code = code;
  for (const g of state.svg.querySelectorAll(".space")) {
    g.classList.toggle("sel", g.dataset.code === code);
    g.classList.toggle("dim", false);
  }
  history.replaceState(null, "", `#${state.floor}${code ? "/" + encodeURIComponent(code) : ""}`);
  renderPanel();
  if (focus && code) zoomTo(code);
}

function zoomTo(code) {
  const g = state.svg.querySelector(`.space[data-code="${CSS.escape(code)}"]`);
  if (!g) return;
  const b = g.querySelector("path").getBBox();
  const rect = state.svg.getBoundingClientRect();
  const k = Math.max((b.width * 2.4) / rect.width, (b.height * 2.4) / rect.height);
  const w = rect.width * k, h = rect.height * k;
  state.vb = [b.x + b.width / 2 - w / 2, b.y + b.height / 2 - h / 2, w, h];
  applyVb();
}

function renderPanel() {
  const meta = state.metas.get(state.floor);
  const room = meta.rooms.find((r) => r.code === state.code);
  if (!room) {
    const total = meta.rooms.reduce((a, r) => a + r.count, 0);
    $("#panel").innerHTML = `
      <h2>${esc(meta.building)} ${esc(meta.floor)}</h2>
      <div class="sub">點選地圖上的空間查看財物</div>
      <div class="stats"><div class="stat"><b>${meta.rooms.length}</b><span>空間</span></div>
        <div class="stat"><b>${total}</b><span>財物（件）</span></div></div>
      <h3>空間列表</h3>
      <ul class="spaces">${[...meta.rooms].sort((a, b) => b.count - a.count).map((r) =>
        `<li data-code="${esc(r.code)}"><span>${esc(r.name)}</span><b>${r.count}</b></li>`).join("")}</ul>`;
    return;
  }
  const units = Object.entries(room.units).sort((a, b) => b[1] - a[1]);
  $("#panel").innerHTML = `
    <button class="back" data-back>← ${esc(meta.building)} ${esc(meta.floor)} 全部空間</button>
    <h2>${esc(room.name)}</h2>
    <div class="sub">${esc(room.code.replace("*", "").replace(/^_.*/, "—"))} · ${KIND[room.kind] ?? "空間"} · 約 ${room.areaM2} m²</div>
    ${room.provisional ? `<div class="warn">位置待確認：地圖上的位置是暫定的</div>` : ""}
    <div class="stats"><div class="stat"><b>${room.count}</b><span>財物（件）</span></div>
      <div class="stat"><b>${room.items.length}</b><span>品項</span></div></div>
    ${units.length ? `<h3>使用單位</h3><div class="chips">${units.map(([u, n]) =>
      `<span class="chip">${esc(u)} ${n}</span>`).join("")}</div>` : ""}
    <h3>財物</h3>
    ${room.items.length ? `<ul class="items">${room.items.map((i) =>
      `<li><span>${esc(i.name)}</span><b>${i.qty}</b></li>`).join("")}</ul>` : `<div class="sub">尚無財物登記在這個空間</div>`}`;
}

// ---------- search ----------
function search(q) {
  q = q.trim().toLowerCase();
  const box = $("#results");
  if (!q) { box.hidden = true; return; }
  const hits = [];
  for (const [fid, meta] of state.metas) {
    for (const r of meta.rooms) {
      const byRoom = r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q);
      const item = byRoom ? null : r.items.find((i) => i.name.toLowerCase().includes(q));
      if (byRoom || item) hits.push({ fid, meta, r, item });
    }
  }
  box.innerHTML = hits.slice(0, 30).map((h, i) =>
    `<li data-i="${i}"><span>${esc(h.r.name)}${h.item ? ` · ${esc(h.item.name)}` : ""}</span>
     <small>${esc(h.meta.building)} ${esc(h.meta.floor)}</small></li>`).join("") ||
    `<li><span>找不到符合的空間或財物</span></li>`;
  box.hidden = false;
  box._hits = hits;
}

$("#q").addEventListener("input", (e) => search(e.target.value));
$("#q").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.target.value = ""; search(""); } });
$("#results").addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-i]");
  const h = li && $("#results")._hits[+li.dataset.i];
  if (!h) return;
  $("#results").hidden = true;
  if (h.fid !== state.floor) await showFloor(h.fid, h.r.code);
  else select(h.r.code, { focus: true });
});
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) $("#results").hidden = true; });

// ---------- interactions ----------
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-floor]");
  if (b && b.dataset.floor !== state.floor) showFloor(b.dataset.floor);
});
$("#panel").addEventListener("click", (e) => {
  if (e.target.closest("[data-back]")) return select(null);
  const li = e.target.closest("li[data-code]");
  if (li) select(li.dataset.code, { focus: true });
});
$("#fit").addEventListener("click", () => { state.vb = [...state.home]; applyVb(); });

const stage = $("#stage");
const toSvg = (e) => {
  const pt = state.svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const q = pt.matrixTransform(state.svg.getScreenCTM().inverse());
  return [q.x, q.y];
};
stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  const k = Math.exp(e.deltaY * 0.0015);
  const [px, py] = toSvg(e);
  const [x, y, w, h] = state.vb;
  state.vb = [px - (px - x) * k, py - (py - y) * k, w * k, h * k];
  applyVb();
}, { passive: false });
let pan = null;
stage.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button")) return;
  pan = { x: e.clientX, y: e.clientY, vb: [...state.vb], moved: false };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!pan) return;
  if (!pan.moved && Math.hypot(e.clientX - pan.x, e.clientY - pan.y) < 4) return;
  pan.moved = true;
  stage.classList.add("drag");
  const r = state.svg.getBoundingClientRect();
  const s = Math.max(pan.vb[2] / r.width, pan.vb[3] / r.height);
  state.vb = [pan.vb[0] - (e.clientX - pan.x) * s, pan.vb[1] - (e.clientY - pan.y) * s, pan.vb[2], pan.vb[3]];
  applyVb();
});
const endPan = (e) => {
  if (pan && !pan.moved && e.type === "pointerup") {
    const g = document.elementFromPoint(e.clientX, e.clientY)?.closest(".space");
    select(g ? g.dataset.code : null);
  }
  pan = null;
  stage.classList.remove("drag");
};
stage.addEventListener("pointerup", endPan);
stage.addEventListener("pointercancel", endPan);

load().catch((err) => { $("#panel").innerHTML = `<p class="sub">${esc(err.message)}</p>`; });
