import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestValidPeriod, yearBucketLabel } from "./period";

const D = ["2022-01-03", "2026-06-30"] as const;

test("dates inside the data do not move", () => {
  assert.deepEqual(nearestValidPeriod(undefined, undefined, ...D), { from: undefined, to: undefined, moved: false });
  assert.deepEqual(nearestValidPeriod("2023-01-01", "2023-12-31", ...D), { from: "2023-01-01", to: "2023-12-31", moved: false });
});

test("the first of the first month is not expired", () => {
  assert.equal(nearestValidPeriod("2022-01-01", "2022-06-30", ...D).moved, false);
});

test("a bound outside the data moves to the end of the data", () => {
  assert.deepEqual(nearestValidPeriod("2021-10-01", "2023-01-31", ...D), { from: "2022-01-03", to: "2023-01-31", moved: true });
  assert.deepEqual(nearestValidPeriod("2025-01-01", "2026-12-31", ...D), { from: "2025-01-01", to: "2026-06-30", moved: true });
});

test("a Period wholly before the data keeps its length at the start", () => {
  assert.deepEqual(nearestValidPeriod("2021-07-01", "2021-12-31", ...D), { from: "2022-01-03", to: "2022-06-30", moved: true });
});

test("a Period wholly after the data keeps its length at the end", () => {
  assert.deepEqual(nearestValidPeriod("2027-01-01", "2027-03-31", ...D), { from: "2026-04-01", to: "2026-06-30", moved: true });
});

test("a long Period wholly before the data stops at the end of the data", () => {
  assert.equal(nearestValidPeriod("2010-01-01", "2020-12-31", ...D).to, "2026-06-30");
});

test("a reversed Period inside the data stays as the link gave it", () => {
  assert.deepEqual(nearestValidPeriod("2025-01-01", "2024-01-01", ...D), { from: "2025-01-01", to: "2024-01-01", moved: false });
});

test("a Year bucket takes the label of its year range, which names the months of a Partial year", () => {
  const years = [{ label: "2021, Jul–Dec", from: "2021-07-01" }, { label: "2022", from: "2022-01-03" }];
  assert.equal(yearBucketLabel("2021", "2021", years), "2021, Jul–Dec");
  assert.equal(yearBucketLabel("2022", "2022", years), "2022");
  assert.equal(yearBucketLabel("2030", "2030", years), "2030");
});
