import React, { useEffect, useState } from "react";
import { money } from "../../lib/formatters";

function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const finalValue = Math.max(0, Number(target) || 0);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setValue(finalValue);
      return undefined;
    }
    const startedAt = performance.now();
    let frame;
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setValue(finalValue * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    setValue(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

function HomeMetrics({
  canAdmin,
  canChief,
  imports,
  ownCount,
  setPage,
  totalValue,
  user,
  visible,
}) {
  const assetCount = Math.round(useCountUp(visible.length));
  const netValue = Math.round(useCountUp(totalValue));
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ROLE-BASED VIEW</p>
          <h1>你好，{user.name}</h1>
          <p>這裡只顯示你目前角色可查看與處理的資料。</p>
        </div>
        <button
          className="button button-secondary"
          onClick={() => setPage("query")}
        >
          查詢財物
        </button>
      </div>
      <div className="bento">
        <article className="bento-cell bento-wide">
          <p className="eyebrow">可查詢財物</p>
          <strong aria-label={`${visible.length.toLocaleString()} 筆`}>
            {assetCount.toLocaleString()} <small>筆</small>
          </strong>
          <p>
            {canAdmin
              ? "目前已匯入的全部清冊資料。"
              : canChief
                ? "包含你所屬單位與你個人保管的資料。"
                : "依保管人代碼篩選。"}
          </p>
        </article>
        <article className="bento-cell bento-value">
          <p className="eyebrow">淨值合計</p>
          <strong aria-label={`NT$ ${money(totalValue)}`}>
            NT$ {money(netValue)}
          </strong>
          <p>依目前可見範圍計算</p>
        </article>
        <article className="bento-cell bento-action">
          <p className="eyebrow">快速開始</p>
          <h2>{visible.length ? "從名稱或編號開始找" : "先匯入一份清冊"}</h2>
          <button
            className="text-link"
            onClick={() => setPage(visible.length ? "query" : "import")}
          >
            {visible.length ? "開啟查詢 →" : "前往匯入 →"}
          </button>
        </article>
        <article className="bento-cell bento-small">
          <p className="eyebrow">我保管的財物</p>
          <strong>{ownCount.toLocaleString()}</strong>
          <p>筆資料</p>
        </article>
        <article className="bento-cell bento-import">
          <p className="eyebrow">最近匯入</p>
          <h2>{imports[0] ? imports[0].fileName : "尚未匯入"}</h2>
          <p>
            {imports[0]
              ? `${imports[0].count.toLocaleString()} 筆 · ${imports[0].at}`
              : "請由系統管理員上傳 Excel。"}
          </p>
        </article>
      </div>
    </section>
  );
}

export function Home({ visible, user, imports, setPage, canAdmin, canChief }) {
  const totalValue = visible.reduce(
    (sum, a) => sum + (Number(a.netValue) || 0),
    0,
  );
  const ownCount = visible.filter((a) =>
    user.custodianCodes?.includes(a.custodianCode),
  ).length;
  return (
    <HomeMetrics
      canAdmin={canAdmin}
      canChief={canChief}
      imports={imports}
      ownCount={ownCount}
      setPage={setPage}
      totalValue={totalValue}
      user={user}
      visible={visible}
    />
  );
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ROLE-BASED VIEW</p>
          <h1>你好，{user.name}</h1>
          <p>這裡只顯示你目前角色可查看與處理的資料。</p>
        </div>
        <button
          className="button button-secondary"
          onClick={() => setPage("query")}
        >
          查詢財物
        </button>
      </div>
      <div className="bento">
        <article className="bento-cell bento-wide">
          <p className="eyebrow">可查詢財物</p>
          <strong>
            {visible.length.toLocaleString()} <small>筆</small>
          </strong>
          <p>
            {canAdmin
              ? "目前已匯入的全部清冊資料。"
              : canChief
                ? "包含你所屬單位與你個人保管的資料。"
                : "依保管人代碼篩選。"}
          </p>
        </article>
        <article className="bento-cell bento-value">
          <p className="eyebrow">淨值合計</p>
          <strong>NT$ {money(totalValue)}</strong>
          <p>依目前可見範圍計算</p>
        </article>
        <article className="bento-cell bento-action">
          <p className="eyebrow">快速開始</p>
          <h2>{visible.length ? "從名稱或編號開始找" : "先匯入一份清冊"}</h2>
          <button
            className="text-link"
            onClick={() => setPage(visible.length ? "query" : "import")}
          >
            {visible.length ? "開啟查詢 →" : "前往匯入 →"}
          </button>
        </article>
        <article className="bento-cell bento-small">
          <p className="eyebrow">我保管的財物</p>
          <strong>{ownCount.toLocaleString()}</strong>
          <p>筆資料</p>
        </article>
        <article className="bento-cell bento-import">
          <p className="eyebrow">最近匯入</p>
          <h2>{imports[0] ? imports[0].fileName : "尚未匯入"}</h2>
          <p>
            {imports[0]
              ? `${imports[0].count.toLocaleString()} 筆 · ${imports[0].at}`
              : "請由系統管理員上傳 Excel。"}
          </p>
        </article>
      </div>
    </section>
  );
}
