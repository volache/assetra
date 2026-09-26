import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import mapboxgl from 'mapbox-gl';
import * as XLSX from 'xlsx';
import 'mapbox-gl/dist/mapbox-gl.css';
import './styles.css';

// The authoritative cadastral source stays outside version control. `import.meta.glob`
// keeps a fresh checkout buildable when that local source has not been provisioned.
const landPropertyFiles = import.meta.glob('../data/private/geospatial/land-properties.geojson', { eager: true, import: 'default', query: '?raw' });
const landPropertiesText = Object.values(landPropertyFiles)[0] || '{"type":"FeatureCollection","features":[]}';
const landProperties = JSON.parse(landPropertiesText);

const STORE = 'asset-ledger-prototype-v1';
const initialUsers = [
  { id: 'admin', name: '系統管理員', email: 'admin@example.local', password: 'Admin@1234', roles: ['admin'] },
  { id: 'chief-b04', name: '單位主管示範', email: 'chief@example.local', password: 'Chief@1234', roles: ['chief'], unitCodes: ['B04'] },
  { id: 'custodian-op23', name: '保管人示範', email: 'keeper@example.local', password: 'Keeper@1234', roles: ['custodian'], custodianCodes: ['OP23'] },
];

const sourceLabels = { asset: '財產清冊', item: '物品清冊' };
const roleLabels = { custodian: '保管人', chief: '單位主管', admin: '系統管理員' };
const roleDescriptions = {
  custodian: '查看已配對保管人代碼的財物。',
  chief: '查看已指派所屬單位的財物。',
  admin: '管理全部財物、清冊匯入與使用者。',
};
const columns = {
  assetNo: ['財產編號'], serialNo: ['流水號'], name: ['中文名稱'], oldNo: ['OLDNUMBER'],
  acquiredAt: ['購置日期'], unitCode: ['保管單位代碼'], unitName: ['保管單位中文'], useUnitName: ['使用單位中文'],
  locationCode: ['存置地點代碼'], locationName: ['存置地點中文'],
  custodianCode: ['保管人'], custodianName: ['保管人中文'], userCode: ['使用人'], userName: ['使用人中文'], quantity: ['數量'], measureUnit: ['單位'],
  originalValue: ['原值'], depreciation: ['累折'], netValue: ['淨值'], usefulLife: ['年限'],
  categoryName: ['財產別名'], categoryType: ['區分別中文', '區分別'], model: ['型式', '型試'], brand: ['廠牌'], notes: ['備註'], status: ['是否報廢'],
};

function loadStore() {
  try { const saved = JSON.parse(localStorage.getItem(STORE)); return saved ? { users: initialUsers, assets: [], imports: [], custodianProfiles: {}, unitProfiles: {}, ...saved, custodianProfiles: saved.custodianProfiles || {}, unitProfiles: saved.unitProfiles || {} } : { users: initialUsers, assets: [], imports: [], custodianProfiles: {}, unitProfiles: {} }; }
  catch { return { users: initialUsers, assets: [], imports: [], custodianProfiles: {}, unitProfiles: {} }; }
}
function saveStore(value) { localStorage.setItem(STORE, JSON.stringify(value)); }
function valueOf(row, keys) { for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key]; return ''; }
function rocDate(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{5,7}$/.test(text)) return text;
  const padded = text.padStart(7, '0');
  return `${padded.slice(0, 3)}/${padded.slice(3, 5)}/${padded.slice(5, 7)}`;
}
function money(value) { const n = Number(value); return Number.isFinite(n) ? new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(n) : '—'; }
function usedDuration(value) {
  const match = String(value || '').match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return '—';
  const acquired = new Date(Number(match[1]) + 1911, Number(match[2]) - 1, Number(match[3]));
  const today = new Date();
  if (Number.isNaN(acquired.getTime()) || acquired > today) return '—';
  let months = (today.getFullYear() - acquired.getFullYear()) * 12 + today.getMonth() - acquired.getMonth();
  if (today.getDate() < acquired.getDate()) months -= 1;
  return `${Math.floor(months / 12)} 年 ${months % 12} 月`;
}
function assetMajorClass(assetNo) {
  const number = String(assetNo || '').trim();
  if (number.startsWith('111')) return '土地改良物';
  if (number.startsWith('1')) return '土地';
  if (number.startsWith('2')) return '房屋建築及設備';
  if (number.startsWith('3')) return '機械及設備';
  if (number.startsWith('4')) return '交通及運輸設備';
  if (number.startsWith('5')) return '什項設備';
  if (number.startsWith('6')) return '非消耗品';
  return '—';
}
function normalizeRows(rows, sourceType) {
  return rows.filter((row) => valueOf(row, columns.assetNo)).map((row, i) => {
    const get = (field) => valueOf(row, columns[field]);
    return {
      id: `${sourceType}:${get('assetNo')}:${get('serialNo')}:${i}`,
      sourceType, assetNo: String(get('assetNo')), serialNo: String(get('serialNo')).padStart(7, '0'),
      name: String(get('name')), oldNo: String(get('oldNo') || ''), acquiredAt: rocDate(get('acquiredAt')),
      unitCode: String(get('unitCode') || ''), unitName: String(get('unitName') || ''), useUnitName: String(get('useUnitName') || ''),
      locationCode: String(get('locationCode') || ''), locationName: String(get('locationName') || ''),
      custodianCode: String(get('custodianCode') || ''), custodianName: String(get('custodianName') || ''), userCode: String(get('userCode') || ''), userName: String(get('userName') || ''),
      quantity: get('quantity'), measureUnit: String(get('measureUnit') || ''), originalValue: get('originalValue'), depreciation: get('depreciation'), netValue: get('netValue'),
      usefulLife: get('usefulLife'), categoryName: String(get('categoryName') || ''), categoryType: String(get('categoryType') || ''), model: String(get('model') || ''),
      brand: String(get('brand') || ''), notes: String(get('notes') || ''), status: String(get('status') || ''),
    };
  });
}
function allowedAssets(assets, user) {
  if (user.roles.includes('admin')) return assets;
  return assets.filter((asset) => (user.roles.includes('custodian') && user.custodianCodes?.includes(asset.custodianCode)) || (user.roles.includes('chief') && user.unitCodes?.includes(asset.unitCode)));
}
function accountCodeFor(user) { return String(user.accountCode || user.custodianCodes?.[0] || user.email || '').trim(); }
function App() {
  const [store, setStore] = useState(loadStore);
  const [session, setSession] = useState(null);
  const [page, setPage] = useState('home');
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isEnteringPortal, setIsEnteringPortal] = useState(false);
  const [isLeavingPortal, setIsLeavingPortal] = useState(false);
  useEffect(() => saveStore(store), [store]);
  function startSession(user) {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return setSession(user);
    setIsLoadingSession(true);
    window.setTimeout(() => {
      setSession(user);
      setIsLoadingSession(false);
      setIsEnteringPortal(true);
      window.setTimeout(() => setIsEnteringPortal(false), 560);
    }, 1180);
  }
  function endSession() {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) { setPage('home'); return setSession(null); }
    setIsLeavingPortal(true);
    window.setTimeout(() => {
      setPage('home');
      setSession(null);
      setIsLeavingPortal(false);
    }, 420);
  }
  if (!session) return <Login isLoading={isLoadingSession} users={store.users} onLogin={startSession} />;
  return <Portal entering={isEnteringPortal} leaving={isLeavingPortal} store={store} setStore={setStore} user={session} page={page} setPage={setPage} onLogout={endSession} />;
}

function Login({ isLoading, users, onLogin }) {
  const [email, setEmail] = useState('admin@example.local'); const [password, setPassword] = useState('Admin@1234'); const [error, setError] = useState('');
  function submit(e) { e.preventDefault(); if (isLoading) return; const user = users.find((u) => (u.email.toLowerCase() === email.toLowerCase() || accountCodeFor(u).toLowerCase() === email.toLowerCase()) && u.password === password && (u.status || 'active') === 'active'); if (user) onLogin(user); else setError('帳號或密碼不正確，或帳號尚未啟用。'); }
  return <main className={`login-shell ${isLoading ? 'is-loading' : ''}`}><section className="login-intro"><p className="eyebrow">INTERNAL ASSET LEDGER</p><h1>讓每件財物<br />都有清楚去向。</h1><p>管理者匯入清冊。保管人登入後，只會看到自己負責的資料。</p><div className="intro-mark" aria-hidden="true"><span /><span /><span /></div></section><section className="login-panel"><div><p className="eyebrow">登入系統</p><h2>財物清冊</h2><p className="muted">此為本機原型。管理者可先使用預設帳號登入。</p></div><form onSubmit={submit}><label>帳號<input value={email} onChange={(e) => setEmail(e.target.value)} type="text" autoComplete="username" /></label><label>密碼<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={isLoading} type="submit">登入</button></form><div className="credential-note"><strong>管理者示範帳號</strong><span>admin@example.local ／ Admin@1234</span></div></section><div className="session-loader" aria-live="polite" aria-label="正在載入系統工作區"><div className="session-loader-pills" aria-hidden="true"><span /><span /><span /></div><strong>正在載入工作區</strong><small>準備財物清冊資料</small></div></main>;
}

function Portal({ entering, leaving, store, setStore, user, page, setPage, onLogout }) {
  const canAdmin = user.roles.includes('admin'); const canChief = user.roles.includes('chief');
  const visible = useMemo(() => allowedAssets(store.assets, user).map((asset) => ({ ...asset, rawCustodianName: asset.custodianName, custodianName: store.custodianProfiles?.[asset.custodianCode]?.displayName || asset.custodianName })), [store.assets, store.custodianProfiles, user]);
  const previousPage = useRef(page);
  const isPageSwitch = previousPage.current !== page;
  useEffect(() => { previousPage.current = page; }, [page]);
  const navigation = [{ id: 'home', label: '總覽' }, { id: 'query', label: '財物查詢' }, ...(canAdmin ? [{ id: 'import', label: '匯入清冊' }, { id: 'geo', label: '地理圖資' }, { id: 'organization', label: '組織管理' }, { id: 'accounts', label: '使用者管理' }] : []), { id: 'password', label: '修改密碼' }];
  return <div className={`app-shell ${entering ? 'is-entering' : ''} ${leaving ? 'is-leaving' : ''}`}><aside className="side-nav"><div className="brand"><span className="brand-dot" />財物清冊</div><nav aria-label="主要功能">{navigation.map((item) => <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.id)}>{item.label}</button>)}</nav><div className="side-user"><span>{user.name}</span><small>{user.roles.map((role) => roleLabels[role]).join('、')}</small><button className="text-button" onClick={onLogout}>登出</button></div></aside><main className="main-area"><header className="mobile-header"><div className="brand"><span className="brand-dot" />財物清冊</div><button className="text-button" onClick={onLogout}>登出</button></header><div className={`page-transition ${isPageSwitch ? 'is-switching' : ''}`} key={page}>{page === 'home' && <Home visible={visible} user={user} imports={store.imports} setPage={setPage} canAdmin={canAdmin} canChief={canChief} />}{page === 'query' && <Query assets={visible} imports={store.imports} />}{page === 'import' && canAdmin && <Import store={store} setStore={setStore} />}{page === 'geo' && canAdmin && <GeographicAssets />}{page === 'accounts' && canAdmin && <Accounts store={store} setStore={setStore} />}{page === 'organization' && canAdmin && <Organization store={store} setStore={setStore} />}{page === 'password' && <Password user={user} setStore={setStore} />}</div></main></div>;
}

function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const finalValue = Math.max(0, Number(target) || 0);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setValue(finalValue); return undefined; }
    const startedAt = performance.now();
    let frame;
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - ((1 - progress) ** 3);
      setValue(finalValue * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    setValue(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

function HomeMetrics({ canAdmin, canChief, imports, ownCount, setPage, totalValue, user, visible }) {
  const assetCount = Math.round(useCountUp(visible.length));
  const netValue = Math.round(useCountUp(totalValue));
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">ROLE-BASED VIEW</p><h1>你好，{user.name}</h1><p>這裡只顯示你目前角色可查看與處理的資料。</p></div><button className="button button-secondary" onClick={() => setPage('query')}>查詢財物</button></div><div className="bento"><article className="bento-cell bento-wide"><p className="eyebrow">可查詢財物</p><strong aria-label={`${visible.length.toLocaleString()} 筆`}>{assetCount.toLocaleString()} <small>筆</small></strong><p>{canAdmin ? '目前已匯入的全部清冊資料。' : canChief ? '包含你所屬單位與你個人保管的資料。' : '依保管人代碼篩選。'}</p></article><article className="bento-cell bento-value"><p className="eyebrow">淨值合計</p><strong aria-label={`NT$ ${money(totalValue)}`}>NT$ {money(netValue)}</strong><p>依目前可見範圍計算</p></article><article className="bento-cell bento-action"><p className="eyebrow">快速開始</p><h2>{visible.length ? '從名稱或編號開始找' : '先匯入一份清冊'}</h2><button className="text-link" onClick={() => setPage(visible.length ? 'query' : 'import')}>{visible.length ? '開啟查詢 →' : '前往匯入 →'}</button></article><article className="bento-cell bento-small"><p className="eyebrow">我保管的財物</p><strong>{ownCount.toLocaleString()}</strong><p>筆資料</p></article><article className="bento-cell bento-import"><p className="eyebrow">最近匯入</p><h2>{imports[0] ? imports[0].fileName : '尚未匯入'}</h2><p>{imports[0] ? `${imports[0].count.toLocaleString()} 筆 · ${imports[0].at}` : '請由系統管理員上傳 Excel。'}</p></article></div></section>;
}

function Home({ visible, user, imports, setPage, canAdmin, canChief }) {
  const totalValue = visible.reduce((sum, a) => sum + (Number(a.netValue) || 0), 0); const ownCount = visible.filter((a) => user.custodianCodes?.includes(a.custodianCode)).length;
  return <HomeMetrics canAdmin={canAdmin} canChief={canChief} imports={imports} ownCount={ownCount} setPage={setPage} totalValue={totalValue} user={user} visible={visible} />;
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">ROLE-BASED VIEW</p><h1>你好，{user.name}</h1><p>這裡只顯示你目前角色可查看與處理的資料。</p></div><button className="button button-secondary" onClick={() => setPage('query')}>查詢財物</button></div><div className="bento"><article className="bento-cell bento-wide"><p className="eyebrow">可查詢財物</p><strong>{visible.length.toLocaleString()} <small>筆</small></strong><p>{canAdmin ? '目前已匯入的全部清冊資料。' : canChief ? '包含你所屬單位與你個人保管的資料。' : '依保管人代碼篩選。'}</p></article><article className="bento-cell bento-value"><p className="eyebrow">淨值合計</p><strong>NT$ {money(totalValue)}</strong><p>依目前可見範圍計算</p></article><article className="bento-cell bento-action"><p className="eyebrow">快速開始</p><h2>{visible.length ? '從名稱或編號開始找' : '先匯入一份清冊'}</h2><button className="text-link" onClick={() => setPage(visible.length ? 'query' : 'import')}>{visible.length ? '開啟查詢 →' : '前往匯入 →'}</button></article><article className="bento-cell bento-small"><p className="eyebrow">我保管的財物</p><strong>{ownCount.toLocaleString()}</strong><p>筆資料</p></article><article className="bento-cell bento-import"><p className="eyebrow">最近匯入</p><h2>{imports[0] ? imports[0].fileName : '尚未匯入'}</h2><p>{imports[0] ? `${imports[0].count.toLocaleString()} 筆 · ${imports[0].at}` : '請由系統管理員上傳 Excel。'}</p></article></div></section>;
}

const filterFields = [
  ['unitName', '保管單位'], ['custodianName', '保管人'], ['locationName', '存置地點'],
  ['name', '財產名稱'], ['categoryName', '財產別名'], ['status', '使用現況'],
];
const defaultPageSize = 50;
const normalized = (value) => String(value || '').trim().toLocaleLowerCase('zh-TW');
const searchFieldAliases = {
  '保管單位': 'unitName', '保管人': 'custodianName', '存置地點': 'locationName', '財產名稱': 'name', '財產別名': 'categoryName', '使用現況': 'status',
  '財產編號': 'assetNo', '流水號': 'serialNo', '淨值': 'netValue', '原值': 'originalValue', '累折': 'depreciation', '購置日期': 'acquiredAt',
  '廠牌': 'brand', '型式': 'model', '使用單位': 'useUnitName', '使用人': 'userName', '計量單位': 'measureUnit', '財產區分別': 'categoryType', '年限': 'usefulLife', '數量': 'quantity', '備註': 'notes',
};
const searchRuleGroups = [
  { title: '邏輯', rules: [['任一符合', ' | '], ['排除文字', ' -'], ['精確片語', '""']] },
  { title: '萬用字元', rules: [['任意文字', '*'], ['單一字元', '?']] },
  { title: '指定欄位', rules: [['保管單位', '保管單位:'], ['保管人', '保管人:'], ['存置地點', '存置地點:'], ['財產名稱', '財產名稱:'], ['財產別名', '財產別名:'], ['使用現況', '使用現況:']] },
  { title: '其他欄位', rules: [['廠牌', '廠牌:'], ['型式', '型式:'], ['使用單位', '使用單位:'], ['使用人', '使用人:'], ['計量單位', '計量單位:'], ['財產區分別', '財產區分別:'], ['年限', '年限:'], ['數量', '數量:'], ['備註', '備註:']] },
  { title: '比較', rules: [['淨值大於', '淨值:>50000'], ['購置日期之後', '購置日期:>=110/01/01']] },
];

function tokenizeSearch(term) {
  return String(term || '').match(/-?(?:[^\s"|]+:)?(?:"[^"]*"|[^\s|]+)|\|/g) || [];
}
function dateNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^\d{7}$/.test(digits) ? Number(digits) : NaN;
}
function numericValue(value) {
  const number = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : NaN;
}
function textMatches(value, needle) {
  const query = normalized(String(needle).replace(/^"|"$/g, ''));
  if (!/[?*]/.test(query)) return normalized(value).includes(query);
  const expression = [...query].map((character) => character === '*' ? '.*' : character === '?' ? '.' : character.replace(/[.*+^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(expression, 'u').test(normalized(value));
}
function tokenMatches(asset, rawToken) {
  const negated = rawToken.startsWith('-');
  const token = negated ? rawToken.slice(1) : rawToken;
  const comparison = token.match(/^([^:]+):(>=|<=|>|<|=)(.+)$/);
  const fieldSearch = token.match(/^([^:]+):(.+)$/);
  let matched;
  if (comparison && searchFieldAliases[comparison[1]]) {
    const [, label, operator, expected] = comparison;
    const field = searchFieldAliases[label];
    const actual = field === 'acquiredAt' ? dateNumber(asset[field]) : numericValue(asset[field]);
    const target = field === 'acquiredAt' ? dateNumber(expected) : numericValue(expected);
    matched = Number.isFinite(actual) && Number.isFinite(target) && ({ '>': actual > target, '>=': actual >= target, '<': actual < target, '<=': actual <= target, '=': actual === target })[operator];
  } else if (fieldSearch && searchFieldAliases[fieldSearch[1]]) {
    matched = textMatches(asset[searchFieldAliases[fieldSearch[1]]], fieldSearch[2]);
  } else {
    matched = Object.values(asset).some((value) => textMatches(value, token));
  }
  return negated ? !matched : matched;
}
function matchesAdvancedSearch(asset, term) {
  const groups = tokenizeSearch(term).reduce((all, token) => {
    if (token === '|') all.push([]); else all[all.length - 1].push(token);
    return all;
  }, [[]]).filter((group) => group.length);
  return !groups.length || groups.some((group) => group.every((token) => tokenMatches(asset, token)));
}
function HighlightText({ value, terms }) {
  const text = String(value || '');
  const needles = [...new Set(terms.map((term) => String(term).replace(/^"|"$/g, '').replace(/[?*]/g, '').trim()).filter((term) => term.length > 1))].sort((a, b) => b.length - a.length);
  if (!text || !needles.length) return text || '—';
  const pattern = new RegExp(`(${needles.map((term) => term.replace(/[.*+^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu');
  return text.split(pattern).map((part, index) => normalized(part) && needles.some((term) => normalized(part) === normalized(term)) ? <mark key={index}>{part}</mark> : part);
}

function FilterCombo({ id, label, value, options, open, onChange, onOpenChange }) {
  const suggestions = options.filter((option) => normalized(option).includes(normalized(value))).slice(0, 100);
  return <label className="filter-field">{label}<span className="filter-combobox"><input aria-autocomplete="list" aria-controls={`${id}-options`} aria-expanded={open} autoComplete="off" value={value} onBlur={() => setTimeout(() => onOpenChange((current) => current === id ? null : current), 120)} onChange={(e) => { onChange(e.target.value); onOpenChange(id); }} onFocus={() => onOpenChange(id)} onKeyDown={(e) => { if (e.key === 'Escape') onOpenChange(null); }} placeholder={`全部${label}`} /><button aria-label={`開啟${label}選項`} className={`combo-toggle ${open ? 'open' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onOpenChange(open ? null : id)} type="button"><span aria-hidden="true" /></button>{open && <span className="combo-menu" id={`${id}-options`} role="listbox">{suggestions.length ? suggestions.map((option) => <button key={option} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(option); onOpenChange(null); }} role="option" type="button">{option}</button>) : <span className="combo-empty">沒有符合的選項</span>}</span>}</span></label>;
}

function SearchRuleMenu({ open, onInsert, onToggle }) {
  return <span className="search-rule-menu"><button aria-expanded={open} aria-haspopup="true" className="search-rule-trigger" onClick={onToggle} type="button">加入規則 <span aria-hidden="true" /></button>{open && <span className="search-rule-popover"><strong>搜尋規則</strong>{searchRuleGroups.map((group) => <span className="search-rule-group" key={group.title}><b>{group.title}</b>{group.rules.map(([label, value]) => <button key={label} onClick={() => onInsert(value)} type="button"><span>{label}</span><code>{value || '輸入文字'}</code></button>)}</span>)}</span>}</span>;
}

function Query({ assets, imports }) {
  const [term, setTerm] = useState(''); const [appliedTerm, setAppliedTerm] = useState(''); const [source, setSource] = useState('all');
  const [filters, setFilters] = useState(() => Object.fromEntries(filterFields.map(([key]) => [key, ''])));
  const [currentPage, setCurrentPage] = useState(1); const [pageSize, setPageSize] = useState(defaultPageSize); const [expandedId, setExpandedId] = useState(null);
  const [compactFilters, setCompactFilters] = useState(false); const [compactFilterExpanded, setCompactFilterExpanded] = useState(false); const [openFilterId, setOpenFilterId] = useState(null); const [ruleMenuOpen, setRuleMenuOpen] = useState(false); const filterSentinelRef = useRef(null); const filterPanelRef = useRef(null); const searchInputRef = useRef(null);
  const matches = (asset, omit = null) => filterFields.every(([key]) => key === omit || !filters[key] || normalized(asset[key]).includes(normalized(filters[key])));
  const sourceRows = useMemo(() => assets.filter((asset) => source === 'all' || asset.sourceType === source), [assets, source]);
  const options = useMemo(() => Object.fromEntries(filterFields.map(([key]) => [key, [...new Set(sourceRows.filter((asset) => matches(asset, key)).map((asset) => String(asset[key] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'))])), [sourceRows, filters]);
  const rows = useMemo(() => sourceRows
    .filter((asset) => matches(asset) && matchesAdvancedSearch(asset, appliedTerm))
    .sort((left, right) => String(left.assetNo || '').localeCompare(String(right.assetNo || ''), 'zh-Hant', { numeric: true, sensitivity: 'base' }) || String(left.serialNo || '').localeCompare(String(right.serialNo || ''), 'zh-Hant', { numeric: true, sensitivity: 'base' })), [sourceRows, filters, appliedTerm]);
  const globalHighlightTerms = useMemo(() => tokenizeSearch(appliedTerm).filter((token) => token !== '|' && !token.startsWith('-') && !token.includes(':')), [appliedTerm]);
  function highlightTermsFor(field) {
    const terms = filters[field] ? [filters[field]] : [];
    tokenizeSearch(appliedTerm).filter((token) => token !== '|' && !token.startsWith('-')).forEach((token) => {
      const comparison = token.match(/^([^:]+):(>=|<=|>|<|=)(.+)$/); if (comparison) return;
      const fieldToken = token.match(/^([^:]+):(.+)$/);
      if (fieldToken) { if (searchFieldAliases[fieldToken[1]] === field) terms.push(fieldToken[2]); } else terms.push(token);
    });
    return terms;
  }
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize)); const page = Math.min(currentPage, totalPages);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const activeFilterCount = filterFields.filter(([key]) => filters[key]).length + Number(Boolean(appliedTerm)) + Number(source !== 'all');
  useEffect(() => { setCurrentPage(1); setExpandedId(null); }, [appliedTerm, source, ...filterFields.map(([key]) => filters[key])]);
  useEffect(() => { const updateCompactMode = () => { if (window.innerWidth < 960 || !filterSentinelRef.current) return setCompactFilters(false); setCompactFilters(filterSentinelRef.current.getBoundingClientRect().bottom <= 0); }; updateCompactMode(); window.addEventListener('scroll', updateCompactMode, { passive: true }); window.addEventListener('resize', updateCompactMode); return () => { window.removeEventListener('scroll', updateCompactMode); window.removeEventListener('resize', updateCompactMode); }; }, []);
  useEffect(() => { const closeOutsideMenus = (event) => { const target = event.target; if (!(target instanceof Element)) return; if (!target.closest('.filter-combobox')) setOpenFilterId(null); if (!target.closest('.search-rule-menu')) setRuleMenuOpen(false); if (!target.closest('.compact-filter-bar')) setCompactFilterExpanded(false); }; document.addEventListener('pointerdown', closeOutsideMenus); return () => document.removeEventListener('pointerdown', closeOutsideMenus); }, []);
  function updateFilter(key, value) { setFilters((current) => ({ ...current, [key]: value })); }
  function clearFilters() { setFilters(Object.fromEntries(filterFields.map(([key]) => [key, '']))); setTerm(''); setAppliedTerm(''); setSource('all'); }
  function runSearch() { setAppliedTerm(term.trim()); setRuleMenuOpen(false); }
  function showFullFilters() { setCompactFilterExpanded((open) => !open); }
  function insertRule(value) { const input = searchInputRef.current; const start = input?.selectionStart ?? term.length; const end = input?.selectionEnd ?? term.length; const before = term.slice(0, start); const after = term.slice(end); const padding = before && !/\s$/.test(before) && !value.startsWith(' ') ? ' ' : ''; const next = `${before}${padding}${value}${after}`; setTerm(next); setRuleMenuOpen(false); requestAnimationFrame(() => { input?.focus(); const caret = (before + padding + value).length; input?.setSelectionRange(caret, caret); }); }
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">ASSET SEARCH</p><h1>財物查詢</h1><p>篩選條件彼此取交集；每個選單會依其餘條件即時縮小。</p></div></div><div aria-hidden="true" className="filter-sentinel" ref={filterSentinelRef} />{compactFilters && <div className="compact-filter-bar compact-filter-bar-fixed"><button aria-expanded={compactFilterExpanded} className="compact-filter-trigger" onClick={showFullFilters} type="button">篩選條件{activeFilterCount ? <b>{activeFilterCount}</b> : null}</button><label className="compact-search"><span className="sr-only">全局關鍵字搜尋</span><input value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }} placeholder="輸入後按 Enter 搜尋…" /></label><button className="compact-clear" disabled={!activeFilterCount} onClick={clearFilters} type="button">清除</button>{compactFilterExpanded && <div className="compact-filter-popover"><div className="filter-grid">{filterFields.map(([key, label]) => <FilterCombo id={`compact-${key}`} key={key} label={label} onChange={(value) => updateFilter(key, value)} onOpenChange={setOpenFilterId} open={openFilterId === `compact-${key}`} options={options[key]} value={filters[key]} />)}</div></div>}</div>}<section className="search-panel" aria-label="篩選條件" ref={filterPanelRef}><div className="filter-panel-heading"><div><h2>篩選條件</h2><p>可直接輸入文字，或由清冊資料中的選項挑選。</p></div><button className="button button-secondary filter-reset" type="button" onClick={clearFilters}>清除篩選</button></div><div className="filter-grid">{filterFields.map(([key, label]) => <FilterCombo id={key} key={key} label={label} onChange={(value) => updateFilter(key, value)} onOpenChange={setOpenFilterId} open={openFilterId === key} options={options[key]} value={filters[key]} />)}</div><div className="advanced-search"><label className="search-field">全局關鍵字搜尋<input ref={searchInputRef} value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }} placeholder="輸入文字、欄位或搜尋規則" /></label><div className="advanced-search-actions"><button className={`button button-primary search-submit ${term !== appliedTerm ? 'pending' : ''}`} onClick={runSearch} type="button">搜尋</button><SearchRuleMenu onInsert={insertRule} onToggle={() => setRuleMenuOpen((open) => !open)} open={ruleMenuOpen} /></div></div><fieldset><legend>資料類型</legend><div className="segmented">{[['all', '全部'], ['asset', '財產'], ['item', '物品']].map(([value, label]) => <label key={value}><input type="radio" checked={source === value} onChange={() => setSource(value)} /><span>{label}</span></label>)}</div></fieldset></section><div className="result-summary"><p className="result-count">查詢結果：<strong>{rows.length.toLocaleString()}</strong> 筆</p>{imports[0] && <p className="latest-data">資料更新：{imports[0].at}</p>}{rows.length > pageSize && <label className="page-size">每頁<select aria-label="每頁顯示筆數" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}><option value="25">25 筆</option><option value="50">50 筆</option><option value="100">100 筆</option></select></label>}<p>第 {page}／{totalPages} 頁</p></div>{rows.length ? <><div className="asset-table-wrap"><table><thead><tr><th>使用現況</th><th>財產編號</th><th>名稱</th><th>廠牌／型式</th><th>保管人</th><th>存置地點</th><th>明細</th></tr></thead><tbody>{pageRows.map((a) => <React.Fragment key={a.id}><tr><td><HighlightText value={a.status} terms={highlightTermsFor('status')} /></td><td className="mono"><HighlightText value={a.assetNo} terms={highlightTermsFor('assetNo')} /><small><HighlightText value={a.serialNo} terms={highlightTermsFor('serialNo')} /></small></td><td><HighlightText value={a.name} terms={highlightTermsFor('name')} /><small><HighlightText value={a.categoryName} terms={highlightTermsFor('categoryName')} /></small></td><td><HighlightText value={a.brand} terms={highlightTermsFor('brand')} /><small><HighlightText value={a.model} terms={highlightTermsFor('model')} /></small></td><td><HighlightText value={a.custodianName || '未指定'} terms={highlightTermsFor('custodianName')} /><small><HighlightText value={a.custodianCode} terms={highlightTermsFor('custodianCode')} /></small></td><td><HighlightText value={a.locationName} terms={highlightTermsFor('locationName')} /></td><td><button className="row-action" aria-expanded={expandedId === a.id} aria-controls={`detail-${a.id}`} onClick={() => setExpandedId((id) => id === a.id ? null : a.id)}>{expandedId === a.id ? '收合' : '展開'}</button></td></tr><tr className="asset-detail-row"><td colSpan="7"><div className={`asset-detail ${expandedId === a.id ? 'open' : ''}`} id={`detail-${a.id}`}><div><dl>{[['財產區分別', <HighlightText value={a.categoryType} terms={highlightTermsFor('categoryType')} />], ['類型', <HighlightText value={a.sourceType === 'asset' ? '財產' : '物品'} terms={globalHighlightTerms} />], ['財產大類', <HighlightText value={assetMajorClass(a.assetNo)} terms={globalHighlightTerms} />], ['保管單位', <HighlightText value={a.unitName} terms={highlightTermsFor('unitName')} />], ['使用單位／使用人', <HighlightText value={[a.useUnitName, a.userName].filter(Boolean).join('／')} terms={[...highlightTermsFor('useUnitName'), ...highlightTermsFor('userName')]} />], ['計量單位', <HighlightText value={a.measureUnit} terms={highlightTermsFor('measureUnit')} />], ['購置日期', <HighlightText value={a.acquiredAt} terms={highlightTermsFor('acquiredAt')} />], ['年限', <HighlightText value={a.usefulLife ? `${a.usefulLife} 年` : '—'} terms={highlightTermsFor('usefulLife')} />], ['已使用', <HighlightText value={usedDuration(a.acquiredAt)} terms={globalHighlightTerms} />], ['原值', <HighlightText value={money(a.originalValue)} terms={highlightTermsFor('originalValue')} />], ['累折', <HighlightText value={money(a.depreciation)} terms={highlightTermsFor('depreciation')} />], ['淨值', <HighlightText value={money(a.netValue)} terms={highlightTermsFor('netValue')} />], ['備註', <HighlightText value={a.notes} terms={highlightTermsFor('notes')} />]].map(([label, value]) => <div className={`detail-pair ${label === '備註' ? 'detail-wide' : ''}`} key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}</dl></div></div></td></tr></React.Fragment>)}</tbody></table></div>{totalPages > 1 && <nav className="pagination" aria-label="清冊分頁"><button className="button button-secondary" type="button" disabled={page === 1} onClick={() => setCurrentPage(page - 1)}>上一頁</button><span>第 {page}／{totalPages} 頁</span><button className="button button-secondary" type="button" disabled={page === totalPages} onClick={() => setCurrentPage(page + 1)}>下一頁</button></nav>}</> : <div className="empty-state"><h2>目前沒有符合的資料</h2><p>{assets.length ? '請調整篩選條件或搜尋文字。' : '尚未匯入可供查詢的清冊。'}</p></div>}</section>;
}

function AssetDialog({ asset, onClose }) { return <dialog open className="detail-dialog" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}><div><header><div><p className="eyebrow">{sourceLabels[asset.sourceType]}</p><h2>{asset.name}</h2></div><button className="close-button" onClick={onClose} aria-label="關閉">×</button></header><dl>{[['財產編號', asset.assetNo], ['流水號', asset.serialNo], ['保管人', `${asset.custodianName || '—'} ${asset.custodianCode ? `(${asset.custodianCode})` : ''}`], ['使用單位', asset.unitName], ['存置地點', asset.locationName], ['購置日期', asset.acquiredAt], ['原值', money(asset.originalValue)], ['累折', money(asset.depreciation)], ['淨值', money(asset.netValue)], ['型式／廠牌', [asset.model, asset.brand].filter(Boolean).join(' ／ ') || '—'], ['備註', asset.notes || '—']].map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{value || '—'}</dd></React.Fragment>)}</dl></div></dialog>; }

function readWorksheetRows(sheet) {
  const [headers = [], ...records] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const seen = new Map();
  const fields = headers.map((header) => {
    const name = String(header || '').trim(); const count = (seen.get(name) || 0) + 1; seen.set(name, count);
    if (name === '保管人' && count === 2) return '使用人';
    if (name === '保管人中文' && count === 2) return '使用人中文';
    return name;
  });
  return records.filter((record) => record.some((value) => String(value ?? '').trim())).map((record) => Object.fromEntries(fields.map((field, index) => [field, record[index] ?? ''])));
}

function landAssetNumberParts(value) {
  const parts = String(value || '').split('-').filter(Boolean);
  if (parts.length >= 3) return { primary: parts.slice(-3, -1).join('-'), serial: parts.at(-1) };
  return { primary: String(value || '—'), serial: '' };
}

function GeoListViewContent({ activeFilterCount, appliedTerm, clearFilters, compactFilters, compactFiltersOpen, currentPage, filters, filtered, geoFilterSentinelRef, onCompactFiltersOpenChange, onOpenMap, onPageChange, onPageSizeChange, onSearch, onTermChange, onViewMap, pageRows, pageSize, term, totalArea, totalPages, totalValue }) {
  return <section className="page geographic-page is-list-view"><div className="page-heading"><div><p className="eyebrow">GEOSPATIAL ASSET DIRECTORY</p><h1>地理圖資</h1><p>以 Mapbox 底圖與地籍範圍檢視花蓮航空站土地財產，並與財產編號、面積及帳面價值交叉核對。</p></div><button className="button button-primary" onClick={onViewMap} type="button">地圖檢視</button></div><div aria-hidden="true" className="filter-sentinel" ref={geoFilterSentinelRef} />{compactFilters && <div className="compact-filter-bar compact-filter-bar-fixed"><button aria-expanded={compactFiltersOpen} className="compact-filter-trigger" onClick={() => onCompactFiltersOpenChange((open) => !open)} type="button">篩選條件{activeFilterCount ? <b>{activeFilterCount}</b> : null}</button><label className="compact-search"><span className="sr-only">全局關鍵字搜尋</span><input onChange={(event) => onTermChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }} placeholder="輸入後按 Enter 搜尋…" value={term} /></label><button className="compact-clear" disabled={!activeFilterCount} onClick={clearFilters} type="button">清除</button>{compactFiltersOpen && <div className="compact-filter-popover">{filters('compact-')}</div>}</div>}<section aria-label="篩選條件" className="search-panel geo-filter-panel"><div className="filter-panel-heading"><div><h2>篩選條件</h2><p>可直接輸入文字，或由土地資料中的選項挑選。</p></div><button className="button button-secondary filter-reset" onClick={clearFilters} type="button">清除篩選</button></div>{filters('geo-')}<div className="advanced-search"><label className="search-field">全局關鍵字搜尋<input onChange={(event) => onTermChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }} placeholder="輸入地段、地號、財產名稱或編號" value={term} /></label><div className="advanced-search-actions"><button className={`button button-primary search-submit ${term !== appliedTerm ? 'pending' : ''}`} onClick={onSearch} type="button">搜尋</button></div></div></section><section className="geo-table-panel"><div className="result-summary geo-result-summary"><p className="result-count">查詢結果：<strong>{filtered.length.toLocaleString()}</strong> 筆</p><p>土地總面積：{totalArea.toLocaleString()} m²</p><p>帳面價值：NT$ {money(totalValue)}</p><label className="page-size">每頁顯示<select aria-label="每頁顯示土地筆數" onChange={(event) => onPageSizeChange(Number(event.target.value))} value={pageSize}><option value="25">25 筆</option><option value="50">50 筆</option><option value="100">100 筆</option></select></label><p>第 {currentPage}／{totalPages} 頁</p></div><div className="geo-table-wrap"><table><thead><tr><th>段小段</th><th>地號</th><th>面積 (M²)</th><th>使用資訊</th><th>公告土地現值</th><th>公告地價</th><th>財產編號</th><th>財產名稱</th><th>財產價值 (元)</th><th>關聯建號</th><th>操作</th></tr></thead><tbody>{pageRows.map((land) => { const [number, serial] = String(land.id).split('\n'); return <tr key={land.id}><td>{land.section}<small>{land.sectionCode}</small></td><td>{land.landNumber}</td><td className="money">{land.area.toLocaleString()}</td><td><strong>{land.zoningLabel}</strong><small>{land.landUseType}</small></td><td className="money">{land.announcedLandValue.toLocaleString()}</td><td className="money">{land.announcedLandPrice.toLocaleString()}</td><td className="mono"><strong>{number}</strong>{serial && <small>{serial}</small>}</td><td><strong>{land.name}</strong><small>{land.section}{land.landNumber}</small></td><td className="money">{money(land.price)}</td><td>{land.relatedBuildingNumbers}</td><td><button className="row-action" onClick={() => onOpenMap(land)} type="button">查看地圖</button></td></tr>; })}</tbody></table></div>{totalPages > 1 && <nav aria-label="土地列表分頁" className="pagination"><button className="button button-secondary" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)} type="button">上一頁</button><span>第 {currentPage}／{totalPages} 頁</span><button className="button button-secondary" disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)} type="button">下一頁</button></nav>}</section></section>;
}

function GeoListView({ activeFilterCount, appliedTerm, clearFilters, compactFilters, compactFiltersOpen, currentPage, filtered, geoFilterSentinelRef, landFilters, landUseTypes, onCompactFiltersOpenChange, onFilterChange, onOpenFilterChange, onOpenMap, onPageChange, onPageSizeChange, onSearch, onTermChange, onViewMap, openFilterId, pageRows, pageSize, sections, term, totalArea, totalPages, totalValue, zonings }) {
  const filterFields = [
    ['section', '地段', sections],
    ['zoning', '使用分區', zonings],
    ['landUseType', '使用地類別', landUseTypes],
  ];
  const filters = (prefix = '') => <div className="filter-grid">{filterFields.map(([key, label, options]) => <FilterCombo id={`${prefix}${key}`} key={key} label={label} onChange={(value) => onFilterChange(key, value)} onOpenChange={onOpenFilterChange} open={openFilterId === `${prefix}${key}`} options={options} value={landFilters[key]} />)}</div>;
  return <GeoListViewContent activeFilterCount={activeFilterCount} appliedTerm={appliedTerm} clearFilters={clearFilters} compactFilters={compactFilters} compactFiltersOpen={compactFiltersOpen} currentPage={currentPage} filters={filters} filtered={filtered} geoFilterSentinelRef={geoFilterSentinelRef} onCompactFiltersOpenChange={onCompactFiltersOpenChange} onOpenMap={onOpenMap} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} onSearch={onSearch} onTermChange={onTermChange} onViewMap={onViewMap} pageRows={pageRows} pageSize={pageSize} term={term} totalArea={totalArea} totalPages={totalPages} totalValue={totalValue} />;
  return <section className="page geographic-page is-list-view"><div className="page-heading"><div><p className="eyebrow">GEOSPATIAL ASSET DIRECTORY</p><h1>地理圖資</h1><p>以 Mapbox 底圖與地籍範圍檢視花蓮航空站土地財產，並與財產編號、面積及帳面價值交叉核對。</p></div><button className="button button-primary" onClick={onViewMap} type="button">地圖檢視</button></div><div aria-hidden="true" className="filter-sentinel" ref={geoFilterSentinelRef} />{compactFilters && <div className="compact-filter-bar compact-filter-bar-fixed"><button aria-expanded={compactFiltersOpen} className="compact-filter-trigger" onClick={() => onCompactFiltersOpenChange((open) => !open)} type="button">篩選條件{activeFilterCount ? <b>{activeFilterCount}</b> : null}</button><label className="compact-search"><span className="sr-only">全局關鍵字搜尋</span><input onChange={(event) => onTermChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }} placeholder="輸入後按 Enter 搜尋…" value={term} /></label><button className="compact-clear" disabled={!activeFilterCount} onClick={clearFilters} type="button">清除</button>{compactFiltersOpen && <div className="compact-filter-popover">{filters('compact-')}</div>}</div>}<section aria-label="篩選條件" className="search-panel geo-filter-panel"><div className="filter-panel-heading"><div><h2>篩選條件</h2><p>可直接輸入文字，或由土地資料中的選項挑選。</p></div><button className="button button-secondary filter-reset" onClick={clearFilters} type="button">清除篩選</button></div>{filters('geo-')}<div className="advanced-search"><label className="search-field">全局關鍵字搜尋<input onChange={(event) => onTermChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }} placeholder="輸入地段、地號、財產名稱或編號" value={term} /></label><div className="advanced-search-actions"><button className={`button button-primary search-submit ${term !== appliedTerm ? 'pending' : ''}`} onClick={onSearch} type="button">搜尋</button></div></div></section><section className="geo-table-panel"><div className="result-summary"><p className="result-count">查詢結果：<strong>{filtered.length.toLocaleString()}</strong> 筆</p><p>土地總面積：{totalArea.toLocaleString()} m²</p><p>帳面價值：NT$ {money(totalValue)}</p></div><div className="geo-table-wrap"><table><thead><tr><th>段小段</th><th>地號</th><th>面積 (M²)</th><th>使用資訊</th><th>公告土地現值</th><th>公告地價</th><th>財產編號</th><th>財產名稱</th><th>財產價值 (元)</th><th>關聯建號</th><th>操作</th></tr></thead><tbody>{filtered.map((land) => { const [number, serial] = String(land.id).split('\n'); return <tr key={land.id}><td>{land.section}<small>{land.sectionCode}</small></td><td>{land.landNumber}</td><td className="money">{land.area.toLocaleString()}</td><td><strong>{land.zoningLabel}</strong><small>{land.landUseType}</small></td><td className="money">{land.announcedLandValue.toLocaleString()}</td><td className="money">{land.announcedLandPrice.toLocaleString()}</td><td className="mono"><strong>{number}</strong>{serial && <small>{serial}</small>}</td><td><strong>{land.name}</strong><small>{land.section}{land.landNumber}</small></td><td className="money">{money(land.price)}</td><td>{land.relatedBuildingNumbers}</td><td><button className="row-action" onClick={() => onOpenMap(land)} type="button">查看地圖</button></td></tr>; })}</tbody></table></div></section></section>;
}

function GeographicAssets() {
  const lands = useMemo(() => landProperties.features.map((feature, index) => {
    const basic = feature.properties?.basic_info || {};
    const property = feature.properties?.property_info || {};
    const propertyNumber = property.property_number || `${basic.section_code}-${basic.land_number}-${index}`;
    const number = landAssetNumberParts(propertyNumber);
    return { announcedLandPrice: Number(basic.announced_land_price) || 0, announcedLandValue: Number(basic.announced_land_value) || 0, area: Number(basic.area) || 0, feature, id: number.serial ? `${number.primary}\n${number.serial}` : number.primary, landNumber: basic.land_number || '—', landUseType: basic.land_use_type || '—', name: property.property_name || '未命名土地', price: Number(property.property_value) || 0, relatedBuildingNumbers: feature.properties?.related_building_numbers?.join('、') || '—', section: basic.section_name || '未分類段', sectionCode: basic.section_code || '—', zoning: `${basic.zoning || '未分類'}\n${basic.land_use_type || '—'}`, zoningLabel: basic.zoning || '未分類' };
  }), []);
  const [term, setTerm] = useState('');
  const [appliedTerm, setAppliedTerm] = useState('');
  const [landFilters, setLandFilters] = useState({ section: '', zoning: '', landUseType: '' });
  const [openGeoFilterId, setOpenGeoFilterId] = useState(null);
  const [compactGeoFilters, setCompactGeoFilters] = useState(false);
  const [compactGeoFiltersOpen, setCompactGeoFiltersOpen] = useState(false);
  const [geoPage, setGeoPage] = useState(1);
  const [geoPageSize, setGeoPageSize] = useState(25);
  const geoFilterSentinelRef = useRef(null);
  const [selectedId, setSelectedId] = useState(() => lands[0]?.id || '');
  const [mapFailure, setMapFailure] = useState('');
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState('map');
  const [mapStyle, setMapStyle] = useState('standard');
  const [is3D, setIs3D] = useState(false);
  const mapContainerRef = useRef(null);
  const mapPanelRef = useRef(null);
  const mapRef = useRef(null);
  const mapToken = import.meta.env.VITE_MAPBOX_TOKEN;
  const filtered = useMemo(() => lands.filter((land) => normalized(`${land.section}${land.landNumber} ${land.name} ${land.id} ${land.zoning}`).includes(normalized(viewMode === 'list' ? appliedTerm : term)) && (!landFilters.section || land.section === landFilters.section) && (!landFilters.zoning || land.zoningLabel === landFilters.zoning) && (!landFilters.landUseType || land.landUseType === landFilters.landUseType)), [lands, term, appliedTerm, landFilters, viewMode]);
  const selected = filtered.find((land) => land.id === selectedId) || lands.find((land) => land.id === selectedId) || filtered[0] || lands[0];
  const fullBounds = useMemo(() => {
    const coordinates = lands.flatMap((land) => land.feature.geometry.type === 'Polygon' ? land.feature.geometry.coordinates.flat() : land.feature.geometry.coordinates.flat(2));
    const xs = coordinates.map(([x]) => x); const ys = coordinates.map(([, y]) => y);
    return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
  }, [lands]);
  const mapData = useMemo(() => ({ type: 'FeatureCollection', features: lands.map((land) => ({ ...land.feature, properties: { geoId: land.id } })) }), [lands]);
  const boundsFor = (feature) => {
    const coordinates = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates.flat() : feature.geometry.coordinates.flat(2);
    const xs = coordinates.map(([x]) => x); const ys = coordinates.map(([, y]) => y);
    return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
  };
  const mapStyleUrl = mapStyle === 'satellite' ? 'mapbox://styles/mapbox/standard-satellite' : 'mapbox://styles/mapbox/standard';
  useEffect(() => {
    if (viewMode !== 'map' || !mapToken || !mapContainerRef.current || mapRef.current) return undefined;
    mapboxgl.accessToken = mapToken;
    let flyInTimer;
    const map = new mapboxgl.Map({ center: [120.95, 23.7], config: { basemap: { show3dObjects: is3D } }, container: mapContainerRef.current, fitBoundsOptions: { padding: 64 }, maxBounds: [[119, 21], [123, 26]], style: mapStyleUrl, zoom: 6.2 });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('land-properties', { data: mapData, type: 'geojson' });
      map.addLayer({ id: 'land-fill', paint: { 'fill-color': '#16a36b', 'fill-opacity': .32 }, source: 'land-properties', type: 'fill' });
      map.addLayer({ id: 'land-outline', paint: { 'line-color': '#087a4a', 'line-width': 2 }, source: 'land-properties', type: 'line' });
      flyInTimer = window.setTimeout(() => map.fitBounds(fullBounds, { duration: 2200, essential: true, padding: 64 }), 420);
      map.on('click', 'land-fill', (event) => { const id = event.features?.[0]?.properties?.geoId; if (id) setSelectedId(id); });
      map.on('mouseenter', 'land-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'land-fill', () => { map.getCanvas().style.cursor = ''; });
    });
    map.on('error', (event) => { if (event.error?.status === 401 || event.error?.status === 403) setMapFailure('Mapbox 權杖無效或尚未允許此網址使用。'); });
    return () => { window.clearTimeout(flyInTimer); map.remove(); mapRef.current = null; };
  }, [fullBounds, is3D, mapData, mapStyleUrl, mapToken, viewMode]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !map.getLayer('land-fill')) return;
    const visibleIds = filtered.map((land) => land.id);
    map.setPaintProperty('land-fill', 'fill-color', ['case', ['==', ['get', 'geoId'], selectedId], '#ef7356', '#16a36b']);
    map.setPaintProperty('land-fill', 'fill-opacity', ['case', ['==', ['get', 'geoId'], selectedId], .54, ['in', ['get', 'geoId'], ['literal', visibleIds]], .32, .08]);
    map.setPaintProperty('land-outline', 'line-color', ['case', ['==', ['get', 'geoId'], selectedId], '#b53d24', '#087a4a']);
    map.setPaintProperty('land-outline', 'line-width', ['case', ['==', ['get', 'geoId'], selectedId], 3, 2]);
  }, [filtered, selectedId]);
  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === mapPanelRef.current;
      setIsMapFullscreen(active);
      window.setTimeout(() => mapRef.current?.resize(), 80);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);
  function selectLand(land, moveMap = true) { setSelectedId(land.id); if (moveMap && mapRef.current?.isStyleLoaded()) mapRef.current.fitBounds(boundsFor(land.feature), { maxZoom: 17, padding: 90 }); }
  function showFullExtent() { setSelectedId(lands[0]?.id || ''); if (mapRef.current?.isStyleLoaded()) mapRef.current.fitBounds(fullBounds, { padding: 64 }); }
  function toggleMapFullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else mapPanelRef.current?.requestFullscreen?.(); }
  useEffect(() => {
    const updateCompactMode = () => {
      if (viewMode !== 'list' || window.innerWidth < 960 || !geoFilterSentinelRef.current) return setCompactGeoFilters(false);
      setCompactGeoFilters(geoFilterSentinelRef.current.getBoundingClientRect().bottom <= 0);
    };
    updateCompactMode();
    window.addEventListener('scroll', updateCompactMode, { passive: true });
    window.addEventListener('resize', updateCompactMode);
    return () => { window.removeEventListener('scroll', updateCompactMode); window.removeEventListener('resize', updateCompactMode); };
  }, [viewMode]);
  useEffect(() => { setGeoPage(1); }, [appliedTerm, landFilters, geoPageSize]);
  useEffect(() => {
    const closeMenus = (event) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('.geo-filter-panel .filter-combobox') && !event.target.closest('.compact-filter-bar .filter-combobox')) setOpenGeoFilterId(null);
      if (!event.target.closest('.compact-filter-bar')) setCompactGeoFiltersOpen(false);
    };
    document.addEventListener('pointerdown', closeMenus);
    return () => document.removeEventListener('pointerdown', closeMenus);
  }, []);
  function openMapForLand(land) { setSelectedId(land.id); setViewMode('map'); }
  const totalArea = filtered.reduce((sum, land) => sum + land.area, 0);
  const totalValue = filtered.reduce((sum, land) => sum + land.price, 0);
  const geoTotalPages = Math.max(1, Math.ceil(filtered.length / geoPageSize));
  const geoCurrentPage = Math.min(geoPage, geoTotalPages);
  const geoPageRows = filtered.slice((geoCurrentPage - 1) * geoPageSize, geoCurrentPage * geoPageSize);
  const sections = [...new Set(lands.map((land) => land.section))].sort((a, b) => a.localeCompare(b, 'zh-TW'));
  const zonings = [...new Set(lands.map((land) => land.zoningLabel))].sort((a, b) => a.localeCompare(b, 'zh-TW'));
  const landUseTypes = [...new Set(lands.map((land) => land.landUseType))].sort((a, b) => a.localeCompare(b, 'zh-TW'));
  const setLandFilter = (key, value) => setLandFilters((current) => ({ ...current, [key]: value }));
  const clearLandFilters = () => { setTerm(''); setAppliedTerm(''); setLandFilters({ section: '', zoning: '', landUseType: '' }); setOpenGeoFilterId(null); setCompactGeoFiltersOpen(false); };
  const activeLandFilterCount = Object.values(landFilters).filter(Boolean).length + Number(Boolean(appliedTerm));
  const runLandSearch = () => setAppliedTerm(term.trim());
  if (viewMode === 'list') return <GeoListView activeFilterCount={activeLandFilterCount} appliedTerm={appliedTerm} clearFilters={clearLandFilters} compactFilters={compactGeoFilters} compactFiltersOpen={compactGeoFiltersOpen} currentPage={geoCurrentPage} filtered={filtered} geoFilterSentinelRef={geoFilterSentinelRef} landFilters={landFilters} landUseTypes={landUseTypes} onCompactFiltersOpenChange={setCompactGeoFiltersOpen} onFilterChange={setLandFilter} onOpenFilterChange={setOpenGeoFilterId} onOpenMap={openMapForLand} onPageChange={setGeoPage} onPageSizeChange={setGeoPageSize} onSearch={runLandSearch} onTermChange={setTerm} onViewMap={() => setViewMode('map')} openFilterId={openGeoFilterId} pageRows={geoPageRows} pageSize={geoPageSize} sections={sections} term={term} totalArea={totalArea} totalPages={geoTotalPages} totalValue={totalValue} zonings={zonings} />;
  if (viewMode === 'list') return <section className="page geographic-page is-list-view"><div className="page-heading"><div><p className="eyebrow">GEOSPATIAL ASSET DIRECTORY</p><h1>地理圖資</h1><p>以 Mapbox 底圖與地籍範圍檢視花蓮航空站土地財產，並與財產編號、面積及帳面價值交叉核對。</p></div><button className="button button-primary" onClick={() => setViewMode('map')} type="button">地圖檢視</button></div><section className="geo-table-panel"><section aria-label="篩選條件" className="search-panel geo-filter-panel"><div className="filter-panel-heading"><div><h2>篩選條件</h2><p>可依土地標示、使用資訊或財產資料篩選。</p></div><button className="button button-secondary filter-reset" onClick={clearLandFilters} type="button">清除篩選</button></div><div className="filter-grid"><label className="filter-field">地段<select onChange={(event) => setLandFilter('section', event.target.value)} value={landFilters.section}><option value="">全部地段</option>{sections.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="filter-field">使用分區<select onChange={(event) => setLandFilter('zoning', event.target.value)} value={landFilters.zoning}><option value="">全部使用分區</option>{zonings.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="filter-field">使用地類別<select onChange={(event) => setLandFilter('landUseType', event.target.value)} value={landFilters.landUseType}><option value="">全部使用地類別</option>{landUseTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><div className="advanced-search"><label className="search-field">全局關鍵字搜尋<input onChange={(event) => setTerm(event.target.value)} placeholder="輸入地段、地號、財產名稱或編號" value={term} /></label></div></section><div className="result-summary"><p className="result-count">查詢結果：<strong>{filtered.length.toLocaleString()}</strong> 筆</p><p>土地總面積：{totalArea.toLocaleString()} m²</p><p>帳面價值：NT$ {money(totalValue)}</p></div><div className="geo-table-wrap"><table><thead><tr><th>段小段</th><th>地號</th><th>面積 (M²)</th><th>使用資訊</th><th>公告土地現值</th><th>公告地價</th><th>財產編號</th><th>財產名稱</th><th>財產價值 (元)</th><th>關聯建號</th><th>操作</th></tr></thead><tbody>{filtered.map((land) => { const [number, serial] = String(land.id).split('\n'); return <tr key={land.id}><td>{land.section}<small>{land.sectionCode}</small></td><td>{land.landNumber}</td><td className="money">{land.area.toLocaleString()}</td><td><strong>{land.zoningLabel}</strong><small>{land.landUseType}</small></td><td className="money">{land.announcedLandValue.toLocaleString()}</td><td className="money">{land.announcedLandPrice.toLocaleString()}</td><td className="mono"><strong>{number}</strong>{serial && <small>{serial}</small>}</td><td><strong>{land.name}</strong><small>{land.section}{land.landNumber}</small></td><td className="money">{money(land.price)}</td><td>{land.relatedBuildingNumbers}</td><td><button className="row-action" onClick={() => openMapForLand(land)} type="button">查看地圖</button></td></tr>; })}</tbody></table></div></section></section>;
  return <section className={`page geographic-page ${viewMode === 'list' ? 'is-list-view' : ''}`}><div className="page-heading"><div><p className="eyebrow">GEOSPATIAL ASSET DIRECTORY</p><h1>地理圖資</h1><p>以 Mapbox 底圖與地籍範圍檢視花蓮航空站土地財產，並與財產編號、面積及帳面價值交叉核對。</p></div><button className="button button-primary" onClick={() => setViewMode((current) => current === 'map' ? 'list' : 'map')} type="button">{viewMode === 'map' ? '列表檢視' : '地圖檢視'}</button></div>{viewMode === 'map' ? <section className="geo-workbench"><aside className="geo-list-panel"><header><h2>土地清單</h2><strong>{filtered.length} 筆</strong></header><label className="geo-search"><span className="sr-only">搜尋土地</span><input onChange={(event) => setTerm(event.target.value)} placeholder="地段、地號、財產編號…" value={term} /></label><div className="geo-list-scroll">{filtered.length ? filtered.map((land) => <button aria-pressed={selected?.id === land.id} className={`geo-list-item ${selected?.id === land.id ? 'is-selected' : ''}`} key={land.id} onClick={() => selectLand(land)} type="button"><span aria-hidden="true" className="geo-list-map-icon"><svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8"/><path d="M9 3v15m6-12v15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8"/></svg></span><div><strong>{land.section} {land.landNumber}</strong><small>{land.id}</small></div><em>{land.area.toLocaleString()} m²</em></button>) : <p className="geo-no-result">沒有符合的土地資料。</p>}</div><footer><div><span>目前筆數</span><strong>{filtered.length} 筆</strong></div><div><span>土地總面積</span><strong>{totalArea.toLocaleString()} m²</strong></div><div><span>帳面價值</span><strong>NT$ {money(totalValue)}</strong></div></footer></aside><section aria-label="土地地籍範圍圖" className="geo-map-panel" ref={mapPanelRef}><header><div><span className="geo-live-dot" />Mapbox 地籍範圍圖層</div><div className="geo-map-actions"><span aria-label="選擇底圖" className="geo-basemap-toggle"><button aria-pressed={mapStyle === 'standard'} className={mapStyle === 'standard' ? 'is-active' : ''} onClick={() => setMapStyle('standard')} type="button">標準</button><button aria-pressed={mapStyle === 'satellite'} className={mapStyle === 'satellite' ? 'is-active' : ''} onClick={() => setMapStyle('satellite')} type="button">衛星</button></span><button aria-pressed={is3D} className={`geo-3d-toggle ${is3D ? 'is-active' : ''}`} onClick={() => setIs3D((enabled) => !enabled)} type="button">3D</button><button className="text-button" onClick={showFullExtent} type="button">回到全區</button><button aria-pressed={isMapFullscreen} className="text-button" onClick={toggleMapFullscreen} type="button">{isMapFullscreen ? '離開全螢幕' : '全螢幕'}</button></div></header><div className="geo-map-stage">{mapToken ? <div aria-label="花蓮航空站土地地籍範圍 Mapbox 地圖" className="geo-mapbox" ref={mapContainerRef} /> : <div className="geo-map-config"><strong>尚未設定 Mapbox 權杖</strong><p>請在專案根目錄的 <code>.env</code> 設定 <code>VITE_MAPBOX_TOKEN</code>，然後重新啟動開發伺服器。</p></div>}{mapFailure && <p className="geo-map-error" role="alert">{mapFailure}</p>}{selected && <article className="geo-map-detail"><p>{selected.section}{selected.landNumber}</p><h2>{selected.name}</h2><dl><div><dt>面積</dt><dd>{selected.area.toLocaleString()} m²</dd></div><div><dt>帳面價值</dt><dd>NT$ {money(selected.price)}</dd></div><div><dt>使用分區</dt><dd>{selected.zoning}</dd></div></dl><a href={selected.feature.properties?.cadastral_link} rel="noreferrer" target="_blank">開啟地籍資料 ↗</a></article>}</div><footer><span><i className="geo-legend-land" />土地範圍</span><span><i className="geo-legend-selected" />目前選取</span><span className="geo-building-note">建物圖徵：待後續匯入座標或範圍資料</span></footer></section></section> : <section className="geo-table-panel"><header><div><h2>土地列表</h2><p>共 {filtered.length} 筆土地財產</p></div><label className="geo-search"><span className="sr-only">搜尋土地</span><input onChange={(event) => setTerm(event.target.value)} placeholder="地段、地號、財產編號…" value={term} /></label></header><div className="geo-table-wrap"><table><thead><tr><th>段小段</th><th>地號</th><th>面積 (M²)</th><th>使用分區</th><th>使用地類別</th><th>公告土地現值</th><th>公告地價</th><th>財產編號</th><th>財產名稱</th><th>財產價值 (元)</th><th>關聯建號</th><th>操作</th></tr></thead><tbody>{filtered.map((land) => <tr key={land.id}><td>{land.section}<small>{land.sectionCode}</small></td><td>{land.landNumber}</td><td className="money">{land.area.toLocaleString()}</td><td>{land.zoning}</td><td>{land.landUseType}</td><td className="money">{land.announcedLandValue.toLocaleString()}</td><td className="money">{land.announcedLandPrice.toLocaleString()}</td><td className="mono">{land.id}</td><td>{land.name}</td><td className="money">{money(land.price)}</td><td>{land.relatedBuildingNumbers}</td><td><button className="row-action" onClick={() => openMapForLand(land)} type="button">查看地圖</button></td></tr>)}</tbody></table></div></section>}</section>;
}

function Import({ store, setStore }) {
  const [file, setFile] = useState(null); const [sourceType, setSourceType] = useState('asset'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function importFile(e) { e.preventDefault(); if (!file) return setMessage('請先選擇 Excel 檔案。'); setBusy(true); try { const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' }); const first = workbook.Sheets[workbook.SheetNames[0]]; const records = normalizeRows(readWorksheetRows(first), sourceType); if (!records.length) throw new Error('找不到「財產編號」欄位或有效資料列。'); const keys = new Set(records.map((r) => `${r.sourceType}:${r.assetNo}:${r.serialNo}`)); const retained = store.assets.filter((r) => !keys.has(`${r.sourceType}:${r.assetNo}:${r.serialNo}`)); const at = new Date().toLocaleString('zh-TW', { hour12: false }); setStore({ ...store, assets: [...retained, ...records], imports: [{ fileName: file.name, sourceType, count: records.length, at }, ...store.imports] }); setMessage(`已完成匯入 ${records.length.toLocaleString()} 筆資料。相同類型、財產編號與流水號的既有資料已更新。`); } catch (error) { setMessage(error.message || '匯入失敗，請確認檔案格式。'); } finally { setBusy(false); } }
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">IMPORT REGISTER</p><h1>匯入清冊</h1><p>上傳一份 Excel，系統會以資料類型、財產編號與流水號更新資料。</p></div></div><form className="import-form" onSubmit={importFile}><fieldset><legend>清冊類型</legend><div className="source-options">{Object.entries(sourceLabels).map(([value, label]) => <label key={value}><input type="radio" checked={sourceType === value} onChange={() => setSourceType(value)} /><span><strong>{label}</strong><small>{value === 'asset' ? '含原值、累折與淨值' : '通常不含折舊資料'}</small></span></label>)}</div></fieldset><label className="file-field">Excel 檔案<input type="file" accept=".xlsx,.xls,.xlsm" onChange={(e) => setFile(e.target.files?.[0] || null)} /><span>{file ? file.name : '選擇 .xlsx、.xls 或 .xlsm 檔案'}</span></label><button className="button button-primary" disabled={busy} type="submit">{busy ? '正在匯入…' : '開始匯入'}</button>{message && <p className={message.startsWith('已完成') ? 'form-success' : 'form-error'} role="status">{message}</p>}</form><section className="import-history"><h2>匯入紀錄</h2>{store.imports.length ? <ul>{store.imports.map((entry, i) => <li key={`${entry.at}-${i}`}><span className={`source-tag ${entry.sourceType}`}>{sourceLabels[entry.sourceType]}</span><strong>{entry.fileName}</strong><span>{entry.count.toLocaleString()} 筆</span><time>{entry.at}</time></li>)}</ul> : <p className="muted">尚無匯入紀錄。</p>}</section></section>;
}

function UserFilterCombo({ id, label, value, options, open, onChange, onOpenChange }) {
  const selected = options.find((option) => option.value === value) || options[0];
  return <label className="filter-field">{label}<span className="filter-combobox"><input aria-controls={`${id}-options`} aria-expanded={open} aria-haspopup="listbox" readOnly placeholder={options[0]?.label} value={value ? selected?.label || '' : ''} onFocus={() => onOpenChange(id)} onKeyDown={(event) => { if (event.key === 'Escape') onOpenChange(null); }} /><button aria-label={`開啟${label}選項`} className={`combo-toggle ${open ? 'open' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onOpenChange(open ? null : id)} type="button"><span aria-hidden="true" /></button>{open && <span className="combo-menu" id={`${id}-options`} role="listbox">{options.map((option) => <button aria-selected={option.value === value} key={option.value || 'all'} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.value); onOpenChange(null); }} role="option" type="button">{option.label}</button>)}</span>}</span></label>;
}

function FormCombo({ id, label, value, options, open, onChange, onOpenChange }) {
  const selected = options.find((option) => option.value === value) || options[0];
  const comboRef = useRef(null);
  useEffect(() => { if (!open) return undefined; const close = (event) => { if (!comboRef.current?.contains(event.target)) onOpenChange(null); }; document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close); }, [open, onOpenChange]);
  return <label className="editor-combo" ref={comboRef}>{label}<span className="filter-combobox"><input aria-controls={`${id}-options`} aria-expanded={open} aria-haspopup="listbox" readOnly value={selected?.label || ''} onFocus={() => onOpenChange(id)} onKeyDown={(event) => { if (event.key === 'Escape') onOpenChange(null); }} /><button aria-label={`開啟${label}選項`} className={`combo-toggle ${open ? 'open' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onOpenChange(open ? null : id)} type="button"><span aria-hidden="true" /></button>{open && <span className="combo-menu" id={`${id}-options`} role="listbox">{options.map((option) => <button aria-selected={option.value === value} key={option.value || 'empty'} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.value); onOpenChange(null); }} role="option" type="button">{option.label}</button>)}</span>}</span></label>;
}

function UnitMasterDialog({ error, profiles, units, onClose, onSave }) {
  const [selectedCode, setSelectedCode] = useState(units[0]?.code || '');
  const [draft, setDraft] = useState({ name: '', parentCode: '' });
  const [openCombo, setOpenCombo] = useState(null);
  const selected = units.find((unit) => unit.code === selectedCode);
  useEffect(() => {
    if (!selected) return;
    const profile = profiles[selected.code] || {};
    setDraft({ name: profile.name || selected.rawName, parentCode: profile.parentCode ?? selected.defaultParentCode ?? '' });
    setOpenCombo(null);
  }, [selectedCode]);
  if (!selected) return null;
  const unitOptions = units.map((unit) => ({ value: unit.code, label: `${unit.code}／${unit.name}` }));
  const parentOptions = [{ value: '', label: '花蓮航空站' }, ...units.filter((unit) => unit.code !== selected.code).map((unit) => ({ value: unit.code, label: `${unit.code}／${unit.name}` }))];
  function submit(event) { event.preventDefault(); onSave(selected.code, draft); }
  return <dialog className="detail-dialog user-editor unit-master-editor" open onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><div><header><div><p className="eyebrow">UNIT DIRECTORY</p><h2>編輯單位</h2></div><button aria-label="關閉" className="close-button" onClick={onClose} type="button">×</button></header><form className="account-form user-account-form" onSubmit={submit}><div className="user-form-grid user-editor-grid"><FormCombo id="unit-master-unit" label="選擇單位" onChange={setSelectedCode} onOpenChange={setOpenCombo} open={openCombo === 'unit-master-unit'} options={unitOptions} value={selected.code} /><FormCombo id="unit-master-parent" label="上級單位" onChange={(parentCode) => setDraft((current) => ({ ...current, parentCode }))} onOpenChange={setOpenCombo} open={openCombo === 'unit-master-parent'} options={parentOptions} value={draft.parentCode} /><label>單位名稱<input onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} value={draft.name} /></label><label>單位代碼<input readOnly value={selected.code} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="user-editor-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-primary" type="submit">儲存變更</button></div></form></div></dialog>;
}

function Organization({ store, setStore }) {
  const [collapsed, setCollapsed] = useState({});
  const [isMasterOpen, setIsMasterOpen] = useState(false);
  const [masterError, setMasterError] = useState('');
  const [isPanning, setIsPanning] = useState(false);
  const [chartZoom, setChartZoom] = useState(1);
  const [edgeLayer, setEdgeLayer] = useState({ height: 0, paths: [], width: 0 });
  const chartRef = useRef(null);
  const chartSurfaceRef = useRef(null);
  const cardRefs = useRef(new Map());
  const panRef = useRef(null);
  const suppressPanClickRef = useRef(false);
  const profiles = store.unitProfiles || {};
  const unitSort = (left, right) => left.code.localeCompare(right.code, 'en', { numeric: true, sensitivity: 'base' });
  const tree = useMemo(() => {
    const units = [...new Map(store.assets.filter((asset) => asset.unitCode).map((asset) => [asset.unitCode, asset.unitName || asset.unitCode])).entries()]
      .map(([code, rawName]) => { const profile = profiles[code] || {}; return { code, rawName, name: profile.name || rawName, hasConfiguredParent: Object.prototype.hasOwnProperty.call(profile, 'parentCode'), parentCode: profile.parentCode || '' }; })
      .sort(unitSort);
    const aviationUnit = units.find((unit) => unit.rawName.includes('航務組'));
    units.forEach((unit) => { unit.defaultParentCode = !unit.hasConfiguredParent && unit.rawName.includes('消防班') && aviationUnit ? aviationUnit.code : ''; });
    const nodes = [{ id: 'root', name: '花蓮航空站', code: 'HUALIEN AIRPORT', parentId: null, virtual: true, children: [] }, ...units.map((unit) => ({ id: `unit:${unit.code}`, ...unit, parentId: null, virtual: false, children: [] }))];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    nodes.forEach((node) => { if (!node.id.startsWith('unit:')) return; const parentCode = node.parentCode || node.defaultParentCode; const requestedParent = parentCode ? `unit:${parentCode}` : 'root'; node.parentId = requestedParent !== node.id && byId.has(requestedParent) ? requestedParent : 'root'; });
    nodes.forEach((node) => { if (node.parentId) byId.get(node.parentId)?.children.push(node); });
    nodes.forEach((node) => node.children.sort(unitSort));
    const members = new Map(nodes.map((node) => [node.id, []]));
    const unassigned = [];
    store.users.forEach((user) => { const code = user.unitCode || user.unitCodes?.[0]; const bucket = code ? members.get(`unit:${code}`) : null; if (bucket) bucket.push(user); else unassigned.push(user); });
    const assetCounts = new Map();
    store.assets.forEach((asset) => asset.unitCode && assetCounts.set(asset.unitCode, (assetCounts.get(asset.unitCode) || 0) + 1));
    return { root: byId.get('root'), members, unassigned, assetCounts, units };
  }, [store.assets, store.users, profiles]);
  const chartLayout = useMemo(() => {
    if (!tree.root) return null;
    const nodes = [];
    const edges = [];
    let maxDepth = 0;
    function measure(node, depth) {
      const children = node.children.length && !collapsed[node.id] ? node.children : [];
      const metrics = children.map((child) => measure(child, depth + 1));
      const span = metrics.length ? metrics.reduce((total, child) => total + child.span, 0) : 1;
      maxDepth = Math.max(maxDepth, depth);
      return { node, depth, children: metrics, span, start: 1 };
    }
    const root = measure(tree.root, 0);
    let nextColumn = 1;
    function assign(metric) {
      metric.start = nextColumn;
      if (metric.children.length) {
        metric.children.forEach((child) => { edges.push({ from: metric.node.id, to: child.node.id }); assign(child); });
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
        '--org-level-columns': `repeat(${root.span}, ${columnWidth}px)`,
        '--org-column-gap': `${gap}px`,
        '--org-level-count': maxDepth + 1,
        '--org-row-gap': `${56 * chartZoom}px`,
        '--org-level-width': `${root.span * columnWidth + Math.max(root.span - 1, 0) * gap}px`,
        '--org-zoom': chartZoom,
      },
    };
  }, [chartZoom, collapsed, tree.root]);
  useEffect(() => {
    const canvas = chartRef.current;
    if (!canvas) return undefined;
    const frame = requestAnimationFrame(() => { canvas.scrollLeft = Math.max(0, (canvas.scrollWidth - canvas.clientWidth) / 2); });
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
      setEdgeLayer({ height: surface.scrollHeight, paths, width: surface.scrollWidth });
    };
    const frame = requestAnimationFrame(redraw);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(redraw);
    observer?.observe(surface);
    cardRefs.current.forEach((card) => observer?.observe(card));
    window.addEventListener('resize', redraw);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', redraw); };
  }, [chartLayout]);
  function saveUnitProfile(code, draft) { const visited = new Set([code]); let parentCode = draft.parentCode; while (parentCode) { if (visited.has(parentCode)) { setMasterError('無法將單位編入自己的下層單位。'); return; } visited.add(parentCode); const parent = tree.units.find((unit) => unit.code === parentCode); parentCode = parent?.parentCode || parent?.defaultParentCode || ''; } setStore((current) => ({ ...current, unitProfiles: { ...(current.unitProfiles || {}), [code]: { name: draft.name.trim(), parentCode: draft.parentCode } } })); setMasterError(''); setIsMasterOpen(false); }
  function toggle(id) { setCollapsed((current) => ({ ...current, [id]: !current[id] })); }
  function beginPan(event) { if (event.button !== 0 || !chartRef.current) return; panRef.current = { moved: false, pointerId: event.pointerId, startX: event.clientX, startScrollLeft: chartRef.current.scrollLeft }; }
  function pan(event) { const state = panRef.current; if (!state || state.pointerId !== event.pointerId || !chartRef.current) return; const delta = event.clientX - state.startX; if (!state.moved && Math.abs(delta) > 4) { state.moved = true; suppressPanClickRef.current = true; chartRef.current.setPointerCapture?.(event.pointerId); setIsPanning(true); } if (state.moved) { event.preventDefault(); chartRef.current.scrollLeft = state.startScrollLeft - delta; } }
  function endPan(event) { if (panRef.current?.pointerId !== event.pointerId) return; panRef.current = null; setIsPanning(false); }
  function suppressPanClick(event) { if (!suppressPanClickRef.current) return; event.preventDefault(); event.stopPropagation(); suppressPanClickRef.current = false; }
  function zoomChart(event) { event.preventDefault(); setChartZoom((current) => Math.min(1.5, Math.max(.65, Math.round((current + (event.deltaY < 0 ? .1 : -.1)) * 100) / 100))); }
  function renderCard(node, ref) { const members = tree.members.get(node.id) || []; const isCollapsed = collapsed[node.id]; const hasChildren = node.children.length > 0; return <article className={`org-unit-card ${node.virtual ? 'org-unit-root' : ''}`} ref={ref}><button aria-expanded={!isCollapsed} className="org-unit-toggle" disabled={!hasChildren} onClick={() => toggle(node.id)} type="button"><span className="org-unit-mark" aria-hidden="true" /><span><small>{node.code}</small><strong>{node.name}</strong><em>{node.virtual ? '組織節點' : `${tree.assetCounts.get(node.code) || 0} 筆財物`}</em></span>{hasChildren && <b aria-hidden="true">{isCollapsed ? '+' : '−'}</b>}</button>{members.length ? <div className="org-members">{members.map((member) => <div className="org-member" key={member.id}><span aria-hidden="true">{(member.name || '?').slice(0, 1)}</span><div><strong>{member.name || '未命名使用者'}</strong><small>{member.title || '未設定職稱'} · {member.roles.map((role) => roleLabels[role]).join('、')}</small></div></div>)}</div> : <p className="org-empty">尚無已編制使用者</p>}</article>; }
  function renderMobileBranch(node, depth = 0) { const expanded = node.children.length && !collapsed[node.id]; return <li className="org-mobile-node" key={node.id} style={{ '--org-depth': depth }}>{renderCard(node)}{expanded ? <ul>{node.children.map((child) => renderMobileBranch(child, depth + 1))}</ul> : null}</li>; }
  return <section className="page organization-page"><div className="page-heading"><div><p className="eyebrow">ORGANIZATION DIRECTORY</p><h1>組織管理</h1><p>結合花蓮航空站的單位階層與已建立使用者的成員編制。</p></div><button className="button button-primary" disabled={!tree.units.length} onClick={() => { setMasterError(''); setIsMasterOpen(true); }} type="button">編輯單位</button></div><section className="organization-intro"><p><strong>編制規則</strong> 同層單位一律依單位代碼排列；可在單位主檔設定顯示名稱與上層單位。消防班預設隸屬清冊中的航務組，其餘清冊單位預設為航空站直屬。</p></section>{tree.root && <section aria-label="花蓮航空站組織與成員編制" className="organization-chart"><div className="org-zoom-status"><span>滾輪縮放</span><strong>{Math.round(chartZoom * 100)}%</strong><button aria-label="還原組織圖比例" disabled={chartZoom === 1} onClick={() => setChartZoom(1)} type="button">還原</button></div><div className={`org-scroll-canvas ${isPanning ? 'is-panning' : ''}`} onPointerCancel={endPan} onPointerDown={beginPan} onPointerMove={pan} onPointerUp={endPan} onWheel={zoomChart} ref={chartRef}><div className="org-level-canvas" ref={chartSurfaceRef} style={chartLayout?.css}><svg aria-hidden="true" className="org-edge-layer" height={edgeLayer.height} viewBox={`0 0 ${edgeLayer.width} ${edgeLayer.height}`} width={edgeLayer.width}>{edgeLayer.paths.map((path, index) => <path d={path} key={`${path}-${index}`} />)}</svg>{chartLayout?.nodes.map((item) => <div className="org-level-node" key={item.node.id} style={{ gridColumn: `${item.start} / span ${item.span}`, gridRow: item.depth + 1 }}>{renderCard(item.node, (element) => { if (element) cardRefs.current.set(item.node.id, element); else cardRefs.current.delete(item.node.id); })}</div>)}</div></div><ul className="org-mobile-tree">{renderMobileBranch(tree.root)}</ul></section>}{tree.unassigned.length > 0 && <section className="org-unassigned"><header><h2>未編制使用者</h2><p>尚未設定所屬單位的使用者不會放入組織圖。</p></header><div className="org-members">{tree.unassigned.map((member) => <div className="org-member" key={member.id}><span aria-hidden="true">{(member.name || '?').slice(0, 1)}</span><div><strong>{member.name || '未命名使用者'}</strong><small>{member.title || '未設定職稱'} · {member.roles.map((role) => roleLabels[role]).join('、')}</small></div></div>)}</div></section>}{isMasterOpen && <UnitMasterDialog error={masterError} onClose={() => setIsMasterOpen(false)} onSave={saveUnitProfile} profiles={profiles} units={tree.units} />}</section>;
}

function Accounts({ store, setStore }) {
  const emptyForm = { accountCode: '', custodianCode: '', name: '', unitCode: '', title: '', email: '', password: '', roles: ['custodian'], status: 'active' };
  const [form, setForm] = useState(emptyForm); const [editingId, setEditingId] = useState(null); const [isEditorOpen, setIsEditorOpen] = useState(false); const [term, setTerm] = useState(''); const [appliedTerm, setAppliedTerm] = useState(''); const [roleFilter, setRoleFilter] = useState(''); const [statusFilter, setStatusFilter] = useState(''); const [unitFilter, setUnitFilter] = useState(''); const [openFilterId, setOpenFilterId] = useState(null); const [openEditorCombo, setOpenEditorCombo] = useState(null); const [userPage, setUserPage] = useState(1); const [userPageSize, setUserPageSize] = useState(25); const [message, setMessage] = useState(''); const [compactUserFilters, setCompactUserFilters] = useState(false); const [compactUserFiltersOpen, setCompactUserFiltersOpen] = useState(false); const userFilterSentinelRef = useRef(null);
  const profiles = store.custodianProfiles || {};
  const directory = useMemo(() => {
    const people = new Map();
    store.assets.forEach((asset) => { const code = String(asset.custodianCode || '').trim(); if (!code) return; const person = people.get(code) || { code, names: new Set(), units: new Map() }; if (asset.custodianName) person.names.add(asset.custodianName); if (asset.unitCode) person.units.set(asset.unitCode, asset.unitName || asset.unitCode); people.set(code, person); });
    return [...people.values()].map((person) => ({ ...person, names: [...person.names], displayName: profiles[person.code]?.displayName || [...person.names][0] || '', units: [...person.units.entries()] })).sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  }, [store.assets, profiles]);
  const units = useMemo(() => [...new Map(directory.flatMap((person) => person.units)).entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-Hant')), [directory]);
  const unitOptions = useMemo(() => [{ value: '', label: '全部單位' }, ...units.map(([value, label]) => ({ value, label: `${label}（${value}）` }))], [units]);
  const roleOptions = useMemo(() => [{ value: '', label: '全部權限' }, ...Object.entries(roleLabels).map(([value, label]) => ({ value, label }))], []);
  const statusOptions = useMemo(() => [{ value: '', label: '全部狀態' }, ...Object.entries({ active: '啟用', pending: '待啟用', inactive: '停用' }).map(([value, label]) => ({ value, label }))], []);
  const editorUnitOptions = [{ value: '', label: '未指定單位' }, ...((directory.find((person) => person.code === form.custodianCode)?.units || units).map(([value, label]) => ({ value, label: `${label}（${value}）` })))];
  const editorStatusOptions = statusOptions.slice(1);
  const accountOptions = [{ value: '', label: '不配對保管人' }, ...directory.map((person) => ({ value: person.code, label: `${person.code}／${person.displayName || '未提供姓名'}` }))];
  const filteredUsers = useMemo(() => store.users.filter((user) => {
    const unitCode = user.unitCode || user.unitCodes?.[0] || '';
    const unitName = units.find(([code]) => code === unitCode)?.[1] || '';
    const status = user.status || 'active';
    const statusName = statusOptions.find((option) => option.value === status)?.label || '';
    const roles = (user.roles || []).map((role) => roleLabels[role]).filter(Boolean);
    const text = [accountCodeFor(user), user.name, user.email, user.title, unitCode, unitName, status, statusName, ...roles].map(normalized).join(' ');
    return (!appliedTerm || text.includes(normalized(appliedTerm))) && (!roleFilter || user.roles.includes(roleFilter)) && (!statusFilter || status === statusFilter) && (!unitFilter || user.unitCode === unitFilter || user.unitCodes?.includes(unitFilter));
  }).sort((a, b) => accountCodeFor(a).localeCompare(accountCodeFor(b), 'en', { numeric: true })), [store.users, appliedTerm, roleFilter, statusFilter, unitFilter, units, statusOptions]);
  const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / userPageSize));
  const currentUserPage = Math.min(userPage, totalUserPages);
  const pageUsers = filteredUsers.slice((currentUserPage - 1) * userPageSize, currentUserPage * userPageSize);
  const unitLabel = (code) => units.find(([value]) => value === code)?.[1] || code || '—';
  const activeUserFilterCount = Number(Boolean(appliedTerm)) + Number(Boolean(unitFilter)) + Number(Boolean(roleFilter)) + Number(Boolean(statusFilter));
  function userHighlightTerms(field) {
    const terms = appliedTerm ? [appliedTerm] : [];
    if (field === 'unit' && unitFilter) terms.push(unitLabel(unitFilter));
    if (field === 'role' && roleFilter) terms.push(roleOptions.find((option) => option.value === roleFilter)?.label || '');
    if (field === 'status' && statusFilter) terms.push(statusOptions.find((option) => option.value === statusFilter)?.label || '');
    return terms;
  }
  useEffect(() => { const updateCompactMode = () => { if (window.innerWidth < 960 || !userFilterSentinelRef.current) return setCompactUserFilters(false); setCompactUserFilters(userFilterSentinelRef.current.getBoundingClientRect().bottom <= 0); }; updateCompactMode(); window.addEventListener('scroll', updateCompactMode, { passive: true }); window.addEventListener('resize', updateCompactMode); return () => { window.removeEventListener('scroll', updateCompactMode); window.removeEventListener('resize', updateCompactMode); }; }, []);
  useEffect(() => { const close = (event) => { if (!(event.target instanceof Element)) return; if (!event.target.closest('.user-management-panel .filter-combobox') && !event.target.closest('.compact-filter-bar .filter-combobox')) setOpenFilterId(null); if (!event.target.closest('.user-editor .filter-combobox')) setOpenEditorCombo(null); if (!event.target.closest('.compact-filter-bar')) setCompactUserFiltersOpen(false); }; document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close); }, []);
  useEffect(() => { setUserPage(1); }, [appliedTerm, roleFilter, statusFilter, unitFilter, userPageSize]);
  function clearFilters() { setTerm(''); setAppliedTerm(''); setRoleFilter(''); setStatusFilter(''); setUnitFilter(''); setOpenFilterId(null); setCompactUserFiltersOpen(false); }
  function runUserSearch() { setAppliedTerm(term.trim()); }
  function openCreate() { setEditingId(null); setForm(emptyForm); setMessage(''); setIsEditorOpen(true); }
  function openEdit(user) { const custodianCode = user.custodianCodes?.[0] || ''; setEditingId(user.id); setForm({ accountCode: accountCodeFor(user), custodianCode, name: user.name || profiles[custodianCode]?.displayName || directory.find((person) => person.code === custodianCode)?.displayName || '', unitCode: user.unitCode || user.unitCodes?.[0] || '', title: user.title || '', email: user.email || '', password: '', roles: user.roles || [], status: user.status || 'active' }); setMessage(''); setIsEditorOpen(true); }
  function setFromDirectory(code) { const person = directory.find((item) => item.code === code); setForm((current) => ({ ...current, custodianCode: code, name: profiles[code]?.displayName || person?.displayName || current.name, unitCode: person?.units[0]?.[0] || current.unitCode })); }
  function toggleRole(role) { setForm((current) => ({ ...current, roles: current.roles.includes(role) ? current.roles.filter((item) => item !== role) : [...current.roles, role] })); }
  function saveUser(event) { event.preventDefault(); if (!form.accountCode || !form.name || !form.roles.length || (!editingId && !form.password)) return setMessage('請填寫帳號、姓名、權限與初始密碼。'); if (store.users.some((user) => user.id !== editingId && accountCodeFor(user).toLowerCase() === form.accountCode.toLowerCase())) return setMessage('此帳號已由其他使用者使用。'); const existing = store.users.find((user) => user.id === editingId); const user = { ...existing, id: editingId || crypto.randomUUID(), accountCode: form.accountCode.trim(), name: form.name, unitCode: form.unitCode, unitCodes: form.unitCode ? [form.unitCode] : [], title: form.title, email: form.email, roles: form.roles, status: form.status, custodianCodes: form.custodianCode ? [form.custodianCode] : [], ...(form.password ? { password: form.password } : {}) }; setStore((current) => ({ ...current, users: editingId ? current.users.map((item) => item.id === editingId ? user : item) : [...current.users, user], custodianProfiles: form.custodianCode ? { ...(current.custodianProfiles || {}), [form.custodianCode]: { displayName: form.name.trim() } } : current.custodianProfiles || {} })); setIsEditorOpen(false); setMessage(''); }
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">USER DIRECTORY</p><h1>使用者管理</h1><p>帳號可自由建立；可選擇配對清冊保管人，並校正本系統的顯示名稱。</p></div><button className="button button-primary" onClick={openCreate} type="button">新增使用者</button></div><div aria-hidden="true" className="filter-sentinel" ref={userFilterSentinelRef} />{compactUserFilters && <div className="compact-filter-bar compact-filter-bar-fixed"><button aria-expanded={compactUserFiltersOpen} className="compact-filter-trigger" onClick={() => setCompactUserFiltersOpen((open) => !open)} type="button">篩選條件{activeUserFilterCount ? <b>{activeUserFilterCount}</b> : null}</button><label className="compact-search"><span className="sr-only">全局關鍵字搜尋</span><input value={term} onChange={(event) => setTerm(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') runUserSearch(); }} placeholder="輸入後按 Enter 搜尋…" /></label><button className="compact-clear" disabled={!activeUserFilterCount} onClick={clearFilters} type="button">清除</button>{compactUserFiltersOpen && <div className="compact-filter-popover"><div className="filter-grid"><UserFilterCombo id="compact-user-unit" label="所屬單位" value={unitFilter} options={unitOptions} open={openFilterId === 'compact-user-unit'} onChange={setUnitFilter} onOpenChange={setOpenFilterId} /><UserFilterCombo id="compact-user-role" label="權限" value={roleFilter} options={roleOptions} open={openFilterId === 'compact-user-role'} onChange={setRoleFilter} onOpenChange={setOpenFilterId} /><UserFilterCombo id="compact-user-status" label="狀態" value={statusFilter} options={statusOptions} open={openFilterId === 'compact-user-status'} onChange={setStatusFilter} onOpenChange={setOpenFilterId} /></div></div>}</div>}<section className="search-panel user-management-panel" aria-label="使用者篩選"><div className="filter-panel-heading"><div><h2>篩選條件</h2><p>依所屬單位、權限與狀態篩選，可搜尋帳號、姓名、職稱或 Email。</p></div><button className="button button-secondary filter-reset" onClick={clearFilters} type="button">清除篩選</button></div><div className="filter-grid"><UserFilterCombo id="user-unit" label="所屬單位" value={unitFilter} options={unitOptions} open={openFilterId === 'user-unit'} onChange={setUnitFilter} onOpenChange={setOpenFilterId} /><UserFilterCombo id="user-role" label="權限" value={roleFilter} options={roleOptions} open={openFilterId === 'user-role'} onChange={setRoleFilter} onOpenChange={setOpenFilterId} /><UserFilterCombo id="user-status" label="狀態" value={statusFilter} options={statusOptions} open={openFilterId === 'user-status'} onChange={setStatusFilter} onOpenChange={setOpenFilterId} /></div><div className="advanced-search user-advanced-search"><label className="search-field">全局關鍵字搜尋<input value={term} onChange={(event) => setTerm(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') runUserSearch(); }} placeholder="輸入帳號、姓名、職稱或 Email" /></label><div className="advanced-search-actions"><button className={`button button-primary search-submit ${term !== appliedTerm ? 'pending' : ''}`} onClick={runUserSearch} type="button">搜尋</button></div></div></section><div className="result-summary user-result-summary"><p className="result-count">使用者：<strong>{filteredUsers.length.toLocaleString()}</strong> 位</p><p className="directory-note">清冊已辨識 {directory.length.toLocaleString()} 位保管人</p><label className="page-size">每頁顯示<select aria-label="每頁顯示使用者數" value={userPageSize} onChange={(event) => setUserPageSize(Number(event.target.value))}><option value="25">25 筆</option><option value="50">50 筆</option><option value="100">100 筆</option></select></label><p>第 {currentUserPage}／{totalUserPages} 頁</p></div>{filteredUsers.length ? <><div className="asset-table-wrap user-table-wrap"><table className="user-table"><thead><tr><th>狀態</th><th>帳號</th><th>姓名</th><th>所屬單位</th><th>職稱</th><th>權限</th><th>Email</th><th>管理</th></tr></thead><tbody>{pageUsers.map((user) => <tr key={user.id}><td><span className={`user-status ${user.status || 'active'}`}><HighlightText value={({ active: '啟用', pending: '待啟用', inactive: '停用' })[user.status || 'active']} terms={userHighlightTerms('status')} /></span></td><td className="mono"><HighlightText value={accountCodeFor(user)} terms={userHighlightTerms('global')} /></td><td><HighlightText value={user.name || '—'} terms={userHighlightTerms('global')} /></td><td><HighlightText value={unitLabel(user.unitCode || user.unitCodes?.[0])} terms={userHighlightTerms('unit')} /></td><td><HighlightText value={user.title || '—'} terms={userHighlightTerms('global')} /></td><td><div className="role-tags">{user.roles.map((role) => <span className="role-tag" key={role}><HighlightText value={roleLabels[role]} terms={userHighlightTerms('role')} /></span>)}</div></td><td><HighlightText value={user.email || '—'} terms={userHighlightTerms('global')} /></td><td><button aria-haspopup="dialog" className="row-action" onClick={() => openEdit(user)} type="button">編輯</button></td></tr>)}</tbody></table></div>{totalUserPages > 1 && <nav className="pagination" aria-label="使用者分頁"><button className="button button-secondary" disabled={currentUserPage === 1} onClick={() => setUserPage(currentUserPage - 1)} type="button">上一頁</button><span>第 {currentUserPage}／{totalUserPages} 頁</span><button className="button button-secondary" disabled={currentUserPage === totalUserPages} onClick={() => setUserPage(currentUserPage + 1)} type="button">下一頁</button></nav>}</> : <div className="empty-state"><h2>找不到符合的使用者</h2><p>請調整篩選條件或搜尋文字。</p></div>}{isEditorOpen && <dialog open className="detail-dialog user-editor" onClick={(event) => { if (event.target === event.currentTarget) setIsEditorOpen(false); }}><div><header><div><p className="eyebrow">{editingId ? 'EDIT USER' : 'CREATE USER'}</p><h2>{editingId ? '編輯使用者' : '新增使用者'}</h2></div><button className="close-button" onClick={() => setIsEditorOpen(false)} aria-label="關閉">×</button></header><form className="account-form user-account-form" onSubmit={saveUser}><div className="user-form-grid user-editor-grid"><label>帳號<input value={form.accountCode} readOnly={Boolean(editingId)} onChange={(event) => setForm({ ...form, accountCode: event.target.value })} /></label><label>{editingId ? '修改密碼' : '初始密碼'}<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><label>姓名<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><FormCombo id="editor-custodian" label="配對保管人（選填）" value={form.custodianCode} options={accountOptions} open={openEditorCombo === 'editor-custodian'} onChange={setFromDirectory} onOpenChange={setOpenEditorCombo} /><FormCombo id="editor-unit" label="所屬單位" value={form.unitCode} options={editorUnitOptions} open={openEditorCombo === 'editor-unit'} onChange={(value) => setForm({ ...form, unitCode: value })} onOpenChange={setOpenEditorCombo} /><label>職稱<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Email（選填）<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><FormCombo id="editor-status" label="狀態" value={form.status} options={editorStatusOptions} open={openEditorCombo === 'editor-status'} onChange={(value) => setForm({ ...form, status: value })} onOpenChange={setOpenEditorCombo} /></div><fieldset><legend>權限</legend><div className="role-checks">{Object.entries(roleLabels).map(([role, label]) => <label key={role}><input type="checkbox" checked={form.roles.includes(role)} onChange={() => toggleRole(role)} /><span>{label}</span></label>)}</div></fieldset><div className="role-guidance" aria-label="權限說明">{Object.entries(roleDescriptions).map(([role, description]) => <p key={role}><strong>{roleLabels[role]}</strong><span>{description}</span></p>)}</div>{message && <p className="form-error" role="alert">{message}</p>}<footer className="user-editor-actions"><button className="button button-secondary" onClick={() => setIsEditorOpen(false)} type="button">取消</button><button className="button button-primary" type="submit">{editingId ? '儲存變更' : '新增使用者'}</button></footer></form></div></dialog>}</section>;
}

function LegacyAccounts({ store, setStore }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', custodianCodes: '', unitCodes: '', roles: ['custodian'] }); const [message, setMessage] = useState('');
  function toggleRole(role) { setForm((f) => ({ ...f, roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role] })); }
  function submit(e) { e.preventDefault(); if (!form.name || !form.email || !form.password || !form.roles.length) return setMessage('請填寫姓名、帳號、初始密碼與至少一個角色。'); if (store.users.some((u) => u.email.toLowerCase() === form.email.toLowerCase())) return setMessage('此帳號已存在。'); const user = { id: crypto.randomUUID(), ...form, custodianCodes: form.custodianCodes.split(',').map((x) => x.trim()).filter(Boolean), unitCodes: form.unitCodes.split(',').map((x) => x.trim()).filter(Boolean) }; setStore({ ...store, users: [...store.users, user] }); setForm({ name: '', email: '', password: '', custodianCodes: '', unitCodes: '', roles: ['custodian'] }); setMessage('帳號已建立。保管人可在登入後自行修改密碼。'); }
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">ACCOUNT ACCESS</p><h1>帳號與權限</h1><p>同一帳號可同時擁有保管人、單位主管與系統管理員角色。</p></div></div><div className="account-grid"><form className="account-form" onSubmit={submit}><h2>建立帳號</h2><label>姓名<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>登入帳號<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>初始密碼<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label><fieldset><legend>角色</legend><div className="role-checks">{Object.entries(roleLabels).map(([role, label]) => <label key={role}><input type="checkbox" checked={form.roles.includes(role)} onChange={() => toggleRole(role)} /><span>{label}</span></label>)}</div></fieldset><label>保管人代碼<span className="helper">多個代碼以逗號分隔</span><input value={form.custodianCodes} onChange={(e) => setForm({ ...form, custodianCodes: e.target.value })} placeholder="例如：OP23, MS22" /></label><label>主管單位代碼<span className="helper">多個代碼以逗號分隔</span><input value={form.unitCodes} onChange={(e) => setForm({ ...form, unitCodes: e.target.value })} placeholder="例如：B04" /></label><button className="button button-primary" type="submit">建立帳號</button>{message && <p className={message.startsWith('帳號已') ? 'form-success' : 'form-error'}>{message}</p>}</form><section className="user-list"><h2>現有帳號</h2>{store.users.map((account) => <article key={account.id}><div><strong>{account.name}</strong><span>{account.email}</span></div><p>{account.roles.map((role) => <span className="role-tag" key={role}><HighlightText value={roleLabels[role]} terms={userHighlightTerms('role')} /></span>)}</p><small>{account.custodianCodes?.length ? `保管人：${account.custodianCodes.join('、')}` : ''}{account.unitCodes?.length ? ` 單位：${account.unitCodes.join('、')}` : ''}</small></article>)}</section></div></section>;
}

function Password({ user, setStore }) { const [oldPassword, setOld] = useState(''); const [nextPassword, setNext] = useState(''); const [message, setMessage] = useState(''); function submit(e) { e.preventDefault(); if (oldPassword !== user.password) return setMessage('目前密碼不正確。'); if (nextPassword.length < 8) return setMessage('新密碼至少需要 8 個字元。'); setStore((store) => ({ ...store, users: store.users.map((u) => u.id === user.id ? { ...u, password: nextPassword } : u) })); user.password = nextPassword; setOld(''); setNext(''); setMessage('密碼已更新。'); } return <section className="page narrow"><div className="page-heading"><div><p className="eyebrow">PASSWORD</p><h1>修改密碼</h1><p>新密碼至少 8 個字元。帳號與角色權限仍由系統管理員管理。</p></div></div><form className="account-form" onSubmit={submit}><label>目前密碼<input type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} /></label><label>新密碼<input type="password" value={nextPassword} onChange={(e) => setNext(e.target.value)} /></label><button className="button button-primary" type="submit">更新密碼</button>{message && <p className={message === '密碼已更新。' ? 'form-success' : 'form-error'}>{message}</p>}</form></section>; }

createRoot(document.getElementById('root')).render(<App />);
