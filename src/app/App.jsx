import React, { useEffect, useState } from "react";
import { Login } from "../features/auth/Login";
import { loadStore, saveStore } from "../lib/local-store";
import { authEmailFor, supabase } from "../supabase";
import { loadInventory, loadSignedInUser, loadUsers } from "./dataApi";
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
  const refreshUsers = async () => {
    let users;
    try {
      users = await loadUsers();
    } catch {
      return;
    }
    setStore((current) => ({ ...current, users }));
  };
  const refreshInventory = async () => {
    const { assets, imports } = await loadInventory();
    setStore((current) => ({ ...current, assets, imports }));
  };
  useEffect(() => {
    if (!supabase) return setAuthReady(true);
    loadSignedInUser().then(async (user) => {
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
          const user = await loadSignedInUser();
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
