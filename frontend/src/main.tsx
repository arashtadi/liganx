import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
import { tryReloadOnChunkError } from "./lib/chunkReload";

// Sentry — opt-in via VITE_SENTRY_DSN. When the env var is unset (local
// dev, preview deploys), the init code is a no-op. We dynamic-import so
// the @sentry/react bundle never ships to clients we don't have a DSN
// for. Documented in the May 2026 platform audit (#256).
if (import.meta.env.VITE_SENTRY_DSN) {
  // @sentry/react is an optional runtime dep. We dynamic-import it
  // only when VITE_SENTRY_DSN is set; without that env var the import
  // never runs and the package doesn't need to be installed for the
  // rest of the app to build.
  //
  // The module specifier goes through a variable so Rollup can't
  // statically resolve it at build time. Without that indirection the
  // build fails with "Rollup failed to resolve import '@sentry/react'"
  // whenever the package isn't installed, even though the runtime
  // code path is gated on the DSN env var. The catch block below
  // handles the case where the package is missing at runtime.
  const sentryModuleId = "@sentry/react";
  import(/* @vite-ignore */ sentryModuleId).then((Sentry) => {
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
  }).catch(() => {
    // Soft-fail: missing dependency or network error shouldn't break the
    // app. Sentry is observability, not a critical path.
  });
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
