import { useCallback, useEffect, useRef, useState } from "react";
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
/** A date that exists in the calendar, so "2020-13-45" is not one. */
function isDate(s: string | undefined): s is string {
  const d = s && DATE.test(s) ? new Date(`${s}T00:00:00Z`) : null;
  return !!d && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

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
    from: isDate(from) ? from : undefined,
    to: isDate(to) ? to : undefined,
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

/**
 * How a change of view reaches the browser history. A new Area adds an entry, so the Back button (and the back
 * gesture on a phone) returns to the Area before. Every other change replaces the entry, so dragging the dates or
 * flipping a panel setting does not fill the history.
 */
export function historyMode(prev: Pick<ViewState, "area">, next: Pick<ViewState, "area">): "push" | "replace" {
  return JSON.stringify(prev.area) === JSON.stringify(next.area) ? "replace" : "push";
}

/**
 * The view of a link, with its Period moved inside the data. A Period that covers all the data is left out, as the
 * "All dates" preset does, so a link cleaned of a bad date reads as the default view.
 */
export function linkView(search: string, datasetFrom: string, datasetTo: string): { state: ViewState; moved: boolean } {
  const s = parseView(search);
  const p = nearestValidPeriod(s.from, s.to, datasetFrom, datasetTo);
  const all = (p.from ?? datasetFrom) === datasetFrom && (p.to ?? datasetTo) === datasetTo;
  return { state: { ...s, from: all ? undefined : p.from, to: all ? undefined : p.to }, moved: p.moved };
}

/** View state mirrored into the query string so a link reproduces the view. */
export function useViewState(datasetFrom: string, datasetTo: string) {
  // The first state holds the moved dates, so no request uses the expired ones. Writing it replaces the link's
  // query string, so the address bar shows the cleaned view.
  const [first] = useState(() => {
    const { state, moved } = linkView(window.location.search, datasetFrom, datasetTo);
    return { state, movedTo: moved ? { from: state.from, to: state.to } : null };
  });
  const [state, setState] = useState<ViewState>(first.state);
  const written = useRef<ViewState>(first.state);
  const fromHistory = useRef(false);
  const correcting = useRef(false);
  useEffect(() => {
    const qs = viewQuery(state);
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    // A view restored by Back or Forward is already the current entry.
    if (fromHistory.current) fromHistory.current = false;
    else if (!correcting.current && historyMode(written.current, state) === "push") window.history.pushState(window.history.state, "", url);
    else window.history.replaceState(window.history.state, "", url);
    written.current = state;
    correcting.current = false;
  }, [state]);
  useEffect(() => {
    const onPop = () => {
      fromHistory.current = true;
      setState(linkView(window.location.search, datasetFrom, datasetTo).state);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [datasetFrom, datasetTo]);
  const patch = useCallback(
    (p: Partial<ViewState> | ((s: ViewState) => Partial<ViewState>)) => setState((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) })),
    [],
  );
  // Fixes a view that a link got wrong, such as an Area that does not exist. It replaces the history entry.
  const correct = useCallback((p: Partial<ViewState>) => { correcting.current = true; setState((s) => ({ ...s, ...p })); }, []);
  return [state, patch, first.movedTo, correct] as const;
}
