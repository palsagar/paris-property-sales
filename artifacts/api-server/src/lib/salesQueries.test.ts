import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createSalesFixture, FIXTURE_SALES, type FixtureSale } from "./salesFixture";
import type { SalesDb } from "./salesDb";
import { bucketOrdinal, changeWindows } from "./timeStats";
import {
  areaStats,
  areaTrendPoints,
  distribution,
  salePoints,
  saleAreaName,
  salesByRooms,
  summaryStats,
  transactionPage,
  trendPoints,
  type SaleFilter,
} from "./salesQueries";

let db: SalesDb;
let changeDb: SalesDb;
let fewEndDb: SalesDb;
let numericDb: SalesDb;

function changeSales(endCount: number): FixtureSale[] {
  const make = (id: string, date: string, price: number): FixtureSale => ({
    id, date, type: "Appartement", price, surface: 10, pricePerSqm: price / 10,
    rooms: 1, arr: 1, quartier: "7510101", lon: null, lat: null, street: "Rue X",
  });
  return [
    ...Array.from({ length: 5 }, (_, i) => make(`a${i}`, "2023-01-10", 100000)),
    ...Array.from({ length: endCount }, (_, i) => make(`b${i}`, "2023-12-10", 120000)),
  ];
}

before(async () => {
  db = await createSalesFixture(FIXTURE_SALES);
  changeDb = await createSalesFixture(changeSales(5));
  fewEndDb = await createSalesFixture(changeSales(4));
  // Two Sales in one month, in Arrondissements 10 and 2.
  const inArr = (id: string, arr: number): FixtureSale => ({
    id, date: "2024-01-10", type: "Appartement", price: 100000, surface: 10, pricePerSqm: 10000,
    rooms: 1, arr, quartier: null, lon: null, lat: null, street: "Rue X",
  });
  numericDb = await createSalesFixture([inArr("n1", 10), inArr("n2", 2)]);
});

test("summary of the fixture", async () => {
  const s = await summaryStats(db, {}, null);
  assert.deepEqual(
    [s.count, s.totalVolume, s.medianPrice, s.averagePrice, s.medianPricePerSqm, s.averagePricePerSqm, s.medianSurface, s.minPrice, s.maxPrice],
    [5, 1500000, 300000, 300000, 10000, 11200, 25, 100000, 500000],
  );
  assert.equal(typeof s.count, "number");
  assert.equal(s.changePct, null);
});

test("filters", async () => {
  const count = async (f: SaleFilter) => (await summaryStats(db, f, null)).count;
  assert.equal(await count({ propertyType: "Maison" }), 1);
  assert.equal(await count({ propertyType: "all" }), 5);
  assert.equal(await count({ arrondissement: 2 }), 2);
  assert.equal(await count({ quartier: "7510101" }), 2);
  assert.equal(await count({ from: "2024-02-01", to: "2024-02-29" }), 1);
});

test("dates that do not exist compare as strings", async () => {
  assert.equal((await summaryStats(db, { from: "2024-13-45" }, null)).count, 0);
  assert.equal((await summaryStats(db, { to: "2024-02-31" }, null)).count, 3);
});

test("no Sales gives zeros and empty lists", async () => {
  const f = { from: "2030-01-01" };
  const s = await summaryStats(db, f, null);
  assert.deepEqual(
    [s.count, s.totalVolume, s.medianPrice, s.averagePrice, s.medianPricePerSqm, s.averagePricePerSqm, s.medianSurface, s.minPrice, s.maxPrice],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(await distribution(db, f, "price", 45), { bins: [], median: 0, mean: 0, p10: 0, p25: 0, p75: 0, p90: 0 });
  assert.deepEqual(await salesByRooms(db, f), []);
  assert.deepEqual(await areaStats(db, f, "arrondissement", null), []);
});

test("distribution bins follow the old calculation", async () => {
  const d = await distribution(db, {}, "price", 45);
  assert.equal(d.bins.length, 40);
  assert.deepEqual(d.bins[0], { from: 100000, to: 110000, count: 1 });
  assert.equal(d.bins[10]!.count, 1);
  assert.equal(d.bins[30]!.count, 1);
  // 500,000 is above the 99th percentile, so no bin counts it.
  assert.equal(d.bins.reduce((n, b) => n + b.count, 0), 4);
  assert.deepEqual([d.median, d.mean, d.p25, d.p75], [300000, 300000, 200000, 400000]);
});

test("one distinct value gives no bins and still gives statistics", async () => {
  const d = await distribution(db, { from: "2024-02-15", to: "2024-02-15" }, "price", 45);
  assert.deepEqual(d.bins, []);
  assert.deepEqual([d.median, d.mean, d.p10, d.p90], [300000, 300000, 300000, 300000]);
});

test("rooms leave out 0 and group 5 or more", async () => {
  const rows = await salesByRooms(db, {});
  assert.deepEqual(rows.map((r) => r.rooms), [1, 2, 3, 5]);
  assert.equal(rows[3]!.medianPrice, 300000);
});

test("Area figures", async () => {
  const arr = await areaStats(db, {}, "arrondissement", null);
  assert.deepEqual(arr.map((a) => [a.area, a.count]), [["1", 2], ["2", 2], ["3", 1]]);
  const a2 = arr[1]!;
  assert.deepEqual(
    [a2.medianPrice, a2.medianPricePerSqm, a2.p25PricePerSqm, a2.p75PricePerSqm, a2.medianSurface],
    [350000, 8000, 7000, 9000, 45],
  );
  const q = await areaStats(db, {}, "quartier", null);
  assert.deepEqual(q.map((a) => a.area).sort(), ["7510101", "7510201"]);
});

test("Change needs 5 Sales in each Change window", async () => {
  // 5 Sales in January 2023 at 10,000 EUR/m², and 5 in December 2023 at 12,000 EUR/m².
  const w = changeWindows("2023-01-01", "2023-12-31");
  const s = await summaryStats(changeDb, {}, w);
  assert.deepEqual([s.startMedianPricePerSqm, s.endMedianPricePerSqm], [10000, 12000]);
  assert.ok(Math.abs(s.changePct! - 20) < 1e-9);
  assert.ok(Math.abs(s.priceChangePct! - 20) < 1e-9);
  // The same data with 4 Sales in December gives no Change.
  assert.equal((await summaryStats(fewEndDb, {}, w)).changePct, null);
});

const month = (d: string) => bucketOrdinal(d, "month");

test("trend with no pooling skips empty buckets", async () => {
  const rows = await trendPoints(db, {}, "month", 1, month("2024-01-01"), month("2024-05-01"));
  assert.deepEqual(
    rows.map((r) => [r.label, r.count, r.medianPrice]),
    [["2024-01", 2, 150000], ["2024-02", 1, 300000], ["2024-03", 2, 450000]],
  );
});

test("Smoothing window pools each bucket with the ones before it", async () => {
  const rows = await trendPoints(db, {}, "month", 2, month("2024-01-01"), month("2024-04-01"));
  assert.deepEqual(
    rows.map((r) => [r.label, r.count, r.medianPrice]),
    [["2024-01", 2, 150000], ["2024-02", 3, 200000], ["2024-03", 3, 400000], ["2024-04", 2, 450000]],
  );
});

test("quarter and year labels", async () => {
  const q = await trendPoints(db, {}, "quarter", 1, bucketOrdinal("2024-01-01", "quarter"), bucketOrdinal("2024-12-31", "quarter"));
  assert.deepEqual(q.map((r) => [r.label, r.period, r.count]), [["2024 Q1", "2024-01-01", 5]]);
  const y = await trendPoints(db, {}, "year", 1, 2024, 2024);
  assert.deepEqual(y.map((r) => [r.label, r.period, r.count]), [["2024", "2024-01-01", 5]]);
});

test("reversed range and no Sales give empty trends", async () => {
  assert.deepEqual(await trendPoints(db, {}, "month", 1, month("2024-03-01"), month("2024-01-01")), []);
  assert.deepEqual(await trendPoints(db, { from: "2030-01-01" }, "month", 1, month("2030-01-01"), month("2030-02-01")), []);
  assert.deepEqual(await areaTrendPoints(db, { from: "2030-01-01" }, "quartier", "month", 1, month("2030-01-01"), month("2030-02-01")), []);
});

test("quartier trend leaves out Sales with no quartier", async () => {
  const rows = await areaTrendPoints(db, {}, "quartier", "month", 1, month("2024-01-01"), month("2024-03-01"));
  assert.deepEqual(
    rows.map((r) => [r.period, r.id, r.count]),
    [["2024-01-01", "7510101", 2], ["2024-02-01", "7510201", 1], ["2024-03-01", "7510201", 1]],
  );
});

test("Arrondissements sort as numbers within a period", async () => {
  const rows = await areaTrendPoints(numericDb, {}, "arrondissement", "month", 1, month("2024-01-01"), month("2024-01-01"));
  assert.deepEqual(rows.map((r) => r.id), ["2", "10"]);
});

test("points leave out Sales with no position and have a fixed order", async () => {
  assert.deepEqual((await salePoints(db, {})).map((p) => p.id), ["s4", "s3", "s2", "s1"]);
  assert.deepEqual(await salePoints(db, { from: "2030-01-01" }), []);
});

test("ties break by id ascending in both directions", async () => {
  const ids = async (by: "date" | "pricePerSqm", dir: "asc" | "desc") =>
    (await transactionPage(db, {}, by, dir, 200, 0)).items.map((i) => i.id);
  assert.deepEqual(await ids("date", "desc"), ["s4", "s5", "s3", "s2", "s1"]);
  assert.deepEqual(await ids("pricePerSqm", "desc"), ["s5", "s1", "s2", "s4", "s3"]);
  assert.deepEqual(await ids("pricePerSqm", "asc"), ["s3", "s1", "s2", "s4", "s5"]);
});

test("paging", async () => {
  const page = await transactionPage(db, {}, "price", "asc", 2, 1);
  assert.deepEqual([page.total, page.items.map((i) => i.id)], [5, ["s2", "s3"]]);
  const past = await transactionPage(db, {}, "price", "asc", 15, 999999);
  assert.deepEqual([past.total, past.items], [5, []]);
  assert.equal(page.items[0]!.address, "Rue B");
});

test("an offset beyond the INTEGER range gives an empty page", async () => {
  const past = await transactionPage(db, {}, "price", "asc", 15, 3_000_000_000);
  assert.deepEqual([past.total, past.items], [5, []]);
});

/** A Sale of 10 m² at the given Price per m², so its price is ten times that. */
function ppsmSale(id: string, date: string, ppsm: number, arr = 1, quartier: string | null = null): FixtureSale {
  return {
    id, date, type: "Appartement", price: ppsm * 10, surface: 10, pricePerSqm: ppsm,
    rooms: 1, arr, quartier, lon: null, lat: null, street: "Rue X",
  };
}

const repeat = (prefix: string, n: number, date: string, ppsm: number, arr = 1) =>
  Array.from({ length: n }, (_, i) => ppsmSale(`${prefix}${i}`, date, ppsm, arr));

test("Area Change compares the first and last Change window of each Area", async () => {
  // Period 2023-01-01 to 2023-12-31: 12 months, so each Change window covers 6 months.
  const areaChangeDb = await createSalesFixture([
    // Arrondissement 1: 5 Sales at 10,000 then 5 at 12,000. (12,000 - 10,000) / 10,000 = +20%.
    ...repeat("a", 5, "2023-02-10", 10000, 1), ...repeat("b", 5, "2023-11-10", 12000, 1),
    // Arrondissement 2: 5 Sales at the start but only 4 at the end, so there is no Change.
    ...repeat("c", 5, "2023-02-10", 10000, 2), ...repeat("d", 4, "2023-11-10", 12000, 2),
    // Arrondissement 3: start median of 6000, 8000, 10000, 12000, 14000 is 10,000. End median is 9,000. -10%.
    ...[6000, 8000, 10000, 12000, 14000].map((p, i) => ppsmSale(`e${i}`, "2023-02-10", p, 3)),
    ...repeat("f", 5, "2023-11-10", 9000, 3),
  ]);
  const rows = await areaStats(areaChangeDb, {}, "arrondissement", changeWindows("2023-01-01", "2023-12-31"));
  assert.deepEqual(rows.map((r) => [r.area, r.count]), [["1", 10], ["2", 9], ["3", 10]]);
  assert.deepEqual([rows[0]!.startMedianPricePerSqm, rows[0]!.endMedianPricePerSqm], [10000, 12000]);
  assert.ok(Math.abs(rows[0]!.changePct! - 20) < 1e-9);
  assert.deepEqual([rows[1]!.startMedianPricePerSqm, rows[1]!.endMedianPricePerSqm, rows[1]!.changePct], [null, null, null]);
  assert.deepEqual([rows[2]!.startMedianPricePerSqm, rows[2]!.endMedianPricePerSqm], [10000, 9000]);
  assert.ok(Math.abs(rows[2]!.changePct! + 10) < 1e-9);
});

test("without Change windows, Area figures have no Change", async () => {
  const rows = await areaStats(db, {}, "arrondissement", null);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.changePct === null && r.startMedianPricePerSqm === null));
});

test("distribution on Price per m²", async () => {
  // Prices per m² are 6000, 10000, 10000, 10000, 20000. Quantiles interpolate at position q * (5 - 1).
  // p99 sits at position 3.96: 10000 + 0.96 * 10000 = 19600.
  // Raw bin width (19600 - 6000) / 45 = 302.2, so the nice step is 500. The first bin starts at 6000.
  // The bin count is ceil((19600 - 6000) / 500) = 28.
  const d = await distribution(db, {}, "price_per_sqm", 45);
  assert.equal(d.bins.length, 28);
  assert.deepEqual(d.bins[0], { from: 6000, to: 6500, count: 1 });
  // 10000 falls in bin (10000 - 6000) / 500 = 8, which holds three Sales.
  assert.deepEqual(d.bins[8], { from: 10000, to: 10500, count: 3 });
  // 20000 is above the 99th percentile, so no bin counts it.
  assert.equal(d.bins.reduce((n, b) => n + b.count, 0), 4);
  assert.equal(d.mean, 11200); // (6000 + 30000 + 20000) / 5
  assert.equal(d.median, 10000);
  assert.equal(d.p25, 10000); // position 1
  assert.equal(d.p75, 10000); // position 3
  assert.ok(Math.abs(d.p10 - 7600) < 1e-6); // position 0.4: 6000 + 0.4 * 4000
  assert.ok(Math.abs(d.p90 - 16000) < 1e-6); // position 3.6: 10000 + 0.6 * 10000
});

// Change windows for 2023-01-01 to 2023-06-15: 6 months, so each covers 3 months.
// The start window is before 2023-04-01 (exclusive). The end window is after 2023-03-15 (exclusive). They overlap.
const boundaryWindows = changeWindows("2023-01-01", "2023-06-15");

async function changeWith(extra: FixtureSale[], startCount: number, endCount: number) {
  const dbForCase = await createSalesFixture([
    ...repeat("s", startCount, "2023-01-10", 10000),
    ...repeat("e", endCount, "2023-06-10", 12000),
    ...extra,
  ]);
  return (await summaryStats(dbForCase, {}, boundaryWindows)).changePct;
}

test("the start Change window excludes its upper bound", async () => {
  assert.deepEqual(boundaryWindows && [boundaryWindows.startEnd, boundaryWindows.endStart], ["2023-04-01", "2023-03-15"]);
  // 4 Sales in January plus one on 2023-04-01: the Sale on the bound is not in the start window, so it has 4 Sales.
  assert.equal(await changeWith([ppsmSale("x", "2023-04-01", 10000)], 4, 5), null);
  // A Sale on 2023-03-31 is inside the start window, so it has 5 Sales. Median 10,000 to 12,000 is +20%.
  assert.ok(Math.abs((await changeWith([ppsmSale("x", "2023-03-31", 10000)], 4, 5))! - 20) < 1e-9);
});

test("the end Change window excludes its lower bound", async () => {
  // 4 Sales in June plus one on 2023-03-15: the Sale on the bound is not in the end window, so it has 4 Sales.
  assert.equal(await changeWith([ppsmSale("x", "2023-03-15", 12000)], 5, 4), null);
  // A Sale on 2023-03-16 is inside the end window, so it has 5 Sales. Start median is 10,000 (5 of its 6 Sales). End is 12,000.
  assert.ok(Math.abs((await changeWith([ppsmSale("x", "2023-03-16", 12000)], 5, 4))! - 20) < 1e-9);
});

test("trend quartiles of Price per m² follow the Smoothing window", async () => {
  // Smoothing window 1, March: Sales at 10000 and 20000. p25 at position 0.25 is 12500, p75 at position 0.75 is 17500.
  const one = await trendPoints(db, {}, "month", 1, month("2024-03-01"), month("2024-03-01"));
  assert.deepEqual(
    one.map((r) => [r.label, r.medianPricePerSqm, r.p25PricePerSqm, r.p75PricePerSqm]),
    [["2024-03", 15000, 12500, 17500]],
  );
  // Smoothing window 2, February pools January and February: 6000, 10000, 10000.
  // p25 at position 0.5 is 8000 and p75 at position 1.5 is 10000.
  // March pools February and March: 6000, 10000, 20000. p25 is 8000, p75 at position 1.5 is 15000.
  const two = await trendPoints(db, {}, "month", 2, month("2024-02-01"), month("2024-03-01"));
  assert.deepEqual(
    two.map((r) => [r.label, r.medianPricePerSqm, r.p25PricePerSqm, r.p75PricePerSqm]),
    [["2024-02", 10000, 8000, 10000], ["2024-03", 10000, 8000, 15000]],
  );
});

test("buckets beyond the first quarter and month of a year", async () => {
  const yearDb = await createSalesFixture([
    ppsmSale("q2a", "2024-04-01", 10000), ppsmSale("q2b", "2024-06-30", 10000),
    ppsmSale("q3", "2024-09-30", 10000),
    ppsmSale("q4a", "2024-10-01", 10000), ppsmSale("q4b", "2024-11-20", 10000), ppsmSale("q4c", "2024-12-31", 10000),
  ]);
  // Quarter ordinal is year * 4 + (month - 1) // 3: April and June give 2, September gives 2 (Q3 is index 2), November gives 3.
  const q = await trendPoints(yearDb, {}, "quarter", 1, bucketOrdinal("2024-01-01", "quarter"), bucketOrdinal("2024-12-31", "quarter"));
  assert.deepEqual(
    q.map((r) => [r.label, r.period, r.count]),
    [["2024 Q2", "2024-04-01", 2], ["2024 Q3", "2024-07-01", 1], ["2024 Q4", "2024-10-01", 3]],
  );
  // November alone sits in month ordinal 2024 * 12 + 10.
  const m = await trendPoints(yearDb, {}, "month", 1, month("2024-11-01"), month("2024-12-01"));
  assert.deepEqual(m.map((r) => [r.label, r.count]), [["2024-11", 1], ["2024-12", 1]]);
});

/** A Sale in the given Area, with a Price per m² of 10,000. */
function areaSale(id: string, department: string, commune: string | null, arr: number | null): FixtureSale {
  return {
    id, date: "2024-01-10", type: "Appartement", price: 100000, surface: 10, pricePerSqm: 10000,
    rooms: 1, department, commune, arr, quartier: null, lon: 2.3, lat: 48.8, street: "Rue X",
  };
}

let areaDb: SalesDb;

before(async () => {
  // 2 Sales in Paris, 3 in Commune 92012, 2 in Commune 93066 and 1 in the Major town 78646.
  areaDb = await createSalesFixture([
    areaSale("p1", "75", null, 1), areaSale("p2", "75", null, 1),
    areaSale("a1", "92", "92012", null), areaSale("a2", "92", "92012", null), areaSale("a3", "92", "92012", null),
    areaSale("b1", "93", "93066", null), areaSale("b2", "93", "93066", null),
    areaSale("m1", "78", "78646", null),
  ]);
});

async function salePointsIds(database: SalesDb, f: SaleFilter): Promise<string[]> {
  return (await salePoints(database, f)).map((p) => p.id).sort();
}

test("a filter with no Area means Paris, never the whole file", async () => {
  assert.equal((await summaryStats(areaDb, {}, null)).count, 2);
  assert.deepEqual(await salePointsIds(areaDb, {}), ["p1", "p2"]);
  assert.equal((await transactionPage(areaDb, {}, "date", "desc", 200, 0)).total, 2);
});

test("each kind of Area filters to its own Sales", async () => {
  const count = async (f: SaleFilter) => (await summaryStats(areaDb, f, null)).count;
  assert.equal(await count({ department: "92" }), 3);
  assert.equal(await count({ commune: "93066" }), 2);
  assert.equal(await count({ commune: "78646" }), 1);
});

test("Commune figures list each Commune and no Paris Sale", async () => {
  const rows = await areaStats(areaDb, {}, "commune", null);
  assert.deepEqual(rows.map((r) => [r.area, r.count]), [["78646", 1], ["92012", 3], ["93066", 2]]);
});

test("Arrondissement figures hold only Paris", async () => {
  const rows = await areaStats(areaDb, {}, "arrondissement", null);
  assert.deepEqual(rows.map((r) => r.area), ["1"]);
});

test("Commune trend leaves out Paris", async () => {
  const rows = await areaTrendPoints(areaDb, {}, "commune", "month", 1, month("2024-01-01"), month("2024-12-01"));
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.id.length === 5));
});

test("the place name of a Sale", () => {
  const names = new Map([["92012", "Boulogne-Billancourt"]]);
  assert.equal(saleAreaName(1, null, names), "1er arrondissement");
  assert.equal(saleAreaName(5, null, names), "5e arrondissement");
  assert.equal(saleAreaName(null, "92012", names), "Boulogne-Billancourt");
});
