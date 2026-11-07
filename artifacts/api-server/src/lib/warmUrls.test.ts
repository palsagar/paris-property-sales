import assert from "node:assert/strict";
import { test } from "node:test";
import { warmUrls } from "./warmUrls";

const quartiers = ["7510101", "7510102"];
const communes = ["92012", "78646", "93066"];
const urls = warmUrls(quartiers, communes);
const params = (u: string) => new URLSearchParams(u.split("?")[1] ?? "");

test("the list has seven URLs for each Area and ten shared URLs", () => {
  const areas = 1 + 20 + 3 + quartiers.length + communes.length;
  assert.equal(urls.length, 7 * areas + 10);
  for (const area of ["arrondissement=5", "department=93", "quartier=7510102", "commune=78646"]) {
    assert.equal(urls.filter((u) => u.includes(`${area}&`) || u.endsWith(area)).length, 7, area);
  }
});

test("no URL carries from, to, or a property type other than all", () => {
  for (const u of urls) {
    const p = params(u);
    assert.ok(!p.has("from") && !p.has("to"), u);
    if (p.has("propertyType")) assert.equal(p.get("propertyType"), "all", u);
  }
});

test("a Quartier's trend uses a window of 3, others a window of 1", () => {
  const trend = (area: string) => urls.filter((u) => u.startsWith("/sales/trend?") && u.includes(area) && params(u).get("granularity") === "quarter");
  assert.deepEqual(trend("quartier=7510101").map((u) => params(u).get("window")), ["3"]);
  assert.deepEqual(trend("arrondissement=5&").map((u) => params(u).get("window")), ["1"]);
  assert.deepEqual(trend("commune=92012").map((u) => params(u).get("window")), ["1"]);
  assert.ok(urls.includes("/sales/trend?propertyType=all&granularity=quarter&window=3"), "the Paris line beside a Quartier");
  assert.ok(urls.includes("/sales/trend?propertyType=all&granularity=month&window=1"), "the slider's chart for Paris");
});

test("the shared URLs cover the map, the ranking, the heat map and the boundaries", () => {
  for (const u of [
    "/sales/by-arrondissement?propertyType=all",
    "/sales/by-commune?propertyType=all",
    "/sales/area-trend?level=arrondissement&propertyType=all&granularity=quarter&window=1",
    "/sales/area-trend?level=arrondissement&propertyType=all&granularity=quarter&window=4",
    "/sales/area-trend?level=commune&propertyType=all&granularity=quarter&window=1",
    "/sales/area-trend?level=commune&propertyType=all&granularity=quarter&window=4",
    "/geo/arrondissements", "/geo/quartiers", "/geo/communes",
  ]) assert.ok(urls.includes(u), u);
  assert.ok(urls.includes("/sales/transactions?propertyType=all&commune=78646&sortBy=date&sortDir=desc&limit=15&offset=0"));
});

test("no URL is repeated", () => {
  assert.equal(new Set(urls).size, urls.length);
});

test("the list holds no /sales/points URL", () => {
  assert.ok(!urls.some((u) => u.startsWith("/sales/points")));
});
