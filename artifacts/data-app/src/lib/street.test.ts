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

test("an article stays capitalised in a proper name and is lower case after a preposition", () => {
  assert.equal(streetName("Rue La Fayette"), "Rue La Fayette");
  assert.equal(streetName("Rue Le Peletier"), "Rue Le Peletier");
  assert.equal(streetName("Rue La Boetie"), "Rue La Boetie");
  assert.equal(streetName("Rue De La Paix"), "Rue de la Paix");
  assert.equal(streetName("Av Du General Le Clerc"), "Avenue du General Le Clerc");
});

test("an unknown street type and an empty street stay as they are", () => {
  assert.equal(streetName("Vc Ham Michel Ange"), "Vc Ham Michel Ange");
  assert.equal(streetName(""), "");
});
