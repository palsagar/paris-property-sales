import { useCallback, useEffect, useState } from "react";

/** "system" follows the device setting; "light" and "dark" are a Visitor's own choice, remembered on this device. */
export type ThemeChoice = "system" | "light" | "dark";

const KEY = "theme";
const query = () => window.matchMedia("(prefers-color-scheme: dark)");

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/**
 * The colour theme. It follows the system setting until the Visitor flips it, then remembers that choice.
 * index.html applies the same rule before the first paint, so the page does not flash light before turning dark.
 */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const [systemDark, setSystemDark] = useState(() => query().matches);
  useEffect(() => {
    const mq = query();
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const isDark = choice === "dark" || (choice === "system" && systemDark);
  useEffect(() => { document.documentElement.classList.toggle("dark", isDark); }, [isDark]);
  /** Flips to the other theme and remembers it. Choosing the system's own theme goes back to following the system. */
  const toggle = useCallback(() => {
    const next: ThemeChoice = isDark ? (systemDark ? "light" : "system") : (systemDark ? "system" : "dark");
    try {
      if (next === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, next);
    } catch { /* private mode: the choice lasts for this visit */ }
    setChoice(next);
  }, [isDark, systemDark]);
  return { isDark, choice, toggle };
}
