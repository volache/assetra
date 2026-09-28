import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { roleLabels } from "../../lib/labels";
import { UnitMasterDialog } from "./UnitMasterDialog";

export function Organization({ store, setStore }) {
  const [collapsed, setCollapsed] = useState({});
  const [isMasterOpen, setIsMasterOpen] = useState(false);
  const [masterError, setMasterError] = useState("");
  const [isPanning, setIsPanning] = useState(false);
  const [chartZoom, setChartZoom] = useState(1);
  const [edgeLayer, setEdgeLayer] = useState({
    height: 0,
    paths: [],
    width: 0,
  });
  const chartRef = useRef(null);
  const chartSurfaceRef = useRef(null);
  const cardRefs = useRef(new Map());
  const panRef = useRef(null);
  const suppressPanClickRef = useRef(false);
  const profiles = store.unitProfiles || {};
  const unitSort = (left, right) =>
    left.code.localeCompare(right.code, "en", {
      numeric: true,
      sensitivity: "base",
    });
  const tree = useMemo(() => {
    const units = [
      ...new Map(
        store.assets
          .filter((asset) => asset.unitCode)
          .map((asset) => [asset.unitCode, asset.unitName || asset.unitCode]),
      ).entries(),
    ]
      .map(([code, rawName]) => {
        const profile = profiles[code] || {};
        return {
          code,
          rawName,
          name: profile.name || rawName,
          hasConfiguredParent: Object.prototype.hasOwnProperty.call(
            profile,
            "parentCode",
          ),
          parentCode: profile.parentCode || "",
        };
      })
      .sort(unitSort);
    const aviationUnit = units.find((unit) => unit.rawName.includes("航務組"));
    units.forEach((unit) => {
      unit.defaultParentCode =
        !unit.hasConfiguredParent &&
        unit.rawName.includes("消防班") &&
        aviationUnit
          ? aviationUnit.code
          : "";
    });
    const nodes = [
      {
        id: "root",
        name: "花蓮航空站",
        code: "HUALIEN AIRPORT",
        parentId: null,
        virtual: true,
        children: [],
      },
      ...units.map((unit) => ({
        id: `unit:${unit.code}`,
        ...unit,
        parentId: null,
        virtual: false,
        children: [],
      })),
    ];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    nodes.forEach((node) => {
      if (!node.id.startsWith("unit:")) return;
      const parentCode = node.parentCode || node.defaultParentCode;
      const requestedParent = parentCode ? `unit:${parentCode}` : "root";
      node.parentId =
        requestedParent !== node.id && byId.has(requestedParent)
          ? requestedParent
          : "root";
    });
    nodes.forEach((node) => {
      if (node.parentId) byId.get(node.parentId)?.children.push(node);
    });
    nodes.forEach((node) => node.children.sort(unitSort));
    const members = new Map(nodes.map((node) => [node.id, []]));
    const unassigned = [];
    store.users.forEach((user) => {
      const code = user.unitCode || user.unitCodes?.[0];
      const bucket = code ? members.get(`unit:${code}`) : null;
      if (bucket) bucket.push(user);
      else unassigned.push(user);
    });
    const assetCounts = new Map();
    store.assets.forEach(
      (asset) =>
        asset.unitCode &&
        assetCounts.set(
          asset.unitCode,
          (assetCounts.get(asset.unitCode) || 0) + 1,
        ),
    );
    return { root: byId.get("root"), members, unassigned, assetCounts, units };
  }, [store.assets, store.users, profiles]);
  const chartLayout = useMemo(() => {
    if (!tree.root) return null;
    const nodes = [];
    const edges = [];
    let maxDepth = 0;
    function measure(node, depth) {
      const children =
        node.children.length && !collapsed[node.id] ? node.children : [];
      const metrics = children.map((child) => measure(child, depth + 1));
      const span = metrics.length
        ? metrics.reduce((total, child) => total + child.span, 0)
        : 1;
      maxDepth = Math.max(maxDepth, depth);
      return { node, depth, children: metrics, span, start: 1 };
    }
    const root = measure(tree.root, 0);
    let nextColumn = 1;
    function assign(metric) {
      metric.start = nextColumn;
      if (metric.children.length) {
        metric.children.forEach((child) => {
          edges.push({ from: metric.node.id, to: child.node.id });
          assign(child);
        });
      } else nextColumn += 1;
      nodes.push(metric);
    }
    assign(root);
    const columnWidth = 250 * chartZoom;
    const gap = 16 * chartZoom;
    return {
      edges,
      nodes,
      width: root.span * columnWidth + Math.max(root.span - 1, 0) * gap,
      css: {
        "--org-level-columns": `repeat(${root.span}, ${columnWidth}px)`,
        "--org-column-gap": `${gap}px`,
        "--org-level-count": maxDepth + 1,
        "--org-row-gap": `${56 * chartZoom}px`,
        "--org-level-width": `${root.span * columnWidth + Math.max(root.span - 1, 0) * gap}px`,
        "--org-zoom": chartZoom,
      },
    };
  }, [chartZoom, collapsed, tree.root]);
  useEffect(() => {
    const canvas = chartRef.current;
    if (!canvas) return undefined;
    const frame = requestAnimationFrame(() => {
      canvas.scrollLeft = Math.max(
        0,
        (canvas.scrollWidth - canvas.clientWidth) / 2,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [chartLayout?.width, chartZoom]);
  useLayoutEffect(() => {
    const surface = chartSurfaceRef.current;
    if (!surface || !chartLayout) return undefined;
    const redraw = () => {
      const surfaceRect = surface.getBoundingClientRect();
      const paths = chartLayout.edges.flatMap(({ from, to }) => {
        const parent = cardRefs.current.get(from);
        const child = cardRefs.current.get(to);
        if (!parent || !child) return [];
        const parentRect = parent.getBoundingClientRect();
        const childRect = child.getBoundingClientRect();
        const x1 = parentRect.left - surfaceRect.left + parentRect.width / 2;
        const y1 = parentRect.bottom - surfaceRect.top;
        const x2 = childRect.left - surfaceRect.left + childRect.width / 2;
        const y2 = childRect.top - surfaceRect.top;
        const midY = y1 + (y2 - y1) / 2;
        return [`M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`];
      });
      setEdgeLayer({
        height: surface.scrollHeight,
        paths,
        width: surface.scrollWidth,
      });
    };
    const frame = requestAnimationFrame(redraw);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(redraw);
    observer?.observe(surface);
    cardRefs.current.forEach((card) => observer?.observe(card));
    window.addEventListener("resize", redraw);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", redraw);
    };
  }, [chartLayout]);
  function saveUnitProfile(code, draft) {
    const visited = new Set([code]);
    let parentCode = draft.parentCode;
    while (parentCode) {
      if (visited.has(parentCode)) {
        setMasterError("無法將單位編入自己的下層單位。");
        return;
      }
      visited.add(parentCode);
      const parent = tree.units.find((unit) => unit.code === parentCode);
      parentCode = parent?.parentCode || parent?.defaultParentCode || "";
    }
    setStore((current) => ({
      ...current,
      unitProfiles: {
        ...(current.unitProfiles || {}),
        [code]: { name: draft.name.trim(), parentCode: draft.parentCode },
      },
    }));
    setMasterError("");
    setIsMasterOpen(false);
  }
  function toggle(id) {
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  }
  function beginPan(event) {
    if (event.button !== 0 || !chartRef.current) return;
    panRef.current = {
      moved: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: chartRef.current.scrollLeft,
    };
  }
  function pan(event) {
    const state = panRef.current;
    if (!state || state.pointerId !== event.pointerId || !chartRef.current)
      return;
    const delta = event.clientX - state.startX;
    if (!state.moved && Math.abs(delta) > 4) {
      state.moved = true;
      suppressPanClickRef.current = true;
      chartRef.current.setPointerCapture?.(event.pointerId);
      setIsPanning(true);
    }
    if (state.moved) {
      event.preventDefault();
      chartRef.current.scrollLeft = state.startScrollLeft - delta;
    }
  }
  function endPan(event) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setIsPanning(false);
  }
  function suppressPanClick(event) {
    if (!suppressPanClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressPanClickRef.current = false;
  }
  function zoomChart(event) {
    event.preventDefault();
    setChartZoom((current) =>
      Math.min(
        1.5,
        Math.max(
          0.65,
          Math.round((current + (event.deltaY < 0 ? 0.1 : -0.1)) * 100) / 100,
        ),
      ),
    );
  }
  function renderCard(node, ref) {
    const members = tree.members.get(node.id) || [];
    const isCollapsed = collapsed[node.id];
    const hasChildren = node.children.length > 0;
    return (
      <article
        className={`org-unit-card ${node.virtual ? "org-unit-root" : ""}`}
        ref={ref}
      >
        <button
          aria-expanded={!isCollapsed}
          className="org-unit-toggle"
          disabled={!hasChildren}
          onClick={() => toggle(node.id)}
          type="button"
        >
          <span className="org-unit-mark" aria-hidden="true" />
          <span>
            <small>{node.code}</small>
            <strong>{node.name}</strong>
            <em>
              {node.virtual
                ? "組織節點"
                : `${tree.assetCounts.get(node.code) || 0} 筆財物`}
            </em>
          </span>
          {hasChildren && <b aria-hidden="true">{isCollapsed ? "+" : "−"}</b>}
        </button>
        {members.length ? (
          <div className="org-members">
            {members.map((member) => (
              <div className="org-member" key={member.id}>
                <span aria-hidden="true">
                  {(member.name || "?").slice(0, 1)}
                </span>
                <div>
                  <strong>{member.name || "未命名使用者"}</strong>
                  <small>
                    {member.title || "未設定職稱"} ·{" "}
                    {member.roles.map((role) => roleLabels[role]).join("、")}
                  </small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="org-empty">尚無已編制使用者</p>
        )}
      </article>
    );
  }
  function renderMobileBranch(node, depth = 0) {
    const expanded = node.children.length && !collapsed[node.id];
    return (
      <li
        className="org-mobile-node"
        key={node.id}
        style={{ "--org-depth": depth }}
      >
        {renderCard(node)}
        {expanded ? (
          <ul>
            {node.children.map((child) => renderMobileBranch(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  }
  return (
    <section className="page organization-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ORGANIZATION DIRECTORY</p>
          <h1>組織管理</h1>
          <p>結合花蓮航空站的單位階層與已建立使用者的成員編制。</p>
        </div>
        <button
          className="button button-primary"
          disabled={!tree.units.length}
          onClick={() => {
            setMasterError("");
            setIsMasterOpen(true);
          }}
          type="button"
        >
          編輯單位
        </button>
      </div>
      <section className="organization-intro">
        <p>
          <strong>編制規則</strong>{" "}
          同層單位一律依單位代碼排列；可在單位主檔設定顯示名稱與上層單位。消防班預設隸屬清冊中的航務組，其餘清冊單位預設為航空站直屬。
        </p>
      </section>
      {tree.root && (
        <section
          aria-label="花蓮航空站組織與成員編制"
          className="organization-chart"
        >
          <div className="org-zoom-status">
            <span>滾輪縮放</span>
            <strong>{Math.round(chartZoom * 100)}%</strong>
            <button
              aria-label="還原組織圖比例"
              disabled={chartZoom === 1}
              onClick={() => setChartZoom(1)}
              type="button"
            >
              還原
            </button>
          </div>
          <div
            className={`org-scroll-canvas ${isPanning ? "is-panning" : ""}`}
            onPointerCancel={endPan}
            onPointerDown={beginPan}
            onPointerMove={pan}
            onPointerUp={endPan}
            onWheel={zoomChart}
            ref={chartRef}
          >
            <div
              className="org-level-canvas"
              ref={chartSurfaceRef}
              style={chartLayout?.css}
            >
              <svg
                aria-hidden="true"
                className="org-edge-layer"
                height={edgeLayer.height}
                viewBox={`0 0 ${edgeLayer.width} ${edgeLayer.height}`}
                width={edgeLayer.width}
              >
                {edgeLayer.paths.map((path, index) => (
                  <path d={path} key={`${path}-${index}`} />
                ))}
              </svg>
              {chartLayout?.nodes.map((item) => (
                <div
                  className="org-level-node"
                  key={item.node.id}
                  style={{
                    gridColumn: `${item.start} / span ${item.span}`,
                    gridRow: item.depth + 1,
                  }}
                >
                  {renderCard(item.node, (element) => {
                    if (element) cardRefs.current.set(item.node.id, element);
                    else cardRefs.current.delete(item.node.id);
                  })}
                </div>
              ))}
            </div>
          </div>
          <ul className="org-mobile-tree">{renderMobileBranch(tree.root)}</ul>
        </section>
      )}
      {tree.unassigned.length > 0 && (
        <section className="org-unassigned">
          <header>
            <h2>未編制使用者</h2>
            <p>尚未設定所屬單位的使用者不會放入組織圖。</p>
          </header>
          <div className="org-members">
            {tree.unassigned.map((member) => (
              <div className="org-member" key={member.id}>
                <span aria-hidden="true">
                  {(member.name || "?").slice(0, 1)}
                </span>
                <div>
                  <strong>{member.name || "未命名使用者"}</strong>
                  <small>
                    {member.title || "未設定職稱"} ·{" "}
                    {member.roles.map((role) => roleLabels[role]).join("、")}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {isMasterOpen && (
        <UnitMasterDialog
          error={masterError}
          onClose={() => setIsMasterOpen(false)}
          onSave={saveUnitProfile}
          profiles={profiles}
          units={tree.units}
        />
      )}
    </section>
  );
}
