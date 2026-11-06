import { test } from "node:test";
import assert from "node:assert/strict";
import { areaParams, featureArea, featureId, featureState, groupOfArea, searchValue } from "./areas";

test("areaParams gives the request parameter of each kind", () => {
  assert.deepEqual(areaParams({ kind: "paris" }), {});
  assert.deepEqual(areaParams({ kind: "department", id: "92" }), { department: "92" });
  assert.deepEqual(areaParams({ kind: "arr", arr: 5 }), { arrondissement: 5 });
  assert.deepEqual(areaParams({ kind: "q", id: "7510101" }), { quartier: "7510101" });
  assert.deepEqual(areaParams({ kind: "commune", id: "93066" }), { commune: "93066" });
});

test("groupOfArea reads the first two characters of the code", () => {
  assert.equal(groupOfArea({ kind: "arr", arr: 3 }), "paris");
  assert.equal(groupOfArea({ kind: "department", id: "94" }), "94");
  assert.equal(groupOfArea({ kind: "commune", id: "93066" }), "93");
  assert.equal(groupOfArea({ kind: "commune", id: "78646" }), "major");
});

test("featureArea and featureId read each kind of feature", () => {
  const arr = { arr: 7, name: "7e" };
  const q = { arr: 7, id: "7510701", name: "Q" };
  const c = { id: "92012", name: "C", group: "92" as const };
  assert.deepEqual(featureArea(arr), { kind: "arr", arr: 7 });
  assert.deepEqual(featureArea(q), { kind: "q", id: "7510701" });
  assert.deepEqual(featureArea(c), { kind: "commune", id: "92012" });
  assert.deepEqual([arr, q, c].map(featureId), ["7", "7510701", "92012"]);
});

test("featureState follows the selected Area", () => {
  const arr7 = { arr: 7, name: "7e" };
  const arr8 = { arr: 8, name: "8e" };
  const q = { arr: 7, id: "7510701", name: "Q" };
  const c92 = { id: "92012", name: "A", group: "92" as const };
  const c93 = { id: "93066", name: "B", group: "93" as const };

  for (const f of [arr7, q, c92, c93]) assert.deepEqual(featureState(f, { kind: "paris" }), { selected: false, focus: true });

  const dept = { kind: "department", id: "92" } as const;
  assert.deepEqual(featureState(c92, dept), { selected: true, focus: true });
  assert.deepEqual(featureState(c93, dept), { selected: false, focus: false });

  const commune = { kind: "commune", id: "93066" } as const;
  assert.deepEqual(featureState(c93, commune), { selected: true, focus: true });
  assert.deepEqual(featureState(c92, commune), { selected: false, focus: false });

  const quartier = { kind: "q", id: "7510701" } as const;
  assert.deepEqual(featureState(q, quartier), { selected: true, focus: true });
  assert.deepEqual(featureState(arr7, quartier, 7), { selected: false, focus: true });
  assert.deepEqual(featureState(arr8, quartier, 7), { selected: false, focus: false });
});

test("searchValue finds names without accents and old names", () => {
  assert.ok(searchValue("Créteil", "94028").includes("creteil"));
  assert.ok(searchValue("Évry-Courcouronnes", "91228").includes("evry"));
  assert.ok(searchValue("Saint-Denis", "93066").includes("pierrefitte"));
  assert.ok(searchValue("L'Île-Saint-Denis", "93039").includes("ile-saint-denis"));
});
