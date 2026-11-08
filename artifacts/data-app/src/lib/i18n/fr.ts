import type { Messages } from "./en";

const DEPARTMENTS: Record<string, string> = {
  "Hauts-de-Seine": "dans les Hauts-de-Seine",
  "Seine-Saint-Denis": "en Seine-Saint-Denis",
  "Val-de-Marne": "dans le Val-de-Marne",
};

/** Les textes en français. Les termes viennent de CONTEXT.md (_French_). */
export const fr: Messages = {
  header: {
    siteName: "Ventes immobilières à Paris et alentours",
  },
  months: {
    short: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
    long: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  },
  fmt: {
    tooFew: "Trop peu de ventes",
    allParis: "Tout Paris",
    /** Le nom d'un Secteur avec sa préposition : « dans le 11e arrondissement », « à Montreuil ». */
    inArea: (name: string) =>
      name === "Tout Paris" ? "dans tout Paris" : /arrondissement$/.test(name) ? `dans le ${name}` : DEPARTMENTS[name] ?? `à ${name}`,
    quarter: (y: number, q: number) => `T${q} ${y}`,
    houseShare: (pct: number) => `${pct}% de maisons`,
    houseShareWarning: (pct: number) => `Les maisons font ${pct}% de ces ventes. Le prix d'une maison comprend son terrain, donc cette médiane se compare moins bien.`,
  },
};
