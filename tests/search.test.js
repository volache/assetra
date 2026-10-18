import assert from "node:assert/strict";
import { test } from "node:test";
import {
  looksLikeRuleSyntax,
  matchesAdvancedSearch,
  normalized,
  searchTermWarnings,
} from "../src/features/inventory/search.js";

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

test("plain words match any text field", () => {
  assert.equal(matchesAdvancedSearch(asset, "氣囊"), true);
  assert.equal(matchesAdvancedSearch(asset, "不存在的字"), false);
});

test("field rules: exact by default, ~ for contains", () => {
  assert.equal(matchesAdvancedSearch(asset, "保管人:王小明"), true);
  assert.equal(matchesAdvancedSearch(asset, "存置地點:宿舍"), false);
  assert.equal(matchesAdvancedSearch(asset, "存置地點:~宿舍"), true);
});

test("numeric and date comparisons", () => {
  assert.equal(matchesAdvancedSearch(asset, "數量:>=2 原值:>=60000"), true);
  assert.equal(matchesAdvancedSearch(asset, "數量:>2"), false);
  assert.equal(matchesAdvancedSearch(asset, "購置日期:>110/01/01"), false);
  assert.equal(matchesAdvancedSearch(asset, "已使用:=5年"), true);
});

test("a leading minus excludes", () => {
  assert.equal(matchesAdvancedSearch(asset, "氣囊 -王小明"), false);
  assert.equal(matchesAdvancedSearch(asset, "氣囊 -李大華"), true);
});

test("looksLikeRuleSyntax tells search rules from natural language", () => {
  assert.equal(looksLikeRuleSyntax("保管人:王小明"), true);
  assert.equal(looksLikeRuleSyntax("存置地點:~宿舍 數量:>=2"), true);
  assert.equal(looksLikeRuleSyntax("宿舍裡有哪些電腦"), false);
  assert.equal(looksLikeRuleSyntax(""), false);
});

test("searchTermWarnings flags an unbalanced quote", () => {
  assert.equal(searchTermWarnings("保管人:王小明").length, 0);
  assert.ok(searchTermWarnings('名稱:"氣囊').length > 0);
});

test("normalized ignores case, spacing and the 臺／台 and 汙／污 spellings", () => {
  assert.equal(normalized("  ABC  "), "abc");
  assert.equal(normalized("臺北"), normalized("台北"));
  assert.equal(normalized("汙水處理廠"), normalized("污水處理廠"));
  assert.equal(normalized(null), "");
});
