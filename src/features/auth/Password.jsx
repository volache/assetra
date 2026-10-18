import React, { useState } from "react";
import { CapsuleSpinner, useFeedback } from "../../components/FeedbackCenter";
import { changePassword } from "./api";

export function Password() {
  const [oldPassword, setOld] = useState("");
  const [nextPassword, setNext] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { run } = useFeedback();
  async function submit(e) {
    e.preventDefault();
    if (nextPassword.length < 8)
      return setMessage("新密碼至少需要 8 個字元。");
    setIsSaving(true);
    setMessage("");
    try {
      await run(async () => {
        await changePassword(oldPassword, nextPassword);
      }, {
        loading: "正在更新密碼…",
        success: "密碼已更新。",
        error: "目前密碼不正確或無法更新。",
      });
      setOld("");
      setNext("");
    } catch {
      setMessage("目前密碼不正確或無法更新。");
    } finally {
      setIsSaving(false);
    }
  }
  return (
    <section className="page narrow">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PASSWORD</p>
          <h1>修改密碼</h1>
          <p>新密碼至少需要 8 個字元。</p>
        </div>
      </div>
      <form className="account-form" onSubmit={submit}>
        <label>
          目前密碼
          <input
            type="password"
            value={oldPassword}
            onChange={(e) => setOld(e.target.value)}
          />
        </label>
        <label>
          新密碼
          <input
            type="password"
            value={nextPassword}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <button className="button button-primary" disabled={isSaving} type="submit">
          {isSaving && <CapsuleSpinner compact />}
          {isSaving ? "更新中…" : "更新密碼"}
        </button>
        {message && (
          <p
            className={
              "form-error"
            }
          >
            {message}
          </p>
        )}
      </form>
    </section>
  );
}
