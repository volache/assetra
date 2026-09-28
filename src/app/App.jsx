import React, { useEffect, useState } from "react";
import { Login } from "../features/auth/Login";
import { fromDatabaseAsset, fromDatabaseImport } from "../lib/inventory";
import { loadStore, saveStore } from "../lib/local-store";
import { authEmailFor, supabase } from "../supabase";
import { Portal } from "./Portal";

export function App() {
  const [store, setStore] = useState(loadStore);
  const [session, setSession] = useState(null);
  const [page, setPage] = useState("home");
  const [taskFocus, setTaskFocus] = useState(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isEnteringPortal, setIsEnteringPortal] = useState(false);
  const [isLeavingPortal, setIsLeavingPortal] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => saveStore(store), [store]);
  const loadProfile = async () => {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return null;
    const [
      { data: profile },
      { data: roles },
      { data: units },
      { data: custodians },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, account_code, display_name, title, contact_email, status")
        .eq("id", authUser.id)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", authUser.id),
      supabase
        .from("user_units")
        .select("unit_code")
        .eq("user_id", authUser.id),
      supabase
        .from("user_custodians")
        .select("custodian_code")
        .eq("user_id", authUser.id),
    ]);
    if (!profile || profile.status !== "active") return null;
    return {
      id: profile.id,
      accountCode: profile.account_code,
      name: profile.display_name,
      title: profile.title,
      email: profile.contact_email,
      status: profile.status,
      roles: (roles || []).map((x) => x.role),
      unitCodes: (units || []).map((x) => x.unit_code),
      custodianCodes: (custodians || []).map((x) => x.custodian_code),
    };
  };
  const refreshUsers = async () => {
    const {
      data: { session: authSession },
    } = await supabase.auth.getSession();
    if (!authSession) return;
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-users`,
      {
        headers: {
          Authorization: `Bearer ${authSession.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      },
    );
    if (!response.ok) return;
    const { users = [] } = await response.json();
    setStore((current) => ({
      ...current,
      users: users.map((u) => ({
        id: u.id,
        accountCode: u.account_code,
        name: u.display_name,
        title: u.title,
        email: u.contact_email,
        status: u.status,
        roles: (u.user_roles || []).map((x) => x.role),
        unitCodes: (u.user_units || []).map((x) => x.unit_code),
        custodianCodes: (u.user_custodians || []).map((x) => x.custodian_code),
      })),
    }));
  };
  const refreshInventory = async () => {
    const loadAllRecords = async () => {
      const pageSize = 1000;
      const records = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("asset_records")
          .select("*")
          .eq("is_current", true)
          .order("category_type_code")
          .order("asset_no")
          .order("serial_no")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        records.push(...(data || []));
        if (!data || data.length < pageSize) return records;
      }
    };
    const [records, { data: imports, error: importError }] = await Promise.all([
      loadAllRecords(),
      supabase
        .from("imports")
        .select(
          "id, file_name, source_type, record_count, summary, imported_at, committed_at",
        )
        .eq("status", "committed")
        .order("committed_at", { ascending: false }),
    ]);
    setStore((current) => ({
      ...current,
      assets: records.map(fromDatabaseAsset),
      imports: importError ? [] : (imports || []).map(fromDatabaseImport),
    }));
  };
  useEffect(() => {
    if (!supabase) return setAuthReady(true);
    loadProfile().then(async (user) => {
      if (user) {
        setSession(user);
        refreshUsers();
        try {
          await refreshInventory();
        } catch {
          /* 留在空清冊狀態，避免中斷登入。 */
        }
      }
      setAuthReady(true);
    });
  }, []);
  function startSession(user) {
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) return setSession(user);
    setIsLoadingSession(true);
    window.setTimeout(() => {
      setSession(user);
      setIsLoadingSession(false);
      setIsEnteringPortal(true);
      window.setTimeout(() => setIsEnteringPortal(false), 560);
    }, 1180);
  }
  async function endSession() {
    await supabase.auth.signOut();
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      setPage("home");
      return setSession(null);
    }
    setIsLeavingPortal(true);
    window.setTimeout(() => {
      setPage("home");
      setSession(null);
      setIsLeavingPortal(false);
    }, 420);
  }
  function openTaskInAssetQuery(task) {
    if (!task?.asset?.identityId) return;
    setTaskFocus({
      identityId: task.asset.identityId,
      collaborationId: task.id,
      requestId: Date.now(),
    });
    setPage("query");
  }
  if (!authReady)
    return (
      <main className="login-shell">
        <section className="login-panel">
          <p className="muted">正在連線至 Assetra…</p>
        </section>
      </main>
    );
  if (!session)
    return (
      <Login
        isLoading={isLoadingSession}
        onLogin={async (accountCode, password) => {
          const { error } = await supabase.auth.signInWithPassword({
            email: authEmailFor(accountCode),
            password,
          });
          if (error) throw error;
          const user = await loadProfile();
          if (!user) {
            await supabase.auth.signOut();
            throw new Error("帳號尚未啟用或未完成系統授權。");
          }
          startSession(user);
          refreshUsers();
          await refreshInventory();
        }}
      />
    );
  return (
    <Portal
      entering={isEnteringPortal}
      leaving={isLeavingPortal}
      store={store}
      setStore={setStore}
      user={session}
      page={page}
      setPage={setPage}
      taskFocus={taskFocus}
      onTaskFocusHandled={() => setTaskFocus(null)}
      onOpenTask={openTaskInAssetQuery}
      onLogout={endSession}
      refreshUsers={refreshUsers}
      refreshInventory={refreshInventory}
    />
  );
}
