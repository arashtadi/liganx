/**
 * Turnstile — Cloudflare CAPTCHA widget wrapper.
 *
 * Usage:
 *   <Turnstile siteKey={env.TURNSTILE_SITE_KEY} onVerify={setToken} />
 *
 * On mount we (a) lazy-load Cloudflare's challenges.cloudflare.com
 * script if it's not already on the page, then (b) explicitly render
 * the widget into our own div and forward the token to onVerify.
 *
 * We use explicit-rendering (not auto-mode) for two reasons:
 *   1. React can re-mount the widget across page transitions; auto-
 *      mode looks for matching CSS classes at script-load time and
 *      misses anything mounted later.
 *   2. Explicit mode lets us reset() the widget on form-submit error
 *      so the user gets a fresh challenge rather than a stale token.
 *
 * If `siteKey` is empty (env var unset), we render nothing and call
 * `onVerify("")` so the parent form still submits — but the BACKEND
 * will reject submissions without a valid token IF its secret is
 * configured. This split lets us deploy frontend-first or backend-
 * first without breaking the form mid-rollout.
 */

import { useEffect, useRef } from "react";

interface TurnstileWindow extends Window {
  turnstile?: {
    render: (
      container: HTMLElement,
      options: {
        sitekey: string;
        callback?: (token: string) => void;
        "error-callback"?: () => void;
        "expired-callback"?: () => void;
        theme?: "light" | "dark" | "auto";
        size?: "normal" | "flexible" | "compact";
        appearance?: "always" | "execute" | "interaction-only";
        action?: string;
      }
    ) => string;  // widget id
    reset: (widgetId?: string) => void;
    remove: (widgetId: string) => void;
  };
  // The official Cloudflare loader fires this global when the script
  // finishes loading and the turnstile object is ready. We optionally
  // hook it for the case where multiple components race to load the
  // script — only one wins, the others wait on this signal.
  onloadTurnstileCallback?: () => void;
}

declare const window: TurnstileWindow;

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onloadTurnstileCallback";

// Module-level promise so concurrent <Turnstile /> mounts only fire
// one network request. Resolves when window.turnstile is callable.
let scriptLoadPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    // If the script tag already exists (e.g. another component
    // already started loading it), just wait for the global.
    const existing = document.querySelector(`script[src^="https://challenges.cloudflare.com/turnstile"]`);
    if (existing && window.turnstile) {
      resolve();
      return;
    }
    window.onloadTurnstileCallback = () => resolve();
    if (existing) {
      // Script tag is there but not loaded yet — the existing
      // listener will resolve us. Add a fallback timeout in case
      // the script 404'd before our callback was registered.
      setTimeout(() => {
        if (window.turnstile) resolve();
      }, 50);
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("Failed to load Cloudflare Turnstile script"));
    document.head.appendChild(s);
  });
  return scriptLoadPromise;
}

export interface TurnstileProps {
  /** Cloudflare site key. If empty, the widget renders nothing and
   *  the form will submit without a token (backend may reject). */
  siteKey: string;
  /** Called with the token whenever the user passes the challenge. */
  onVerify: (token: string) => void;
  /** Called when the token expires (Turnstile tokens are ~5 min). */
  onExpire?: () => void;
  /** Called when the widget hits an error rendering or solving. */
  onError?: () => void;
  /** Theme — defaults to "auto" so it tracks the page's dark/light mode. */
  theme?: "light" | "dark" | "auto";
}

export default function Turnstile({
  siteKey,
  onVerify,
  onExpire,
  onError,
  theme = "auto",
}: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    // No site key configured (frontend env var unset) — short-circuit
    // and let the form submit with an empty token. The backend will
    // either accept (if its own secret is also unset) or reject with
    // a clear error, depending on which side rolled out first.
    if (!siteKey) {
      onVerify("");
      return;
    }
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        // Defensive: never render twice into the same container.
        // Strict mode in dev runs effects twice; without this guard
        // we'd get two widgets stacked on top of each other.
        if (widgetIdRef.current) return;
        try {
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            callback: (token: string) => onVerify(token),
            "expired-callback": () => {
              onVerify("");  // Clear stale token in parent state.
              onExpire?.();
            },
            "error-callback": () => {
              onVerify("");
              onError?.();
            },
            theme,
            // "flexible" lets the widget pick a size based on the
            // container width; on narrow screens it shrinks rather
            // than overflowing.
            size: "flexible",
          });
        } catch (e) {
          // Render exceptions (bad site key, etc.) — clear token in
          // the parent and let the user see the form submit error
          // path instead of the page silently breaking.
          onVerify("");
          onError?.();
        }
      })
      .catch(() => {
        // Script failed to load — pass empty token; parent form will
        // get a backend rejection on submit, which is the right
        // failure mode (don't auto-pass the form if CAPTCHA is down).
        onVerify("");
        onError?.();
      });

    return () => {
      cancelled = true;
      // Clean up the widget instance on unmount so React strict-mode
      // re-mounts and route navigations don't leak DOM nodes.
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* widget already removed */
        }
        widgetIdRef.current = null;
      }
    };
    // siteKey is the only prop that should re-mount the widget;
    // changing onVerify identity (a new closure each parent render)
    // shouldn't cause the widget to flash. The closure captures the
    // *first* onVerify which is what we want — the parent passes a
    // setter from useState that's stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, theme]);

  if (!siteKey) {
    // Render a small placeholder note in dev so the operator sees
    // why the CAPTCHA isn't appearing. In prod (key set) we never
    // hit this branch.
    if (import.meta.env.DEV) {
      return (
        <div className="text-[11px] text-amber-700 dark:text-amber-400 italic">
          (CAPTCHA disabled — VITE_TURNSTILE_SITE_KEY not set)
        </div>
      );
    }
    return null;
  }
  return <div ref={containerRef} className="cf-turnstile" />;
}
