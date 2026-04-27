import { useEffect, useState } from "react";

/**
 * Theme toggle button — light / dark.
 *
 * The actual theme application happens via a `.dark` class on <html>. The
 * initial value is set by an inline script in index.html (so there's no
 * flash-of-wrong-theme before React mounts). This component just keeps
 * React state in sync with the DOM, persists changes to localStorage, and
 * renders a sun/moon icon button.
 *
 * Honours `prefers-color-scheme` as the default when nothing is saved.
 */

type Theme = "light" | "dark";

function readInitialTheme(): Theme {
  // The inline bootstrap in index.html may have already set .dark on <html>.
  // Trust the DOM as the source of truth for the first render.
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  // Apply theme class + persist on every change.
  // Storage key is `liganx-theme` post-rebrand; we also clear the legacy
  // `deltadock-theme` key so it can't override on next paint.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem("liganx-theme", theme);
      localStorage.removeItem("deltadock-theme");
    } catch { /* ignore — private mode etc. */ }
  }, [theme]);

  // If the user hasn't explicitly chosen a theme, follow OS changes live.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange(e: MediaQueryListEvent) {
      const explicit = (() => {
        try {
          // Honour either key — legacy `deltadock-theme` keeps existing
          // bookmarks' preference until the next toggle migrates it.
          return (
            localStorage.getItem("liganx-theme") ||
            localStorage.getItem("deltadock-theme")
          );
        } catch { return null; }
      })();
      if (!explicit) setTheme(e.matches ? "dark" : "light");
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex items-center justify-center w-9 h-9 rounded-md text-slate-600 hover:text-ink hover:bg-slate-100 transition-colors dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
