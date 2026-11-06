import { useEffect, useState } from "react";
import { nearestValidPeriod } from "./period";
import type { PropertyTypeParameter, GranularityParameter } from "@workspace/api-client-react";

export type Area = { kind: "all" } | { kind: "arr"; arr: number } | { kind: "q"; id: string };
export type MapMode = "level" | "change" | "dots";
export type MapLevel = "arr" | "quartier";

export interface ViewState {
  ptype: PropertyTypeParameter;
  area: Area;
  from?: string;
  to?: string;
  mapMode: MapMode;
  mapLevel: MapLevel;
  gran: GranularityParameter;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function read(): ViewState {
  const sp = new URLSearchParams(window.location.search);
  const t = sp.get("type");
  const arr = Number(sp.get("arr"));
  const q = sp.get("q");
  const from = sp.get("from") ?? undefined;
  const to = sp.get("to") ?? undefined;
  const mm = sp.get("map");
  const ml = sp.get("level");
  const g = sp.get("gran");
  return {
    ptype: t === "Appartement" || t === "Maison" ? t : "all",
    area: q && /^\d{7}$/.test(q) ? { kind: "q", id: q } : arr >= 1 && arr <= 20 ? { kind: "arr", arr } : { kind: "all" },
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
    mapMode: mm === "change" || mm === "dots" ? mm : "level",
    mapLevel: ml === "quartier" ? "quartier" : "arr",
    gran: g === "month" || g === "year" ? g : "quarter",
  };
}

/** View state mirrored into the query string so a link reproduces the view. */
export function useViewState(datasetFrom: string, datasetTo: string) {
  // The first state holds the moved dates, so no request uses the expired ones.
  const [first] = useState(() => {
    const s = read();
    const p = nearestValidPeriod(s.from, s.to, datasetFrom, datasetTo);
    return { state: { ...s, from: p.from, to: p.to }, movedTo: p.moved ? { from: p.from, to: p.to } : null };
  });
  const [state, setState] = useState<ViewState>(first.state);
  useEffect(() => {
    const sp = new URLSearchParams();
    if (state.ptype !== "all") sp.set("type", state.ptype);
    if (state.area.kind === "arr") sp.set("arr", String(state.area.arr));
    if (state.area.kind === "q") sp.set("q", state.area.id);
    if (state.from) sp.set("from", state.from);
    if (state.to) sp.set("to", state.to);
    if (state.mapMode !== "level") sp.set("map", state.mapMode);
    if (state.mapLevel !== "arr") sp.set("level", state.mapLevel);
    if (state.gran !== "quarter") sp.set("gran", state.gran);
    const qs = sp.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [state]);
  const patch = (p: Partial<ViewState>) => setState((s) => ({ ...s, ...p }));
  return [state, patch, first.movedTo] as const;
}
