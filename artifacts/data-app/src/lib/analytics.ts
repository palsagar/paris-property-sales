import type { GranularityParameter, ListTransactionsSortBy, PropertyTypeParameter } from "@workspace/api-client-react";
import { DEPARTMENT_NAMES, type Area, type RankGroup } from "./areas";
import { arrLabel } from "./fmt";
import type { MapLevel, MapMode, ViewState } from "./view-state";

/**
 * Analytics events, sent to Umami. The server adds the Umami script only when it is configured (api-server lib/umami.ts),
 * so without it every call here does nothing.
 *
 * Rules (docs/architecture.md, "Analytics"):
 * - An event describes the Selection or the control used. It never carries anything about a single Sale: no id,
 *   street, price or position.
 * - The text typed in the area search box is never sent.
 * - An event fires when the Visitor changes something, not on a click that changes nothing.
 * A new control adds its event to `Events` below.
 */

type AreaLevel = "paris" | "arrondissement" | "quartier" | "commune" | "department";
export type AreaProps = { level: AreaLevel; area: string; code: string };
/** The control a Visitor used to choose an Area. */
export type AreaVia = "buttons" | "search" | "map" | "dot" | "ranking" | "heatmap" | "sales-list" | "back-link";
type TypeName = "all" | "apartment" | "house";
/** A Period as months (YYYY-MM). Both are left out for all the dates of the release. */
type PeriodProps = { from?: string; to?: string };

export interface Events {
  /** The Selection a Visitor arrives with, sent only when a link or bookmark carries settings. */
  "open": AreaProps & PeriodProps & { type: TypeName; map: MapMode };
  "select-area": AreaProps & { via: AreaVia };
  "select-property-type": { type: TypeName };
  "change-period": PeriodProps & { via: "preset" | "slider"; preset?: "all" | "year" | "last-12-months" };
  "change-map-mode": { mode: MapMode };
  "change-map-level": { level: MapLevel };
  "time-travel": { via: "play" | "slider" | "heatmap-column" };
  "change-ranking-group": { group: RankGroup };
  "sort-ranking": { by: "price" | "change" };
  "change-heatmap-colour": { by: "price" | "change" };
  "change-granularity": { gran: GranularityParameter };
  "toggle-smoothing": { on: boolean };
  "toggle-band": { on: boolean };
  "sort-sales": { column: ListTransactionsSortBy; dir: "asc" | "desc" };
  /** The page now shown, counted from 1. */
  "page-sales": { page: number };
  /** The panel whose CSV was downloaded, by its test id. */
  "export-csv": { panel: string };
  "print": undefined;
  "toggle-dark-mode": { on: boolean };
  "refresh": undefined;
  "set-auto-refresh": { interval: "off" | "5m" | "15m" | "1h" | "24h" };
}

type Umami = { track: (...args: unknown[]) => unknown };
type Send = (u: Umami) => void;

const umami = (): Umami | undefined => (globalThis as { umami?: Umami }).umami;
const run = (u: Umami, send: Send) => { try { send(u); } catch { /* analytics never breaks the page */ } };

// The script loads with `async`, so the first events can come before it. They wait and go out when it loads. A blocked
// script may fail before the first event, when no listener is there to clear the queue, so the limit bounds what stays.
const MAX_WAITING = 50;
const waiting: Send[] = [];
let watched: EventTarget | null = null;

function flush() {
  const u = umami();
  for (const send of waiting.splice(0)) if (u) run(u, send);
}

// On a later task, so that analytics adds no work to the click's own frame.
function later(send: Send) {
  setTimeout(() => {
    const u = umami();
    if (u) { run(u, send); return; }
    const script = typeof document === "undefined" ? null : document.querySelector("script[data-website-id]");
    if (!script) return;
    if (waiting.length < MAX_WAITING) waiting.push(send);
    if (watched !== script) {
      watched = script;
      script.addEventListener("load", flush, { once: true });
      script.addEventListener("error", () => { waiting.length = 0; }, { once: true });
    }
  }, 0);
}

export function track<K extends keyof Events>(name: K, ...props: Events[K] extends undefined ? [] : [Events[K]]): void {
  const data = props[0];
  later((u) => u.track(name, data));
}

/** One page view for each visit. The query string holds the Selection, which the events record, so it is left out. */
export function trackPageview(): void {
  later((u) => u.track((p: { url?: string }) => ({ ...p, url: (p.url ?? "/").split("?")[0] })));
}

export function areaProps(a: Area, names: ReadonlyMap<string, string>): AreaProps {
  switch (a.kind) {
    case "paris": return { level: "paris", area: "Paris", code: "paris" };
    case "arr": return { level: "arrondissement", area: `Paris ${arrLabel(a.arr)}`, code: String(a.arr) };
    case "q": return { level: "quartier", area: names.get(a.id) ?? a.id, code: a.id };
    case "commune": return { level: "commune", area: names.get(a.id) ?? a.id, code: a.id };
    case "department": return { level: "department", area: DEPARTMENT_NAMES[a.id], code: a.id };
  }
}

export const typeName = (p: PropertyTypeParameter): TypeName => (p === "Appartement" ? "apartment" : p === "Maison" ? "house" : "all");

/** The months of a Period. Both are left out when it covers all the dates of the release. */
export function periodProps(from?: string, to?: string): PeriodProps {
  return from || to ? { ...(from && { from: from.slice(0, 7) }), ...(to && { to: to.slice(0, 7) }) } : {};
}

export function openProps(v: ViewState, names: ReadonlyMap<string, string>): Events["open"] {
  return { ...areaProps(v.area, names), type: typeName(v.ptype), ...periodProps(v.from, v.to), map: v.mapMode };
}
