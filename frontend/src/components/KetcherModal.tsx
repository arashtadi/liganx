import { useEffect, useRef, useState } from "react";
import { Close } from "./Icons";

/**
 * Ketcher 2D structure-editor modal — opens the self-hosted Ketcher
 * Standalone (served from /ketcher/index.html on the same origin) inside
 * an iframe, lets the user draw a molecule, then extracts the SMILES via
 * Ketcher 3.x's direct JS API.
 *
 * Why an iframe and not the `ketcher-react` npm package: ketcher-react's
 * dependency on indigo-ketcher's WASM bundles adds ~6 MB to our JS payload
 * and several minutes to the cold-build time — overkill for a feature that
 * the median user might use once or twice. The iframe approach defers the
 * Ketcher load until the user actually clicks "Sketch" and keeps our main
 * bundle lean.
 *
 * Communication protocol (Ketcher 3.x, same-origin):
 *
 *   1. Once the iframe finishes booting, Ketcher posts
 *      `window.postMessage({ eventType: 'init' }, '*')` to its parent.
 *   2. After we see that init event, the iframe's `contentWindow.ketcher`
 *      object becomes available. From there:
 *        - `ketcher.setMolecule(smilesOrMol)` — push a structure in
 *        - `ketcher.getSmiles()` → Promise<string> — pull the SMILES out
 *
 *   This direct-method protocol is far simpler than the postMessage-based
 *   protocol older Ketcher versions used (and which earlier revisions of
 *   this file targeted). It works only because we're SAME-ORIGIN with the
 *   iframe — cross-origin would block the contentWindow access. That's a
 *   key reason we self-host Ketcher under /ketcher/ instead of using
 *   EPAM's public demo URL.
 *
 * Reference: ketcher-standalone/iframe.html in the EPAM Ketcher 3.12 release.
 */
interface Props {
  /** Optional starting SMILES — pre-loaded into the editor when the modal
   *  opens, so users editing an existing compound don't lose their work. */
  initialSmiles?: string;
  onClose: () => void;
  onAccept: (smiles: string) => void;
}

const KETCHER_SRC = "/ketcher/index.html";

/** Helper to grab the live `ketcher` API object out of the iframe. Returns
 *  `null` if the iframe is still loading or the API hasn't initialised yet. */
function getKetcherApi(iframe: HTMLIFrameElement | null): any | null {
  if (!iframe) return null;
  try {
    const win = iframe.contentWindow as any;
    return win?.ketcher ?? null;
  } catch {
    // contentWindow access throws when the iframe is cross-origin — should
    // never happen for our self-hosted /ketcher/ path, but handle gracefully.
    return null;
  }
}

export default function KetcherModal({ initialSmiles, onClose, onAccept }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // `ketcherReady` flips true when Ketcher's internal init event fires.
  // The bare `iframe.onLoad` event fires earlier — when the HTML is parsed,
  // before the WASM Indigo bundle has finished booting — so it's not enough.
  const [ketcherReady, setKetcherReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Listen for Ketcher's init event. This is the signal that the iframe's
  // window.ketcher API is ready to call.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Ketcher 3.x posts { eventType: 'init' } once boot is complete.
      // Origin check is safe because we self-host on the same origin.
      if (e?.data?.eventType === "init") {
        setKetcherReady(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Once Ketcher signals ready, push the initial SMILES in (if any).
  useEffect(() => {
    if (!ketcherReady || !initialSmiles) return;
    const api = getKetcherApi(iframeRef.current);
    if (!api?.setMolecule) {
      console.warn("Ketcher API ready event fired but setMolecule unavailable");
      return;
    }
    try {
      // setMolecule returns a Promise; we await it inside an IIFE so we can
      // surface a useful warning if the SMILES is rejected (e.g. malformed).
      (async () => {
        try {
          await api.setMolecule(initialSmiles);
        } catch (err) {
          console.warn("Ketcher setMolecule rejected initial SMILES:", err);
        }
      })();
    } catch (err) {
      console.warn("Ketcher setMolecule threw:", err);
    }
  }, [ketcherReady, initialSmiles]);

  // Esc to close, like every other modal in the app
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleAccept() {
    const api = getKetcherApi(iframeRef.current);
    if (!api?.getSmiles) {
      setError("Ketcher hasn't finished loading. Wait a moment and retry.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      // Ketcher's getSmiles returns a Promise<string>. Empty string when the
      // canvas is empty, which we surface as a friendly error rather than
      // silently writing "" into the compound row.
      const smiles: string = await api.getSmiles();
      if (typeof smiles !== "string" || smiles.trim().length === 0) {
        setPending(false);
        setError("The canvas is empty — draw a structure or paste a SMILES first.");
        return;
      }
      setPending(false);
      onAccept(smiles.trim());
    } catch (err) {
      setPending(false);
      setError(
        `Couldn't read the structure from Ketcher: ${(err as Error)?.message ?? err}. ` +
        `Try File → Save As → SMILES to copy it manually.`,
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700"
        style={{ height: "min(85vh, 750px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-ink dark:text-slate-100">Sketch a molecule</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Draw, paste a SMILES, or load from CDX/MOL — the result becomes a SMILES string in your compound list.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-ink dark:hover:text-slate-100 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label="Close"
          >
            <Close size={18} />
          </button>
        </header>

        {/* Iframe */}
        <div className="flex-1 relative bg-slate-50 dark:bg-slate-800/40">
          {!ketcherReady && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 dark:text-slate-400 text-sm pointer-events-none z-10">
              Loading Ketcher…
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={KETCHER_SRC}
            title="Ketcher 2D structure editor"
            className="w-full h-full border-0"
            // sandbox is intentionally LIBERAL — Ketcher needs scripts +
            // same-origin messaging + popups for its file dialogs.
            // allow-same-origin is REQUIRED for the contentWindow.ketcher
            // direct-API protocol to work; without it our parent window
            // gets a cross-origin error trying to read the ketcher object.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 dark:border-slate-700 shrink-0 bg-white dark:bg-slate-900">
          <div className="text-xs text-slate-600 dark:text-slate-400 flex-1 min-w-0">
            {error ? (
              <span className="text-amber-700 dark:text-amber-400">{error}</span>
            ) : (
              <span>
                Powered by <a href="https://lifescience.opensource.epam.com/ketcher/" target="_blank" rel="noopener noreferrer" className="underline hover:text-ink dark:hover:text-slate-100">EPAM Ketcher</a>{" "}
                — open-source 2D structure editor
              </span>
            )}
          </div>
          <button onClick={onClose} className="btn-secondary btn-sm">Cancel</button>
          <button
            onClick={handleAccept}
            disabled={!ketcherReady || pending}
            className="btn-primary btn-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? "Reading…" : "Use this structure"}
          </button>
        </footer>
      </div>
    </div>
  );
}
