import assert from "node:assert/strict";
import { test } from "node:test";
import { floorName, project, spaceTitle, unproject } from "../src/features/indoor/geometry.js";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("flat mode only flips y so the plan reads with north up", () => {
  const [x, y] = project([100, 50], "flat");
  close(x, 100);
  close(y, -50);
});

test("unproject undoes project in every mode", () => {
  for (const mode of ["flat", "iso", 0.4]) {
    const [x, y] = unproject(project([1234, -567], mode), mode);
    close(x, 1234);
    close(y, -567);
  }
});

test("floorName shows the building only when it adds information", () => {
  assert.equal(floorName(null), "");
  assert.equal(floorName({ building: "航廈", label: "二樓" }), "航廈｜二樓");
  assert.equal(floorName({ building: "汙水處理廠", label: "汙水處理廠" }), "汙水處理廠");
});

test("spaceTitle prefers the name, then the usage, then the tool id", () => {
  assert.equal(spaceTitle({ name: "辦公室", usage: "x", tool_id: "r1" }), "辦公室");
  assert.equal(spaceTitle({ usage: "倉庫", tool_id: "r1" }), "倉庫");
  assert.equal(spaceTitle({ tool_id: "r1" }), "r1");
  assert.equal(spaceTitle({}), "未命名空間");
});
