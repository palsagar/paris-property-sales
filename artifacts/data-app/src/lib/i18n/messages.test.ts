import { test } from "node:test";
import assert from "node:assert/strict";
import { en } from "./en";
import { fr } from "./fr";

type Node = unknown;
/** Every leaf of a texts object, with its path. A function text is called with "2" for each argument, which works as a number and as a string. */
function leaves(o: Node, path = ""): [string, string, "string" | "function"][] {
  if (typeof o === "string") return [[path, o, "string"]];
  if (typeof o === "function") {
    const args = Array.from({ length: o.length }, () => "2");
    return [[path, String((o as (...a: string[]) => unknown)(...args)), "function"]];
  }
  if (Array.isArray(o)) return o.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  return Object.entries(o as Record<string, Node>).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
}

// The words that CONTEXT.md keeps the same in both languages, the switch labels and the author's name.
const SAME = /^(DVF|Mutation|Arrondissement|Quartier|Commune|EN|FR|Sagar Pal|Language · Langue|)$/;

test("French is complete", () => {
  const f = new Map(leaves(fr).map(([p, , k]) => [p, k]));
  for (const [p, , k] of leaves(en)) assert.equal(f.get(p), k, `fr.${p} is missing or is not a ${k}`);
});

test("French is not English", () => {
  const e = new Map(leaves(en).map(([p, v]) => [p, v]));
  for (const [p, v] of leaves(fr)) if (!SAME.test(v)) assert.notEqual(v, e.get(p), `fr.${p} is the English text "${v}"`);
});

test("French avoids banlieue, zone and transaction", () => {
  for (const [p, v] of leaves(fr)) assert.doesNotMatch(v, /\b(banlieue|zone|transaction)s?\b/i, `fr.${p}`);
});

test("French puts a no-break space, never a plain one, before : ; ? ! and %", () => {
  for (const [p, v] of leaves(fr)) assert.doesNotMatch(v, / [:;?!%]/, `fr.${p} has a plain space before a sign: "${v}"`);
});
