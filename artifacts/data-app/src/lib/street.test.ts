import { test } from "node:test";
import assert from "node:assert/strict";
import { streetName } from "./street";

test("a DVF street name gets its type in full and French small words in lower case", () => {
  assert.equal(streetName("Car De L Odeon"), "Carrefour de l'Odeon");
  assert.equal(streetName("Rue De Rivoli"), "Rue de Rivoli");
  assert.equal(streetName("Vla Emile Meyer"), "Villa Emile Meyer");
  assert.equal(streetName("Pl Jeanne D Arc"), "Place Jeanne d'Arc");
  assert.equal(streetName("Esp De L'Europe"), "Esplanade de l'Europe");
  assert.equal(streetName("Quai Des Grands Augustins"), "Quai des Grands Augustins");
  assert.equal(streetName("Cloitre St Spire"), "Cloitre Saint Spire");
  assert.equal(streetName("La Mare Des Noyers"), "La Mare des Noyers");
  assert.equal(streetName("Rue Saint-Honore"), "Rue Saint-Honore");
});

test("an unknown street type and an empty street stay as they are", () => {
  assert.equal(streetName("Vc Ham Michel Ange"), "Vc Ham Michel Ange");
  assert.equal(streetName(""), "");
});
