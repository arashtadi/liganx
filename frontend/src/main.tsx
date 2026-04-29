import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

// Stale-chunk recovery. Vite emits hashed chunk names (`3Dmol-CXDV6TS_.js`)
// and references them from the deployed `index.html`. After a redeploy, the
// chunk hashes change — but a user whose browser already cached the old
// `index.html` will request the old chunk paths, which now 404. The dynamic
// `await import("3dmol")` then throws "Failed to fetch dynamically imported
// module" and any feature that depends on it (3D viewer, ProLIF, etc.) breaks
// without the user knowing why.
//
// Mitigation: when we detect a chunk-load failure, force a hard reload so the
// browser picks up the fresh `index.html` and its current chunk references.
// We guard with sessionStorage so we don't loop if the actual asset really is
// missing on the server (broken deploy).
function isChunkLoadError(reason: unknown): boolean {
  const msg = (reason as Error)?.message || String(reason);
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg);
}
function maybeReloadOnce() {
  const KEY = "__liganx_chunk_reload_at";
  const last = Number(sessionStorage.getItem(KEY) || "0");
  if (Date.now() - last < 30_000) return; // already tried recently — give up
  sessionStorage.setItem(KEY, String(Date.now()));
  // Force a fresh fetch of index.html. `location.reload()` alone usually does
  // it (the navigation is uncached); appending a cache-buster guarantees it.
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now().toString());
  window.location.replace(url.toString());
}
window.addEventListener("error", (e) => {
  if (isChunkLoadError(e.error || e.message)) maybeReloadOnce();
});
window.addEventListener("unhandledrejection", (e) => {
  if (isChunkLoadError(e.reason)) maybeReloadOnce();
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
