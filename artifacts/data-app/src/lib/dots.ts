import type { SalePoint } from "@workspace/api-client-react";
import { pointArea, type Area } from "./areas";
import { escapeHtml } from "./escape";
import { eur, num, sqm } from "./fmt";
import type { MapLevel } from "./view-state";

/** The Sales at one rounded position in one Area, drawn as one dot. */
export interface SaleDot {
  key: string;
  lat: number;
  lon: number;
  /** Newest first, as the server sends them. */
  sales: SalePoint[];
  medianPricePerSqm: number;
  radius: number;
  area: Area;
}

/** Positions are rounded to 0.001°. A nudge below half of that on each axis keeps a dot inside its own cell. */
const NUDGE = 0.0009;

/** FNV-1a hash of a string, as an unsigned 32-bit integer. */
function fnv1a(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const offset = (key: string, seed: number) => (fnv1a(key, seed) / 2 ** 32 - 0.5) * NUDGE;

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** One dot per position and Area, moved by a fixed amount so that the dots do not form a grid. */
export function groupDots(points: SalePoint[], level: MapLevel): SaleDot[] {
  const groups = new Map<string, { area: Area; sales: SalePoint[] }>();
  for (const p of points) {
    const area = pointArea(p, level);
    const key = `${p.lat},${p.lon}|${JSON.stringify(area)}`;
    const g = groups.get(key);
    if (g) g.sales.push(p);
    else groups.set(key, { area, sales: [p] });
  }
  return [...groups].map(([key, { area, sales }]) => ({
    key,
    lat: sales[0]!.lat + offset(key, 1),
    lon: sales[0]!.lon + offset(key, 2),
    sales,
    medianPricePerSqm: median(sales.map((s) => s.pricePerSqm)),
    radius: Math.min(9, 3 + Math.sqrt(sales.length - 1)),
    area,
  }));
}

const typeLabel = (t: string) => (t === "Maison" ? "House" : "Apartment");
const ROWS = 8;

/** Tooltip HTML of a dot. It lists Sales and never states a median. */
export function dotTooltip(dot: SaleDot, areaName: string): string {
  const name = escapeHtml(areaName);
  if (dot.sales.length === 1) {
    const p = dot.sales[0]!;
    return `<div class="pt-title">${escapeHtml(p.address)}</div><div class="pt-sub">${name}</div><div>${typeLabel(p.type)} of ${num(p.surface)} m², sold on ${escapeHtml(p.date.slice(0, 10))}</div><div class="pt-num">${eur(p.price)}, <b>${sqm(p.pricePerSqm)}</b></div>`;
  }
  const rows = dot.sales.slice(0, ROWS).map((p) =>
    `<div class="pt-row">${escapeHtml(p.date.slice(0, 10))}, ${escapeHtml(p.address)}, ${typeLabel(p.type).toLowerCase()} of ${num(p.surface)} m², <span class="pt-num">${eur(p.price)}</span></div>`);
  const rest = dot.sales.length - ROWS;
  return `<div class="pt-title">${name}</div><div class="pt-sub">${num(dot.sales.length)} sales near here</div><div class="pt-rows">${rows.join("")}</div>` +
    (rest > 0 ? `<div class="pt-sub">and ${num(rest)} more sales</div>` : "");
}
