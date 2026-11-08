/** The two languages of the site. The current one is module state, so formatting helpers outside React can read it. */
export type Lang = "en" | "fr";

const KEY = "lang";

/** A Visitor's saved choice wins. Otherwise French when the browser's first language is French, else English. */
export function pickLang(saved: string | null, browser: readonly string[]): Lang {
  if (saved === "en" || saved === "fr") return saved;
  return browser[0]?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** The language to start with. index.html applies the same rule before the first paint. */
export function readLang(): Lang {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* site data blocked: use the browser's language */ }
  return pickLang(saved, typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]);
}

export function saveLang(l: Lang): void {
  try { localStorage.setItem(KEY, l); } catch { /* private mode: the choice lasts for this visit */ }
}

let current: Lang = "en";
export const getLang = (): Lang => current;
/** Sets the module state only. useLanguage().change also saves the choice and redraws the page. */
export const setLang = (l: Lang): void => { current = l; };

/** Picks the singular or plural form with the current language's rules: French uses the singular for 0 and 1. */
export function plural(n: number, one: string, other: string): string {
  return new Intl.PluralRules(current).select(n) === "one" ? one : other;
}
