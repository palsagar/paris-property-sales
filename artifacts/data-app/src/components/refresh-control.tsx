import { useEffect, useRef, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ChevronDown, Check } from "lucide-react";
import { btnCls } from "@/components/ui-bits";

const INTERVAL_OPTIONS = [
  { label: "Every 5 min", ms: 5 * 60 * 1000 },
  { label: "Every 15 min", ms: 15 * 60 * 1000 },
  { label: "Every 1 hour", ms: 60 * 60 * 1000 },
  { label: "Every 24 hours", ms: 24 * 60 * 60 * 1000 },
];

/** The refresh button and its menu. It watches every request, so it lives apart from the dashboard, which then does not redraw when one starts or ends. */
export function RefreshControl() {
  const qc = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalMs, setIntervalMs] = useState(5 * 60 * 1000);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => qc.invalidateQueries(), Math.max(intervalMs, 5 * 60 * 1000));
    return () => clearInterval(t);
  }, [autoRefresh, intervalMs, qc]);

  const fetchingCount = useIsFetching();
  useEffect(() => {
    if (fetchingCount > 0) { setIsSpinning(true); return; }
    const t = setTimeout(() => setIsSpinning(false), 600);
    return () => clearTimeout(t);
  }, [fetchingCount]);

  return (
    <div className="relative" ref={dropdownRef}>
      <div className={`flex items-center rounded-md overflow-hidden h-8 text-[13px] ${btnCls}`}>
        <button onClick={() => qc.invalidateQueries()} disabled={fetchingCount > 0} data-testid="button-refresh" className="flex items-center gap-1.5 px-2.5 h-full hover:bg-foreground/5 transition-colors disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${isSpinning ? "animate-spin" : ""}`} />{autoRefresh ? "Refresh (auto)" : "Refresh"}
        </button>
        <div className="w-px h-4 bg-border" />
        <button onClick={() => setDropdownOpen((o) => !o)} data-testid="button-refresh-menu" aria-label="Auto-refresh options" aria-expanded={dropdownOpen} className="flex items-center px-1.5 h-full hover:bg-foreground/5 transition-colors">
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
        </button>
      </div>
      {dropdownOpen && (
        <div className="absolute right-0 mt-1.5 w-[210px] z-[1000] rounded-lg border bg-popover p-1.5 text-[13px] shadow-[0_12px_32px_-12px_hsl(var(--foreground)/0.35)]">
          <button onClick={() => setAutoRefresh((a) => !a)} data-testid="toggle-auto-refresh" aria-pressed={autoRefresh} className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted">
            Auto-refresh
            <span className={`w-7 h-4 rounded-full relative transition-colors ${autoRefresh ? "bg-primary" : "bg-muted-foreground/30"}`}>
              <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-background transition-transform ${autoRefresh ? "translate-x-3" : ""}`} />
            </span>
          </button>
          <div className="h-px bg-border my-1" />
          {INTERVAL_OPTIONS.map((o) => (
            <button key={o.ms} disabled={!autoRefresh} onClick={() => setIntervalMs(o.ms)} className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted disabled:opacity-40">
              {o.label}{intervalMs === o.ms && <Check className="w-3.5 h-3.5 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
