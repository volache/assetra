import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromDatabaseAsset, fromDatabaseImport } from "../src/lib/inventory.js";
import { assetMajorClass, rocDate, rocDateTime } from "../src/lib/formatters.js";
import { matchesAdvancedSearch } from "../src/features/inventory/search.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = resolve(root, "src");
const sourceFiles = [];

function collectFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) collectFiles(path);
    else if ([".js", ".jsx", ".css"].includes(extname(entry.name)))
      sourceFiles.push(path);
  }
}

function resolveRelativeImport(from, specifier) {
  const candidate = resolve(from, "..", specifier);
  const paths = [
    candidate,
    ...[".js", ".jsx", ".css", ".json"].map(
      (extension) => `${candidate}${extension}`,
    ),
    ...["index.js", "index.jsx"].map((name) => resolve(candidate, name)),
  ];
  return paths.some(existsSync);
}

function checkImports() {
  collectFiles(sourceRoot);
  const importPattern =
    /(?:import\s+(?:[^"']*?\s+from\s+)?|export\s+[^"']*?\s+from\s+|import\s*\()\s*["']([^"']+)["']/g;
  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier.startsWith(".") && !resolveRelativeImport(file, specifier)) {
        throw new Error(`找不到相對匯入：${file} → ${specifier}`);
      }
    }
  }
}

function checkFeatureContracts() {
  const read = (path) => readFileSync(resolve(root, path), "utf8");
  assert.match(read("src/features/accounts/Accounts.jsx"), /HighlightText/);
  assert.match(read("src/features/accounts/Accounts.jsx"), /UserFilterCombo/);
  assert.match(read("src/features/imports/BatchHistory.jsx"), /Fragment/);
  assert.match(read("src/features/imports/ImportInventory.jsx"), /sourceLabels/);
  assert.match(read("src/features/organization/Organization.jsx"), /UnitMasterDialog/);
  assert.match(read("src/features/auth/Login.jsx"), /session-loader-pills/);
  assert.match(read("src/app/Portal.jsx"), /CollaborationTasks/);
  assert.match(read("src/features/accounts/Accounts.jsx"), /manage-users/);
  assert.match(read("src/features/accounts/Accounts.jsx"), /使用者資料已更新/);
  assert.match(read("src/features/accounts/Accounts.jsx"), /儲存中/);
  assert.match(read("src/features/auth/Password.jsx"), /正在更新密碼/);
  assert.match(read("src/main.jsx"), /FeedbackProvider/);
  assert.match(read("src/components/FeedbackCenter.jsx"), /CapsuleSpinner/);
  assert.match(read("src/styles/feedback.css"), /capsule-turn/);
  assert.doesNotMatch(read("src/components/FeedbackCenter.jsx"), /<dialog/);
  assert.doesNotMatch(read("src/components/FeedbackCenter.jsx"), /window\.fetch\s*=/);
  assert.match(read("src/features/inventory/AssetQuery.jsx"), /action: "summaries"/);
  assert.match(read("src/features/collaboration/CollaborationTasks.jsx"), /action: "list_tasks"/);
  assert.match(read("supabase/functions/manage-collaborations/index.ts"), /action === "summaries"/);
  assert.match(read("supabase/functions/manage-collaborations/index.ts"), /action === "list_tasks"/);
  assert.match(read("supabase/functions/manage-collaborations/index.ts"), /canAccessAsset/);
  assert.match(read("supabase/functions/manage-users/index.ts"), /authorizeAdmin/);
  assert.match(read("supabase/functions/manage-users/index.ts"), /auth\.admin\.createUser/);
  assert.match(read("supabase/functions/manage-users/index.ts"), /auth\.admin\.updateUserById/);
  assert.match(read("supabase/functions/manage-users/index.ts"), /127\.0\.0\.1:5173/);
  assert.match(read("supabase/functions/manage-users/index.ts"), /detail: \{ accountCode/);
}

function checkInventoryBehavior() {
  assert.equal(rocDate("2026-09-28"), "115/09/28");
  assert.equal(rocDate("115/9/2"), "115/09/02");
  assert.equal(assetMajorClass("3080104-0031"), "機械及設備");
  assert.equal(
    fromDatabaseAsset({
      id: "record-1",
      source_type: "asset",
      asset_no: "1040103-0001",
      name: "機場用地",
      acquired_at: "2026-09-28",
    }).acquiredAt,
    "115/09/28",
  );
  assert.match(
    fromDatabaseImport({
      id: "import-1",
      file_name: "財產清冊.xlsx",
      source_type: "asset",
      record_count: 1,
      committed_at: "2026-09-28T01:05:41+08:00",
    }).at,
    /^115\/09\/28 /,
  );
  assert.equal(rocDateTime("not-a-date"), "not-a-date");
}

function checkSearchBehavior() {
  const asset = {
    assetNo: "3080104-0031",
    serialNo: "0000021",
    name: "搶救失事飛機昇舉氣囊",
    custodianName: "王小明",
    measureUnit: "具",
    assetMajorClass: "機械及設備",
    usedDuration: "5 年 0 月",
    usefulLife: 10,
    quantity: 2,
    originalValue: 60000,
    depreciation: 10000,
    netValue: 50000,
    acquiredAt: "110/01/01",
    status: "使用中",
  };
  assert.equal(matchesAdvancedSearch(asset, "保管人:王小明"), true);
  assert.equal(matchesAdvancedSearch(asset, "計量單位:具"), true);
  assert.equal(matchesAdvancedSearch(asset, "財產大類:機械及設備"), true);
  assert.equal(matchesAdvancedSearch(asset, "已使用:=5年"), true);
  assert.equal(matchesAdvancedSearch(asset, "數量:>=2 原值:>=60000"), true);
  assert.equal(matchesAdvancedSearch(asset, "購置日期:>110/01/01"), false);
  assert.equal(matchesAdvancedSearch(asset, "氣囊 -王小明"), false);
}

checkImports();
checkFeatureContracts();
checkInventoryBehavior();
checkSearchBehavior();
console.log(`Regression checks passed for ${sourceFiles.length} source files.`);
