function clean(value) {
  return String(value || "").trim();
}

/**
 * Returns unambiguous, active account names keyed by the matched custodian
 * code.  A duplicated assignment intentionally falls back to the imported
 * name instead of picking an arbitrary account.
 */
export function officialNamesByCode(users = []) {
  const namesByCode = new Map();
  users.forEach((user) => {
    if (user?.status && user.status !== "active") return;
    const name = clean(user?.name);
    if (!name) return;
    (user.custodianCodes || []).forEach((value) => {
      const code = clean(value);
      if (!code) return;
      const names = namesByCode.get(code) || new Set();
      names.add(name);
      namesByCode.set(code, names);
    });
  });
  return Object.fromEntries(
    [...namesByCode].flatMap(([code, names]) =>
      names.size === 1 ? [[code, [...names][0]]] : [],
    ),
  );
}

/**
 * Adds official display names to imported inventory without modifying the
 * imported source values.  A same-name user without a user code inherits the
 * matched custodian name; this covers source files that omit 使用人代碼.
 */
export function applyOfficialPersonnelNames(assets = [], users = []) {
  const names = officialNamesByCode(users);
  return assets.map((asset) => {
    const rawCustodianName = clean(asset.rawCustodianName || asset.custodianName);
    const rawUserName = clean(asset.rawUserName || asset.userName);
    const custodianName = names[clean(asset.custodianCode)] || rawCustodianName;
    const userName =
      names[clean(asset.userCode)] ||
      (rawUserName && rawUserName === rawCustodianName ? custodianName : rawUserName);
    return { ...asset, rawCustodianName, rawUserName, custodianName, userName };
  });
}
