import assert from "node:assert/strict";
import { test } from "node:test";
import { accountCodeFor } from "../src/lib/accounts.js";
import { applyOfficialPersonnelNames } from "../src/lib/personnel.js";

test("accountCodeFor uses the account code, then the custodian code, then the email", () => {
  assert.equal(accountCodeFor({ accountCode: " ab12 ", custodianCodes: ["X1"] }), "ab12");
  assert.equal(accountCodeFor({ custodianCodes: ["X1"], email: "a@b.c" }), "X1");
  assert.equal(accountCodeFor({ email: "a@b.c" }), "a@b.c");
  assert.equal(accountCodeFor({}), "");
});

test("official personnel names replace garbled ones but keep the raw text", () => {
  const [asset] = applyOfficialPersonnelNames(
    [{ custodianCode: "OP63", custodianName: "楊?彬", userCode: "OP63", userName: "楊?彬" }],
    [{ name: "楊喆彬", status: "active", custodianCodes: ["OP63"] }],
  );
  assert.equal(asset.custodianName, "楊喆彬");
  assert.equal(asset.rawCustodianName, "楊?彬");
});
