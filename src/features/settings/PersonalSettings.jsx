import React, { useEffect, useState } from "react";
import { CapsuleSpinner, useFeedback } from "../../components/FeedbackCenter";
import { supabase } from "../../supabase";

async function requestSettings(method, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-ai-settings`, { method, headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "無法更新設定。");
  return result;
}

export function PersonalSettings() {
  const [key, setKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const { notify } = useFeedback();
  useEffect(() => { requestSettings("GET").then((result) => { setConfigured(result.configured); setGeminiModel(result.model || ""); }).catch(() => {}); }, []);
  async function save(event) { event.preventDefault(); setBusy(true); try { const result = await requestSettings("POST", { geminiApiKey: key, geminiModel }); setConfigured(result.configured); setGeminiModel(result.model || geminiModel); setKey(""); notify("智慧查詢設定已儲存。"); } catch (error) { notify(error instanceof Error ? error.message : "設定失敗。", "error"); } finally { setBusy(false); } }
  async function updatePassword(event) { event.preventDefault(); if (nextPassword.length < 8) return notify("新密碼至少需要 8 個字元。", "error"); setPasswordBusy(true); try { const { error } = await supabase.auth.updateUser({ password: nextPassword, current_password: oldPassword }); if (error) throw error; setOldPassword(""); setNextPassword(""); notify("密碼已更新。"); } catch { notify("目前密碼不正確或無法更新。", "error"); } finally { setPasswordBusy(false); } }
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">PERSONAL SETTINGS</p><h1>個人設定</h1><p>管理智慧查詢服務與登入密碼。</p></div></div><div className="personal-settings-grid"><form className="account-form" onSubmit={updatePassword}><h2>修改密碼</h2><label>目前密碼<input onChange={(event) => setOldPassword(event.target.value)} type="password" value={oldPassword} /></label><label>新密碼<input onChange={(event) => setNextPassword(event.target.value)} type="password" value={nextPassword} /></label><p className="helper">新密碼至少需要 8 個字元。</p><button className="button button-primary" disabled={passwordBusy} type="submit">{passwordBusy && <CapsuleSpinner compact />}{passwordBusy ? "更新中…" : "更新密碼"}</button></form><form className="account-form" onSubmit={save}><h2>智慧查詢設定</h2><label>Gemini API Key<input className="gemini-key-input" autoComplete="off" onChange={(event) => setKey(event.target.value)} placeholder={configured ? "已儲存；輸入新的 API Key 即可更換" : "請輸入 Gemini API Key"} type="password" value={key} /></label><label>Gemini 模型<input className="gemini-key-input" autoComplete="off" onChange={(event) => setGeminiModel(event.target.value)} placeholder="gemini-flash-lite-latest" value={geminiModel} /></label><p className="helper">請勿分享 API Key。模型名稱請填入 Google AI Studio 提供的文字模型；留白時使用系統預設。</p><button className="button button-primary" disabled={busy} type="submit">{busy && <CapsuleSpinner compact />}{busy ? "儲存中…" : "儲存智慧查詢設定"}</button>{configured && <button className="button button-secondary" disabled={busy} onClick={() => { setKey(""); requestSettings("POST", { removeKey: true }).then(() => { setConfigured(false); setGeminiModel(""); notify("Gemini API Key 已移除。"); }).catch((error) => notify(error instanceof Error ? error.message : "設定失敗。", "error")); }} type="button">移除 API Key</button>}</form></div></section>;
}
