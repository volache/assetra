import React, { useState } from "react";
import { supabase } from "../../supabase";

export function Password() {
  const [oldPassword, setOld] = useState("");
  const [nextPassword, setNext] = useState("");
  const [message, setMessage] = useState("");
  async function submit(e) {
    e.preventDefault();
    if (nextPassword.length < 12)
      return setMessage("新密碼至少需要 12 個字元。");
    const { error } = await supabase.auth.updateUser({
      password: nextPassword,
      current_password: oldPassword,
    });
    if (error) return setMessage("目前密碼不正確或無法更新。");
    setOld("");
    setNext("");
    setMessage("密碼已更新。");
  }
  return (
    <section className="page narrow">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PASSWORD</p>
          <h1>修改密碼</h1>
          <p>新密碼至少需要 12 個字元。</p>
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
        <button className="button button-primary" type="submit">
          更新密碼
        </button>
        {message && (
          <p
            className={
              message === "密碼已更新。" ? "form-success" : "form-error"
            }
          >
            {message}
          </p>
        )}
      </form>
    </section>
  );
}
