import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useGetSalesTrend, getGetSalesTrendQueryKey, type YearRange } from "@workspace/api-client-react";
import { ComposedChart, Bar, Line, XAxis, YAxis, Brush, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useChartColors } from "@/components/ui-bits";
import { endOfMonth, monthLabel, monthsBefore, rangeLabel } from "@/lib/fmt";
import { areaParams, keepInSameArea } from "@/lib/areas";
import { timeTrendParams } from "@/lib/selection-queries";
import type { ViewState } from "@/lib/view-state";
import { periodProps, track } from "@/lib/analytics";

const pillCls = (on: boolean, tall: boolean) =>
  `inline-flex items-center ${tall ? "h-11 px-3.5 text-[15px]" : "h-9 px-3 text-[14px]"} rounded-full border font-medium whitespace-nowrap transition-colors ${on ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:bg-sunken"}`;
const selectCls = "h-10 w-full rounded-lg border border-control bg-background px-2.5 text-[15px] disabled:opacity-50";

/**
 * Chooses the Period: one-tap presets, a brush over the whole timeline, and From / To months for anyone who cannot
 * or does not want to drag. It is the body of the Period popover on a laptop and of the Selection sheet on a phone.
 * `chartView` is the shown view, for the small chart. `from` and `to` are the requested Period, for the handles.
 */
export function TimeControl({ chartView, from, to, datasetFrom, datasetTo, years, onChange, isDark, tall = false, status }: {
  chartView: Pick<ViewState, "ptype" | "area">; from?: string; to?: string; datasetFrom: string; datasetTo: string; years: YearRange[];
  onChange: (from?: string, to?: string) => void; isDark: boolean; tall?: boolean; status?: string;
}) {
  const c = useChartColors(isDark);
  const ids = useId();
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
  const apply = (s: number, e: number, via: "slider" | "months") => {
    const full = s === 0 && e === periods.length - 1;
    if (s !== startIdx || e !== endIdx) track("change-period", { via, ...(full ? {} : periodProps(periods[s], periods[e])) });
    if (full) onChange(undefined, undefined);
    else onChange(periods[s], endOfMonth(periods[e]));
  };
  const commit = () => {
    const r = pending.current;
    if (!r) return;
    pending.current = null;
    setDraft(null);
    if (r.data !== data) return;
    apply(r.s, r.e, "slider");
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

  type Preset = "all" | "year" | "last-12-months";
  const presets: [string, string | undefined, string | undefined, Preset][] = [
    ["All dates", undefined, undefined, "all"],
    ["Last 12 months", monthsBefore(datasetTo, 11), datasetTo, "last-12-months"],
    ...years.map((y) => [y.label, y.from, y.to, "year"] as [string, string, string, Preset]),
  ];
  const ef = from ?? datasetFrom, et = to ?? datasetTo;
  const chartH = tall ? 56 : 72;

  // The chart element stays the same while a draft changes, so a redraw does not reset the Brush mid-drag.
  const chart = useMemo(() => (
    <ResponsiveContainer width="100%" height={chartH} debounce={0}>
      <ComposedChart data={data} margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
        <Brush key={`${startIdx}-${endIdx}-${data.length}`} dataKey="label" height={chartH} y={0} travellerWidth={12}
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
            <Line yAxisId="p" dataKey="medianPricePerSqm" stroke={c.accent} strokeWidth={1.75} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </Brush>
      </ComposedChart>
    </ResponsiveContainer>
  ), [data, startIdx, endIdx, c.accent, c.second, chartH]);

  const yearTicks = periods.map((p, i) => [p, i] as const).filter(([p]) => p.slice(5, 7) === "01");
  const shownS = draft ? draft.s : startIdx, shownE = draft ? draft.e : endIdx;

  return (
    <div className="flex flex-col gap-4" data-testid="time-control">
      <div role="group" aria-label="Period presets" className="flex flex-wrap gap-2">
        {presets.map(([l, f, t, kind]) => {
          const active = (f ?? undefined) === from && (t === undefined ? to === undefined : t === to);
          const choose = () => {
            if (!active) track("change-period", { via: "preset", preset: kind, ...periodProps(f, t) });
            onChange(f, t);
          };
          return (
            <button key={l} type="button" onClick={choose} data-testid={`preset-${l.replace(/\s/g, "-").toLowerCase()}`}
              aria-pressed={active} className={pillCls(active, tall)}>{l}</button>
          );
        })}
      </div>
      <div className="flex flex-col gap-2 pt-3 border-t">
        <p className="text-[14px] font-medium">Or set your own dates</p>
        <div ref={wrapper} className="relative" style={{ height: chartH }} onKeyUp={commitKey}>
          {q.isLoading ? <Skeleton className="w-full h-full" /> : data.length > 1 && chart}
        </div>
        <div className="relative h-4 mx-2 font-num text-[12px] text-muted-foreground" aria-hidden>
          {yearTicks.map(([p, i]) => <span key={p} className="absolute -translate-x-1/2" style={{ left: `${(i / Math.max(1, periods.length - 1)) * 100}%` }}>{p.slice(0, 4)}</span>)}
        </div>
        <p className="text-[13px] text-muted-foreground">Bars: sales per month. Line: median price per m². Drag a handle, use the arrow keys on it, or pick the months below.</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2.5">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-from`} className="text-[13px] text-muted-foreground">From</label>
          <select id={`${ids}-from`} className={selectCls} disabled={periods.length < 2} value={periods[shownS] ?? ""} data-testid="select-from"
            onChange={(e) => { const s = periods.indexOf(e.target.value); if (s >= 0) apply(s, Math.max(s, endIdx), "months"); }}>
            {periods.map((p) => <option key={p} value={p}>{monthLabel(p.slice(0, 7))}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-to`} className="text-[13px] text-muted-foreground">To</label>
          <select id={`${ids}-to`} className={selectCls} disabled={periods.length < 2} value={periods[shownE] ?? ""} data-testid="select-to"
            onChange={(e) => { const t = periods.indexOf(e.target.value); if (t >= 0) apply(Math.min(startIdx, t), t, "months"); }}>
            {periods.map((p) => <option key={p} value={p}>{monthLabel(p.slice(0, 7))}</option>)}
          </select>
        </div>
        <p className="col-span-2 sm:col-span-1 sm:pb-2.5 text-[14px] leading-tight" aria-live="polite">
          <span className="font-num font-medium" data-testid="text-range">{draft ? rangeLabel(periods[draft.s]!, endOfMonth(periods[draft.e]!)) : rangeLabel(ef, et)}</span>
          {status && <span className="block text-muted-foreground font-num">{status}</span>}
        </p>
      </div>
    </div>
  );
}
