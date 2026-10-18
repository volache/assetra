// The floor plans are loaded once and shared by the 室內平面圖 page and the little location maps in 財物查詢.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../supabase";
import { loadIndoor } from "./indoorData";

let snapshot = { status: "idle", error: "", data: null };
let inflight = null;
const listeners = new Set();
const publish = (next) => { snapshot = next; listeners.forEach((listener) => listener(snapshot)); };

export function loadIndoorStore(client = supabase, force = false) {
  if (!client) { publish({ status: "error", error: "尚未設定 Supabase 連線。", data: null }); return Promise.resolve(); }
  if (inflight && !force) return inflight;
  publish({ ...snapshot, status: snapshot.data ? "ready" : "loading" });
  inflight = loadIndoor(client)
    .then((data) => publish({ status: "ready", error: "", data }))
    .catch((cause) => publish({ status: snapshot.data ? "ready" : "error", error: cause.message, data: snapshot.data }))
    .finally(() => { inflight = null; });
  return inflight;
}

/** `enabled: false` waits (a collapsed row does not need the plans yet). */
export function useIndoorStore({ client = supabase, enabled = true } = {}) {
  const [snap, setSnap] = useState(snapshot);
  useEffect(() => {
    listeners.add(setSnap);
    setSnap(snapshot);
    if (enabled && snapshot.status === "idle") loadIndoorStore(client);
    return () => { listeners.delete(setSnap); };
  }, [client, enabled]);
  const reload = useCallback(() => loadIndoorStore(client, true), [client]);
  return { ...snap, loading: snap.status === "idle" || snap.status === "loading", reload };
}
