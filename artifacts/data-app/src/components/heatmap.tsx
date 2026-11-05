import { useMemo, useState } from "react";
import type { AreaTrendPoint } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard, ErrorState, GradientLegend, Segmented } from "@/components/ui-bits";
import { num, sqm, pct, arrLabel, makeDivScale } from "@/lib/fmt";

export function Heatmap({ data, loading, fetching, error, retry, scale, domain, selArr, onSelectArr, travel, onSelectPeriod, isDark }: {
  data: AreaTrendPoint[]; loading: boolean; fetching: boolean; error: boolean; retry: () => void;
  scale: (v: number) => string; domain: [number, number]; selArr?: number; onSelectArr: (a: number) => void;
  travel: string | null; onSelectPeriod: (p: string) => void; isDark: boolean;
}) {
  const [rel, setRel] = useState<"level" | "rel">("level");
  const [hover, setHover] = useState<{ r: number; c: string } | null>(null);
  const { periods, labels, cell, first } = useMemo(() => {
    const cell = new Map<string, AreaTrendPoint>();
    const labels = new Map<string, string>();
    for (const r of data) { cell.set(`${r.id}|${r.period}`, r); labels.set(r.period, r.label); }
    const periods = [...labels.keys()].sort();
    const first = new Map<number, number>();
    for (let a = 1; a <= 20; a++) { const p = periods.find((p) => cell.get(`${a}|${p}`)); if (p) first.set(a, cell.get(`${a}|${p}`)!.medianPricePerSqm); }
    return { periods, labels, cell, first };
  }, [data]);
  const relMax = useMemo(() => {
    let m = 5;
    cell.forEach((r) => { const f = first.get(Number(r.id)); if (f) m = Math.max(m, Math.abs(((r.medianPricePerSqm - f) / f) * 100)); });
    return Math.min(40, Math.ceil(m / 5) * 5);
  }, [cell, first]);
  const div = useMemo(() => makeDivScale(relMax), [relMax]);
  const hv = hover ? cell.get(`${hover.r}|${hover.c}`) : undefined;
  const hf = hover ? first.get(hover.r) : undefined;

  return (
    <ChartCard testId="heatmap" title="Price per m² by arrondissement and quarter" isDark={isDark} loading={loading} fetching={fetching}
      csv={data} csvName="heatmap-arrondissement-quarter.csv"
      desc="Each cell is the median price per m² for one quarter. Click a row to select the arrondissement. Click a year mark above a column to show that quarter on the map."
      right={<Segmented label="Colour by" testId="heat-mode" value={rel} onChange={(v) => setRel(v as "level" | "rel")} options={[["level", "Price level"], ["rel", "Change since first quarter"]]} />}>
      {loading ? <Skeleton className="w-full h-[440px]" /> : error ? <ErrorState onRetry={retry} /> : periods.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No sales in this period. Pick a longer one.</div>
      ) : (
        <>
          <div className="h-6 mb-1 text-[13px]" data-testid="text-heat-readout">
            {hover && hv ? (
              <><b>{arrLabel(hover.r)}</b>, {labels.get(hover.c)}: <b>{sqm(hv.medianPricePerSqm)}</b>, {num(hv.count)} sales{hf ? <>, {pct(((hv.medianPricePerSqm - hf) / hf) * 100)} since first quarter</> : null}{hv.count < 10 && <span className="text-primary"> (low sample)</span>}</>
            ) : <span className="text-muted-foreground">Point at a cell to read its figure.</span>}
          </div>
          <div className="overflow-x-auto">
            <div className="grid gap-[2px] min-w-[560px]" style={{ gridTemplateColumns: `38px repeat(${periods.length}, minmax(12px, 1fr))` }} onMouseLeave={() => setHover(null)}>
              <span />
              {periods.map((p) => (
                <button key={p} onClick={() => onSelectPeriod(p)} data-testid={`heat-col-${p}`}
                  className={`no-tap text-[11px] font-num h-5 rounded-sm transition-colors ${travel === p ? "bg-primary text-primary-foreground" : hover?.c === p ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`}
                  title={`Show ${labels.get(p)} on the map`}>
                  {p.slice(5, 7) === "01" ? p.slice(2, 4) : ""}
                </button>
              ))}
              {Array.from({ length: 20 }, (_, i) => i + 1).map((a) => (
                <div key={a} className="contents">
                  <button onClick={() => onSelectArr(a)} data-testid={`heat-row-${a}`}
                    className={`no-tap text-[11.5px] font-num text-right pr-1.5 rounded-sm transition-colors ${selArr === a ? "text-primary font-semibold" : hover?.r === a ? "text-foreground" : "text-muted-foreground"} hover:text-primary`}>{arrLabel(a)}</button>
                  {periods.map((p) => {
                    const r = cell.get(`${a}|${p}`);
                    const f = first.get(a);
                    const color = !r ? "transparent" : rel === "rel" && f ? div(((r.medianPricePerSqm - f) / f) * 100) : scale(r.medianPricePerSqm);
                    const dim = hover && hover.r !== a && hover.c !== p;
                    return (
                      <button key={p} onMouseEnter={() => setHover({ r: a, c: p })} onClick={() => onSelectArr(a)}
                        className={`no-tap h-[19px] rounded-[2px] transition-opacity duration-150 ${selArr === a ? "ring-1 ring-primary" : ""} ${r && r.count < 10 ? "outline-1 outline-dashed outline-foreground/40" : ""}`}
                        style={{ background: color, opacity: dim ? 0.55 : 1 }}
                        aria-label={`${arrLabel(a)} ${labels.get(p)}`} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            {rel === "rel" ? <GradientLegend title="Change since the first quarter shown" min={-relMax} max={relMax} mid={0} scale={div} fmt={(n) => (n === 0 ? "0%" : pct(n, 0))} />
              : <GradientLegend title="Median price per m², same scale as the map" min={domain[0]} max={domain[1]} scale={scale} fmt={num} />}
            <span className="text-[12px] text-muted-foreground">Year marks sit on the first quarter of each year. Dashed cells have fewer than 10 sales.</span>
          </div>
        </>
      )}
    </ChartCard>
  );
}
