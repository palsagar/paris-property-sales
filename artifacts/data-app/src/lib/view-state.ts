import { useCallback, useEffect, useState } from "react";
import { nearestValidPeriod } from "./period";
import { groupOfArea, type Area, type DepartmentId, type RankGroup } from "./areas";
import type { PropertyTypeParameter, GranularityParameter } from "@workspace/api-client-react";

export type MapMode = "level" | "change" | "dots";
export type MapLevel = "arr" | "quartier";

export interface ViewState {
  ptype: PropertyTypeParameter;
  area: Area;
  rank: RankGroup;
  from?: string;
  to?: string;
  mapMode: MapMode;
  mapLevel: MapLevel;
  gran: GranularityParameter;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const RANKS: readonly string[] = ["paris", "92", "93", "94", "major"];

/** Reads a view from a query string. Unknown or invalid values fall back to the default view. */
export function parseView(search: string): ViewState {
  const sp = new URLSearchParams(search);
  const t = sp.get("type");
  const arr = Number(sp.get("arr"));
  const q = sp.get("q");
  const commune = sp.get("commune");
  const dept = sp.get("dept");
  const from = sp.get("from") ?? undefined;
  const to = sp.get("to") ?? undefined;
  const mm = sp.get("map");
  const ml = sp.get("level");
  const g = sp.get("gran");
  const r = sp.get("rank");
  const area: Area =
    q && /^\d{7}$/.test(q) ? { kind: "q", id: q }
    : commune && /^\d{5}$/.test(commune) ? { kind: "commune", id: commune }
    : dept === "92" || dept === "93" || dept === "94" ? { kind: "department", id: dept as DepartmentId }
    : Number.isInteger(arr) && arr >= 1 && arr <= 20 ? { kind: "arr", arr }
    : { kind: "paris" };
  return {
    ptype: t === "Appartement" || t === "Maison" ? t : "all",
    area,
    rank: r && RANKS.includes(r) ? (r as RankGroup) : groupOfArea(area),
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
    mapMode: mm === "change" || mm === "dots" ? mm : "level",
    mapLevel: ml === "quartier" ? "quartier" : "arr",
    gran: g === "month" || g === "year" ? g : "quarter",
  };
}

/** The query string (without "?") that reproduces a view. Defaults are left out. */
export function viewQuery(s: ViewState): string {
  const sp = new URLSearchParams();
  if (s.ptype !== "all") sp.set("type", s.ptype);
  if (s.area.kind === "arr") sp.set("arr", String(s.area.arr));
  if (s.area.kind === "q") sp.set("q", s.area.id);
  if (s.area.kind === "department") sp.set("dept", s.area.id);
  if (s.area.kind === "commune") sp.set("commune", s.area.id);
  if (s.rank !== groupOfArea(s.area)) sp.set("rank", s.rank);
  if (s.from) sp.set("from", s.from);
  if (s.to) sp.set("to", s.to);
  if (s.mapMode !== "level") sp.set("map", s.mapMode);
  if (s.mapLevel !== "arr") sp.set("level", s.mapLevel);
  if (s.gran !== "quarter") sp.set("gran", s.gran);
  return sp.toString();
}

/** View state mirrored into the query string so a link reproduces the view. */
export function useViewState(datasetFrom: string, datasetTo: string) {
  // The first state holds the moved dates, so no request uses the expired ones.
  const [first] = useState(() => {
    const s = parseView(window.location.search);
    const p = nearestValidPeriod(s.from, s.to, datasetFrom, datasetTo);
    return { state: { ...s, from: p.from, to: p.to }, movedTo: p.moved ? { from: p.from, to: p.to } : null };
  });
  const [state, setState] = useState<ViewState>(first.state);
  useEffect(() => {
    const qs = viewQuery(state);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [state]);
  const patch = useCallback(
    (p: Partial<ViewState> | ((s: ViewState) => Partial<ViewState>)) => setState((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) })),
    [],
  );
  return [state, patch, first.movedTo] as const;
}
