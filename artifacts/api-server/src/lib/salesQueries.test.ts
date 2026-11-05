import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createSalesFixture, FIXTURE_SALES, type FixtureSale } from "./salesFixture";
import type { SalesDb } from "./salesDb";
import { changeWindows } from "./timeStats";
import {
  areaStats,
  distribution,
  salesByRooms,
  summaryStats,
  type SaleFilter,
} from "./salesQueries";

let db: SalesDb;
let changeDb: SalesDb;
let fewEndDb: SalesDb;

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
