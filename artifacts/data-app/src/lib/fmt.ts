import { interpolateMagma, interpolateRdBu } from "d3-scale-chromatic";

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
export const kShort = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`);

export function makeScale(min: number, max: number) {
  const span = Math.max(1, max - min);
  return (v: number) => {
    const t = Math.min(1, Math.max(0, (v - min) / span));
    return interpolateMagma(0.93 - 0.78 * t);
  };
}

export const arrLabel = (n: number) => (n === 1 ? "1er" : `${n}e`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const longMonthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${LONG_MONTHS[m - 1]} ${y}`;
};
export const dateLabel = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number);
  return `${dd} ${MONTHS[m - 1]} ${y}`;
};

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
export function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}
