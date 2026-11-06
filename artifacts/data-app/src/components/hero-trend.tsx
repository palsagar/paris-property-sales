import { useEffect, useMemo, useState } from "react";
import { useGetSalesTrend, getGetSalesTrendQueryKey, type GranularityParameter, type PropertyTypeParameter, type YearRange } from "@workspace/api-client-react";
import { ComposedChart, BarChart, Area, Line, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard, ErrorState, Segmented, TipBox, useChartColors } from "@/components/ui-bits";
import { eur, sqm, sqmOrTooFew, num, pct, orTooFew, houseShareLabel, TOO_FEW } from "@/lib/fmt";
import type { areaParams } from "@/lib/areas";
import { yearBucketLabel } from "@/lib/period";

export type Filters = ReturnType<typeof areaParams> & { propertyType: PropertyTypeParameter; from?: string; to?: string };

const PLOT_H = 260;
const STRIP_H = 64; // 40px of bars plus the x-axis labels
const Y_W = 46;

function Switch({ on, onClick, label, disabled, testId }: { on: boolean; onClick: () => void; label: string; disabled?: boolean; testId: string }) {
  return (
    <button disabled={disabled} onClick={onClick} data-testid={testId} aria-pressed={on}
      className={`print:hidden h-8 px-2.5 rounded-md border text-[13px] flex items-center gap-1.5 transition-colors disabled:opacity-40 ${on ? "border-primary/40 text-primary" : "hover:bg-muted"}`}>
      <span className={`w-6 h-3.5 rounded-full relative transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"}`}>
        <span className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-background transition-transform ${on ? "translate-x-2.5" : ""}`} />
      </span>
      {label}
    </button>
  );
}

export function HeroTrend({ filters, areaName, hasArea, isQuartier, gran, setGran, isDark, years }: {
  filters: Filters; areaName: string; hasArea: boolean; isQuartier: boolean; gran: GranularityParameter; setGran: (g: GranularityParameter) => void; isDark: boolean; years: YearRange[];
}) {
  const c = useChartColors(isDark);
  const [override, setOverride] = useState<boolean | null>(null);
  const [showBand, setShowBand] = useState(true);
  useEffect(() => setOverride(null), [gran, isQuartier]);
  const smooth = gran === "year" ? false : override ?? (gran === "month" || isQuartier);
  const win = smooth ? 3 : 1;
  const params = { ...filters, granularity: gran, window: win };
  const q = useGetSalesTrend(params, { query: { queryKey: getGetSalesTrendQueryKey(params) } });
  const allP = { propertyType: filters.propertyType, from: filters.from, to: filters.to, granularity: gran, window: win };
  const all = useGetSalesTrend(allP, { query: { queryKey: getGetSalesTrendQueryKey(allP), enabled: hasArea } });

  const data = useMemo(() => {
    const pts = q.data ?? [];
    const byP = new Map(pts.map((p) => [p.period, p]));
    const paris = new Map((hasArea ? all.data ?? [] : []).map((p) => [p.period, p.medianPricePerSqm]));
    return pts.map((p) => {
      const prevKey = `${Number(p.period.slice(0, 4)) - 1}${p.period.slice(4)}`;
      const prev = byP.get(prevKey);
      return {
        ...p, shown: gran === "year" ? yearBucketLabel(p.period, p.label, years) : p.label, band: [p.p25PricePerSqm, p.p75PricePerSqm] as [number | null, number | null],
        paris: paris.get(p.period), low: p.count < 10,
        yoy: prev && prev.medianPricePerSqm && p.medianPricePerSqm != null ? ((p.medianPricePerSqm - prev.medianPricePerSqm) / prev.medianPricePerSqm) * 100 : null,
      };
    });
  }, [q.data, all.data, hasArea, gran, years]);

  // Without the range, the y-axis is fitted to the median (and the All Paris line) so its movement is readable.
  // With the range on, the axis covers P25 to P75 plus 40% of that span on each side, so the range reads as a
  // band inside the plot instead of filling it.
  const domain = useMemo<[number, number]>(() => {
    const line = data.flatMap((d) => [d.medianPricePerSqm, d.paris]).filter((x): x is number => x != null && isFinite(x));
    if (!line.length) return [0, 1];
    let lo = Math.min(...line), hi = Math.max(...line);
    let pad = Math.max((hi - lo) * 0.25, 250);
    if (showBand) {
      lo = Math.min(lo, ...data.map((d) => d.p25PricePerSqm).filter((x) => x != null));
      hi = Math.max(hi, ...data.map((d) => d.p75PricePerSqm).filter((x) => x != null));
      pad = (hi - lo) * 0.4;
    }
    return [Math.max(0, Math.floor((lo - pad) / 500) * 500), Math.ceil((hi + pad) / 500) * 500];
  }, [data, showBand]);
  const lowN = data.filter((d) => d.low).length;
  const noMedian = data.every((d) => d.medianPricePerSqm == null);

  return (
    <ChartCard testId="trend" title={`Price per m² over time in ${areaName}`} isDark={isDark}
      loading={q.isLoading} fetching={q.isFetching || all.isFetching}
      csv={data.map(({ band: _b, shown: _s, ...r }) => r)} csvName="price-trend.csv"
      desc={<>The line is the median price per m² for each {gran}{hasArea && <>; the dashed line is All Paris</>}. The strip below counts sales. {smooth ? `Each point averages ${win} periods to reduce noise.` : ""}</>}
      right={
        <>
          <Segmented testId="gran" label="Granularity" value={gran} onChange={setGran} options={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]} />
          <Switch testId="toggle-smooth" on={smooth} disabled={gran === "year"} onClick={() => setOverride(!smooth)} label="Smoothing" />
          <Switch testId="toggle-band" on={showBand} onClick={() => setShowBand((b) => !b)} label="P25-P75" />
        </>
      }>
      {q.isLoading ? <Skeleton className="w-full" style={{ height: PLOT_H + STRIP_H }} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : data.length === 0 ? (
        <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height: PLOT_H + STRIP_H }}>No sales match this selection. Try a longer period or a larger area.</div>
      ) : (
        <>
          {noMedian ? <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height: PLOT_H }}>{TOO_FEW}</div> : <ResponsiveContainer width="100%" height={PLOT_H} debounce={0}>
            <ComposedChart data={data} syncId="trend" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
              <XAxis dataKey="shown" hide />
              <YAxis tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 12, fill: c.tick }} stroke={c.tick} width={Y_W} domain={domain} allowDataOverflow tickCount={5} />
              <Tooltip filterNull={false} isAnimationActive={false} cursor={{ stroke: c.tick, strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as (typeof data)[number];
                  if (d.count === 0) return <TipBox title={d.shown} rows={[["Sales", "No sales"]]} />;
                  const rows: [string, string, string?][] = [
                    ["Median per m²", sqmOrTooFew(d.medianPricePerSqm), c.accent],
                    ["P25 to P75", d.p25PricePerSqm != null && d.p75PricePerSqm != null ? `${num(d.p25PricePerSqm)} to ${num(d.p75PricePerSqm)}` : TOO_FEW],
                    ["Median price", orTooFew(d.medianPrice, eur)],
                    ["Sales", num(d.count)],
                  ];
                  const share = filters.propertyType === "all" ? houseShareLabel(d.houseShare) : null;
                  if (share) rows.push(["House share", share]);
                  if (d.yoy != null) rows.push(["Change on a year earlier", pct(d.yoy)]);
                  if (d.paris != null) rows.push(["All Paris", sqm(d.paris), c.second]);
                  return <TipBox title={d.shown} rows={rows} note={d.low && d.medianPricePerSqm != null ? "Fewer than 10 sales in this period, so treat the figure with care." : undefined} />;
                }} />
              {showBand && <Area dataKey="band" stroke="none" fill={c.accent} fillOpacity={0.06} isAnimationActive={false} type="linear" activeDot={false} />}
              {showBand && <Line dataKey="p25PricePerSqm" stroke={c.accent} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="1 3" dot={false} activeDot={false} isAnimationActive={false} />}
              {showBand && <Line dataKey="p75PricePerSqm" stroke={c.accent} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="1 3" dot={false} activeDot={false} isAnimationActive={false} />}
              {hasArea && <Line dataKey="paris" stroke={c.second} strokeWidth={1.6} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />}
              <Line dataKey="medianPricePerSqm" stroke={c.accent} strokeWidth={2.5} isAnimationActive={false} type="linear"
                activeDot={{ r: 5, stroke: c.bg, strokeWidth: 2 }}
                dot={(p: { cx?: number; cy?: number | null; index?: number; payload?: { low: boolean } }) =>
                  p.cy == null ? <g key={p.index} /> : p.payload?.low ? <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill={c.bg} stroke={c.accent} strokeWidth={1.5} strokeDasharray="2 1.5" />
                    : <circle key={p.index} cx={p.cx} cy={p.cy} r={data.length > 30 ? 0 : 2.5} fill={c.accent} />} />
            </ComposedChart>
          </ResponsiveContainer>}
          <ResponsiveContainer width="100%" height={STRIP_H} debounce={0}>
            <BarChart data={data} syncId="trend" margin={{ top: 6, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
              <XAxis dataKey="shown" tick={{ fontSize: 11.5, fill: c.tick }} stroke={c.tick} minTickGap={24} />
              <YAxis width={Y_W} tick={false} axisLine={false} domain={[0, "dataMax"]}
                label={{ value: "Sales", position: "insideRight", fill: c.tick, fontSize: 11, offset: 6 }} />
              <Tooltip content={() => null} cursor={{ fill: c.cursor }} isAnimationActive={false} />
              <Bar dataKey="count" isAnimationActive={false} radius={[1, 1, 0, 0]}>
                {data.map((d, i) => <Cell key={i} fill={d.low ? c.accent : c.tick} fillOpacity={d.low ? 0.5 : 0.35} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5" style={{ background: c.accent }} />Median per m²</span>
            {showBand && <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dotted" style={{ borderColor: c.accent }} />P25 and P75, the middle half of sales</span>}
            {hasArea && <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: c.second }} />All Paris</span>}
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.tick, opacity: 0.4 }} />Number of sales</span>
            {lowN > 0 && <span className="inline-flex items-center gap-1.5 text-primary"><span className="w-2.5 h-2.5 rounded-full border border-dashed border-primary" />{lowN} period{lowN > 1 ? "s" : ""} with fewer than 10 sales</span>}
          </div>
        </>
      )}
    </ChartCard>
  );
}
