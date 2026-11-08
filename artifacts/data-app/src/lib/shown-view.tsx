import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AreaVia } from "./analytics";
import type { Area } from "./areas";
import { selectionQueries, type PanelChoices } from "./selection-queries";
import { viewQuery, type ViewState } from "./view-state";

// A request that never answers must not freeze the page: after this wait it swaps, and that panel shows its loading state.
const MAX_WAIT_MS = 3000;

/**
 * The page keeps two views. The requested view drives the filter buttons and the URL at once. The shown view drives
 * every panel and heading. It changes when all the data of the requested view is loaded, so the page swaps in
 * one redraw and never shows one Area's figures under another Area's name. It changes after MAX_WAIT_MS at the latest.
 */
export function useShownView(view: ViewState, choices: PanelChoices): { shown: ViewState; updating: boolean } {
  const qc = useQueryClient();
  const [shown, setShown] = useState(view);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  const key = viewQuery(view);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    let live = true;
    const next = viewRef.current;
    // prefetchQuery never rejects, so a failed request still lets the page switch, and that panel shows its error.
    // Older requests are not cancelled: they fill the cache for a Visitor who comes back.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<void>((done) => { timer = setTimeout(done, MAX_WAIT_MS); });
    Promise.race([Promise.all(selectionQueries(next, choicesRef.current).map((o) => qc.prefetchQuery(o))), waited]).then(() => {
      if (live) setShown((s) => (viewQuery(s) === key ? s : next));
    });
    return () => { live = false; clearTimeout(timer); };
  }, [key, qc]);
  return { shown, updating: viewQuery(shown) !== key };
}

export type Patch = (p: Partial<ViewState> | ((s: ViewState) => Partial<ViewState>)) => void;

/** The requested view, for the controls that must answer a click at once. */
export const RequestedView = createContext<{ view: ViewState; patch: Patch; selectArea: (a: Area, via: AreaVia) => void; updating: boolean } | null>(null);

export function useRequestedView() {
  const v = useContext(RequestedView);
  if (!v) throw new Error("useRequestedView needs a RequestedView provider");
  return v;
}

/** Panel settings that change requests, kept apart so that a Selection click does not redraw the panels that read them. */
export const PanelChoicesContext = createContext<{ choices: PanelChoices; setChoices: Dispatch<SetStateAction<PanelChoices>> } | null>(null);

export function usePanelChoices() {
  const v = useContext(PanelChoicesContext);
  if (!v) throw new Error("usePanelChoices needs a PanelChoicesContext provider");
  return v;
}
