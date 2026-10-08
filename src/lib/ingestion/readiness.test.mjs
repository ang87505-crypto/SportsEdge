import test from "node:test";
import assert from "node:assert/strict";
import { countValidSports } from "./readiness.ts";

test("valid seeded sport rows yield a deterministic count", () => {
  assert.equal(countValidSports([{ code: "nba" }, { code: "soccer" }, { code: "mlb" }]), 3);
});
test("empty responses fail instead of reporting a healthy connection", () => {
  assert.throws(() => countValidSports([]), /empty or invalid/);
});
test("non-array or malformed rows fail closed", () => {
  for (const value of [null, {}, [null], [{ code: "" }], [{ code: "not valid" }], [{code: 42}]]) {
    assert.throws(() => countValidSports(value));
  }
});
test("duplicate sports fail instead of inflating health counts", () => {
  assert.throws(() => countValidSports([{code: "nba"}, {code: "nba"}]), /duplicate/);
});
