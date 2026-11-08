/** The English texts. fr.ts has the same shape, so the type check finds a missing French text. */
export const en = {
  header: {
    siteName: "Paris & Suburbs Property Sales",
  },
  months: {
    short: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    long: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  },
  fmt: {
    tooFew: "Too few sales",
    allParis: "All Paris",
    /** An Area's name after the words that come before it in a sentence: "in the 11e arrondissement". */
    inArea: (name: string) => (name === "All Paris" ? "all of Paris" : /arrondissement$/.test(name) ? `the ${name}` : name),
    quarter: (y: number, q: number) => `${y} Q${q}`,
    houseShare: (pct: number) => `${pct}% houses`,
    houseShareWarning: (pct: number) => `Houses are ${pct}% of these sales. A house's price includes its land, so this median is harder to compare.`,
  },
};

export type Messages = typeof en;
