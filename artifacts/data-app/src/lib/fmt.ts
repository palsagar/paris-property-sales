import { interpolateRdBu } from "d3-scale-chromatic";
import type { GranularityParameter } from "@workspace/api-client-react";
import { t } from "./i18n/messages";

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
export const num = (n: number) => nf.format(Math.round(n)).replace(/[\u202f\u00a0]/g, " ");
export const eur = (n: number) => `${num(n)} EUR`;
export function eurShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)} Md EUR`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)} M EUR`;
  if (a >= 1e3) return `${Math.round(n / 1e3)} k EUR`;
  return eur(n);
}
export const sqm = (n: number) => `${num(n)} EUR/m²`;
export const tooFew = () => t().fmt.tooFew;
export const orTooFew = (n: number | null | undefined, format: (n: number) => string) => (n == null ? tooFew() : format(n));
export const sqmOrTooFew = (n: number | null | undefined) => orTooFew(n, sqm);

/** Houses above this share of the Sales (in percent) get a warning. */
const HOUSE_SHARE_LIMIT = 10;
export const houseShareLabel = (share: number | null | undefined) => (share == null ? null : t().fmt.houseShare(Math.round(share)));
export const houseShareWarning = (share: number | null | undefined) =>
  share == null || share <= HOUSE_SHARE_LIMIT
    ? null
    : t().fmt.houseShareWarning(Math.round(share));
export const kShort = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`);

export const arrLabel = (n: number) => (n === 1 ? "1er" : `${n}e`);
/** Joins a figure to its digits and unit with no-break spaces, so "12 054 EUR" never breaks across two lines. */
export const keep = (s: string) => s.replace(/(\d) (?=\d)/g, "$1\u00a0").replace(/(\d) (?=(k|M|Md)?\s?(EUR|m²))/g, "$1\u00a0").replace(/ (EUR|m²)/g, "\u00a0$1");
/**
 * An Area's name as it reads in a sentence: "the 11e arrondissement" in English, "dans le 11e arrondissement" in French.
 * French needs the Area's kind, because a Quartier reads "dans le quartier Halles" and a Commune "à Montreuil".
 */
export const inArea = (name: string, kind?: string) => t().fmt.inArea(name, kind);

const short = (m: number) => t().months.short[m - 1];
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${short(m)} ${y}`;
};
export const longMonthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${t().months.long[m - 1]} ${y}`;
};
export const dateLabel = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number);
  return `${dd} ${short(m)} ${y}`;
};

/** A calendar year of the data. A Partial year names its months, for example "2021, Jul–Dec". Copies the server's yearRanges(). */
export function yearRangeLabel(from: string, to: string): string {
  const y = from.slice(0, 4);
  const first = Number(from.slice(5, 7)), last = Number(to.slice(5, 7));
  if (first === 1 && last === 12) return y;
  return `${y}, ${first === last ? short(first) : `${short(first)}–${short(last)}`}`;
}

/** The label of one time bucket from its first day. Copies the server's labels in English: "2024-03", "2024 Q1", "2024". */
export function bucketLabel(period: string, gran: GranularityParameter): string {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
  if (gran === "month") return period.slice(0, 7);
  if (gran === "quarter") return t().fmt.quarter(y, Math.floor((m - 1) / 3) + 1);
  return String(y);
}

export const pct = (n: number, d = 1) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(d)}%`;

/** Diverging: rises -> bordeaux-red, falls -> blue. */
export function makeDivScale(maxAbs: number) {
  const m = Math.max(1, maxAbs);
  return (v: number) => interpolateRdBu(0.5 - Math.max(-1, Math.min(1, v / m)) * 0.48);
}

export function endOfMonth(dateStr: string) {
  const [y, m] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}
export function monthsBefore(dateStr: string, months: number) {
  const [y, m] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - months, 1));
  return d.toISOString().slice(0, 10);
}
export function monthsBetween(a: string, b: string) {
  const [y1, m1] = a.split("-").map(Number);
  const [y2, m2] = b.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}
export const rangeLabel = (from: string, to: string) => `${monthLabel(from.slice(0, 7))} - ${monthLabel(to.slice(0, 7))}`;
