import { memo, useMemo, useState } from "react";
import type { AreaTrendPoint, PropertyTypeParameter } from "@workspace/api-client-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, GradientLegend, Segmented, outlineBtnCls } from "@/components/ui-bits";
import { num, sqm, pct, makeDivScale, tooFew, houseShareLabel, bucketLabel } from "@/lib/fmt";
import type { RankGroup } from "@/lib/areas";
import { track } from "@/lib/analytics";
import { t } from "@/lib/i18n/messages";

const stepCls = "inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-lg border border-control bg-card hover:bg-sunken disabled:opacity-40";

/**
 * The heat map, the "Quarter by quarter" tab of the Areas card (areas-card.tsx). One row per Area, one column per
 * quarter. A cell shows its figures on hover, on keyboard focus and on a tap, which keeps them until another cell is
 * chosen; the arrows step through the quarters. A row's name, or the button under the figures, selects the Area.
 */
export const Heatmap = memo(function Heatmap({ data, rows, loading, error, retry, scale, domain, selId, onSelectRow, rank, ptype, travel, onSelectPeriod }: {
  data: AreaTrendPoint[]; rows: { id: string; label: string }[]; loading: boolean; error: boolean; retry: () => void;
  scale: (v: number) => string; domain: [number, number]; selId?: string; onSelectRow: (id: string, only?: boolean) => void;
  rank: RankGroup; ptype: PropertyTypeParameter; travel: string | null; onSelectPeriod: (p: string) => void;
}) {
  const [rel, setRel] = useState<"level" | "rel">("level");
  const [hover, setHover] = useState<{ r: string; c: string } | null>(null);
  const [pinned, setPinned] = useState<{ r: string; c: string } | null>(null);
  const labelOf = useMemo(() => new Map(rows.map((r) => [r.id, r.label])), [rows]);
  const { periods, labels, cell, first } = useMemo(() => {
    const cell = new Map<string, AreaTrendPoint>();
    const labels = new Map<string, string>();
    for (const r of data) { cell.set(`${r.id}|${r.period}`, r); labels.set(r.period, bucketLabel(r.period, "quarter")); }
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
  // A pinned cell of an earlier group or Period no longer exists.
  const pin = pinned && labelOf.has(pinned.r) && periods.includes(pinned.c) ? pinned : null;
  const shown = hover ?? pin;
  const hv = shown ? cell.get(`${shown.r}|${shown.c}`) : undefined;
  const hf = shown ? first.get(shown.r) : undefined;
  const step = (d: number) => {
    if (!pin) return;
    const i = periods.indexOf(pin.c) + d;
    if (i >= 0 && i < periods.length) setPinned({ r: pin.r, c: periods[i]! });
  };
  const labelW = rank === "paris" ? "40px" : "minmax(72px,120px)";
  const h = t().heatmap;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] text-muted-foreground">{h.colourBy}</span>
        <Segmented label={h.colourBy} testId="heat-mode" value={rel} onChange={(v) => { if (v !== rel) track("change-heatmap-colour", { by: v === "level" ? "price" : "change" }); setRel(v as "level" | "rel"); }}
          options={[["level", h.level], ["rel", h.rel]]} />
      </div>
      {loading ? <Skeleton className="w-full h-[440px]" /> : error ? <ErrorState onRetry={retry} /> : periods.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-[15px] text-muted-foreground">{h.empty}</div>
      ) : (
        <>
          <div role="status" aria-live="polite" className="flex items-center gap-2 min-h-14 p-2 rounded-lg bg-sunken/70" data-testid="text-heat-readout">
            <button type="button" className={stepCls} onClick={() => step(-1)} disabled={!pin || periods.indexOf(pin.c) <= 0} aria-label={h.previous}><ChevronLeft className="w-[18px] h-[18px]" aria-hidden /></button>
            <div className="flex-1 min-w-0 text-[14px] leading-snug">
              {shown && hv ? (
                <>
                  <p className="font-semibold">{labelOf.get(shown.r)} · {labels.get(shown.c)}</p>
                  <p className="font-num">{hv.medianPricePerSqm == null ? tooFew() : sqm(hv.medianPricePerSqm)} · {t().sales(num(hv.count), hv.count)}
                    {ptype === "all" && hv.houseShare != null ? ` · ${houseShareLabel(hv.houseShare)}` : ""}
                    {hf && hv.medianPricePerSqm != null ? h.sinceFirst(pct(((hv.medianPricePerSqm - hf) / hf) * 100)) : ""}
                    {hv.count < 10 && <span className="text-primary">{h.few}</span>}</p>
                </>
              ) : <p className="text-muted-foreground">{h.point}</p>}
            </div>
            <button type="button" className={stepCls} onClick={() => step(1)} disabled={!pin || periods.indexOf(pin.c) >= periods.length - 1} aria-label={h.next}><ChevronRight className="w-[18px] h-[18px]" aria-hidden /></button>
          </div>
          <div className="grid gap-[2px]" style={{ gridTemplateColumns: `${labelW} repeat(${periods.length}, minmax(0, 1fr))` }} onMouseLeave={() => setHover(null)}>
            <span />
            {periods.map((p) => (
              <button key={p} type="button" onClick={() => onSelectPeriod(p)} data-testid={`heat-col-${p}`}
                className={`no-tap text-[12px] font-num h-5 rounded-sm transition-colors overflow-visible whitespace-nowrap ${travel === p ? "bg-primary text-primary-foreground" : shown?.c === p ? "bg-sunken text-foreground" : "text-muted-foreground hover:bg-sunken"}`}
                aria-label={h.show(labels.get(p) ?? "")} title={h.show(labels.get(p) ?? "")}>
                {p.slice(5, 7) === "01" ? `'${p.slice(2, 4)}` : ""}
              </button>
            ))}
            {rows.map(({ id, label }) => (
              <div key={id} className="contents">
                <button type="button" onClick={() => onSelectRow(id)} data-testid={`heat-row-${id}`} title={h.select(label)}
                  className={`no-tap text-[12px] font-num text-right pr-1.5 rounded-sm truncate transition-colors ${selId === id ? "text-primary font-semibold" : shown?.r === id ? "text-foreground" : "text-muted-foreground"} hover:text-primary`}>{label}</button>
                {periods.map((p) => {
                  const r = cell.get(`${id}|${p}`);
                  const f = first.get(id);
                  const m = r?.medianPricePerSqm;
                  const color = m == null ? "transparent" : rel === "rel" && f ? div(((m - f) / f) * 100) : scale(m);
                  const dim = shown && shown.r !== id && shown.c !== p;
                  const isPin = pin?.r === id && pin.c === p;
                  return (
                    <button key={p} type="button" onMouseEnter={() => setHover({ r: id, c: p })} onFocus={() => setPinned({ r: id, c: p })} onClick={() => setPinned({ r: id, c: p })}
                      className={`no-tap h-4 sm:h-[18px] rounded-[2px] transition-opacity duration-150 ${isPin ? "ring-2 ring-foreground ring-offset-1 ring-offset-card" : selId === id ? "ring-1 ring-primary" : ""} ${r && r.count < 10 ? "outline-1 outline-dashed outline-foreground/50" : ""}`}
                      style={{ background: color, opacity: dim ? 0.55 : 1 }}
                      aria-label={`${label}, ${labels.get(p)}${r && m == null ? `: ${tooFew()}` : ""}`} />
                  );
                })}
              </div>
            ))}
          </div>
          {pin && (
            <button type="button" className={`${outlineBtnCls} self-start`} onClick={() => onSelectRow(pin.r, true)} data-testid="button-heat-focus">
              {h.focus(labelOf.get(pin.r) ?? "")}
            </button>
          )}
          <div className="flex flex-wrap items-end justify-between gap-3">
            {rel === "rel" ? <GradientLegend title={h.relLegend} min={-relMax} max={relMax} mid={0} scale={div} fmt={(n) => (n === 0 ? "0%" : pct(n, 0))} className="w-full sm:w-[280px]" />
              : <GradientLegend title={h.levelLegend} min={domain[0]} max={domain[1]} scale={scale} fmt={num} className="w-full sm:w-[280px]" />}
            <span className="text-[13px] text-muted-foreground">{h.note}</span>
          </div>
        </>
      )}
    </div>
  );
});
