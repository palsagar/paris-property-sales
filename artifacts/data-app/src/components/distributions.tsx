import {
  useGetPriceDistribution, getGetPriceDistributionQueryKey, useGetPricePerSqmDistribution, getGetPricePerSqmDistributionQueryKey,
  useGetSalesByRooms, getGetSalesByRoomsQueryKey, type Distribution,
} from "@workspace/api-client-react";
import { BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard, ErrorState, TipBox, useChartColors } from "@/components/ui-bits";
import { eur, eurShort, sqm, num, kShort } from "@/lib/fmt";
import type { Filters } from "@/components/hero-trend";

function Histogram({ dist, isDark, fmtVal, color }: { dist: Distribution; isDark: boolean; fmtVal: (n: number) => string; color: string }) {
  const c = useChartColors(isDark);
  const data = dist.bins.map((b) => ({ ...b, mid: (b.from + b.to) / 2, label: kShort(b.from) }));
  const binOf = (v: number) => data.find((b) => v >= b.from && v < b.to)?.label ?? data[data.length - 1]?.label;
  // P25/P75 labels sit inside the plot, on the outer side of their line, so they never collide with the Median label on top.
  const refs: [string, number, string, "insideTopRight" | "top" | "insideTopLeft", number][] = [
    ["P25", dist.p25, c.second, "insideTopRight", 1.25], ["Median", dist.median, c.accent, "top", 2], ["P75", dist.p75, c.second, "insideTopLeft", 1.25],
  ];
  return (
    <>
      <ResponsiveContainer width="100%" height={260} debounce={0}>
        <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: c.tick }} stroke={c.tick} interval="preserveStartEnd" minTickGap={18} />
          <YAxis tick={{ fontSize: 12, fill: c.tick }} stroke={c.tick} width={44} />
          <Tooltip isAnimationActive={false} cursor={{ fill: c.cursor }}
            content={({ active, payload }) => active && payload?.length ? (
              <TipBox title={`${fmtVal(payload[0].payload.from)} - ${fmtVal(payload[0].payload.to)}`} rows={[["Sales", num(payload[0].payload.count), color]]} />
            ) : null} />
          <Bar dataKey="count" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={color} fillOpacity={d.mid >= dist.p25 && d.mid <= dist.p75 ? 0.9 : 0.4} />)}
          </Bar>
          {refs.map(([n, v, col, pos, w]) => (
            <ReferenceLine key={n} x={binOf(v)} stroke={col} strokeDasharray={n === "Median" ? undefined : "4 3"} strokeWidth={w}
              label={{ value: n, position: pos, fill: col, fontSize: 10.5, fontWeight: 600, offset: n === "Median" ? 6 : 4 }} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <dl className="grid grid-cols-5 gap-1 mt-3 text-center border-t pt-2">
        {([["P10", dist.p10], ["P25", dist.p25], ["Median", dist.median], ["P75", dist.p75], ["P90", dist.p90]] as [string, number][]).map(([k, v]) => (
          <div key={k} className="py-1">
            <dt className="text-[12px] text-muted-foreground">{k}</dt>
            <dd className={`font-num text-[13px] ${k === "Median" ? "text-primary font-medium" : ""}`}>{fmtVal(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[12.5px] text-muted-foreground mt-2">The mean is {fmtVal(dist.mean)}. Darker bars hold the middle half of sales, between P25 and P75.</p>
    </>
  );
}

export function Distributions({ filters, isDark }: { filters: Filters; isDark: boolean }) {
  const c = useChartColors(isDark);
  const pd = useGetPriceDistribution(filters, { query: { queryKey: getGetPriceDistributionQueryKey(filters) } });
  const sd = useGetPricePerSqmDistribution(filters, { query: { queryKey: getGetPricePerSqmDistributionQueryKey(filters) } });
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <ChartCard testId="price-dist" title="Sale prices" desc="Number of sales in each price bracket." isDark={isDark} loading={pd.isLoading} fetching={pd.isFetching} csv={pd.data?.bins} csvName="price-distribution.csv">
        {pd.isLoading ? <Skeleton className="w-full h-[340px]" /> : pd.isError ? <ErrorState onRetry={() => pd.refetch()} /> : pd.data && <Histogram dist={pd.data} isDark={isDark} color={c.second} fmtVal={eurShort} />}
      </ChartCard>
      <ChartCard testId="sqm-dist" title="Price per m²" desc="Number of sales in each price-per-m² bracket." isDark={isDark} loading={sd.isLoading} fetching={sd.isFetching} csv={sd.data?.bins} csvName="price-per-sqm-distribution.csv">
        {sd.isLoading ? <Skeleton className="w-full h-[340px]" /> : sd.isError ? <ErrorState onRetry={() => sd.refetch()} /> : sd.data && <Histogram dist={sd.data} isDark={isDark} color={c.accent} fmtVal={sqm} />}
      </ChartCard>
    </div>
  );
}

export function RoomsChart({ filters, isDark }: { filters: Filters; isDark: boolean }) {
  const c = useChartColors(isDark);
  const rooms = useGetSalesByRooms(filters, { query: { queryKey: getGetSalesByRoomsQueryKey(filters) } });
  return (
    <ChartCard testId="rooms" title="Prices by number of rooms" desc="Bars show the median price and the line the median price per m², for each count of main rooms." isDark={isDark}
      loading={rooms.isLoading} fetching={rooms.isFetching} csv={rooms.data} csvName="sales-by-rooms.csv">
      {rooms.isLoading ? <Skeleton className="w-full h-[300px]" /> : rooms.isError ? <ErrorState onRetry={() => rooms.refetch()} /> : (
        <ResponsiveContainer width="100%" height={300} debounce={0}>
          <ComposedChart data={(rooms.data ?? []).map((r) => ({ ...r, label: r.rooms >= 5 ? "5+ rooms" : `${r.rooms} room${r.rooms > 1 ? "s" : ""}` }))} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: c.tick }} stroke={c.tick} />
            <YAxis yAxisId="l" tickFormatter={kShort} tick={{ fontSize: 12, fill: c.tick }} stroke={c.tick} width={44} />
            <YAxis yAxisId="r" orientation="right" tickFormatter={kShort} tick={{ fontSize: 12, fill: c.tick }} stroke={c.tick} width={44} />
            <Tooltip isAnimationActive={false} cursor={{ fill: c.cursor }}
              content={({ active, payload }) => active && payload?.length ? (() => { const d = payload[0].payload; return (
                <TipBox title={d.label} rows={[["Median price", eur(d.medianPrice), c.second], ["Median / m²", sqm(d.medianPricePerSqm), c.accent], ["Median surface", `${num(d.medianSurface)} m²`], ["Sales", num(d.count)]]} />); })() : null} />
            <Bar yAxisId="l" dataKey="medianPrice" fill={c.second} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Line yAxisId="r" type="linear" dataKey="medianPricePerSqm" stroke={c.accent} strokeWidth={2.5} dot={{ r: 3.5, fill: c.accent }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
