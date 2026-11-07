import { test } from "node:test";
import assert from "node:assert/strict";
import { hashKey } from "@tanstack/react-query";
import { getGetSalesTrendQueryKey, getListTransactionsQueryKey, getGetSalesSummaryQueryKey } from "@workspace/api-client-react";
import { parseView } from "./view-state";
import { selectionQueries, smoothOn, summaryParams, transactionParams, trendParams, trendWindow, type PanelChoices } from "./selection-queries";
// The server's warm-up list copies these requests by hand, so this test compares the two.
import { warmUrls } from "../../../api-server/src/lib/warmUrls";

const DEFAULT: PanelChoices = { smooth: null, sortBy: "date", sortDir: "desc" };
const keys = (search: string, choices = DEFAULT) => selectionQueries(parseView(search), choices).map((o) => hashKey(o.queryKey)).sort();
const k = (path: string, params: object) => hashKey([`/api${path}`, params]);

test("the default view asks for the requests the panels make", () => {
  const all = { propertyType: "all" };
  assert.deepEqual(keys(""), [
    k("/sales/area-trend", { ...all, level: "arrondissement", granularity: "quarter", window: 1 }),
    k("/sales/area-trend", { ...all, level: "arrondissement", granularity: "quarter", window: 4 }),
    k("/sales/area-trend", { ...all, level: "commune", granularity: "quarter", window: 4 }),
    k("/sales/by-arrondissement", all),
    k("/sales/by-commune", all),
    k("/sales/by-rooms", all),
    k("/sales/price-distribution", all),
    k("/sales/price-per-sqm-distribution", all),
    k("/sales/summary", all),
    k("/sales/transactions", { ...all, sortBy: "date", sortDir: "desc", limit: 15, offset: 0 }),
    k("/sales/trend", { ...all, granularity: "month", window: 1 }),
    k("/sales/trend", { ...all, granularity: "quarter", window: 1 }),
  ].sort());
});

test("an Area adds the Paris line and the Area's filters", () => {
  const got = keys("arr=5&from=2023-01-01&to=2023-12-31");
  const dated = { propertyType: "all", from: "2023-01-01", to: "2023-12-31" };
  assert.ok(got.includes(k("/sales/trend", { ...dated, granularity: "quarter", window: 1 })), "Paris line");
  assert.ok(got.includes(k("/sales/trend", { ...dated, arrondissement: 5, granularity: "quarter", window: 1 })), "Area trend");
  assert.ok(got.includes(k("/sales/summary", { ...dated, arrondissement: 5 })));
  assert.ok(got.includes(k("/sales/trend", { propertyType: "all", arrondissement: 5, granularity: "month", window: 1 })), "slider chart has no dates");
  assert.equal(got.length, 13);
});

test("a Quartier uses a window of 3 for its trend and the Paris line", () => {
  const got = keys("q=7510501");
  assert.ok(got.includes(k("/sales/trend", { propertyType: "all", quartier: "7510501", granularity: "quarter", window: 3 })));
  assert.ok(got.includes(k("/sales/trend", { propertyType: "all", granularity: "quarter", window: 3 })));
});

test("dots mode adds the points and the Quartier level adds its stats", () => {
  const all = { propertyType: "all" };
  const dots = keys("map=dots&level=quartier");
  assert.ok(dots.includes(k("/sales/points", all)));
  assert.ok(!dots.some((x) => x.includes("by-quartier")), "no Quartier stats in dots mode");
  const level = keys("level=quartier");
  assert.ok(level.includes(k("/sales/by-quartier", all)));
  assert.ok(level.includes(k("/sales/area-trend", { ...all, level: "quartier", granularity: "quarter", window: 4 })));
  assert.ok(!level.some((x) => x.includes("/sales/points")));
  const change = keys("level=quartier&map=change");
  assert.ok(change.includes(k("/sales/by-quartier", all)));
  assert.ok(!change.some((x) => x.includes('"quartier"')), "Quartier trend only in level mode");
});

test("the rank group picks the heat map's level", () => {
  assert.ok(keys("rank=92").includes(k("/sales/area-trend", { propertyType: "all", level: "commune", granularity: "quarter", window: 1 })));
});

test("the sort and the smoothing choice reach the keys", () => {
  const choices: PanelChoices = { smooth: { gran: "quarter", isQuartier: false, on: true }, sortBy: "price", sortDir: "asc" };
  const got = keys("", choices);
  assert.ok(got.includes(k("/sales/transactions", { propertyType: "all", sortBy: "price", sortDir: "asc", limit: 15, offset: 0 })));
  assert.ok(got.includes(k("/sales/trend", { propertyType: "all", granularity: "quarter", window: 3 })));
});

test("the smoothing choice applies only to its granularity and level", () => {
  const on = (gran: "month" | "quarter" | "year", isQuartier: boolean) => ({ gran, isQuartier, on: true });
  const off = (gran: "month" | "quarter" | "year", isQuartier: boolean) => ({ gran, isQuartier, on: false });
  assert.equal(trendWindow("year", true, on("year", true)), 1);
  assert.equal(trendWindow("month", false, null), 3);
  assert.equal(trendWindow("quarter", true, null), 3);
  assert.equal(trendWindow("quarter", false, null), 1);
  assert.equal(trendWindow("quarter", false, on("quarter", false)), 3);
  assert.equal(trendWindow("quarter", true, off("quarter", true)), 1);
  assert.equal(trendWindow("quarter", true, off("quarter", false)), 3, "a choice for another level does not apply");
  assert.equal(trendWindow("month", false, off("quarter", false)), 3, "a choice for another granularity does not apply");
  assert.equal(smoothOn("quarter", false, on("quarter", false)), true);
  assert.equal(smoothOn("year", false, null), false);
});

test("the server warms every request of each Area's default view", () => {
  const NUMBERS = new Set(["arrondissement", "window", "limit", "offset"]);
  const warmed = new Set(warmUrls(["7510501"], ["78646"]).map((u) => {
    const [path, query] = u.split("?");
    const params = Object.fromEntries([...new URLSearchParams(query ?? "")].map(([name, v]) => [name, NUMBERS.has(name) ? Number(v) : v]));
    return k(path!, params);
  }));
  for (const search of ["", "arr=7", "q=7510501", "commune=78646", "dept=93"]) {
    for (const key of keys(search)) assert.ok(warmed.has(key), `${search || "Paris"}: ${key}`);
  }
});

test("every query key equals the key of the panel's hook", () => {
  const view = parseView("q=7510501&type=Maison&from=2022-01-01&to=2022-06-30&gran=month");
  const got = keys("q=7510501&type=Maison&from=2022-01-01&to=2022-06-30&gran=month");
  assert.ok(got.includes(hashKey(getGetSalesSummaryQueryKey(summaryParams(view)))));
  assert.ok(got.includes(hashKey(getGetSalesTrendQueryKey(trendParams(view, DEFAULT)))));
  assert.ok(got.includes(hashKey(getListTransactionsQueryKey(transactionParams(view, DEFAULT, 0)))));
  assert.ok(got.includes(k("/sales/summary", { propertyType: "Maison", quartier: "7510501", from: "2022-01-01", to: "2022-06-30" })));
});
