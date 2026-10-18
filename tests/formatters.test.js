import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assetMajorClass,
  formatNumber,
  money,
  rocDate,
  rocDateTime,
  serviceLifeExpired,
  usedDuration,
} from "../src/lib/formatters.js";

test("rocDate converts every accepted shape to YYY/MM/DD", () => {
  assert.equal(rocDate("2026-09-28"), "115/09/28");
  assert.equal(rocDate("115/9/2"), "115/09/02");
  assert.equal(rocDate("1150928"), "115/09/28");
  assert.equal(rocDate("  115-9-28 "), "115/09/28");
});

test("rocDate leaves text it cannot read alone", () => {
  assert.equal(rocDate("未提供"), "未提供");
  assert.equal(rocDate(null), "");
  assert.equal(rocDate(undefined), "");
});

test("rocDateTime falls back to rocDate for non-dates", () => {
  assert.equal(rocDateTime("not-a-date"), "not-a-date");
  assert.match(rocDateTime("2026-09-28T01:05:41+08:00"), /^115\/09\/28 \d{2}:\d{2}:\d{2}$/);
});

test("money and formatNumber group thousands", () => {
  assert.equal(money(1234567), "1,234,567");
  assert.equal(money("60000"), "60,000");
  assert.equal(money(1234.6), "1,235");
  assert.equal(money("abc"), "—");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(1234567), "1,234,567");
  assert.equal(formatNumber(1234.5), "1,234.5");
});

test("assetMajorClass follows the leading digit of the asset number", () => {
  assert.equal(assetMajorClass("1040103-0001"), "土地");
  assert.equal(assetMajorClass("1110101-0001"), "土地改良物");
  assert.equal(assetMajorClass("2010101-0001"), "房屋建築及設備");
  assert.equal(assetMajorClass("3080104-0031"), "機械及設備");
  assert.equal(assetMajorClass("4010101-0001"), "交通及運輸設備");
  assert.equal(assetMajorClass("5010101-0001"), "什項設備");
  assert.equal(assetMajorClass("6010101-0001"), "非消耗品");
  assert.equal(assetMajorClass(""), "—");
  assert.equal(assetMajorClass("9999"), "—");
});

test("usedDuration reads ROC dates and ignores bad or future ones", () => {
  assert.equal(usedDuration("not a date"), "—");
  assert.equal(usedDuration("999/01/01"), "—");
  assert.match(usedDuration("100/01/01"), /^\d+ 年 \d+ 月$/);
});

test("serviceLifeExpired compares acquisition date plus life with today", () => {
  assert.equal(serviceLifeExpired("90/01/01", 10), true);
  assert.equal(serviceLifeExpired("990/01/01", 10), false);
  assert.equal(serviceLifeExpired("not a date", 10), false);
  assert.equal(serviceLifeExpired("90/01/01", "abc"), false);
  assert.equal(serviceLifeExpired("90/01/01", -1), false);
});
