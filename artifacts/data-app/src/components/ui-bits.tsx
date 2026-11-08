import { forwardRef, useId, useMemo, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CSVLink } from "react-csv";
import { ChevronDown, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { StepScale } from "@/lib/colour-scale";
import { track } from "@/lib/analytics";

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

/*
 * The three kinds of button. Every other control is a Segmented choice, a FieldButton or a SwitchField.
 * Heights: 40 px with a mouse; index.css raises every target to 44 px on a touch screen.
 */
/** Outline button: secondary actions such as Back to All Paris, Try again, Previous and Next. */
export const outlineBtnCls = "inline-flex items-center justify-center gap-2 h-10 px-3.5 rounded-lg border border-control bg-card text-[14px] font-medium text-foreground whitespace-nowrap hover:bg-sunken transition-colors disabled:opacity-45 disabled:cursor-not-allowed";
/** Ghost icon button: CSV, print, theme, zoom. Always give it an aria-label. */
export const iconBtnCls = "inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-lg text-foreground hover:bg-sunken transition-colors disabled:opacity-45";
/** Bordeaux fill: only the one primary action of a sheet. */
export const primaryBtnCls = "inline-flex items-center justify-center gap-2 h-12 px-4 rounded-[10px] bg-primary text-primary-foreground text-[16px] font-semibold hover:opacity-95 transition-opacity";
/** Kept for older call sites: the ghost style. */
export const btnCls = "text-foreground hover:bg-sunken transition-colors";

/** The one tooltip style, shared with the map's tooltips (index.css, `.leaflet-tooltip.pt`). */
export function TipBox({ title, rows, note }: { title: ReactNode; rows: [string, string, string?][]; note?: ReactNode }) {
  return (
    <div className="bg-popover text-popover-foreground border rounded-lg px-3 py-2.5 text-[13px] min-w-[200px] shadow-md">
      <div className="font-semibold text-[14px] mb-1">{title}</div>
      {rows.map(([k, v, c]) => (
        <div key={k} className="flex gap-3 items-center mt-0.5">
          {c && <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />}
          <span className="text-muted-foreground">{k}</span>
          <span className="ml-auto font-medium font-num">{v}</span>
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

export function CsvButton({ data, filename, testId }: { data: object[]; filename: string; testId: string }) {
  return (
    <CSVLink data={data} filename={filename} data-testid={`button-csv-${testId}`} onClick={() => { track("export-csv", { panel: testId }); }}
      className={`print:hidden ${iconBtnCls}`} aria-label="Download this panel's data as CSV" title="Download CSV">
      <Download className="w-[18px] h-[18px]" aria-hidden />
    </CSVLink>
  );
}

export function ChartCard({ title, desc, lede, csv, csvName, loading, fetching = false, children, className = "", right, controls, testId, level = 2 }: {
  title: string; desc?: ReactNode; lede?: ReactNode; csv?: object[]; csvName: string; loading: boolean; fetching?: boolean; isDark: boolean;
  children: ReactNode; className?: string; right?: ReactNode; controls?: ReactNode; testId: string; level?: 2 | 3;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <Card className={`shadcn-card min-w-0 ${className}`} data-testid={`card-${testId}`}>
      <CardHeader className="px-4 sm:px-5 pt-4 pb-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 max-w-[70ch]">
            <H className="text-[18px] sm:text-[19px] leading-snug font-display font-semibold flex items-baseline gap-2">{title}<FetchDot on={fetching && !loading} /></H>
            {desc && <CardDescription className="text-[14px] mt-0.5 leading-relaxed">{desc}</CardDescription>}
            {lede && <p className="text-[16px] mt-1.5 leading-snug text-foreground">{lede}</p>}
          </div>
          <div className="flex items-center gap-2 -mr-1.5 -mt-1">
            {right}
            {!loading && csv && csv.length > 0 && <CsvButton data={csv} filename={csvName} testId={testId} />}
          </div>
        </div>
        {controls && <div className="flex flex-wrap items-center gap-2 print:hidden">{controls}</div>}
      </CardHeader>
      <CardContent className="px-4 sm:px-5 pb-5">{children}</CardContent>
    </Card>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="h-full min-h-[200px] flex flex-col items-center justify-center gap-3 text-[15px] text-muted-foreground text-center px-4" role="alert">
      <p>This data did not load. Check your connection and try again.</p>
      <button onClick={onRetry} className={outlineBtnCls} data-testid="button-retry">Try again</button>
    </div>
  );
}

/**
 * One choice among a few options. The same style everywhere: a sunken track, the chosen option inked.
 * `stretch` makes the options share the width (phones); `tall` makes them 44 px.
 */
export function Segmented<T extends string>({ value, options, onChange, testId, label, stretch = false, tall = false, className = "", role = "group" }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; testId: string; label?: string; stretch?: boolean; tall?: boolean; className?: string; role?: "group" | "tablist";
}) {
  return (
    <div className={`${stretch ? "flex" : "inline-flex"} gap-0.5 rounded-[10px] bg-sunken p-[3px] print:hidden ${className}`} role={role} aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} data-testid={`${testId}-${v}`}
          {...(role === "tablist" ? { role: "tab", "aria-selected": value === v } : { "aria-pressed": value === v })}
          className={`${stretch ? "flex-1 min-w-0" : ""} ${tall ? "h-11 text-[15px]" : "h-[34px] text-[14px]"} px-3 rounded-[7px] font-medium whitespace-nowrap transition-colors ${value === v ? "bg-foreground text-background" : "text-foreground hover:bg-foreground/[0.06]"}`}>{l}</button>
      ))}
    </div>
  );
}

/** A button that shows a current value and opens a picker: the Area and Period of the Selection bar. */
export const FieldButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> & { icon: ReactNode; label: string; value: ReactNode }>(
  function FieldButton({ icon, label, value, className = "", ...rest }, ref) {
    return (
      <button ref={ref} type="button" {...rest}
        className={`flex items-center gap-2.5 h-[52px] pl-3.5 pr-3 rounded-lg border border-control bg-card text-left hover:bg-sunken/60 transition-colors ${className}`}>
        <span className="text-primary shrink-0" aria-hidden>{icon}</span>
        <span className="flex flex-col min-w-0 leading-tight">
          <span className="text-[12px] text-muted-foreground">{label}</span>
          <span className="text-[15px] font-semibold truncate">{value}</span>
        </span>
        <ChevronDown className="w-4 h-4 ml-auto shrink-0" aria-hidden />
      </button>
    );
  },
);

/** The one on/off control: the trend's Smoothing and middle-half band. */
export function SwitchField({ checked, onCheckedChange, label, disabled, testId, className = "" }: {
  checked: boolean; onCheckedChange: (on: boolean) => void; label: string; disabled?: boolean; testId: string; className?: string;
}) {
  const id = useId();
  return (
    <span className={`inline-flex items-center gap-2 min-h-10 print:hidden ${disabled ? "opacity-45" : ""} ${className}`}>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} data-testid={testId}
        className="data-[state=checked]:bg-foreground data-[state=unchecked]:bg-control/50" />
      <label htmlFor={id} className="text-[14px] cursor-pointer select-none">{label}</label>
    </span>
  );
}

export function GradientLegend({ title, min, max, scale, fmt, mid, className = "w-[260px]" }: { title: ReactNode; min: number; max: number; scale: (v: number) => string; fmt: (n: number) => string; mid?: number; className?: string }) {
  const stops = Array.from({ length: 12 }, (_, i) => scale(min + ((max - min) * i) / 11));
  return (
    <div className={className}>
      <div className="text-[13px] mb-1.5 text-muted-foreground">{title}</div>
      <div className="h-3 rounded-sm" style={{ background: `linear-gradient(90deg, ${stops.join(",")})` }} />
      <div className="flex justify-between font-num text-[12px] mt-1 text-muted-foreground"><span>{fmt(min)}</span><span>{fmt(mid ?? (min + max) / 2)}</span><span>{fmt(max)}</span></div>
    </div>
  );
}

/** One colour for each step of the scale, with each threshold written under the edge between two steps. */
export function StepLegend({ title, scale, fmt, className = "w-full" }: { title: ReactNode; scale: StepScale; fmt: (n: number) => string; className?: string }) {
  const step = 100 / scale.colors.length;
  const t = scale.thresholds;
  const range = (i: number) => (i === 0 ? `under ${fmt(t[0]!)}` : i >= t.length ? `${fmt(t[t.length - 1]!)}+` : `${fmt(t[i - 1]!)}–${fmt(t[i]!)}`);
  return (
    <div className={className} data-testid="step-legend">
      <div className="text-[13px] mb-1.5 text-muted-foreground">{title}</div>
      {/* Laptop: a strip with each threshold under its edge. */}
      <div className="hidden sm:block">
        <div className="flex h-3.5 gap-[2px]">{scale.colors.map((c) => <span key={c} className="flex-1 rounded-[2px]" style={{ background: c }} />)}</div>
        <div className="relative h-5 mt-1 font-num text-[12px] text-muted-foreground">
          {t.map((v, i) => <span key={v} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${step * (i + 1)}%` }}>{fmt(v)}</span>)}
        </div>
      </div>
      {/* Phone: the thresholds would collide on a strip, so each colour gets its range. */}
      <ul className="sm:hidden grid grid-cols-3 gap-x-2.5 gap-y-1.5">
        {scale.colors.map((c, i) => (
          <li key={c} className="flex items-center gap-1.5 min-w-0"><span className="w-4 h-4 rounded-[3px] shrink-0" style={{ background: c }} aria-hidden /><span className="font-num text-[12px] whitespace-nowrap">{range(i)}</span></li>
        ))}
      </ul>
    </div>
  );
}

/** A Change: arrow, sign and colour, so it never relies on colour alone. Blue for a fall, red for a rise. */
export function DeltaChip({ value, size = "sm" }: { value: number | null | undefined; size?: "sm" | "xs" }) {
  if (value == null || !isFinite(value)) return <span className="text-[12px] text-muted-foreground">n/a</span>;
  const up = value > 0.05, down = value < -0.05;
  const cls = up ? "bg-rise-bg text-rise" : down ? "bg-fall-bg text-fall" : "bg-sunken text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 rounded font-num font-medium whitespace-nowrap ${size === "xs" ? "text-[12px] h-5 px-1.5" : "text-[13px] h-6 px-2"} ${cls}`}>
      {(up || down) && <span aria-hidden>{up ? "▲" : "▼"}</span>}
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
