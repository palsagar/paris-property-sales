import { memo, useMemo, useState } from "react";
import type { AreaTrendPoint, PropertyTypeParameter } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard, ErrorState, GradientLegend, Segmented } from "@/components/ui-bits";
import { RankSwitch } from "@/components/ranking";
import { num, sqm, pct, makeDivScale, TOO_FEW, houseShareLabel } from "@/lib/fmt";
import type { RankGroup } from "@/lib/areas";

export const Heatmap = memo(function Heatmap({ data, rows, loading, fetching, error, retry, scale, domain, selId, onSelectRow, rank, onRank, ptype, travel, onSelectPeriod, isDark }: {
  data: AreaTrendPoint[]; rows: { id: string; label: string }[]; loading: boolean; fetching: boolean; error: boolean; retry: () => void;
  scale: (v: number) => string; domain: [number, number]; selId?: string; onSelectRow: (id: string) => void;
  rank: RankGroup; onRank: (r: RankGroup) => void; ptype: PropertyTypeParameter;
  travel: string | null; onSelectPeriod: (p: string) => void; isDark: boolean;
}) {
  const [rel, setRel] = useState<"level" | "rel">("level");
  const [hover, setHover] = useState<{ r: string; c: string } | null>(null);
  const labelOf = useMemo(() => new Map(rows.map((r) => [r.id, r.label])), [rows]);
  const { periods, labels, cell, first } = useMemo(() => {
    const cell = new Map<string, AreaTrendPoint>();
    const labels = new Map<string, string>();
    for (const r of data) { cell.set(`${r.id}|${r.period}`, r); labels.set(r.period, r.label); }
    const periods = [...labels.keys()].sort();
    // The first quarter with a median, for each row. Cells with too few Sales have none.
    const first = new Map<string, number>();
    for (const { id } of rows) {
      for (const p of periods) { const m = cell.get(`${id}|${p}`)?.medianPricePerSqm; if (m != null) { first.set(id, m); break; } }
    }
    return { periods, labels, cell, first };
  }, [data, rows]);
  const relMax = useMemo(() => {
    let m = 5;
    cell.forEach((r) => { const f = first.get(r.id); if (f && r.medianPricePerSqm != null) m = Math.max(m, Math.abs(((r.medianPricePerSqm - f) / f) * 100)); });
    return Math.min(40, Math.ceil(m / 5) * 5);
  }, [cell, first]);
  const div = useMemo(() => makeDivScale(relMax), [relMax]);
  const hv = hover ? cell.get(`${hover.r}|${hover.c}`) : undefined;
  const hf = hover ? first.get(hover.r) : undefined;

  return (
    <ChartCard testId="heatmap" title="Price per m² by area and quarter" isDark={isDark} loading={loading} fetching={fetching}
      csv={data} csvName={`heatmap-${rank}-quarter.csv`}
      desc="Each cell is the median price per m² for one quarter. Click a row to select the area. Click a year mark above a column to show that quarter on the map."
      right={<Segmented label="Colour by" testId="heat-mode" value={rel} onChange={(v) => setRel(v as "level" | "rel")} options={[["level", "Price level"], ["rel", "Change since first quarter"]]} />}>
      <RankSwitch value={rank} onChange={onRank} testId="heat-rank-switch" />
      {loading ? <Skeleton className="w-full h-[440px]" /> : error ? <ErrorState onRetry={retry} /> : periods.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No sales in this period. Pick a longer one.</div>
      ) : (
        <>
          <div className="h-6 mb-1 text-[13px]" data-testid="text-heat-readout">
            {hover && hv ? (
              <><b>{labelOf.get(hover.r)}</b>, {labels.get(hover.c)}: <b>{hv.medianPricePerSqm == null ? TOO_FEW : sqm(hv.medianPricePerSqm)}</b>, {num(hv.count)} sales{ptype === "all" && hv.houseShare != null ? `, ${houseShareLabel(hv.houseShare)}` : ""}{hf && hv.medianPricePerSqm != null ? <>, {pct(((hv.medianPricePerSqm - hf) / hf) * 100)} since first quarter</> : null}{hv.count < 10 && <span className="text-primary"> (low sample)</span>}</>
            ) : <span className="text-muted-foreground">Point at a cell to read its figure.</span>}
          </div>
          <div className="overflow-x-auto">
            <div className="grid gap-[2px] min-w-[560px]" style={{ gridTemplateColumns: `${rank === "paris" ? "38px" : "124px"} repeat(${periods.length}, minmax(12px, 1fr))` }} onMouseLeave={() => setHover(null)}>
              <span />
              {periods.map((p) => (
                <button key={p} onClick={() => onSelectPeriod(p)} data-testid={`heat-col-${p}`}
                  className={`no-tap text-[11px] font-num h-5 rounded-sm transition-colors ${travel === p ? "bg-primary text-primary-foreground" : hover?.c === p ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`}
                  title={`Show ${labels.get(p)} on the map`}>
                  {p.slice(5, 7) === "01" ? p.slice(2, 4) : ""}
                </button>
              ))}
              {rows.map(({ id, label }) => (
                <div key={id} className="contents">
                  <button onClick={() => onSelectRow(id)} data-testid={`heat-row-${id}`} title={label}
                    className={`no-tap text-[11.5px] font-num text-right pr-1.5 rounded-sm truncate transition-colors ${selId === id ? "text-primary font-semibold" : hover?.r === id ? "text-foreground" : "text-muted-foreground"} hover:text-primary`}>{label}</button>
                  {periods.map((p) => {
                    const r = cell.get(`${id}|${p}`);
                    const f = first.get(id);
                    const m = r?.medianPricePerSqm;
                    const color = m == null ? "transparent" : rel === "rel" && f ? div(((m - f) / f) * 100) : scale(m);
                    const dim = hover && hover.r !== id && hover.c !== p;
                    return (
                      <button key={p} onMouseEnter={() => setHover({ r: id, c: p })} onClick={() => onSelectRow(id)}
                        className={`no-tap h-[19px] rounded-[2px] transition-opacity duration-150 ${selId === id ? "ring-1 ring-primary" : ""} ${r && r.count < 10 ? "outline-1 outline-dashed outline-foreground/40" : ""}`}
                        style={{ background: color, opacity: dim ? 0.55 : 1 }}
                        aria-label={`${label} ${labels.get(p)}${r && m == null ? `: ${TOO_FEW}` : ""}`} />
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
});
