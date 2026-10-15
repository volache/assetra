import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromDatabaseAsset, fromDatabaseImport } from "../src/lib/inventory.js";
import { assetMajorClass, rocDate, rocDateTime } from "../src/lib/formatters.js";
import { matchesAdvancedSearch } from "../src/features/inventory/search.js";
import { applyOfficialPersonnelNames } from "../src/lib/personnel.js";
import { blankLandDraft, landPayload, parseLandGeometry } from "../src/features/geography/landEditor.js";

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
      const specifier = match[1].replace(/\?(?:url|raw)$/, "");
      if (specifier.startsWith(".") && !resolveRelativeImport(file, specifier)) {
        throw new Error(`找不到相對匯入：${file} → ${specifier}`);
      }
    }
  }
}

function checkFeatureContracts() {
  const read = (path) => readFileSync(resolve(root, path), "utf8");
  assert.match(read("src/features/accounts/Accounts.jsx"), /HighlightText/);
  assert.match(read("src/features/geography/GeographicAssets.jsx"), /LandEditorDialog/);
  assert.match(read("supabase/migrations/20261014091843_add_land_parcel_editor.sql"), /security invoker/);
  assert.match(read("supabase/migrations/20261014091843_add_land_parcel_editor.sql"), /revoke execute/);
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
  assert.match(read("src/features/inventory/AssetQuery.jsx"), /semantic-asset-query/);
  assert.match(read("src/features/inventory/AssetQuery.jsx"), /exportAssetRegister/);
  assert.match(read("src/features/inventory/exportAssetRegister.js"), /buildRegisterPdf/);
  assert.match(read("src/features/inventory/exportAssetRegister.js"), /buildRegisterWorkbook/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /ai_query_semantic_fields/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /identifier_range/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /ai_query_index_values/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /compileGroup/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /formatChineseTypography/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /intent: "lookup" \| "analysis" \| "clarify"/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /saveClarification/);
  assert.doesNotMatch(read("supabase/functions/semantic-asset-query/index.ts"), /clarificationFor/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /operator === "contains"/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /runAnalysis/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /analysisPlan/);
  assert.match(read("supabase/functions/semantic-asset-query/query-rules.ts"), /你要自行判斷使用者真正要完成的工作/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /analysisPlan = planned\.analysis/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /資料品質檢查/);
  assert.match(read("supabase/functions/import-inventory/index.ts"), /財產大類/);
  assert.match(read("supabase/functions/semantic-asset-query/query-rules.ts"), /identifierSpan/);
  assert.match(read("supabase/functions/semantic-asset-query/index.ts"), /kind.*self|"self"/);
  assert.match(read("src/features/inventory/AssetQuery.jsx"), /想再確認一下/);
  assert.match(read("src/features/inventory/AssetQuery.jsx"), /智慧查詢/);
  assert.match(read("src/features/inventory/AssetQuery.jsx"), /智慧查詢結果/);
  assert.match(read("src/features/inventory/AssetQuery.jsx"), /分析摘要/);
  assert.match(read("src/features/inventory/AssetQuery.jsx"), /推理模型/);
  assert.match(read("supabase/migrations/20261004140000_add_ai_query_clarifications.sql"), /expires_at/);
  assert.match(read("supabase/migrations/20261004150000_add_ai_analysis_capabilities.sql"), /analysis/);
  assert.match(read("supabase/migrations/20261004160000_add_major_class_and_data_quality_analysis.sql"), /asset_major_class/);
  assert.match(read("supabase/migrations/20261004093000_add_ai_query_semantic_catalog.sql"), /asset_records_current_asset_serial_idx/);
  assert.match(read("supabase/migrations/20261004094500_secure_ai_query_semantic_catalog.sql"), /service role manages AI query semantic catalog/);
  assert.match(read("supabase/migrations/20261004101500_add_ai_acquisition_date_semantic.sql"), /date_range/);
  assert.match(read("supabase/migrations/20261003145740_ai_agent_search.sql"), /users search terms for visible inventory/);
}

function checkLandEditorValidation() {
  const draft = { ...blankLandDraft(), sectionCode: "AA", sectionName: "測試段", landNumber: "1", geometryText: JSON.stringify({ type: "Polygon", coordinates: [[[121, 24], [121.001, 24], [121, 24.001], [121, 24]]] }), relatedBuildingNumbers: "101、102, 103" };
  assert.equal(parseLandGeometry(draft.geometryText).type, "Polygon");
  assert.deepEqual(landPayload(draft).related_building_numbers, ["101", "102", "103"]);
  assert.throws(() => parseLandGeometry('{"type":"Point","coordinates":[121,24]}'));
}

function checkAiQueryRegressionCases() {
  const cases = JSON.parse(readFileSync(resolve(root, "scripts/ai-query-regression-cases.json"), "utf8"));
  assert.equal(cases.length, 11);
  assert.deepEqual(cases.slice(0, 4).map((item) => item.expected.count), [470, 203, 5, 7]);
  const byName = new Map(cases.map((item) => [item.name, item.expected]));
  assert.equal(byName.get("複合財產編號範圍").kind, "identifier_range");
  assert.equal(byName.get("相對購置日期").kind, "date_range");
  assert.equal(byName.get("實體排除條件").operator, "not");
  assert.equal(byName.get("折舊數值比較").field, "depreciation");
  assert.equal(byName.get("年限比較").field, "useful_life");
  assert.equal(byName.get("已達年限").field, "service_life_expired");
  assert.equal(byName.get("人員名稱解析").intent, "lookup");
  assert.equal(byName.get("欄位列舉分析").intent, "analysis");
  assert.equal(byName.get("多欄位歧義追問").intent, "clarify");
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
    locationName: "宿舍 301 室",
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
  assert.equal(matchesAdvancedSearch(asset, "存置地點:宿舍"), false);
  assert.equal(matchesAdvancedSearch(asset, "存置地點:~宿舍"), true);
  assert.equal(matchesAdvancedSearch(asset, "計量單位:具"), true);
  assert.equal(matchesAdvancedSearch(asset, "財產大類:機械及設備"), true);
  assert.equal(matchesAdvancedSearch(asset, "已使用:=5年"), true);
  assert.equal(matchesAdvancedSearch(asset, "數量:>=2 原值:>=60000"), true);
  assert.equal(matchesAdvancedSearch(asset, "購置日期:>110/01/01"), false);
  assert.equal(matchesAdvancedSearch(asset, "氣囊 -王小明"), false);
}

function checkOfficialPersonnelNames() {
  const [asset] = applyOfficialPersonnelNames(
    [
      {
        custodianCode: "OP63",
        custodianName: "楊?彬",
        userCode: "OP63",
        userName: "楊?彬",
      },
    ],
    [{ name: "楊喆彬", status: "active", custodianCodes: ["OP63"] }],
  );
  assert.equal(asset.custodianName, "楊喆彬");
  assert.equal(asset.userName, "楊喆彬");
  assert.equal(asset.rawCustodianName, "楊?彬");
  assert.equal(asset.rawUserName, "楊?彬");
  assert.equal(matchesAdvancedSearch(asset, "保管人:楊?彬"), true);
  assert.equal(matchesAdvancedSearch(asset, "使用人:楊喆彬"), true);
}

checkImports();
checkFeatureContracts();
checkAiQueryRegressionCases();
checkInventoryBehavior();
checkSearchBehavior();
checkOfficialPersonnelNames();
checkLandEditorValidation();
console.log(`Regression checks passed for ${sourceFiles.length} source files.`);
