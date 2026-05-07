import { useEffect, useState } from "react";

/**
 * Theme toggle — light / dark, single source of truth for the WHOLE site.
 *
 * The actual theme application happens via a `.dark` class on <html>. The
 * initial value is set by an inline script in index.html (so there's no
 * flash-of-wrong-theme before React mounts). This component just keeps
 * React state in sync with the DOM and persists changes to localStorage.
 *
 * UX note (v0.27): we used to render a separate sun/moon icon-only toggle
 * here AND a text "☼ light / ☾ dark" toggle inside the Studio 2D editor
 * header. Two buttons for one concept caused predictable confusion ("why
 * is the page dark but the molecule editor light?"). Now there's a single
 * text button in the global header and Studio derives the Ketcher iframe
 * filter from this same `.dark` class — one click, everything flips.
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

  // OS prefers-color-scheme is intentionally NOT auto-followed. Earlier
  // we'd flip new users into dark mode whenever their OS was set to dark
  // (or even when the OS theme changed at runtime), but the product
  // brand is light-first and most marketing / shared-link views are
  // screenshotted in light. New users get light by default and stay
  // there until they click the toggle. After they do, their choice is
  // saved to localStorage and persists across sessions.

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="px-2.5 py-1 rounded-md border font-mono text-[11px] uppercase tracking-[0.15em] transition-colors border-slate-300 text-slate-600 hover:text-ink hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800"
      title={isDark ? "Switch entire site to light mode" : "Switch entire site to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? "☼ Light" : "☾ Dark"}
    </button>
  );
}
