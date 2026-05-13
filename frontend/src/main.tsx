import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
import { tryReloadOnChunkError } from "./lib/chunkReload";

// Sentry — opt-in via VITE_SENTRY_DSN. When the env var is unset (local
// dev, preview deploys), Sentry.init() is skipped and the bundle still
// contains the SDK but it's never wired up. The SDK is a static import
// so Vite bundles it — the previous dynamic-import-with-vite-ignore
// trick caused the bare specifier "@sentry/react" to reach the browser
// at runtime, where it 404'd silently and Sentry never initialised.
// (May 2026 platform audit #256 + smoke-test debug 2026-05-13.)
import * as Sentry from "@sentry/react";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Conservative: 10% traces, 100% errors. Bump tracesSampleRate
    // higher if performance work needs more data.
    tracesSampleRate: 0.1,
    // Don't capture replays by default — costs a lot of bandwidth and
    // we haven't reviewed for PII yet.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
  // Bridge our ErrorBoundary's componentDidCatch into Sentry. The
  // boundary calls window.__liganx_capture_error__ for every caught
  // render exception; registering Sentry.captureException here means
  // those land in Sentry the moment the DSN is configured.
  window.__liganx_capture_error__ = (err, info, routeName) => {
    try {
      Sentry.captureException(err, {
        tags: { route: routeName || "unknown" },
        extra: { componentStack: info?.componentStack },
      });
    } catch {
      /* swallow — observability must not cascade */
    }
  };
}

// Sentry smoke-test trigger — hit https://liganx.com/?sentry_test=1 to
// throw a synthetic error that the ErrorBoundary + Sentry bridge will
// capture. The thrown message includes a timestamp so repeat visits
// produce distinct events instead of being deduped into one issue.
// Wrapped in a setTimeout so React has fully mounted before the throw —
// otherwise the error fires before our ErrorBoundary is in the tree
// and only the global window.error handler sees it.
if (typeof window !== "undefined" && window.location.search.includes("sentry_test=1")) {
  setTimeout(() => {
    const ts = new Date().toISOString();
    const err = new Error(`Liganx Sentry smoke test ${ts}`);
    // Send directly via the same bridge ErrorBoundary uses. This works
    // even if React hasn't thrown yet, and tags the event so it's
    // easy to find in Sentry ("route: sentry_test").
    try {
      window.__liganx_capture_error__?.(err, undefined, "sentry_test");
    } catch {
      /* observability must not cascade */
    }
    // Also throw so any global listener (window.onerror, etc.) sees it.
    // Caught synchronously to avoid blanking the page.
    try {
      throw err;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[sentry_test] threw + captured:", (e as Error).message);
    }
  }, 1500);
}

// Stale-chunk recovery. Vite emits hashed chunk names (`3Dmol-CXDV6TS_.js`)
// and references them from the deployed `index.html`. After a redeploy, the
// chunk hashes change — but a user whose browser already cached the old
// `index.html` will request the old chunk paths, which now 404. The dynamic
// `await import("3dmol")` then throws "Failed to fetch dynamically imported
// module" and any feature that depends on it (3D viewer, ProLIF, etc.) breaks
// without the user knowing why.
//
// Mitigation lives in lib/chunkReload — these are the global handlers that
// catch errors that bubble up. Components that wrap their dynamic imports in
// try/catch (so they can render an error UI) need to ALSO call
// tryReloadOnChunkError() inside their catch block, otherwise their
// swallowed error never reaches these handlers.
window.addEventListener("error", (e) => {
  tryReloadOnChunkError(e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  tryReloadOnChunkError(e.reason);
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
