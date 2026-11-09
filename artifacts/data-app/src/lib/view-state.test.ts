import { test } from "node:test";
import assert from "node:assert/strict";
import { parseView, viewQuery, type ViewState } from "./view-state";
import type { Area } from "./areas";

const base: ViewState = { ptype: "all", area: { kind: "paris" }, rank: "paris", from: undefined, to: undefined, mapMode: "level", mapLevel: "arr", gran: "quarter" };

test("a link reproduces each kind of Area", () => {
  const areas: Area[] = [
    { kind: "paris" },
    { kind: "department", id: "93" },
    { kind: "arr", arr: 11 },
    { kind: "q", id: "7511101" },
    { kind: "commune", id: "92012" },
  ];
  for (const area of areas) {
    const s = { ...base, area, rank: parseView(viewQuery({ ...base, area })).rank };
    assert.deepEqual(parseView(viewQuery(s)), s);
  }
});

test("a link reproduces the rank, Period, map and level", () => {
  const s: ViewState = {
    ...base, ptype: "Maison", area: { kind: "commune", id: "92012" }, rank: "94",
    from: "2023-01-01", to: "2024-06-30", mapMode: "dots", mapLevel: "quartier", gran: "year",
  };
  assert.deepEqual(parseView(viewQuery(s)), s);
});

test("an empty search gives Paris ranked in the Paris group", () => {
  const v = parseView("");
  assert.deepEqual(v.area, { kind: "paris" });
  assert.equal(v.rank, "paris");
});

test("the rank follows the Area unless the link sets it", () => {
  assert.equal(parseView("?commune=93066").rank, "93");
  assert.equal(parseView("?commune=78646").rank, "major");
  assert.equal(parseView("?dept=92").rank, "92");
  assert.equal(parseView("?rank=94&commune=92012").rank, "94");
});

test("a link to an Area that does not exist", () => {
  assert.deepEqual(parseView("?dept=95").area, { kind: "paris" });
  assert.deepEqual(parseView("?commune=123").area, { kind: "paris" });
  const v = parseView("?commune=99999");
  assert.deepEqual(v.area, { kind: "commune", id: "99999" });
  assert.equal(v.rank, "major");
});

test("a date that is not in the calendar is dropped", () => {
  assert.equal(parseView("?from=2020-13-45").from, undefined);
  assert.equal(parseView("?to=9999-99-99").to, undefined);
  assert.equal(parseView("?to=2024-02-29").to, "2024-02-29");
});

test("a link's Period is cleaned: bounds at the ends of the data are left out, a reversed Period is put in order", async () => {
  const { linkView } = await import("./view-state");
  assert.equal(viewQuery(linkView("?arr=abc&to=2030-01-01&gran=x", "2021-07-01", "2026-06-30").state), "");
  assert.deepEqual(linkView("?to=2030-01-01", "2021-07-01", "2026-06-30").moved, true);
  const v = linkView("?from=2026-01-01&to=2022-01-01", "2021-07-01", "2026-06-30").state;
  assert.deepEqual([v.from, v.to], ["2022-01-01", "2026-01-31"]);
  // A preset that ends with the data keeps its bounds.
  assert.equal(linkView("?from=2025-07-01&to=2026-06-30", "2021-07-01", "2026-06-30").state.to, "2026-06-30");
});

test("a link with a fractional Arrondissement shows All Paris", () => {
  assert.deepEqual(parseView("?arr=1.5").area, { kind: "paris" });
  assert.deepEqual(parseView("?arr=7").area, { kind: "arr", arr: 7 });
});

test("a new Area adds a history entry; any other change replaces it", async () => {
  const { historyMode } = await import("./view-state");
  assert.equal(historyMode(base, { ...base, area: { kind: "arr", arr: 11 } }), "push");
  assert.equal(historyMode({ ...base, area: { kind: "arr", arr: 11 } }, { ...base, area: { kind: "q", id: "7511101" } }), "push");
  assert.equal(historyMode(base, { ...base, from: "2024-01-01", to: "2024-12-31" }), "replace");
  assert.equal(historyMode(base, { ...base, ptype: "Maison", mapMode: "dots" }), "replace");
});
