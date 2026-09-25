import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import './styles.css';

const STORE = 'asset-ledger-prototype-v1';
const initialUsers = [
  { id: 'admin', name: '系統管理員', email: 'admin@example.local', password: 'Admin@1234', roles: ['admin'] },
  { id: 'chief-b04', name: '單位主管示範', email: 'chief@example.local', password: 'Chief@1234', roles: ['chief'], unitCodes: ['B04'] },
  { id: 'custodian-op23', name: '保管人示範', email: 'keeper@example.local', password: 'Keeper@1234', roles: ['custodian'], custodianCodes: ['OP23'] },
];

const sourceLabels = { asset: '財產清冊', item: '物品清冊' };
const roleLabels = { custodian: '保管人', chief: '單位主管', admin: '系統管理員' };
const columns = {
  assetNo: ['財產編號'], serialNo: ['流水號'], name: ['中文名稱'], oldNo: ['OLDNUMBER'],
  acquiredAt: ['購置日期'], unitCode: ['保管單位代碼'], unitName: ['保管單位中文'], useUnitName: ['使用單位中文'],
  locationCode: ['存置地點代碼'], locationName: ['存置地點中文'],
  custodianCode: ['保管人'], custodianName: ['保管人中文'], userCode: ['使用人'], userName: ['使用人中文'], quantity: ['數量'], measureUnit: ['單位'],
  originalValue: ['原值'], depreciation: ['累折'], netValue: ['淨值'], usefulLife: ['年限'],
  categoryName: ['財產別名'], categoryType: ['區分別中文', '區分別'], model: ['型式', '型試'], brand: ['廠牌'], notes: ['備註'], status: ['是否報廢'],
};

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE)) || { users: initialUsers, assets: [], imports: [] }; }
  catch { return { users: initialUsers, assets: [], imports: [] }; }
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
  function submit(e) { e.preventDefault(); if (isLoading) return; const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password); if (user) onLogin(user); else setError('帳號或密碼不正確，請重新輸入。'); }
  return <main className={`login-shell ${isLoading ? 'is-loading' : ''}`}><section className="login-intro"><p className="eyebrow">INTERNAL ASSET LEDGER</p><h1>讓每件財物<br />都有清楚去向。</h1><p>管理者匯入清冊。保管人登入後，只會看到自己負責的資料。</p><div className="intro-mark" aria-hidden="true"><span /><span /><span /></div></section><section className="login-panel"><div><p className="eyebrow">登入系統</p><h2>財物清冊</h2><p className="muted">此為本機原型。管理者可先使用預設帳號登入。</p></div><form onSubmit={submit}><label>帳號<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" /></label><label>密碼<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={isLoading} type="submit">登入</button></form><div className="credential-note"><strong>管理者示範帳號</strong><span>admin@example.local ／ Admin@1234</span></div></section><div className="session-loader" aria-live="polite" aria-label="正在載入系統工作區"><div className="session-loader-pills" aria-hidden="true"><span /><span /><span /></div><strong>正在載入工作區</strong><small>準備財物清冊資料</small></div></main>;
}

function Portal({ entering, leaving, store, setStore, user, page, setPage, onLogout }) {
  const canAdmin = user.roles.includes('admin'); const canChief = user.roles.includes('chief');
  const visible = useMemo(() => allowedAssets(store.assets, user), [store.assets, user]);
  const previousPage = useRef(page);
  const isPageSwitch = previousPage.current !== page;
  useEffect(() => { previousPage.current = page; }, [page]);
  const navigation = [{ id: 'home', label: '總覽' }, { id: 'query', label: '財物查詢' }, ...(canAdmin ? [{ id: 'import', label: '匯入清冊' }, { id: 'accounts', label: '帳號與權限' }] : []), { id: 'password', label: '修改密碼' }];
  return <div className={`app-shell ${entering ? 'is-entering' : ''} ${leaving ? 'is-leaving' : ''}`}><aside className="side-nav"><div className="brand"><span className="brand-dot" />財物清冊</div><nav aria-label="主要功能">{navigation.map((item) => <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.id)}>{item.label}</button>)}</nav><div className="side-user"><span>{user.name}</span><small>{user.roles.map((role) => roleLabels[role]).join('、')}</small><button className="text-button" onClick={onLogout}>登出</button></div></aside><main className="main-area"><header className="mobile-header"><div className="brand"><span className="brand-dot" />財物清冊</div><button className="text-button" onClick={onLogout}>登出</button></header><div className={`page-transition ${isPageSwitch ? 'is-switching' : ''}`} key={page}>{page === 'home' && <Home visible={visible} user={user} imports={store.imports} setPage={setPage} canAdmin={canAdmin} canChief={canChief} />}{page === 'query' && <Query assets={visible} imports={store.imports} />}{page === 'import' && canAdmin && <Import store={store} setStore={setStore} />}{page === 'accounts' && canAdmin && <Accounts store={store} setStore={setStore} />}{page === 'password' && <Password user={user} setStore={setStore} />}</div></main></div>;
}

function Home({ visible, user, imports, setPage, canAdmin, canChief }) {
  const totalValue = visible.reduce((sum, a) => sum + (Number(a.netValue) || 0), 0); const ownCount = visible.filter((a) => user.custodianCodes?.includes(a.custodianCode)).length;
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

function Import({ store, setStore }) {
  const [file, setFile] = useState(null); const [sourceType, setSourceType] = useState('asset'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function importFile(e) { e.preventDefault(); if (!file) return setMessage('請先選擇 Excel 檔案。'); setBusy(true); try { const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' }); const first = workbook.Sheets[workbook.SheetNames[0]]; const records = normalizeRows(readWorksheetRows(first), sourceType); if (!records.length) throw new Error('找不到「財產編號」欄位或有效資料列。'); const keys = new Set(records.map((r) => `${r.sourceType}:${r.assetNo}:${r.serialNo}`)); const retained = store.assets.filter((r) => !keys.has(`${r.sourceType}:${r.assetNo}:${r.serialNo}`)); const at = new Date().toLocaleString('zh-TW', { hour12: false }); setStore({ ...store, assets: [...retained, ...records], imports: [{ fileName: file.name, sourceType, count: records.length, at }, ...store.imports] }); setMessage(`已完成匯入 ${records.length.toLocaleString()} 筆資料。相同類型、財產編號與流水號的既有資料已更新。`); } catch (error) { setMessage(error.message || '匯入失敗，請確認檔案格式。'); } finally { setBusy(false); } }
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">IMPORT REGISTER</p><h1>匯入清冊</h1><p>上傳一份 Excel，系統會以資料類型、財產編號與流水號更新資料。</p></div></div><form className="import-form" onSubmit={importFile}><fieldset><legend>清冊類型</legend><div className="source-options">{Object.entries(sourceLabels).map(([value, label]) => <label key={value}><input type="radio" checked={sourceType === value} onChange={() => setSourceType(value)} /><span><strong>{label}</strong><small>{value === 'asset' ? '含原值、累折與淨值' : '通常不含折舊資料'}</small></span></label>)}</div></fieldset><label className="file-field">Excel 檔案<input type="file" accept=".xlsx,.xls,.xlsm" onChange={(e) => setFile(e.target.files?.[0] || null)} /><span>{file ? file.name : '選擇 .xlsx、.xls 或 .xlsm 檔案'}</span></label><button className="button button-primary" disabled={busy} type="submit">{busy ? '正在匯入…' : '開始匯入'}</button>{message && <p className={message.startsWith('已完成') ? 'form-success' : 'form-error'} role="status">{message}</p>}</form><section className="import-history"><h2>匯入紀錄</h2>{store.imports.length ? <ul>{store.imports.map((entry, i) => <li key={`${entry.at}-${i}`}><span className={`source-tag ${entry.sourceType}`}>{sourceLabels[entry.sourceType]}</span><strong>{entry.fileName}</strong><span>{entry.count.toLocaleString()} 筆</span><time>{entry.at}</time></li>)}</ul> : <p className="muted">尚無匯入紀錄。</p>}</section></section>;
}

function Accounts({ store, setStore }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', custodianCodes: '', unitCodes: '', roles: ['custodian'] }); const [message, setMessage] = useState('');
  function toggleRole(role) { setForm((f) => ({ ...f, roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role] })); }
  function submit(e) { e.preventDefault(); if (!form.name || !form.email || !form.password || !form.roles.length) return setMessage('請填寫姓名、帳號、初始密碼與至少一個角色。'); if (store.users.some((u) => u.email.toLowerCase() === form.email.toLowerCase())) return setMessage('此帳號已存在。'); const user = { id: crypto.randomUUID(), ...form, custodianCodes: form.custodianCodes.split(',').map((x) => x.trim()).filter(Boolean), unitCodes: form.unitCodes.split(',').map((x) => x.trim()).filter(Boolean) }; setStore({ ...store, users: [...store.users, user] }); setForm({ name: '', email: '', password: '', custodianCodes: '', unitCodes: '', roles: ['custodian'] }); setMessage('帳號已建立。保管人可在登入後自行修改密碼。'); }
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">ACCOUNT ACCESS</p><h1>帳號與權限</h1><p>同一帳號可同時擁有保管人、單位主管與系統管理員角色。</p></div></div><div className="account-grid"><form className="account-form" onSubmit={submit}><h2>建立帳號</h2><label>姓名<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>登入帳號<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>初始密碼<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label><fieldset><legend>角色</legend><div className="role-checks">{Object.entries(roleLabels).map(([role, label]) => <label key={role}><input type="checkbox" checked={form.roles.includes(role)} onChange={() => toggleRole(role)} /><span>{label}</span></label>)}</div></fieldset><label>保管人代碼<span className="helper">多個代碼以逗號分隔</span><input value={form.custodianCodes} onChange={(e) => setForm({ ...form, custodianCodes: e.target.value })} placeholder="例如：OP23, MS22" /></label><label>主管單位代碼<span className="helper">多個代碼以逗號分隔</span><input value={form.unitCodes} onChange={(e) => setForm({ ...form, unitCodes: e.target.value })} placeholder="例如：B04" /></label><button className="button button-primary" type="submit">建立帳號</button>{message && <p className={message.startsWith('帳號已') ? 'form-success' : 'form-error'}>{message}</p>}</form><section className="user-list"><h2>現有帳號</h2>{store.users.map((account) => <article key={account.id}><div><strong>{account.name}</strong><span>{account.email}</span></div><p>{account.roles.map((role) => <span className="role-tag" key={role}>{roleLabels[role]}</span>)}</p><small>{account.custodianCodes?.length ? `保管人：${account.custodianCodes.join('、')}` : ''}{account.unitCodes?.length ? ` 單位：${account.unitCodes.join('、')}` : ''}</small></article>)}</section></div></section>;
}

function Password({ user, setStore }) { const [oldPassword, setOld] = useState(''); const [nextPassword, setNext] = useState(''); const [message, setMessage] = useState(''); function submit(e) { e.preventDefault(); if (oldPassword !== user.password) return setMessage('目前密碼不正確。'); if (nextPassword.length < 8) return setMessage('新密碼至少需要 8 個字元。'); setStore((store) => ({ ...store, users: store.users.map((u) => u.id === user.id ? { ...u, password: nextPassword } : u) })); user.password = nextPassword; setOld(''); setNext(''); setMessage('密碼已更新。'); } return <section className="page narrow"><div className="page-heading"><div><p className="eyebrow">PASSWORD</p><h1>修改密碼</h1><p>新密碼至少 8 個字元。帳號與角色權限仍由系統管理員管理。</p></div></div><form className="account-form" onSubmit={submit}><label>目前密碼<input type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} /></label><label>新密碼<input type="password" value={nextPassword} onChange={(e) => setNext(e.target.value)} /></label><button className="button button-primary" type="submit">更新密碼</button>{message && <p className={message === '密碼已更新。' ? 'form-success' : 'form-error'}>{message}</p>}</form></section>; }

createRoot(document.getElementById('root')).render(<App />);
