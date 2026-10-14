const storageKey = "assetra.keywordSearchHistory";
const maxEntries = 10;

// localStorage can be missing or throw (private windows, blocked site data),
// so every access is guarded and the feature just stays empty.
export function loadSearchHistory() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return Array.isArray(stored)
      ? stored.filter((entry) => typeof entry === "string" && entry).slice(0, maxEntries)
      : [];
  } catch {
    return [];
  }
}

export function rememberSearch(term) {
  const entry = String(term || "").trim();
  if (!entry) return;
  try {
    const next = [entry, ...loadSearchHistory().filter((item) => item !== entry)];
    window.localStorage.setItem(storageKey, JSON.stringify(next.slice(0, maxEntries)));
  } catch {
    // History is a convenience; ignore storage failures.
  }
}

export function clearSearchHistory() {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
