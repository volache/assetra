# 財物清冊原型

這是可在本機執行的前端原型，包含：管理者建立帳號、匯入財產／物品 Excel、依角色查詢資料，以及保管人自行修改密碼。

## 執行

```powershell
npm install
npm run dev
```

瀏覽器開啟終端機顯示的網址。登入帳號與權限由 Assetra 的 Supabase 專案管理。

## 原型限制

- 匯入資料暫存在瀏覽器的 Local Storage，僅供介面與流程驗證，不可作正式上線用途。
- 帳號、密碼與角色權限使用 Supabase Auth 與受保護的伺服器端 Function；絕不可在瀏覽器暴露 `service_role` 金鑰。
- `supabase/schema.sql` 提供資料表與 RLS 的初步設計。執行前請先依實際單位授權範圍檢視與測試政策。
