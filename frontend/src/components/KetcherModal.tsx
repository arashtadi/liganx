import { useEffect, useRef, useState } from "react";
import { Close } from "./Icons";

/**
 * Ketcher 2D structure-editor modal — open the EPAM Ketcher standalone
 * inside an iframe, let the user draw a molecule, then extract the SMILES
 * via Ketcher's `getSmiles` postMessage API.
 *
 * Why an iframe and not the `ketcher-react` npm package: ketcher-react's
 * dependency on indigo-ketcher's WASM bundles adds ~6 MB to our JS payload
 * and several minutes to the cold-build time — overkill for a feature that
 * the median user might use once or twice. The iframe approach defers the
 * Ketcher load until the user actually clicks "Sketch" and keeps our main
 * bundle lean.
 *
 * Communication protocol (Ketcher's documented `RemoteAPI`):
 *   1. We send `{type:"ket-task",call:{method:"getSmiles",arguments:[]}}`
 *   2. Ketcher replies `{type:"ket-result",payload:{smiles:"<...>"}}`
 *
 * If the iframe takes too long to load or the postMessage doesn't return,
 * we fall back to letting the user copy the SMILES manually from inside
 * Ketcher's File menu.
 */
interface Props {
  /** Optional starting SMILES — pre-loaded into the editor when the modal
   *  opens, so users editing an existing compound don't lose their work. */
  initialSmiles?: string;
  onClose: () => void;
  onAccept: (smiles: string) => void;
}

// Self-hosted Ketcher Standalone build, served from frontend/public/ketcher/.
// Living in our own origin (vs. EPAM's public demo URL) eliminates the
// cross-origin postMessage friction and the third-party-uptime dependency:
// if EPAM ever takes down or restructures their demo site, this still works.
// Trade-off: ~25 MB of static assets shipped with the frontend, but they're
// CDN-cached by Vercel and only fetched when the user clicks "Sketch".
const KETCHER_SRC = "/ketcher/index.html";

export default function KetcherModal({ initialSmiles, onClose, onAccept }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // When iframe finishes loading, push the initial SMILES in (if any).
  useEffect(() => {
    if (!iframeLoaded || !initialSmiles) return;
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      {
        eventName: "indigoLoad",
        data: { struct: initialSmiles, format: "smiles" },
      },
      "*",
    );
  }, [iframeLoaded, initialSmiles]);

  // Esc to close, like every other modal in the app
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleAccept() {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) {
      setError("Ketcher hasn't finished loading. Wait a moment and retry.");
      return;
    }
    setPending(true);
    setError(null);

    // One-shot listener for the response
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      // Ketcher's response shape varies by version — accept either form
      const smiles = data?.payload?.smiles ?? data?.data?.struct ?? data?.smiles;
      if (typeof smiles === "string" && smiles.length > 0) {
        window.removeEventListener("message", onMessage);
        clearTimeout(timeout);
        setPending(false);
        onAccept(smiles.trim());
      }
    };
    window.addEventListener("message", onMessage);

    // Send the request — try multiple message shapes since EPAM has shipped
    // a few different Ketcher API conventions across releases.
    iframe.contentWindow.postMessage(
      { eventName: "indigoExport", data: { format: "smiles" } },
      "*",
    );
    iframe.contentWindow.postMessage(
      { type: "ket-task", call: { method: "getSmiles", arguments: [] } },
      "*",
    );

    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      setPending(false);
      setError(
        "Ketcher didn't respond. Inside the editor, use File → Save As → SMILES " +
        "to copy the structure manually, then paste it into the compound row.",
      );
    }, 4000);
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
          {!iframeLoaded && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 dark:text-slate-400 text-sm">
              Loading Ketcher…
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={KETCHER_SRC}
            title="Ketcher 2D structure editor"
            className="w-full h-full border-0"
            onLoad={() => setIframeLoaded(true)}
            // sandbox is intentionally LIBERAL — Ketcher needs scripts +
            // same-origin messaging + popups for its file dialogs.
            // Modify this only if you understand Ketcher's requirements.
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
            disabled={!iframeLoaded || pending}
            className="btn-primary btn-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? "Reading…" : "Use this structure"}
          </button>
        </footer>
      </div>
    </div>
  );
}
