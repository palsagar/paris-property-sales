import type { PropertyTypeParameter, SalesSummary } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DeltaChip } from "@/components/ui-bits";
import { eur, eurShort, sqm, num, dateLabel, orTooFew, sqmOrTooFew, houseShareLabel, houseShareWarning } from "@/lib/fmt";

type Kpi = { label: string; value: string; sub: string; note?: string | null; change?: number | null; startEnd?: [number | null, number | null, (n: number) => string] };

export function Kpis({ s, ptype, loading, fetching, error }: { s?: SalesSummary; ptype: PropertyTypeParameter; loading: boolean; fetching: boolean; error: boolean }) {
  const n = s?.changeWindowMonths ?? 3;
  // A Selection of one type says nothing through its House share, and with no median there is nothing to warn about.
  const share = ptype === "all" && s?.medianPricePerSqm != null ? s.houseShare : null;
  const note = houseShareLabel(share);
  const warning = houseShareWarning(share);
  const kpis: Kpi[] = s ? [
    { label: "Sales recorded", value: num(s.count), sub: `${dateLabel(s.periodFrom)} to ${dateLabel(s.periodTo)}` },
    { label: "Median price", value: orTooFew(s.medianPrice, eur), sub: `Average ${orTooFew(s.averagePrice, eurShort)}`, note, change: s.priceChangePct, startEnd: [s.startMedianPrice, s.endMedianPrice, eurShort] },
    { label: "Median price per m²", value: sqmOrTooFew(s.medianPricePerSqm), sub: `Average ${sqmOrTooFew(s.averagePricePerSqm)}`, note, change: s.changePct, startEnd: [s.startMedianPricePerSqm, s.endMedianPricePerSqm, sqm] },
    { label: "Total volume", value: eurShort(s.totalVolume), sub: "Sum of all sale prices" },
    { label: "Median surface", value: orTooFew(s.medianSurface, (v) => `${num(v)} m²`), sub: "Carrez or built surface", note },
    { label: "Price range", value: `${eurShort(s.minPrice)} - ${eurShort(s.maxPrice)}`, sub: "Cheapest and dearest sale" },
  ] : [];
  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4 transition-opacity ${fetching && !loading ? "opacity-70" : ""}`}>
      {(loading || !s ? Array.from({ length: 6 }) as undefined[] : kpis).map((k, i) => (
        <Card key={i} className="shadcn-card rise overflow-hidden" style={{ animationDelay: `${i * 50}ms` }} data-testid={`card-kpi-${i}`}>
          <CardContent className="p-4">
            {!k ? (error ? <p className="text-sm text-muted-foreground">--</p> : <><Skeleton className="h-3 w-24 mb-3" /><Skeleton className="h-7 w-32 mb-2" /><Skeleton className="h-3 w-20" /></>) : (
              <>
                <h3 className="text-[13px] text-muted-foreground font-normal">{k.label}</h3>
                <p className="font-display font-bold text-[22px] leading-tight mt-1.5 text-primary" data-testid={`text-kpi-${i}`}>{k.value}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {k.startEnd && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0} className="cursor-help" data-testid={`chip-change-${i}`}><DeltaChip value={k.change} /></span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[260px] text-[12px]">
                        Median of the first {n} months of the selected period ({k.startEnd[0] != null ? k.startEnd[2](k.startEnd[0]) : "n/a"}) against the median of the last {n} months ({k.startEnd[1] != null ? k.startEnd[2](k.startEnd[1]) : "n/a"}), in nominal euros.
                        {k.change == null && " One of the two windows has too few sales to compute a change."}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <p className="text-[12.5px] text-muted-foreground">{k.startEnd ? "over the period" : k.sub}</p>
                </div>
                {k.note && <p className="text-[12.5px] text-muted-foreground mt-0.5" data-testid={`text-house-share-${i}`}>{k.note}</p>}
              </>
            )}
          </CardContent>
        </Card>
      ))}
      {warning && <p className="col-span-full text-[13px] text-muted-foreground" data-testid="text-house-share-warning">{warning}</p>}
    </div>
  );
}
