/**
 * DVF writes street names in capitals with short street types. The data build title-cases them ("Car De L Odeon"),
 * so this writes the common types in full and puts the French small words in lower case: "Carrefour de l'Odeon".
 * DVF has no accents, and this does not add them.
 */
const TYPES: Record<string, string> = {
  all: "Allée", av: "Avenue", bd: "Boulevard", car: "Carrefour", che: "Chemin", chem: "Chemin", chs: "Chaussée",
  cite: "Cité", crs: "Cours", dom: "Domaine", dne: "Domaine", esp: "Esplanade", imp: "Impasse", jard: "Jardin",
  pas: "Passage", pass: "Passage", pl: "Place", prom: "Promenade", prv: "Parvis", res: "Résidence", rle: "Ruelle",
  rpt: "Rond-point", rte: "Route", sen: "Sente", sq: "Square", tra: "Traverse", tsse: "Terrasse", vla: "Villa",
};
/** Short forms inside a name. */
const WORDS: Record<string, string> = { st: "Saint", ste: "Sainte" };
const SMALL = new Set(["de", "du", "des", "la", "le", "les", "et", "au", "aux", "sur", "sous", "en"]);

export function streetName(raw: string): string {
  const words = raw.trim().split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!, lower = w.toLowerCase();
    if (i === 0 && TYPES[lower]) { out.push(TYPES[lower]); continue; }
    if (i === 0) { out.push(w); continue; }
    // "L Odeon" and "D Arc" lost their apostrophe; "L'Europe" kept it.
    const elided = /^([ld])'(.+)$/i.exec(w);
    if (elided) { out.push(`${elided[1]!.toLowerCase()}'${elided[2]}`); continue; }
    if ((lower === "l" || lower === "d") && i + 1 < words.length) { out.push(`${lower}'${words[++i]}`); continue; }
    if (SMALL.has(lower)) { out.push(lower); continue; }
    out.push(WORDS[lower] ?? w);
  }
  return out.join(" ");
}
