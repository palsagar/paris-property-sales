import { test } from "node:test";
import assert from "node:assert/strict";
import { areaParams, featureArea, featureId, featureState, groupOfArea, keepInSameArea, saleArea, searchScore, searchValue } from "./areas";

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

test("saleArea gives a Paris Sale its Arrondissement and a Commune Sale its Commune", () => {
  assert.deepEqual(saleArea({ arrondissement: 5, commune: null, communeName: null }), { id: "5", label: "5e", area: { kind: "arr", arr: 5 } });
  assert.deepEqual(saleArea({ arrondissement: null, commune: "99001", communeName: "Ville" }), { id: "99001", label: "Ville", area: { kind: "commune", id: "99001" } });
});

test("keepInSameArea keeps the previous data only while the Area stays the same", () => {
  const query = (params: object) => ({ queryKey: ["/api/sales/summary", params] });
  const commune = { propertyType: "all", commune: "99001" };
  assert.equal(keepInSameArea(commune)("old", query({ propertyType: "Maison", commune: "99001", from: "2024-01-01" })), "old");
  assert.equal(keepInSameArea({ propertyType: "all" })("old", query({ propertyType: "Maison" })), "old");
  assert.equal(keepInSameArea(commune)("old", query({ propertyType: "all" })), undefined);
  assert.equal(keepInSameArea({ propertyType: "all" })("old", query(commune)), undefined);
  assert.equal(keepInSameArea({ arrondissement: 5 })("old", query({ arrondissement: 6 })), undefined);
  assert.equal(keepInSameArea({ arrondissement: 5 })("old", query({ quartier: "7510501" })), undefined);
  assert.equal(keepInSameArea({ department: "92" })("old", query({ department: "93" })), undefined);
  assert.equal(keepInSameArea(commune)(undefined, undefined), undefined);
});

test("searchScore needs every typed word in the name, and takes no loose fuzzy match", () => {
  const stMaur = searchValue("Saint-Maur-des-Fossés", "94068");
  assert.equal(searchScore(stMaur, "saint maur"), 2);
  assert.equal(searchScore(stMaur, "Saint-Maur"), 2);
  assert.equal(searchScore(stMaur, "fossés"), 1);
  assert.equal(searchScore(searchValue("Évry-Courcouronnes", "91228"), "evry"), 2);
  assert.equal(searchScore(searchValue("Ville-d'Avray", "92077"), "evry"), 0);
  assert.equal(searchScore(searchValue("Saint-Germain-l'Auxerrois", "7510101"), "saint maur"), 0);
  assert.equal(searchScore(searchValue("Quinze-Vingts", "7511201"), "zzzz"), 0);
});

test("searchScore accepts a curly apostrophe", () => {
  const lhay = searchValue("L'Haÿ-les-Roses", "94038");
  assert.equal(searchScore(lhay, "l’hay"), 2);
  assert.equal(searchScore(lhay, "l'hay"), 2);
});

test("searchScore accepts St and Ste for Saint and Sainte", () => {
  assert.equal(searchScore(searchValue("Saint-Maur-des-Fossés", "94068"), "st maur"), 2);
  assert.equal(searchScore(searchValue("Saint-Denis", "93066"), "st denis"), 3);
  assert.equal(searchScore(searchValue("Sainte-Marguerite", "7511102"), "ste marguerite"), 3);
  assert.equal(searchScore(searchValue("Saint-Denis", "93066"), "ste denis"), 0);
});

test("searchScore ranks an exact name above a name that starts with the text, and that above a plain match", () => {
  const commune = searchValue("Saint-Denis", "93066");
  const department = searchValue("Seine-Saint-Denis", "93");
  assert.equal(searchScore(commune, "Saint-Denis"), 3);
  assert.equal(searchScore(commune, "saint denis"), 3);
  assert.equal(searchScore(department, "Saint-Denis"), 1);
  assert.equal(searchScore(searchValue("Saint-Germain-en-Laye", "78551"), "Saint-Germain"), 2);
  assert.equal(searchScore(searchValue("Saint-Germain-en-Laye", "78551"), "Saint-Germain-en-Laye"), 3);
  assert.equal(searchScore(searchValue("Créteil", "94028"), "creteil"), 3);
  assert.equal(searchScore(searchValue("Évry-Courcouronnes", "91228"), "evry"), 2);
});
