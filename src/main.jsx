import React, { useEffect, useMemo, useState } from 'react';
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
  acquiredAt: ['購置日期'], unitCode: ['使用單位代碼'], unitName: ['使用單位中文'],
  locationCode: ['存置地點代碼'], locationName: ['存置地點中文'],
  custodianCode: ['保管人'], custodianName: ['保管人中文'], quantity: ['數量'],
  originalValue: ['原值'], depreciation: ['累折'], netValue: ['淨值'], usefulLife: ['年限'],
  categoryName: ['財產別名'], model: ['型式'], brand: ['廠牌'], notes: ['備註'], status: ['是否報廢'],
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
function normalizeRows(rows, sourceType) {
  return rows.filter((row) => valueOf(row, columns.assetNo)).map((row, i) => {
    const get = (field) => valueOf(row, columns[field]);
    return {
      id: `${sourceType}:${get('assetNo')}:${get('serialNo')}:${i}`,
      sourceType, assetNo: String(get('assetNo')), serialNo: String(get('serialNo')).padStart(7, '0'),
      name: String(get('name')), oldNo: String(get('oldNo') || ''), acquiredAt: rocDate(get('acquiredAt')),
      unitCode: String(get('unitCode') || ''), unitName: String(get('unitName') || ''),
      locationCode: String(get('locationCode') || ''), locationName: String(get('locationName') || ''),
      custodianCode: String(get('custodianCode') || ''), custodianName: String(get('custodianName') || ''),
      quantity: get('quantity'), originalValue: get('originalValue'), depreciation: get('depreciation'), netValue: get('netValue'),
      usefulLife: get('usefulLife'), categoryName: String(get('categoryName') || ''), model: String(get('model') || ''),
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
  useEffect(() => saveStore(store), [store]);
  if (!session) return <Login users={store.users} onLogin={setSession} />;
  return <Portal store={store} setStore={setStore} user={session} page={page} setPage={setPage} onLogout={() => setSession(null)} />;
}

function Login({ users, onLogin }) {
  const [email, setEmail] = useState('admin@example.local'); const [password, setPassword] = useState('Admin@1234'); const [error, setError] = useState('');
  function submit(e) { e.preventDefault(); const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password); if (user) onLogin(user); else setError('帳號或密碼不正確，請重新輸入。'); }
  return <main className="login-shell"><section className="login-intro"><p className="eyebrow">INTERNAL ASSET LEDGER</p><h1>讓每件財物<br />都有清楚去向。</h1><p>管理者匯入清冊。保管人登入後，只會看到自己負責的資料。</p><div className="intro-mark" aria-hidden="true"><span /><span /><span /></div></section><section className="login-panel"><div><p className="eyebrow">登入系統</p><h2>財物清冊</h2><p className="muted">此為本機原型。管理者可先使用預設帳號登入。</p></div><form onSubmit={submit}><label>帳號<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" /></label><label>密碼<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" type="submit">登入</button></form><div className="credential-note"><strong>管理者示範帳號</strong><span>admin@example.local ／ Admin@1234</span></div></section></main>;
}

function Portal({ store, setStore, user, page, setPage, onLogout }) {
  const canAdmin = user.roles.includes('admin'); const canChief = user.roles.includes('chief');
  const visible = useMemo(() => allowedAssets(store.assets, user), [store.assets, user]);
  const navigation = [{ id: 'home', label: '總覽' }, { id: 'query', label: '查詢財物' }, ...(canAdmin ? [{ id: 'import', label: '匯入清冊' }, { id: 'accounts', label: '帳號與權限' }] : []), { id: 'password', label: '修改密碼' }];
  return <div className="app-shell"><aside className="side-nav"><div className="brand"><span className="brand-dot" />財物清冊</div><nav aria-label="主要功能">{navigation.map((item) => <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.id)}>{item.label}</button>)}</nav><div className="side-user"><span>{user.name}</span><small>{user.roles.map((role) => roleLabels[role]).join('、')}</small><button className="text-button" onClick={onLogout}>登出</button></div></aside><main className="main-area"><header className="mobile-header"><div className="brand"><span className="brand-dot" />財物清冊</div><button className="text-button" onClick={onLogout}>登出</button></header>{page === 'home' && <Home visible={visible} user={user} imports={store.imports} setPage={setPage} canAdmin={canAdmin} canChief={canChief} />}{page === 'query' && <Query assets={visible} />}{page === 'import' && canAdmin && <Import store={store} setStore={setStore} />}{page === 'accounts' && canAdmin && <Accounts store={store} setStore={setStore} />}{page === 'password' && <Password user={user} setStore={setStore} />}</main></div>;
}

function Home({ visible, user, imports, setPage, canAdmin, canChief }) {
  const totalValue = visible.reduce((sum, a) => sum + (Number(a.netValue) || 0), 0); const ownCount = visible.filter((a) => user.custodianCodes?.includes(a.custodianCode)).length;
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">ROLE-BASED VIEW</p><h1>你好，{user.name}</h1><p>這裡只顯示你目前角色可查看與處理的資料。</p></div><button className="button button-secondary" onClick={() => setPage('query')}>查詢財物</button></div><div className="bento"><article className="bento-cell bento-wide"><p className="eyebrow">可查詢財物</p><strong>{visible.length.toLocaleString()} <small>筆</small></strong><p>{canAdmin ? '目前已匯入的全部清冊資料。' : canChief ? '包含你所屬單位與你個人保管的資料。' : '依保管人代碼篩選。'}</p></article><article className="bento-cell bento-value"><p className="eyebrow">淨值合計</p><strong>NT$ {money(totalValue)}</strong><p>依目前可見範圍計算</p></article><article className="bento-cell bento-action"><p className="eyebrow">快速開始</p><h2>{visible.length ? '從名稱或編號開始找' : '先匯入一份清冊'}</h2><button className="text-link" onClick={() => setPage(visible.length ? 'query' : 'import')}>{visible.length ? '開啟查詢 →' : '前往匯入 →'}</button></article><article className="bento-cell bento-small"><p className="eyebrow">我保管的財物</p><strong>{ownCount.toLocaleString()}</strong><p>筆資料</p></article><article className="bento-cell bento-import"><p className="eyebrow">最近匯入</p><h2>{imports[0] ? imports[0].fileName : '尚未匯入'}</h2><p>{imports[0] ? `${imports[0].count.toLocaleString()} 筆 · ${imports[0].at}` : '請由系統管理員上傳 Excel。'}</p></article></div></section>;
}

function Query({ assets }) {
  const [term, setTerm] = useState(''); const [source, setSource] = useState('all'); const [detail, setDetail] = useState(null);
  const rows = assets.filter((a) => (source === 'all' || a.sourceType === source) && `${a.assetNo} ${a.serialNo} ${a.name} ${a.oldNo} ${a.model} ${a.brand} ${a.locationName}`.toLowerCase().includes(term.toLowerCase()));
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">ASSET SEARCH</p><h1>查詢財物</h1><p>可依財產編號、名稱、型式、廠牌或存置地點查詢。</p></div></div><div className="search-panel"><label className="search-field">搜尋<input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="例如：財產編號、名稱或地點" /></label><fieldset><legend>資料類型</legend><div className="segmented">{[['all', '全部'], ['asset', '財產'], ['item', '物品']].map(([value, label]) => <label key={value}><input type="radio" checked={source === value} onChange={() => setSource(value)} /><span>{label}</span></label>)}</div></fieldset></div><p className="result-count">共 <strong>{rows.length.toLocaleString()}</strong> 筆符合資料</p>{rows.length ? <div className="asset-table-wrap"><table><thead><tr><th>類型</th><th>財產編號</th><th>名稱</th><th>保管人</th><th>存置地點</th><th>淨值</th><th><span className="sr-only">檢視</span></th></tr></thead><tbody>{rows.map((a) => <tr key={a.id}><td><span className={`source-tag ${a.sourceType}`}>{sourceLabels[a.sourceType]}</span></td><td className="mono">{a.assetNo}<small>{a.serialNo}</small></td><td>{a.name}<small>{a.model || a.brand || '—'}</small></td><td>{a.custodianName || '未指定'}<small>{a.custodianCode || '—'}</small></td><td>{a.locationName || '—'}</td><td className="money">{money(a.netValue)}</td><td><button className="row-action" onClick={() => setDetail(a)}>明細</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><h2>目前沒有符合的資料</h2><p>{assets.length ? '請調整搜尋文字或資料類型。' : '尚未匯入可供查詢的清冊。'}</p></div>}{detail && <AssetDialog asset={detail} onClose={() => setDetail(null)} />}</section>;
}

function AssetDialog({ asset, onClose }) { return <dialog open className="detail-dialog" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}><div><header><div><p className="eyebrow">{sourceLabels[asset.sourceType]}</p><h2>{asset.name}</h2></div><button className="close-button" onClick={onClose} aria-label="關閉">×</button></header><dl>{[['財產編號', asset.assetNo], ['流水號', asset.serialNo], ['保管人', `${asset.custodianName || '—'} ${asset.custodianCode ? `(${asset.custodianCode})` : ''}`], ['使用單位', asset.unitName], ['存置地點', asset.locationName], ['購置日期', asset.acquiredAt], ['原值', money(asset.originalValue)], ['累折', money(asset.depreciation)], ['淨值', money(asset.netValue)], ['型式／廠牌', [asset.model, asset.brand].filter(Boolean).join(' ／ ') || '—'], ['備註', asset.notes || '—']].map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{value || '—'}</dd></React.Fragment>)}</dl></div></dialog>; }

function Import({ store, setStore }) {
  const [file, setFile] = useState(null); const [sourceType, setSourceType] = useState('asset'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function importFile(e) { e.preventDefault(); if (!file) return setMessage('請先選擇 Excel 檔案。'); setBusy(true); try { const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' }); const first = workbook.Sheets[workbook.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(first, { defval: '' }); const records = normalizeRows(rows, sourceType); if (!records.length) throw new Error('找不到「財產編號」欄位或有效資料列。'); const keys = new Set(records.map((r) => `${r.sourceType}:${r.assetNo}:${r.serialNo}`)); const retained = store.assets.filter((r) => !keys.has(`${r.sourceType}:${r.assetNo}:${r.serialNo}`)); const at = new Date().toLocaleString('zh-TW', { hour12: false }); setStore({ ...store, assets: [...retained, ...records], imports: [{ fileName: file.name, sourceType, count: records.length, at }, ...store.imports] }); setMessage(`已完成匯入 ${records.length.toLocaleString()} 筆資料。相同類型、財產編號與流水號的既有資料已更新。`); } catch (error) { setMessage(error.message || '匯入失敗，請確認檔案格式。'); } finally { setBusy(false); } }
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
