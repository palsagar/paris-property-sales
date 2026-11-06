import { test } from "node:test";
import assert from "node:assert/strict";
import { longMonthLabel } from "./fmt";

test("longMonthLabel spells out the month", () => {
  assert.equal(longMonthLabel("2026-06"), "June 2026");
  assert.equal(longMonthLabel("2022-01-03"), "January 2022");
});
