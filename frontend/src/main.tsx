import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
import { tryReloadOnChunkError } from "./lib/chunkReload";

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
