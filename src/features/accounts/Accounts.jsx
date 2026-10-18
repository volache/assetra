import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchFunction } from "../../lib/functions";
import { accountCodeFor } from "../../lib/accounts";
import { roleDescriptions, roleLabels } from "../../lib/labels";
import { HighlightText } from "../../components/HighlightText";
import { FormCombo, UserFilterCombo } from "../../components/Comboboxes";
import { CapsuleSpinner, useFeedback } from "../../components/FeedbackCenter";
import { normalized } from "../inventory/search";

export function Accounts({ store, setStore, onUsersChanged }) {
  const emptyForm = {
    accountCode: "",
    custodianCode: "",
    name: "",
    unitCode: "",
    title: "",
    email: "",
    password: "",
    roles: ["custodian"],
    status: "active",
  };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [appliedTerm, setAppliedTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [openFilterId, setOpenFilterId] = useState(null);
  const [openEditorCombo, setOpenEditorCombo] = useState(null);
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(25);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [exportState, setExportState] = useState(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportUnit, setExportUnit] = useState("");
  const [exportCode, setExportCode] = useState("");
  const { notify, run } = useFeedback();
  const [compactUserFilters, setCompactUserFilters] = useState(false);
  const [compactUserFiltersOpen, setCompactUserFiltersOpen] = useState(false);
  const userFilterSentinelRef = useRef(null);
  const profiles = store.custodianProfiles || {};
  const directory = useMemo(() => {
    const people = new Map();
    store.assets.forEach((asset) => {
      const code = String(asset.custodianCode || "").trim();
      if (!code) return;
      const person = people.get(code) || {
        code,
        names: new Set(),
        units: new Map(),
      };
      if (asset.custodianName) person.names.add(asset.custodianName);
      if (asset.unitCode)
        person.units.set(asset.unitCode, asset.unitName || asset.unitCode);
      people.set(code, person);
    });
    return [...people.values()]
      .map((person) => ({
        ...person,
        names: [...person.names],
        displayName:
          profiles[person.code]?.displayName || [...person.names][0] || "",
        units: [...person.units.entries()],
      }))
      .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  }, [store.assets, profiles]);
  const units = useMemo(
    () =>
      [...new Map(directory.flatMap((person) => person.units)).entries()].sort(
        (a, b) => a[1].localeCompare(b[1], "zh-Hant"),
      ),
    [directory],
  );
  const unitOptions = useMemo(
    () => [
      { value: "", label: "全部單位" },
      ...units.map(([value, label]) => ({
        value,
        label: `${label}（${value}）`,
      })),
    ],
    [units],
  );
  const roleOptions = useMemo(
    () => [
      { value: "", label: "全部權限" },
      ...Object.entries(roleLabels).map(([value, label]) => ({ value, label })),
    ],
    [],
  );
  const statusOptions = useMemo(
    () => [
      { value: "", label: "全部狀態" },
      ...Object.entries({
        active: "啟用",
        inactive: "停用",
      }).map(([value, label]) => ({ value, label })),
    ],
    [],
  );
  const editorUnitOptions = [
    { value: "", label: "未指定單位" },
    ...(
      directory.find((person) => person.code === form.custodianCode)?.units ||
      units
    ).map(([value, label]) => ({ value, label: `${label}（${value}）` })),
  ];
  const editorStatusOptions = statusOptions.slice(1);
  const accountOptions = [
    { value: "", label: "不配對保管人" },
    ...directory.map((person) => ({
      value: person.code,
      label: `${person.code}／${person.displayName || "未提供姓名"}`,
    })),
  ];
  const filteredUsers = useMemo(
    () =>
      store.users
        .filter((user) => {
          const unitCode = user.unitCode || user.unitCodes?.[0] || "";
          const unitName = units.find(([code]) => code === unitCode)?.[1] || "";
          const status = user.status || "active";
          const statusName =
            statusOptions.find((option) => option.value === status)?.label ||
            "";
          const roles = (user.roles || [])
            .map((role) => roleLabels[role])
            .filter(Boolean);
          const text = [
            accountCodeFor(user),
            user.name,
            user.email,
            user.title,
            unitCode,
            unitName,
            status,
            statusName,
            ...roles,
          ]
            .map(normalized)
            .join(" ");
          return (
            (!appliedTerm || text.includes(normalized(appliedTerm))) &&
            (!roleFilter || user.roles.includes(roleFilter)) &&
            (!statusFilter || status === statusFilter) &&
            (!unitFilter ||
              user.unitCode === unitFilter ||
              user.unitCodes?.includes(unitFilter))
          );
        })
        .sort((a, b) =>
          accountCodeFor(a).localeCompare(accountCodeFor(b), "en", {
            numeric: true,
          }),
        ),
    [
      store.users,
      appliedTerm,
      roleFilter,
      statusFilter,
      unitFilter,
      units,
      statusOptions,
    ],
  );
  const totalUserPages = Math.max(
    1,
    Math.ceil(filteredUsers.length / userPageSize),
  );
  const currentUserPage = Math.min(userPage, totalUserPages);
  const pageUsers = filteredUsers.slice(
    (currentUserPage - 1) * userPageSize,
    currentUserPage * userPageSize,
  );
  const unitLabel = (code) =>
    units.find(([value]) => value === code)?.[1] || code || "—";
  const activeUserFilterCount =
    Number(Boolean(appliedTerm)) +
    Number(Boolean(unitFilter)) +
    Number(Boolean(roleFilter)) +
    Number(Boolean(statusFilter));
  function userHighlightTerms(field) {
    const terms = appliedTerm ? [appliedTerm] : [];
    if (field === "unit" && unitFilter) terms.push(unitLabel(unitFilter));
    if (field === "role" && roleFilter)
      terms.push(
        roleOptions.find((option) => option.value === roleFilter)?.label || "",
      );
    if (field === "status" && statusFilter)
      terms.push(
        statusOptions.find((option) => option.value === statusFilter)?.label ||
          "",
      );
    return terms;
  }
  useEffect(() => {
    const updateCompactMode = () => {
      if (window.innerWidth < 960 || !userFilterSentinelRef.current)
        return setCompactUserFilters(false);
      setCompactUserFilters(
        userFilterSentinelRef.current.getBoundingClientRect().bottom <= 0,
      );
    };
    updateCompactMode();
    window.addEventListener("scroll", updateCompactMode, { passive: true });
    window.addEventListener("resize", updateCompactMode);
    return () => {
      window.removeEventListener("scroll", updateCompactMode);
      window.removeEventListener("resize", updateCompactMode);
    };
  }, []);
  useEffect(() => {
    const close = (event) => {
      if (!(event.target instanceof Element)) return;
      if (
        !event.target.closest(".user-management-panel .filter-combobox") &&
        !event.target.closest(".compact-filter-bar .filter-combobox")
      )
        setOpenFilterId(null);
      if (!event.target.closest(".user-editor .filter-combobox"))
        setOpenEditorCombo(null);
      if (!event.target.closest(".compact-filter-bar"))
        setCompactUserFiltersOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    setUserPage(1);
  }, [appliedTerm, roleFilter, statusFilter, unitFilter, userPageSize]);
  function clearFilters() {
    setTerm("");
    setAppliedTerm("");
    setRoleFilter("");
    setStatusFilter("");
    setUnitFilter("");
    setOpenFilterId(null);
    setCompactUserFiltersOpen(false);
  }
  function runUserSearch() {
    setAppliedTerm(term.trim());
  }
  const exportPeople = useMemo(() => {
    const inUse = new Set(
      store.assets
        .filter((asset) => asset.status === "使用中" && asset.custodianCode)
        .map((asset) => asset.custodianCode),
    );
    return directory.filter(
      (person) =>
        inUse.has(person.code) &&
        (!exportUnit || person.units.some(([code]) => code === exportUnit)),
    );
  }, [directory, store.assets, exportUnit]);
  const exportUnitOptions = [
    { value: "", label: "全部單位" },
    ...units.map(([value, label]) => ({ value, label: `${label}（${value}）` })),
  ];
  const exportPersonOptions = [
    { value: "", label: `全部保管人（${exportPeople.length} 位，打包下載）` },
    ...exportPeople.map((person) => ({
      value: person.code,
      label: `${person.code}／${person.displayName || "未提供姓名"}`,
    })),
  ];
  const exportSelected = exportPeople.some((person) => person.code === exportCode)
    ? exportCode
    : "";
  async function runInventoryExport() {
    if (!exportPeople.length || exportState) return;
    setExportState({ label: "準備中" });
    try {
      const sheets = await import("../inventory/exportInventorySheet");
      if (exportSelected) {
        const files = await sheets.exportCustodianInventorySheets(
          store.assets,
          exportSelected,
        );
        notify(
          files.length
            ? `已匯出 ${files.length} 份盤點清冊。`
            : "此保管人沒有「使用中」的財物可匯出。",
          files.length ? "success" : "error",
        );
      } else {
        const codes = exportPeople.map((person) => person.code);
        const result = await sheets.exportInventorySheetsZip(
          store.assets,
          codes,
          (done, total) => setExportState({ label: `${done}／${total}` }),
        );
        if (!result.fileName)
          notify("沒有「使用中」的財物可匯出。", "error");
        else
          notify(
            `已打包 ${result.fileCount} 份盤點清冊：${result.fileName}`,
          );
      }
      setIsExportOpen(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : "匯出盤點清冊失敗。", "error");
    } finally {
      setExportState(null);
    }
  }
  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setMessage("");
    setIsEditorOpen(true);
  }
  function openEdit(user) {
    const custodianCode = user.custodianCodes?.[0] || "";
    setEditingId(user.id);
    setForm({
      accountCode: accountCodeFor(user),
      custodianCode,
      name:
        user.name ||
        profiles[custodianCode]?.displayName ||
        directory.find((person) => person.code === custodianCode)
          ?.displayName ||
        "",
      unitCode: user.unitCode || user.unitCodes?.[0] || "",
      title: user.title || "",
      email: user.email || "",
      password: "",
      roles: user.roles || [],
      status: user.status || "active",
    });
    setMessage("");
    setIsEditorOpen(true);
  }
  function setFromDirectory(code) {
    const person = directory.find((item) => item.code === code);
    setForm((current) => ({
      ...current,
      custodianCode: code,
      name: profiles[code]?.displayName || person?.displayName || current.name,
      unitCode: person?.units[0]?.[0] || current.unitCode,
    }));
  }
  function toggleRole(role) {
    setForm((current) => ({
      ...current,
      roles: current.roles.includes(role)
        ? current.roles.filter((item) => item !== role)
        : [...current.roles, role],
    }));
  }
  async function saveUser(event) {
    event.preventDefault();
    if (
      !form.accountCode ||
      !form.name ||
      !form.roles.length ||
      (!editingId && !form.password)
    )
      return setMessage("請填寫帳號、姓名、權限與初始密碼。");
    setIsSaving(true);
    try {
      await run(async () => {
        await fetchFunction("manage-users", {
          body: {
            action: editingId ? "update" : "create",
            id: editingId,
            accountCode: form.accountCode,
            displayName: form.name,
            title: form.title,
            contactEmail: form.email,
            password: form.password || undefined,
            roles: form.roles,
            status: form.status,
            unitCodes: form.unitCode ? [form.unitCode] : [],
            custodianCodes: form.custodianCode ? [form.custodianCode] : [],
          },
        });
        await onUsersChanged();
      }, {
        loading: editingId ? "正在儲存使用者資料…" : "正在建立使用者…",
      });
      setIsEditorOpen(false);
      setMessage("");
      window.setTimeout(
        () => notify(editingId ? "使用者資料已更新。" : "使用者已建立。"),
        0,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儲存失敗。");
    } finally {
      setIsSaving(false);
    }
  }
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">USER DIRECTORY</p>
          <h1>使用者管理</h1>
          <p>帳號可自由建立；可選擇配對清冊保管人，並校正本系統的顯示名稱。</p>
        </div>
        <div className="page-heading-actions">
          <button
            aria-haspopup="dialog"
            className="button button-secondary"
            onClick={() => setIsExportOpen(true)}
            type="button"
          >
            匯出盤點清冊
          </button>
          <button
            className="button button-primary"
            onClick={openCreate}
            type="button"
          >
            新增使用者
          </button>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="filter-sentinel"
        ref={userFilterSentinelRef}
      />
      {compactUserFilters && (
        <div className="compact-filter-bar compact-filter-bar-fixed">
          <button
            aria-expanded={compactUserFiltersOpen}
            className="compact-filter-trigger"
            onClick={() => setCompactUserFiltersOpen((open) => !open)}
            type="button"
          >
            篩選條件
            {activeUserFilterCount ? <b>{activeUserFilterCount}</b> : null}
          </button>
          <label className="compact-search">
            <span className="sr-only">全局關鍵字搜尋</span>
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runUserSearch();
              }}
              placeholder="輸入後按 Enter 搜尋…"
            />
          </label>
          <button
            className="compact-clear"
            disabled={!activeUserFilterCount}
            onClick={clearFilters}
            type="button"
          >
            清除
          </button>
          {compactUserFiltersOpen && (
            <div className="compact-filter-popover">
              <div className="filter-grid">
                <UserFilterCombo
                  id="compact-user-unit"
                  label="所屬單位"
                  value={unitFilter}
                  options={unitOptions}
                  open={openFilterId === "compact-user-unit"}
                  onChange={setUnitFilter}
                  onOpenChange={setOpenFilterId}
                />
                <UserFilterCombo
                  id="compact-user-role"
                  label="權限"
                  value={roleFilter}
                  options={roleOptions}
                  open={openFilterId === "compact-user-role"}
                  onChange={setRoleFilter}
                  onOpenChange={setOpenFilterId}
                />
                <UserFilterCombo
                  id="compact-user-status"
                  label="狀態"
                  value={statusFilter}
                  options={statusOptions}
                  open={openFilterId === "compact-user-status"}
                  onChange={setStatusFilter}
                  onOpenChange={setOpenFilterId}
                />
              </div>
            </div>
          )}
        </div>
      )}
      <section
        className="search-panel user-management-panel"
        aria-label="使用者篩選"
      >
        <div className="filter-panel-heading">
          <div>
            <h2>篩選條件</h2>
            <p>依所屬單位、權限與狀態篩選，可搜尋帳號、姓名、職稱或 Email。</p>
          </div>
          <button
            className="button button-secondary filter-reset"
            onClick={clearFilters}
            type="button"
          >
            清除篩選
          </button>
        </div>
        <div className="filter-grid">
          <UserFilterCombo
            id="user-unit"
            label="所屬單位"
            value={unitFilter}
            options={unitOptions}
            open={openFilterId === "user-unit"}
            onChange={setUnitFilter}
            onOpenChange={setOpenFilterId}
          />
          <UserFilterCombo
            id="user-role"
            label="權限"
            value={roleFilter}
            options={roleOptions}
            open={openFilterId === "user-role"}
            onChange={setRoleFilter}
            onOpenChange={setOpenFilterId}
          />
          <UserFilterCombo
            id="user-status"
            label="狀態"
            value={statusFilter}
            options={statusOptions}
            open={openFilterId === "user-status"}
            onChange={setStatusFilter}
            onOpenChange={setOpenFilterId}
          />
        </div>
        <div className="advanced-search user-advanced-search">
          <label className="search-field">
            全局關鍵字搜尋
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runUserSearch();
              }}
              placeholder="輸入帳號、姓名、職稱或 Email"
            />
          </label>
          <div className="advanced-search-actions">
            <button
              className={`button button-primary search-submit ${term !== appliedTerm ? "pending" : ""}`}
              onClick={runUserSearch}
              type="button"
            >
              搜尋
            </button>
          </div>
        </div>
      </section>
      <div className="result-summary user-result-summary">
        <p className="result-count">
          使用者：<strong>{filteredUsers.length.toLocaleString()}</strong> 位
        </p>
        <p className="directory-note">
          清冊已辨識 {directory.length.toLocaleString()} 位保管人
        </p>
        <label className="page-size">
          每頁顯示
          <select
            aria-label="每頁顯示使用者數"
            value={userPageSize}
            onChange={(event) => setUserPageSize(Number(event.target.value))}
          >
            <option value="25">25 筆</option>
            <option value="50">50 筆</option>
            <option value="100">100 筆</option>
          </select>
        </label>
        <p>
          第 {currentUserPage}／{totalUserPages} 頁
        </p>
      </div>
      {filteredUsers.length ? (
        <>
          <div className="asset-table-wrap user-table-wrap">
            <table className="user-table">
              <thead>
                <tr>
                  <th>狀態</th>
                  <th>帳號</th>
                  <th>姓名</th>
                  <th>所屬單位</th>
                  <th>職稱</th>
                  <th>權限</th>
                  <th>Email</th>
                  <th>管理</th>
                </tr>
              </thead>
              <tbody>
                {pageUsers.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <span
                        className={`user-status ${user.status || "active"}`}
                      >
                        <HighlightText
                          value={
                            {
                              active: "啟用",
                              pending: "待啟用",
                              inactive: "停用",
                            }[user.status || "active"]
                          }
                          terms={userHighlightTerms("status")}
                        />
                      </span>
                    </td>
                    <td className="mono">
                      <HighlightText
                        value={accountCodeFor(user)}
                        terms={userHighlightTerms("global")}
                      />
                    </td>
                    <td>
                      <HighlightText
                        value={user.name || "—"}
                        terms={userHighlightTerms("global")}
                      />
                    </td>
                    <td>
                      <HighlightText
                        value={unitLabel(user.unitCode || user.unitCodes?.[0])}
                        terms={userHighlightTerms("unit")}
                      />
                    </td>
                    <td>
                      <HighlightText
                        value={user.title || "—"}
                        terms={userHighlightTerms("global")}
                      />
                    </td>
                    <td>
                      <div className="role-tags">
                        {user.roles.map((role) => (
                          <span className="role-tag" key={role}>
                            <HighlightText
                              value={roleLabels[role]}
                              terms={userHighlightTerms("role")}
                            />
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <HighlightText
                        value={user.email || "—"}
                        terms={userHighlightTerms("global")}
                      />
                    </td>
                    <td>
                      <button
                        aria-haspopup="dialog"
                        className="row-action"
                        onClick={() => openEdit(user)}
                        type="button"
                      >
                        編輯
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalUserPages > 1 && (
            <nav className="pagination" aria-label="使用者分頁">
              <button
                className="button button-secondary"
                disabled={currentUserPage === 1}
                onClick={() => setUserPage(currentUserPage - 1)}
                type="button"
              >
                上一頁
              </button>
              <span>
                第 {currentUserPage}／{totalUserPages} 頁
              </span>
              <button
                className="button button-secondary"
                disabled={currentUserPage === totalUserPages}
                onClick={() => setUserPage(currentUserPage + 1)}
                type="button"
              >
                下一頁
              </button>
            </nav>
          )}
        </>
      ) : (
        <div className="empty-state">
          <h2>找不到符合的使用者</h2>
          <p>請調整篩選條件或搜尋文字。</p>
        </div>
      )}
      {isExportOpen && (
        <dialog
          open
          className="detail-dialog user-editor export-sheets-dialog"
          onClick={(event) => {
            if (event.target === event.currentTarget && !exportState)
              setIsExportOpen(false);
          }}
        >
          <div>
            <header>
              <div>
                <p className="eyebrow">INVENTORY SHEETS</p>
                <h2>匯出盤點清冊</h2>
              </div>
              <button
                className="close-button"
                disabled={Boolean(exportState)}
                onClick={() => setIsExportOpen(false)}
                aria-label="關閉"
              >
                ×
              </button>
            </header>
            <div className="account-form user-account-form">
              <p className="export-note">
                依清冊上的保管人產生財物盤點清冊（僅「使用中」財物），每位保管人一份，財產與物品併為不同的財產大類。
                未建立使用者帳號的保管人也會一併匯出。
              </p>
              <div className="user-form-grid user-editor-grid">
                <FormCombo
                  id="export-unit"
                  label="保管單位"
                  value={exportUnit}
                  options={exportUnitOptions}
                  open={openEditorCombo === "export-unit"}
                  onChange={setExportUnit}
                  onOpenChange={setOpenEditorCombo}
                />
                <FormCombo
                  id="export-person"
                  label="保管人"
                  value={exportSelected}
                  options={exportPersonOptions}
                  open={openEditorCombo === "export-person"}
                  onChange={setExportCode}
                  onOpenChange={setOpenEditorCombo}
                />
              </div>
              <footer className="user-editor-actions">
                <button
                  className="button button-secondary"
                  disabled={Boolean(exportState)}
                  onClick={() => setIsExportOpen(false)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button button-primary"
                  disabled={!exportPeople.length || Boolean(exportState)}
                  onClick={runInventoryExport}
                  type="button"
                >
                  {exportState && <CapsuleSpinner compact />}
                  {exportState
                    ? `產生中 ${exportState.label}`
                    : exportSelected
                      ? "匯出盤點清冊（PDF）"
                      : `打包匯出（${exportPeople.length} 位保管人）`}
                </button>
              </footer>
            </div>
          </div>
        </dialog>
      )}
      {isEditorOpen && (
        <dialog
          open
          className="detail-dialog user-editor"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsEditorOpen(false);
          }}
        >
          <div>
            <header>
              <div>
                <p className="eyebrow">
                  {editingId ? "EDIT USER" : "CREATE USER"}
                </p>
                <h2>{editingId ? "編輯使用者" : "新增使用者"}</h2>
              </div>
              <button
                className="close-button"
                onClick={() => setIsEditorOpen(false)}
                aria-label="關閉"
              >
                ×
              </button>
            </header>
            <form
              className="account-form user-account-form"
              onSubmit={saveUser}
            >
              <div className="user-form-grid user-editor-grid">
                <label>
                  帳號
                  <input
                    value={form.accountCode}
                    readOnly={Boolean(editingId)}
                    onChange={(event) =>
                      setForm({ ...form, accountCode: event.target.value })
                    }
                  />
                </label>
                <label>
                  {editingId ? "修改密碼" : "初始密碼"}
                  <input
                    type="password"
                    value={form.password}
                    onChange={(event) =>
                      setForm({ ...form, password: event.target.value })
                    }
                  />
                </label>
                <label>
                  姓名
                  <input
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </label>
                <FormCombo
                  id="editor-custodian"
                  label="配對保管人（選填）"
                  value={form.custodianCode}
                  options={accountOptions}
                  open={openEditorCombo === "editor-custodian"}
                  onChange={setFromDirectory}
                  onOpenChange={setOpenEditorCombo}
                />
                <FormCombo
                  id="editor-unit"
                  label="所屬單位"
                  value={form.unitCode}
                  options={editorUnitOptions}
                  open={openEditorCombo === "editor-unit"}
                  onChange={(value) => setForm({ ...form, unitCode: value })}
                  onOpenChange={setOpenEditorCombo}
                />
                <label>
                  職稱
                  <input
                    value={form.title}
                    onChange={(event) =>
                      setForm({ ...form, title: event.target.value })
                    }
                  />
                </label>
                <label>
                  Email（選填）
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) =>
                      setForm({ ...form, email: event.target.value })
                    }
                  />
                </label>
                <FormCombo
                  id="editor-status"
                  label="狀態"
                  value={form.status}
                  options={editorStatusOptions}
                  open={openEditorCombo === "editor-status"}
                  onChange={(value) => setForm({ ...form, status: value })}
                  onOpenChange={setOpenEditorCombo}
                />
              </div>
              <fieldset>
                <legend>權限</legend>
                <div className="role-checks">
                  {Object.entries(roleLabels).map(([role, label]) => (
                    <label key={role}>
                      <input
                        type="checkbox"
                        checked={form.roles.includes(role)}
                        onChange={() => toggleRole(role)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="role-guidance" aria-label="權限說明">
                {Object.entries(roleDescriptions).map(([role, description]) => (
                  <p key={role}>
                    <strong>{roleLabels[role]}</strong>
                    <span>{description}</span>
                  </p>
                ))}
              </div>
              {message && (
                <p className="form-error" role="alert">
                  {message}
                </p>
              )}
              <footer className="user-editor-actions">
                <button
                  className="button button-secondary"
                  onClick={() => setIsEditorOpen(false)}
                  type="button"
                >
                  取消
                </button>
                <button className="button button-primary" disabled={isSaving} type="submit">
                  {isSaving && <CapsuleSpinner compact />}
                  {isSaving ? "儲存中…" : editingId ? "儲存變更" : "新增使用者"}
                </button>
              </footer>
            </form>
          </div>
        </dialog>
      )}
    </section>
  );
}
