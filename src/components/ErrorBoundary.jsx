import React from "react";

// Keeps one failing screen from blanking the whole app.  A page-level boundary is
// remounted on every page switch (the parent keys it by page), so moving to another
// page always recovers; "重新載入" covers the case where a lazy chunk failed to load.
export class ErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Screen failed to render:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="page">
        <div className="empty-state" role="alert">
          <h2>這個畫面暫時無法顯示</h2>
          <p>請重新載入頁面；若問題持續發生，請改用左側選單切換到其他功能，並通知管理員。</p>
          <button
            className="button button-primary"
            onClick={() => window.location.reload()}
            type="button"
          >
            重新載入
          </button>
        </div>
      </section>
    );
  }
}
