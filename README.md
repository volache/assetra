# Assetra 財產管理系統

Assetra 是財產與物品清冊管理前端，提供依角色授權的查詢、Excel 匯入、協作追蹤、地籍圖資、權狀文件、財物照片與使用者管理。

## 技術與資料保存

- 前端：Vite、React、Mapbox GL 與 SheetJS (`xlsx`)。
- 正式資料：Supabase Auth、Postgres、RLS 與 Edge Functions。清冊、匯入批次、帳號、協作、地籍與文件索引皆儲存在 Supabase。
- 瀏覽器 Local Storage：只保留保管人／單位的顯示設定；不保存帳號、清冊或匯入資料。
- 文件與照片：Edge Functions 以短效簽章網址存取設定好的 R2 bucket；請勿將原始清冊或權狀置於 `public/` 或 `src/`。

## 本機執行

1. 複製 `.env.example` 為 `.env`，填入 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`；使用地圖時另填 `VITE_MAPBOX_TOKEN`。
2. 安裝並啟動：

   ```powershell
   npm install
   npm run dev
   ```

3. 開啟終端機顯示的網址。Vite 會將 `/functions/v1` 代理至設定的 Supabase 專案。

## Supabase 部署

先依序套用 `supabase/migrations/`，不要在既有資料庫重新執行 `supabase/schema.sql`。後者是完整 schema 參考檔。

部署下列 Edge Functions：

```text
import-inventory
manage-users
manage-collaborations
manage-asset-photos
manage-ownership-documents
manage-ai-settings
semantic-asset-query
```

所有 Function 都需由平台提供的 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 與 `SUPABASE_SERVICE_ROLE_KEY` 執行環境變數。R2 相關 Function 另需依其原始碼設定 bucket 與憑證。`service_role` 金鑰只能存在於 Function 的伺服器端環境，絕不可放進 `.env` 的 `VITE_` 變數或瀏覽器程式碼。

## 驗證

```powershell
npm run check
npm run build
```

使用者管理 Function 只允許狀態為「啟用」或「停用」的系統管理員呼叫；它會驗證呼叫者的 Supabase 使用者身分與資料庫角色後，才以伺服器端權限管理帳號。

AI 查詢使用「語意目錄 → Gemini 查詢計畫 → 查詢編譯器」流程。模型只輸出受限的意圖 JSON；編譯器依欄位能力、使用者可見的索引事實與既有清冊 RLS 執行查詢。人員、地點與財產名稱由索引解析；數值、多人 OR 與複合財產編號範圍由語意目錄定義，不讓模型直接產生 SQL 或自行宣稱筆數。
