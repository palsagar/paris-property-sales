import { useMemo, type ReactNode } from "react";
import { CSVLink } from "react-csv";
import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import type { StepScale } from "@/lib/colour-scale";

export type ChartColors = {
  grid: string; tick: string; accent: string; second: string; bg: string; cursor: string; ink: string; paper: string; nodata: string;
};

const tokenCache = new Map<boolean, ChartColors>();
const TOKENS: [keyof ChartColors, string][] = [
  ["grid", "--chart-grid"], ["tick", "--chart-tick"], ["accent", "--chart-accent"], ["second", "--chart-second"], ["bg", "--chart-bg"],
  ["cursor", "--chart-cursor"], ["ink", "--chart-ink"], ["paper", "--chart-paper"], ["nodata", "--chart-nodata"],
];

/** Reads chart colours from the CSS tokens declared in index.css (:root / .dark). */
function readTokens(isDark: boolean): ChartColors {
  const hit = tokenCache.get(isDark);
  if (hit) return hit;
  const el = document.createElement("div");
  el.className = isDark ? "dark" : "theme-light";
  el.style.display = "none";
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const out = Object.fromEntries(TOKENS.map(([k, v]) => [k, cs.getPropertyValue(v).trim()])) as ChartColors;
  el.remove();
  if (out.accent) tokenCache.set(isDark, out);
  return out;
}

export function useChartColors(isDark: boolean) {
  return useMemo(() => readTokens(isDark), [isDark]);
}

/** Small neutral button surface used by toolbar buttons. */
export const btnCls = "bg-secondary text-secondary-foreground hover:bg-muted transition-colors";

export function TipBox({ title, rows, note }: { title: ReactNode; rows: [string, string, string?][]; note?: ReactNode }) {
  return (
    <div className="bg-popover text-popover-foreground border rounded-md px-3.5 py-2.5 text-[13px] min-w-[200px] shadow-[0_8px_24px_-10px_hsl(var(--foreground)/0.3)]">
      <div className="font-semibold mb-1.5">{title}</div>
      {rows.map(([k, v, c]) => (
        <div key={k} className="flex gap-3 items-center mt-0.5">
          {c && <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />}
          <span className="text-muted-foreground">{k}</span>
          <span className="ml-auto font-semibold font-num">{v}</span>
        </div>
      ))}
      {note && <div className="mt-1.5 text-[12px] text-primary">{note}</div>}
    </div>
  );
}

/** Quiet text marker shown while a query refetches in the background. */
export function FetchDot({ on }: { on: boolean }) {
  return (
    <span className={`text-[12px] font-normal font-sans tracking-normal text-muted-foreground transition-opacity duration-300 ${on ? "opacity-100" : "opacity-0"}`} aria-live="polite">
      {on ? "Updating" : ""}
    </span>
  );
}

export function ChartCard({ title, desc, csv, csvName, loading, fetching = false, children, className = "", right, testId }: {
  title: string; desc?: ReactNode; csv?: object[]; csvName: string; loading: boolean; fetching?: boolean; isDark: boolean;
  children: ReactNode; className?: string; right?: ReactNode; testId: string;
}) {
  return (
    <Card className={`shadcn-card rise ${className}`} data-testid={`card-${testId}`}>
      <CardHeader className="px-5 pt-4 pb-3 flex-row items-start justify-between space-y-0 gap-3 flex-wrap">
        <div className="min-w-0 max-w-[68ch]">
          <h2 className="text-[17px] leading-snug font-display font-bold flex items-baseline gap-2">{title}<FetchDot on={fetching && !loading} /></h2>
          {desc && <CardDescription className="text-[13px] mt-1 leading-relaxed">{desc}</CardDescription>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {right}
          {!loading && csv && csv.length > 0 && (
            <CSVLink data={csv as object[]} filename={csvName} data-testid={`button-csv-${testId}`}
              className={`print:hidden flex items-center justify-center w-7 h-7 rounded-md active:scale-95 ${btnCls}`}
              aria-label="Download this chart's data as CSV" title="Download CSV">
              <Download className="w-3.5 h-3.5" />
            </CSVLink>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">{children}</CardContent>
    </Card>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="h-full min-h-[200px] flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <p>This data did not load. Check your connection and try again.</p>
      <button onClick={onRetry} className="px-3 h-8 rounded-md bg-primary text-primary-foreground text-[13px]" data-testid="button-retry">Try again</button>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, testId, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; testId: string; label?: string }) {
  return (
    <div className="flex flex-wrap rounded-md border bg-card p-0.5 print:hidden" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} data-testid={`${testId}-${v}`} aria-pressed={value === v}
          className={`px-2.5 h-7 text-[13px] rounded transition-colors ${value === v ? "bg-foreground text-background" : "hover:bg-muted"}`}>{l}</button>
      ))}
    </div>
  );
}

export function GradientLegend({ title, min, max, scale, fmt, mid }: { title: ReactNode; min: number; max: number; scale: (v: number) => string; fmt: (n: number) => string; mid?: number }) {
  const stops = Array.from({ length: 12 }, (_, i) => scale(min + ((max - min) * i) / 11));
  return (
    <div className="w-[240px]">
      <div className="text-[12px] mb-1 text-foreground">{title}</div>
      <div className="h-2.5 rounded-sm" style={{ background: `linear-gradient(90deg, ${stops.join(",")})` }} />
      <div className="flex justify-between font-num text-[11.5px] mt-1"><span>{fmt(min)}</span><span>{fmt(mid ?? (min + max) / 2)}</span><span>{fmt(max)}</span></div>
    </div>
  );
}

/** One colour for each step of the scale, with each threshold written under the edge between two steps. */
export function StepLegend({ title, scale, fmt }: { title: ReactNode; scale: StepScale; fmt: (n: number) => string }) {
  const step = 100 / scale.colors.length;
  return (
    <div className="w-[min(320px,calc(100vw-124px))]" data-testid="step-legend">
      <div className="text-[12px] mb-1 text-foreground">{title}</div>
      <div className="flex h-2.5 rounded-sm overflow-hidden">{scale.colors.map((c) => <span key={c} className="flex-1" style={{ background: c }} />)}</div>
      <div className="relative h-4 mt-1 font-num text-[9.5px] sm:text-[10.5px]">
        {scale.thresholds.map((t, i) => <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${step * (i + 1)}%` }}>{fmt(t)}</span>)}
      </div>
    </div>
  );
}

export function DeltaChip({ value, size = "sm" }: { value: number | null | undefined; size?: "sm" | "xs" }) {
  if (value == null || !isFinite(value)) return <span className="text-[11.5px] text-muted-foreground">n/a</span>;
  const up = value > 0.05, down = value < -0.05;
  const cls = up ? "bg-primary/10 text-primary" : down ? "bg-navy/10 text-navy" : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-0.5 rounded font-num ${size === "xs" ? "text-[11.5px] px-1" : "text-[12px] px-1.5 py-0.5"} ${cls}`}>
      {(up || down) && <span aria-hidden>{up ? "\u25B2" : "\u25BC"}</span>}
      {`${value > 0 ? "+" : value < 0 ? "-" : ""}${Math.abs(value).toFixed(1)}%`}
    </span>
  );
}

export function Sparkline({ values, color, w = 64, h = 18 }: { values: number[]; color: string; w?: number; h?: number }) {
  const v = values.filter((x) => isFinite(x));
  if (v.length < 2) return <svg width={w} height={h} />;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * (w - 2) + 1},${h - 1 - ((x - min) / span) * (h - 2)}`).join(" ");
  const last = pts.split(" ").pop()!.split(",");
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={1.8} fill={color} />
    </svg>
  );
}
