/**
 * Stale-chunk recovery shared between the global error/rejection handlers in
 * main.tsx and any component that catches its own dynamic-import errors
 * (e.g. MutationOverlayViewer's `await import("3dmol")`).
 *
 * Why this lives in its own module: components that wrap their dynamic
 * imports in try/catch swallow the error before the window-level
 * unhandledrejection handler can see it. They need a way to opt back into
 * the auto-reload on chunk failures specifically.
 *
 * The reload is throttled via sessionStorage so a permanently-broken deploy
 * (chunk genuinely missing on the CDN) doesn't cause an infinite reload loop.
 */

const KEY = "__liganx_chunk_reload_at";
const COOLDOWN_MS = 30_000;

export function isChunkLoadError(reason: unknown): boolean {
  const msg = (reason as Error)?.message || String(reason);
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(
    msg
  );
}

/** Hard-reload the page if the error looks like a stale-chunk failure and we
 *  haven't already tried within the cooldown window. Returns true if we
 *  initiated a reload (caller should bail out of subsequent rendering work). */
export function tryReloadOnChunkError(reason: unknown): boolean {
  if (!isChunkLoadError(reason)) return false;
  const last = Number(sessionStorage.getItem(KEY) || "0");
  if (Date.now() - last < COOLDOWN_MS) return false;
  sessionStorage.setItem(KEY, String(Date.now()));
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now().toString());
  window.location.replace(url.toString());
  return true;
}
