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

test("a link with a fractional Arrondissement shows All Paris", () => {
  assert.deepEqual(parseView("?arr=1.5").area, { kind: "paris" });
  assert.deepEqual(parseView("?arr=7").area, { kind: "arr", arr: 7 });
});
