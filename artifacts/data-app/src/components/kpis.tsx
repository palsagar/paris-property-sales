import { memo, type ReactNode } from "react";
import type { PropertyTypeParameter, SalesSummary } from "@workspace/api-client-react";
import { Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DeltaChip } from "@/components/ui-bits";
import { eur, eurShort, sqm, num, orTooFew, sqmOrTooFew, houseShareLabel, houseShareWarning, keep, pct, tooFew } from "@/lib/fmt";

/** "20 k – 3.0 M EUR": the unit once, so the range fits a card. */
const priceRange = (min: number, max: number) => keep(`${eurShort(min).replace(/ EUR$/, "")} – ${eurShort(max)}`);

const cardCls = "rounded-xl border bg-card min-w-0";

function Small({ label, value, sub, testId, note }: { label: string; value: string; sub: ReactNode; testId: number; note?: string | null }) {
  const isTooFew = value === tooFew();
  return (
    <article className={`${cardCls} flex-[1_1_200px] p-4 sm:p-5 flex flex-col gap-1.5`} data-testid={`card-kpi-${testId}`}>
      <h3 className="text-[14px] font-medium text-muted-foreground leading-snug">{label}</h3>
      <p className={`font-display font-bold text-[22px] xl:text-[26px] leading-tight ${isTooFew ? "text-muted-foreground" : "text-primary"}`} data-testid={`text-kpi-${testId}`}>{keep(value)}</p>
      <div className="text-[13px] sm:text-[14px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">{sub}</div>
      {note && <p className="text-[13px] text-muted-foreground" data-testid={`text-house-share-${testId}`}>{note}</p>}
    </article>
  );
}

/**
 * The key figures of the Selection. The median price per m² leads: it is the figure Visitors compare. Beside an Area it
 * shows All Paris for the same type and Period, which the page loads with the Selection (selection-queries.ts).
 */
export const Kpis = memo(function Kpis({ s, paris, ptype, loading, fetching, error }: {
  s?: SalesSummary; paris?: SalesSummary; ptype: PropertyTypeParameter; loading: boolean; fetching: boolean; error: boolean;
}) {
  const n = s?.changeWindowMonths ?? 3;
  // A Selection of one type says nothing through its House share, and with no median there is nothing to warn about.
  const share = ptype === "all" && s?.medianPricePerSqm != null ? s.houseShare : null;
  // Said once, on the lead figure, and only when houses are at least 1% of the Sales.
  const note = share != null && Math.round(share) >= 1 ? houseShareLabel(share) : null;
  const warning = houseShareWarning(share);
  if (loading || !s) {
    return (
      <div className="flex flex-wrap gap-3 sm:gap-4" aria-busy="true">
        {error ? <p className="text-[15px] text-muted-foreground">The key figures did not load.</p> : Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={`${cardCls} ${i === 0 ? "flex-[2_1_360px]" : "flex-[1_1_200px]"} p-5`}><Skeleton className="h-3 w-24 mb-3" /><Skeleton className="h-8 w-32 mb-2" /><Skeleton className="h-3 w-20" /></div>
        ))}
      </div>
    );
  }
  const changeTip = (start: number | null, end: number | null, fmt: (v: number) => string, change: number | null) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="no-tap inline-flex items-center gap-1.5 rounded" aria-label={`Change ${change == null ? "not available" : pct(change)}. How it is measured`}>
          <DeltaChip value={change} /><Info className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px] text-[13px] leading-snug">
        Median of the first {n} months of the Period ({start != null ? fmt(start) : "n/a"}) against the median of the last {n} months ({end != null ? fmt(end) : "n/a"}), in nominal euros.
        {change == null && " One of the two windows has too few sales to compute a change."}
      </TooltipContent>
    </Tooltip>
  );
  return (
    <div className={`flex flex-col gap-2 transition-opacity ${fetching ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap gap-3 sm:gap-4">
        <article className={`${cardCls} flex-[2_1_360px] p-4 sm:px-6 sm:py-5 flex flex-col gap-2.5`} data-testid="card-kpi-2">
          <h3 className="text-[14px] font-medium text-muted-foreground">Median price per m²</h3>
          <p className={`font-display font-bold text-[40px] sm:text-[48px] leading-none ${s.medianPricePerSqm == null ? "text-muted-foreground text-[28px] sm:text-[32px]" : "text-primary"}`} data-testid="text-kpi-2">
            {s.medianPricePerSqm == null ? tooFew() : <>{num(s.medianPricePerSqm)} <span className="text-[18px] sm:text-[22px]">EUR/m²</span></>}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted-foreground" data-testid="chip-change-2">
            {changeTip(s.startMedianPricePerSqm, s.endMedianPricePerSqm, sqm, s.changePct)}
            <span>
              {s.startMedianPricePerSqm != null && s.endMedianPricePerSqm != null
                ? keep(`${num(s.startMedianPricePerSqm)} in the first ${n} months, ${num(s.endMedianPricePerSqm)} in the last ${n}`)
                : "over the period"}
            </span>
          </div>
          {paris && (
            <p className="mt-1 pt-2.5 border-t border-dashed text-[14px] text-muted-foreground" data-testid="text-kpi-paris">
              All Paris: <span className="font-num text-foreground">{sqmOrTooFew(paris.medianPricePerSqm)}</span>{paris.changePct != null && <>, <span className="font-num">{pct(paris.changePct)}</span></>}
            </p>
          )}
          {note && <p className="text-[13px] text-muted-foreground" data-testid="text-house-share-2">{note}</p>}
        </article>
        <Small testId={0} label="Sales recorded" value={num(s.count)} sub={s.count === 0 ? "No sales" : `Worth ${eurShort(s.totalVolume)} in total`} />
        <Small testId={1} label="Median price" value={orTooFew(s.medianPrice, eur)}
          sub={<>{changeTip(s.startMedianPrice, s.endMedianPrice, eurShort, s.priceChangePct)}<span>over the period</span></>} />
        <Small testId={4} label="Median surface" value={orTooFew(s.medianSurface, (v) => `${num(v)} m²`)} sub="Built surface" />
        <Small testId={5} label="Price range" value={s.count === 0 ? "No sales" : priceRange(s.minPrice, s.maxPrice)} sub="Cheapest and dearest sale" />
      </div>
      {warning && <p className="text-[14px] text-muted-foreground" data-testid="text-house-share-warning">{warning}</p>}
    </div>
  );
});
