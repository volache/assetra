const STORE = "asset-ledger-prototype-v1";

const emptyStore = {
  users: [],
  assets: [],
  imports: [],
  custodianProfiles: {},
  unitProfiles: {},
};

export function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    const {
      users: _legacyUsers,
      assets: _cachedAssets,
      imports: _cachedImports,
      ...localData
    } = saved || {};
    return saved
      ? {
          ...emptyStore,
          ...localData,
          custodianProfiles: localData.custodianProfiles || {},
          unitProfiles: localData.unitProfiles || {},
        }
      : emptyStore;
  } catch {
    return emptyStore;
  }
}

export function saveStore({
  users: _remoteUsers,
  assets: _remoteAssets,
  imports: _remoteImports,
  ...localData
}) {
  localStorage.setItem(STORE, JSON.stringify(localData));
}
