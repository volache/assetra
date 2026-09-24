# 財物清冊原型

這是可在本機執行的前端原型，包含：管理者建立帳號、匯入財產／物品 Excel、依角色查詢資料，以及保管人自行修改密碼。

## 執行

```powershell
npm install
npm run dev
```

瀏覽器開啟終端機顯示的網址。預設管理者帳號為 `admin@example.local`，密碼為 `Admin@1234`。

## 原型限制

- 帳號、密碼與匯入資料暫存在瀏覽器的 Local Storage，僅供介面與流程驗證，不可作正式上線用途。
- 正式版應使用 Supabase Auth。帳號建立、密碼重設與 Excel 匯入應改由伺服器端 API 執行，絕不可在瀏覽器暴露 `service_role` 金鑰。
- `supabase/schema.sql` 提供資料表與 RLS 的初步設計。執行前請先依實際單位授權範圍檢視與測試政策。
