import { useEffect, useMemo, useRef } from "react";
import { useGetSalesTrend, getGetSalesTrendQueryKey, type PropertyTypeParameter, type YearRange } from "@workspace/api-client-react";
import { ComposedChart, Bar, Line, XAxis, YAxis, Brush, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useChartColors } from "@/components/ui-bits";
import { endOfMonth, monthsBefore, rangeLabel } from "@/lib/fmt";
import type { areaParams as areaParamsOf } from "@/lib/areas";

type AreaParams = ReturnType<typeof areaParamsOf>;

export function TimeControl({ ptype, areaParams, from, to, datasetFrom, datasetTo, years, onChange, isDark }: {
  ptype: PropertyTypeParameter; areaParams: AreaParams; from?: string; to?: string; datasetFrom: string; datasetTo: string; years: YearRange[];
  onChange: (from?: string, to?: string) => void; isDark: boolean;
}) {
  const c = useChartColors(isDark);
  const params = { propertyType: ptype, ...areaParams, granularity: "month" as const, window: 1 };
  const q = useGetSalesTrend(params, { query: { queryKey: getGetSalesTrendQueryKey(params) } });
  const data = useMemo(() => q.data ?? [], [q.data]);
  const periods = data.map((d) => d.period);

  const startIdx = from ? Math.max(0, periods.findIndex((p) => p.slice(0, 7) >= from.slice(0, 7))) : 0;
  let endIdx = periods.length - 1;
  if (to) { const i = periods.map((p) => p.slice(0, 7) <= to.slice(0, 7)).lastIndexOf(true); if (i >= 0) endIdx = i; }

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => () => clearTimeout(timer.current), []);

  const presets: [string, string | undefined, string | undefined][] = [
    ["All dates", undefined, undefined],
    ...years.map((y) => [y.label, y.from, y.to] as [string, string, string]),
    ["Last 12 months", monthsBefore(datasetTo, 11), datasetTo],
  ];
  const ef = from ?? datasetFrom, et = to ?? datasetTo;

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
        <div className="flex-1 h-[40px] relative">
          {q.isLoading ? <Skeleton className="w-full h-full" /> : data.length > 1 && (
            <ResponsiveContainer width="100%" height={40} debounce={0}>
              <ComposedChart data={data} margin={{ top: 0, right: 6, left: 6, bottom: 0 }}>
                <Brush key={`${startIdx}-${endIdx}-${data.length}`} dataKey="label" height={40} y={0} travellerWidth={8}
                  startIndex={startIdx} endIndex={endIdx} stroke={c.accent} fill="transparent"
                  tickFormatter={() => ""}
                  onChange={(r) => {
                    const s = r.startIndex ?? 0, e = r.endIndex ?? periods.length - 1;
                    clearTimeout(timer.current);
                    timer.current = setTimeout(() => {
                      if (s === 0 && e === periods.length - 1) onChangeRef.current(undefined, undefined);
                      else onChangeRef.current(periods[s], endOfMonth(periods[e]));
                    }, 350);
                  }}>
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
          )}
        </div>
        <div className="shrink-0 text-right leading-tight">
          <div className="font-num text-[13px] font-medium" data-testid="text-range">{rangeLabel(ef, et)}</div>
          <div className="text-[12px] text-muted-foreground">Drag the handles to set dates</div>
        </div>
      </div>
    </div>
  );
}
