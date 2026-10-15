# Assetra：GitHub Pages 部署

此工作流程在 `main` 推送後，將 Vite 產物部署到 GitHub Pages 專案網站。

## 預期網址

儲存庫改名為 `assetra` 後，網址為：

```
https://volache.github.io/assetra/
```

## GitHub 設定

1. 到 **Settings → Pages**，將 Source 設為 **GitHub Actions**。
2. 到 **Settings → Secrets and variables → Actions** 建立下列 repository secrets：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_MAPBOX_TOKEN`（若要啟用地理圖資）
3. 確認 `main` 受到分支保護，只有審核後的變更可以合併並部署。

`VITE_` 變數會被編譯到瀏覽器程式，因此只能放公開值；絕不可將 Supabase Service Role Key 放入 Actions secret 或前端程式。

## Supabase 設定

在 Supabase Auth URL Configuration 加入：

```
https://volache.github.io/assetra/**
```

並將每個 Edge Function 的 CORS allowed origins 加入：

```
https://volache.github.io
```

目前 Edge Functions 僅允許 localhost；上列 CORS 調整必須在第一次公開測試前完成。

## 重要限制

GitHub Free 的 GitHub Pages 適用於公開儲存庫。若維持目前的私有儲存庫，需升級 GitHub 方案或改採另一個部署平台；請勿在未確認前將儲存庫改為公開。
