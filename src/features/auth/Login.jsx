import React, { useState } from "react";

export function Login({ isLoading, onLogin }) {
  const [accountCode, setAccountCode] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const showLoading = isLoading || isSubmitting;
  async function submit(e) {
    e.preventDefault();
    if (showLoading) return;
    setError("");
    setIsSubmitting(true);
    try {
      await onLogin(accountCode, password);
    } catch {
      setError("帳號或密碼不正確，或帳號尚未啟用。");
      setIsSubmitting(false);
    }
  }
  return (
    <main className={`login-shell ${showLoading ? "is-loading" : ""}`}>
      <section className="login-intro">
        <p className="eyebrow">ASSETRA</p>
        <h1>
          讓每件財物
          <br />
          都有清楚去向。
        </h1>
        <p>管理者匯入清冊。保管人登入後，只會看到自己負責的資料。</p>
        <div className="intro-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
      <section className="login-panel">
        <div>
          <p className="eyebrow">登入系統</p>
          <h2>Assetra</h2>
          <p className="muted">請使用系統帳號登入。</p>
        </div>
        <form onSubmit={submit}>
          <label>
            帳號
            <input
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              type="text"
              autoComplete="username"
            />
          </label>
          <label>
            密碼
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button button-primary"
            disabled={showLoading}
            type="submit"
          >
            登入
          </button>
        </form>
      </section>
      <div className="session-loader" aria-live="polite">
        <div className="session-loader-pills" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <strong>正在載入工作區</strong>
      </div>
    </main>
  );
}
