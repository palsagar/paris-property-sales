import { useEffect, useMemo, useRef, useState } from "react";
import { useGetSalesTrend, getGetSalesTrendQueryKey, type YearRange } from "@workspace/api-client-react";
import { ComposedChart, Bar, Line, XAxis, YAxis, Brush, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useChartColors } from "@/components/ui-bits";
import { endOfMonth, monthsBefore, rangeLabel } from "@/lib/fmt";
import { areaParams, keepInSameArea } from "@/lib/areas";
import { timeTrendParams } from "@/lib/selection-queries";
import type { ViewState } from "@/lib/view-state";

/** `chartView` is the shown view, for the small chart. `from` and `to` are the requested Period, for the handles. */
export function TimeControl({ chartView, from, to, datasetFrom, datasetTo, years, onChange, isDark }: {
  chartView: Pick<ViewState, "ptype" | "area">; from?: string; to?: string; datasetFrom: string; datasetTo: string; years: YearRange[];
  onChange: (from?: string, to?: string) => void; isDark: boolean;
}) {
  const c = useChartColors(isDark);
  const params = timeTrendParams(chartView);
  const q = useGetSalesTrend(params, { query: { queryKey: getGetSalesTrendQueryKey(params), placeholderData: keepInSameArea(areaParams(chartView.area)) } });
  const data = useMemo(() => q.data ?? [], [q.data]);
  const periods = data.map((d) => d.period);

  const startIdx = from ? Math.max(0, periods.findIndex((p) => p.slice(0, 7) >= from.slice(0, 7))) : 0;
  let endIdx = periods.length - 1;
  if (to) { const i = periods.map((p) => p.slice(0, 7) <= to.slice(0, 7)).lastIndexOf(true); if (i >= 0) endIdx = i; }

  // A drag or a key press only moves a draft. The change applies when the drag or the key press ends.
  // A draft keeps the data it was made on: the shown view can swap mid-drag, and its indices then point into another timeline.
  type Draft = { s: number; e: number; data: typeof data };
  const pending = useRef<Draft | null>(null);
  const [draftState, setDraft] = useState<Draft | null>(null);
  const draft = draftState?.data === data ? draftState : null;
  const commit = () => {
    const r = pending.current;
    if (!r) return;
    pending.current = null;
    setDraft(null);
    if (r.data !== data) return;
    if (r.s === 0 && r.e === periods.length - 1) onChange(undefined, undefined);
    else onChange(periods[r.s], endOfMonth(periods[r.e]));
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // A committed change redraws the Brush, which loses the keyboard focus. Give it back to the same handle.
  const wrapper = useRef<HTMLDivElement>(null);
  const refocus = useRef(-1);
  const travellers = () => Array.from(wrapper.current?.querySelectorAll<SVGGElement>(".recharts-brush-traveller") ?? []);
  const commitKey = () => {
    if (!pending.current) return;
    refocus.current = travellers().indexOf(document.activeElement as SVGGElement);
    commit();
  };
  useEffect(() => {
    if (refocus.current < 0) return;
    travellers()[refocus.current]?.focus();
    refocus.current = -1;
  }, [startIdx, endIdx]);

  const presets: [string, string | undefined, string | undefined][] = [
    ["All dates", undefined, undefined],
    ...years.map((y) => [y.label, y.from, y.to] as [string, string, string]),
    ["Last 12 months", monthsBefore(datasetTo, 11), datasetTo],
  ];
  const ef = from ?? datasetFrom, et = to ?? datasetTo;

  // The chart element stays the same while a draft changes, so a redraw does not reset the Brush mid-drag.
  const chart = useMemo(() => (
    <ResponsiveContainer width="100%" height={40} debounce={0}>
      <ComposedChart data={data} margin={{ top: 0, right: 6, left: 6, bottom: 0 }}>
        <Brush key={`${startIdx}-${endIdx}-${data.length}`} dataKey="label" height={40} y={0} travellerWidth={8}
          startIndex={startIdx} endIndex={endIdx} stroke={c.accent} fill="transparent"
          tickFormatter={() => ""}
          onChange={(r) => {
            const next = { s: r.startIndex ?? 0, e: r.endIndex ?? data.length - 1, data };
            pending.current = next;
            setDraft(next);
          }}
          onDragEnd={() => commitRef.current()}>
          <ComposedChart data={data}>
            <XAxis dataKey="label" hide />
            <YAxis yAxisId="c" hide domain={[0, "dataMax"]} />
            <YAxis yAxisId="p" hide domain={["dataMin", "dataMax"]} />
            <Bar yAxisId="c" dataKey="count" fill={c.second} fillOpacity={0.3} isAnimationActive={false} />
            <Line yAxisId="p" dataKey="medianPricePerSqm" stroke={c.accent} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </Brush>
      </ComposedChart>
    </ResponsiveContainer>
  ), [data, startIdx, endIdx, c.accent, c.second]);

  return (
    <div className="flex flex-col lg:flex-row lg:items-center gap-x-4 gap-y-2" data-testid="time-control">
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[13px] text-muted-foreground">Period</span>
        <div className="flex flex-wrap rounded-md border bg-card p-0.5">
          {presets.map(([l, f, t]) => {
            const active = (f ?? undefined) === from && (t === undefined ? to === undefined : t === to);
            return (
              <button key={l} onClick={() => onChange(f, t)} data-testid={`preset-${l.replace(/\s/g, "-").toLowerCase()}`}
                aria-pressed={active} className={`px-2.5 h-7 text-[13px] rounded transition-colors ${active ? "bg-foreground text-background" : "hover:bg-muted"}`}>{l}</button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 min-w-[260px] flex items-center gap-3">
        <div ref={wrapper} className="flex-1 h-[40px] relative" onKeyUp={commitKey}>
          {q.isLoading ? <Skeleton className="w-full h-full" /> : data.length > 1 && chart}
        </div>
        <div className="shrink-0 text-right leading-tight">
          <div className="font-num text-[13px] font-medium" data-testid="text-range">{draft ? rangeLabel(periods[draft.s]!, endOfMonth(periods[draft.e]!)) : rangeLabel(ef, et)}</div>
          <div className="text-[12px] text-muted-foreground">Drag the handles to set dates</div>
        </div>
      </div>
    </div>
  );
}
