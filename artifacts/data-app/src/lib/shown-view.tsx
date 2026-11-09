import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AreaVia } from "./analytics";
import type { Area } from "./areas";
import { selectionQueries, type PanelChoices } from "./selection-queries";
import { viewQuery, type ViewState } from "./view-state";

// A slow or failing request must not freeze the page: after this wait it swaps, and that panel shows its loading
// state, then its error.
const MAX_WAIT_MS = 3000;

/**
 * The page keeps two views. The requested view drives the filter buttons and the URL at once. The shown view drives
 * every panel and heading. It changes when all the data of the requested view is loaded, so the page swaps in
 * one redraw and never shows one Area's figures under another Area's name. A slow view swaps after MAX_WAIT_MS,
 * and a request that fails shows its error in its own panel. A view whose requests wait for the network because the
 * browser is offline does not swap: `failed` is true, the page keeps the shown view with its own figures and offers
 * `retry`. It swaps by itself when the requests succeed, for example when the connection comes back.
 */
export function useShownView(view: ViewState, choices: PanelChoices): { shown: ViewState; updating: boolean; failed: boolean; retry: () => void } {
  const qc = useQueryClient();
  const [shown, setShown] = useState(view);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  const key = viewQuery(view);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    let live = true;
    const next = viewRef.current;
    const queries = selectionQueries(next, choicesRef.current);
    // A request with no data that waits for the network: React Query pauses requests while the browser is offline.
    const stuck = () => queries.some((o) => {
      const st = qc.getQueryState(o.queryKey);
      return !!st && st.data === undefined && st.fetchStatus === "paused";
    });
    const settle = () => {
      if (!live) return;
      if (stuck()) { setFailedKey(key); return; }
      setFailedKey(null);
      setShown((s) => (viewQuery(s) === key ? s : next));
    };
    // prefetchQuery never rejects. Older requests are not cancelled: they fill the cache for a Visitor who comes back.
    const timer = setTimeout(settle, MAX_WAIT_MS);
    Promise.all(queries.map((o) => qc.prefetchQuery(o))).then(() => { clearTimeout(timer); settle(); });
    return () => { live = false; clearTimeout(timer); };
  }, [key, qc, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const failed = failedKey === key && viewQuery(shown) !== key;
  return { shown, updating: viewQuery(shown) !== key && !failed, failed, retry };
}

export type Patch = (p: Partial<ViewState> | ((s: ViewState) => Partial<ViewState>)) => void;

/** The requested view, for the controls that must answer a click at once. */
export const RequestedView = createContext<{ view: ViewState; patch: Patch; selectArea: (a: Area, via: AreaVia) => void; updating: boolean; failed: boolean; retry: () => void } | null>(null);

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
