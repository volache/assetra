import React, { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { roleLabels } from "../lib/labels";
import { applyOfficialPersonnelNames } from "../lib/personnel";

const Accounts = lazy(() =>
  import("../features/accounts/Accounts").then(({ Accounts }) => ({
    default: Accounts,
  })),
);
const GeographicAssets = lazy(() =>
  import("../features/geography/GeographicAssets").then(
    ({ GeographicAssets }) => ({ default: GeographicAssets }),
  ),
);
const IndoorPlans = lazy(() =>
  import("../features/indoor/IndoorPlans").then(({ IndoorPlans }) => ({
    default: IndoorPlans,
  })),
);
const Home = lazy(() =>
  import("../features/home/Home").then(({ Home }) => ({ default: Home })),
);
const BatchHistory = lazy(() =>
  import("../features/imports/BatchHistory").then(({ BatchHistory }) => ({
    default: BatchHistory,
  })),
);
const ImportInventory = lazy(() =>
  import("../features/imports/ImportInventory").then(({ ImportInventory }) => ({
    default: ImportInventory,
  })),
);
const AssetQuery = lazy(() =>
  import("../features/inventory/AssetQuery").then(({ AssetQuery }) => ({
    default: AssetQuery,
  })),
);
const CollaborationTasks = lazy(() =>
  import("../features/collaboration/CollaborationTasks").then(
    ({ CollaborationTasks }) => ({ default: CollaborationTasks }),
  ),
);
const Organization = lazy(() =>
  import("../features/organization/Organization").then(({ Organization }) => ({
    default: Organization,
  })),
);
const PersonalSettings = lazy(() => import("../features/settings/PersonalSettings").then(({ PersonalSettings }) => ({ default: PersonalSettings })));

export function Portal({
  entering,
  leaving,
  store,
  setStore,
  user,
  page,
  setPage,
  taskFocus,
  onTaskFocusHandled,
  onOpenTask,
  onLogout,
  refreshUsers,
  refreshInventory,
}) {
  const canAdmin = user.roles.includes("admin");
  const canChief = user.roles.includes("chief");
  const visible = useMemo(
    () => applyOfficialPersonnelNames(store.assets, [...store.users, user]),
    [store.assets, store.users, user],
  );
  const previousPage = useRef(page);
  const isPageSwitch = previousPage.current !== page;
  useEffect(() => {
    previousPage.current = page;
  }, [page]);
  const navigation = [
    { id: "home", label: "總覽" },
    { id: "query", label: "財物查詢" },
    { id: "tasks", label: "協作追蹤" },
    { id: "indoor", label: "室內平面圖" },
    ...(canAdmin
      ? [
          { id: "import", label: "匯入清冊" },
          { id: "batches", label: "匯入批次" },
          { id: "geo", label: "地理圖資" },
          { id: "organization", label: "組織管理" },
          { id: "accounts", label: "使用者管理" },
        ]
      : []),
    { id: "settings", label: "個人設定" },
  ];
  return (
    <div
      className={`app-shell ${entering ? "is-entering" : ""} ${leaving ? "is-leaving" : ""}`}
    >
      <aside className="side-nav">
        <div className="brand">
          <span className="brand-dot" />
          Assetra
        </div>
        <nav aria-label="主要功能">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="side-user">
          <span>{user.name}</span>
          <small>{user.roles.map((role) => roleLabels[role]).join("、")}</small>
          <button className="text-button" onClick={onLogout}>
            登出
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="mobile-header">
          <div className="brand">
            <span className="brand-dot" />
            Assetra
          </div>
          <button className="text-button" onClick={onLogout}>
            登出
          </button>
        </header>
        <div
          className={`page-transition ${isPageSwitch ? "is-switching" : ""}`}
          key={page}
        >
          <Suspense
            fallback={
              <section className="page">
                <p className="muted">正在載入功能頁面…</p>
              </section>
            }
          >
            {page === "home" && (
              <Home
                visible={visible}
                user={user}
                imports={store.imports}
                setPage={setPage}
                canAdmin={canAdmin}
                canChief={canChief}
              />
            )}
            {page === "query" && (
              <AssetQuery
                assets={visible}
                user={user}
                focusTask={taskFocus}
                imports={store.imports}
                onTaskFocusHandled={onTaskFocusHandled}
              />
            )}
            {page === "tasks" && <CollaborationTasks onOpenTask={onOpenTask} />}
            {page === "import" && canAdmin && (
              <ImportInventory store={store} onImported={refreshInventory} />
            )}
            {page === "batches" && canAdmin && (
              <BatchHistory
                imports={store.imports}
                onDeleted={refreshInventory}
              />
            )}
            {page === "geo" && canAdmin && <GeographicAssets />}
            {page === "indoor" && <IndoorPlans canAdmin={canAdmin} />}
            {page === "accounts" && canAdmin && (
              <Accounts
                store={{ ...store, assets: visible }}
                setStore={setStore}
                onUsersChanged={refreshUsers}
              />
            )}
            {page === "organization" && canAdmin && (
              <Organization store={store} setStore={setStore} />
            )}
            {page === "settings" && <PersonalSettings />}
          </Suspense>
        </div>
      </main>
    </div>
  );
}
