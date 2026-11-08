import { memo } from "react";
import {
  useGetPriceDistribution, getGetPriceDistributionQueryKey, useGetPricePerSqmDistribution, getGetPricePerSqmDistributionQueryKey,
  useGetSalesByRooms, getGetSalesByRoomsQueryKey, type Distribution,
} from "@workspace/api-client-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard, ErrorState, TipBox, useChartColors } from "@/components/ui-bits";
import { eurShort, sqm, num, houseShareLabel, keep, tooFew } from "@/lib/fmt";
import { binStart, binTick } from "@/lib/histogram";
import { keepInSameArea } from "@/lib/areas";
import type { Filters } from "@/components/hero-trend";

const Histogram = memo(function Histogram({ dist, houseShare, isDark, fmtVal, color }: { dist: Distribution; houseShare?: number | null; isDark: boolean; fmtVal: (n: number) => string; color: string }) {
  const c = useChartColors(isDark);
  const { median, mean, p10, p25, p75, p90 } = dist;
  if (median == null || mean == null || p10 == null || p25 == null || p75 == null || p90 == null) {
    return <div className="flex items-center justify-center text-muted-foreground text-sm h-[340px]">{tooFew()}</div>;
  }
  const share = houseShareLabel(houseShare);
  // The numeric `from` is the category key: it is unique, so the reference lines find their bin, and the labels may repeat or not.
  const data = dist.bins.map((b) => ({ ...b, mid: (b.from + b.to) / 2 }));
  // P25/P75 labels sit inside the plot, on the outer side of their line, so they never collide with the Median label on top.
  const refs: [string, number, string, "insideTopRight" | "top" | "insideTopLeft", number][] = [
    ["P25", p25, c.second, "insideTopRight", 1.25], ["Median", median, c.accent, "top", 2], ["P75", p75, c.second, "insideTopLeft", 1.25],
  ];
  return (
    <>
      <ResponsiveContainer width="100%" height={260} debounce={0}>
        <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
          <XAxis dataKey="from" tickFormatter={(v: number) => binTick(v, dist.bins)} tick={{ fontSize: 12, fill: c.tick }} stroke={c.tick} interval="preserveStartEnd" minTickGap={22} />
          <YAxis tick={{ fontSize: 12, fill: c.tick }} stroke={c.tick} width={44} />
          <Tooltip isAnimationActive={false} cursor={{ fill: c.cursor }}
            content={({ active, payload }) => active && payload?.length ? (
              <TipBox title={`${fmtVal(payload[0].payload.from)} - ${fmtVal(payload[0].payload.to)}`} rows={[["Sales", num(payload[0].payload.count), color]]} />
            ) : null} />
          <Bar dataKey="count" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={color} fillOpacity={d.mid >= p25 && d.mid <= p75 ? 0.9 : 0.4} />)}
          </Bar>
          {refs.map(([n, v, col, pos, w]) => (
            <ReferenceLine key={n} x={binStart(dist.bins, v)} stroke={col} strokeDasharray={n === "Median" ? undefined : "4 3"} strokeWidth={w}
              label={{ value: n, position: pos, fill: col, fontSize: 12, fontWeight: 600, offset: n === "Median" ? 6 : 4 }} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <dl className="grid grid-cols-5 gap-1 mt-3 text-center border-t pt-2">
        {([["P10", p10], ["P25", p25], ["Median", median], ["P75", p75], ["P90", p90]] as [string, number][]).map(([k, v]) => (
          <div key={k} className="py-1">
            <dt className="text-[12px] text-muted-foreground">{k}</dt>
            <dd className={`font-num text-[13px] leading-tight ${k === "Median" ? "text-primary font-medium" : ""}`}>{fmtVal(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[13px] text-muted-foreground mt-2">The mean is {fmtVal(mean)}. Darker bars hold the middle half of sales, between P25 and P75.{share && ` This selection is ${share}.`}</p>
    </>
  );
});

export const Distributions = memo(function Distributions({ filters, houseShare, isDark }: { filters: Filters; houseShare?: number | null; isDark: boolean }) {
  const c = useChartColors(isDark);
  const pd = useGetPriceDistribution(filters, { query: { queryKey: getGetPriceDistributionQueryKey(filters), placeholderData: keepInSameArea(filters) } });
  const sd = useGetPricePerSqmDistribution(filters, { query: { queryKey: getGetPricePerSqmDistributionQueryKey(filters), placeholderData: keepInSameArea(filters) } });
  return (
    <>
      <ChartCard testId="price-dist" level={3} title="Sale prices" desc="Number of sales in each price bracket." className="flex-[1_1_360px]"
        lede={pd.data?.p25 != null && pd.data.p75 != null ? keep(`Half of the sales were between ${eurShort(pd.data.p25)} and ${eurShort(pd.data.p75)}.`) : undefined}
        isDark={isDark} loading={pd.isLoading} fetching={pd.isFetching} csv={pd.data?.bins} csvName="price-distribution.csv">
        {pd.isLoading ? <Skeleton className="w-full h-[340px]" /> : pd.isError ? <ErrorState onRetry={() => pd.refetch()} /> : pd.data && <Histogram dist={pd.data} houseShare={houseShare} isDark={isDark} color={c.second} fmtVal={eurShort} />}
      </ChartCard>
      <ChartCard testId="sqm-dist" level={3} title="Price per m²" desc="Number of sales in each price-per-m² bracket." className="flex-[1_1_360px]"
        lede={sd.data?.p25 != null && sd.data.p75 != null ? keep(`Half of the sales were between ${sqm(sd.data.p25)} and ${sqm(sd.data.p75)}.`) : undefined}
        isDark={isDark} loading={sd.isLoading} fetching={sd.isFetching} csv={sd.data?.bins} csvName="price-per-sqm-distribution.csv">
        {sd.isLoading ? <Skeleton className="w-full h-[340px]" /> : sd.isError ? <ErrorState onRetry={() => sd.refetch()} /> : sd.data && <Histogram dist={sd.data} houseShare={houseShare} isDark={isDark} color={c.accent} fmtVal={sqm} />}
      </ChartCard>
    </>
  );
});

/**
 * Prices by number of rooms, as a table with one bar. The old chart drew the median price and the median price per m²
 * on two vertical axes, which reads as if the two lines crossed for a reason.
 */
export const RoomsChart = memo(function RoomsChart({ filters, isDark }: { filters: Filters; isDark: boolean }) {
  const c = useChartColors(isDark);
  const rooms = useGetSalesByRooms(filters, { query: { queryKey: getGetSalesByRoomsQueryKey(filters), placeholderData: keepInSameArea(filters) } });
  const rows = (rooms.data ?? []).map((r) => ({ ...r, label: r.rooms >= 5 ? "5+ rooms" : `${r.rooms} room${r.rooms > 1 ? "s" : ""}` }));
  const maxPrice = Math.max(1, ...rows.map((r) => r.medianPrice ?? 0));
  return (
    <ChartCard testId="rooms" level={3} title="By number of rooms" desc="Median price and median price per m², by the number of main rooms." isDark={isDark} className="flex-[1_1_360px]"
      loading={rooms.isLoading} fetching={rooms.isFetching} csv={rooms.data} csvName="sales-by-rooms.csv">
      {rooms.isLoading ? <Skeleton className="w-full h-[260px]" /> : rooms.isError ? <ErrorState onRetry={() => rooms.refetch()} /> : !rows.some((r) => r.medianPricePerSqm != null) ? (
        <div className="flex items-center justify-center text-muted-foreground text-[15px] h-[200px]">{tooFew()}</div>
      ) : (
        <table className="w-full border-collapse text-[14px] sm:text-[15px]" data-testid="table-rooms">
          <thead>
            <tr className="text-left text-[12px] text-muted-foreground">
              <th scope="col" className="font-medium pb-2 pr-2">Rooms</th>
              <th scope="col" className="font-medium pb-2 px-2 text-right">Sales</th>
              <th scope="col" className="font-medium pb-2 px-2">Median price</th>
              <th scope="col" className="font-medium pb-2 pl-2 text-right">EUR/m²</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const share = filters.propertyType === "all" ? houseShareLabel(r.houseShare) : null;
              return (
                <tr key={r.rooms} className="border-t" title={share ? `${r.label}: ${share}` : undefined}>
                  <th scope="row" className="py-2.5 pr-2 font-normal text-left whitespace-nowrap">{r.label}</th>
                  <td className="py-2.5 px-2 text-right font-num text-[13px] text-muted-foreground whitespace-nowrap">{num(r.count)}</td>
                  <td className="py-2.5 px-2 w-[50%]">
                    {r.medianPrice == null ? <span className="text-[13px] text-muted-foreground">{tooFew()}</span> : (
                      <span className="flex items-center gap-2">
                        <span className="hidden sm:block h-3 rounded-[2px] shrink-0" style={{ width: `${(r.medianPrice / maxPrice) * 55}%`, background: c.second }} />
                        <span className="font-num text-[13px] whitespace-nowrap">{eurShort(r.medianPrice)}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pl-2 text-right font-num text-[13px] whitespace-nowrap">{r.medianPricePerSqm == null ? "–" : num(r.medianPricePerSqm)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </ChartCard>
  );
});
