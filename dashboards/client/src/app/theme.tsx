import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

type ThemeModeContextValue = {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
};

const STORAGE_KEY = "engyne.themeMode";

function resolveThemeForTime(date: Date): ResolvedTheme {
  const hour = date.getHours();
  return hour >= 7 && hour < 19 ? "light" : "dark";
}

function nextMode(mode: ThemeMode): ThemeMode {
  if (mode === "auto") return "dark";
  if (mode === "dark") return "light";
  return "auto";
}

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "auto" || raw === "light" || raw === "dark") return raw;
  return "auto";
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredMode());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    mode === "auto" ? resolveThemeForTime(new Date()) : mode,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const nextResolved = mode === "auto" ? resolveThemeForTime(new Date()) : mode;
      setResolvedTheme(nextResolved);
      root.dataset.theme = nextResolved;
    };

    apply();

    if (mode !== "auto") return;
    const interval = window.setInterval(apply, 60_000);
    return () => window.clearInterval(interval);
  }, [mode]);

  const cycleMode = useCallback(() => {
    setMode((prev) => nextMode(prev));
  }, []);

  const value = useMemo(
    () => ({ mode, resolvedTheme, setMode, cycleMode }),
    [mode, resolvedTheme, cycleMode],
  );

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode() {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error("useThemeMode must be used within ThemeModeProvider");
  return ctx;
}

