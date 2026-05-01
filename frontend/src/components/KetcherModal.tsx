import { useEffect, useRef, useState } from "react";
import { Close, Spinner } from "./Icons";
import { api, ApiError } from "../api";

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
  /**
   * Called when the user clicks "Use this structure".
   *
   * `smiles` is what Ketcher emits AT the moment of accept (already
   * canonicalised to Ketcher's preferred form).
   *
   * `unchanged` is true when the structure on canvas is the same
   * MOLECULE as what we loaded into the editor — even if the SMILES
   * STRING differs (Ketcher canonicalises on parse, so loading
   * `OC(=O)/C=C/c1ccccc1` and getting back `O=C(O)/C=C/c1ccccc1` is a
   * no-op). Consumers should treat unchanged=true the same as a Cancel
   * for save-related decisions: don't overwrite, don't create a new
   * library entry, don't trigger any rename prompt.
   */
  onAccept: (smiles: string, unchanged: boolean) => void;
  /** Optional pocket context — when the user is mid-job-creation, pass
   *  the selected target + mutations so AI suggestions can be
   *  pocket-aware ("for V600E, fill the gain-of-function hydrophobic
   *  pocket with…"). Omit on the standalone CompoundsPage path where
   *  there's no target context. */
  targetPdb?: string;
  mutations?: string;
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

export default function KetcherModal({ initialSmiles, onClose, onAccept, targetPdb, mutations }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // `ketcherReady` flips true when Ketcher's internal init event fires.
  // The bare `iframe.onLoad` event fires earlier — when the HTML is parsed,
  // before the WASM Indigo bundle has finished booting — so it's not enough.
  const [ketcherReady, setKetcherReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // hasChanges drives the "Use this structure" button visibility — see
  // the polling effect below. When false, the user is shown only Cancel
  // (because there's nothing to commit). When true, the accept button
  // appears alongside Cancel.
  const [hasChanges, setHasChanges] = useState(false);
  // Ketcher's canonical re-emission of `initialSmiles` after setMolecule
  // has parsed and re-serialised it. Captured ONCE per modal mount (right
  // after the load) and compared against the live canvas state by the
  // change-detection polling loop. Empty string means "no baseline" (no
  // initialSmiles, or the post-load capture failed) — in that case any
  // non-empty canvas counts as a change, which is the right default for
  // create-from-scratch flows.
  const baselineSmilesRef = useRef<string>("");

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

  // Once Ketcher signals ready, push the initial SMILES in (if any) and
  // capture the post-load canonical form as the change-detection baseline.
  useEffect(() => {
    if (!ketcherReady || !initialSmiles) return;
    const api = getKetcherApi(iframeRef.current);
    if (!api?.setMolecule) {
      console.warn("Ketcher API ready event fired but setMolecule unavailable");
      return;
    }
    try {
      (async () => {
        try {
          await api.setMolecule(initialSmiles);
          // Read back the post-parse, post-canonicalise SMILES Ketcher
          // would emit if the user changed nothing. This is what
          // handleAccept compares against — string equality on this
          // canonical form correctly identifies "no real edit" without
          // needing an external RDKit roundtrip.
          if (api.getSmiles) {
            try {
              const baseline: string = await api.getSmiles();
              baselineSmilesRef.current = (baseline || "").trim();
            } catch (err) {
              // Not fatal — just means we'll fall back to "assume
              // changed" in handleAccept, which is the conservative
              // (over-save) default. Better than wrongly suppressing.
              console.warn("Ketcher getSmiles baseline capture failed:", err);
            }
          }
        } catch (err) {
          console.warn("Ketcher setMolecule rejected initial SMILES:", err);
        }
      })();
    } catch (err) {
      console.warn("Ketcher setMolecule threw:", err);
    }
  }, [ketcherReady, initialSmiles]);

  // Change-detection poll. Every 700ms while Ketcher is ready, read the
  // live canvas SMILES and compare against the captured baseline. When
  // they differ, `hasChanges` flips to true and the "Use this structure"
  // button appears. When they match (e.g. the user undoes back to the
  // original), the button disappears again.
  //
  // Why polling instead of subscribing to a Ketcher change event: the
  // iframe's window.ketcher object exposes editor.subscribe in some
  // versions but it's inconsistent across builds and origins. Polling
  // every 700ms is cheap (getSmiles on a small molecule is sub-ms) and
  // robust — and gives us a single integration point that doesn't break
  // when Ketcher upgrades its event API.
  useEffect(() => {
    if (!ketcherReady) return;
    let cancelled = false;
    const interval = window.setInterval(async () => {
      const apiObj = getKetcherApi(iframeRef.current);
      if (!apiObj?.getSmiles) return;
      try {
        const live: string = await apiObj.getSmiles();
        if (cancelled) return;
        const trimmed = (live || "").trim();
        const baseline = baselineSmilesRef.current;
        // Edit (with baseline): changed iff live differs from baseline.
        // Create (no baseline): changed iff anything has been drawn.
        const changed = baseline.length > 0
          ? trimmed !== baseline
          : trimmed.length > 0;
        // Don't churn React state when the value didn't actually change;
        // setState with the same value is cheap but the renders downstream
        // (button label, etc.) still cost a bit on every tick.
        setHasChanges((prev) => (prev === changed ? prev : changed));
        // Clear any stale validation-error banner the moment the user
        // starts editing — keeps the modal feeling responsive instead
        // of leaving a stale "this can't be docked" message hanging
        // there after they've already fixed the issue.
        setError((prev) => (prev ? null : prev));
      } catch {
        // Polling errors are non-fatal — a transient hiccup just means
        // we keep showing the previous state for one tick.
      }
    }, 700);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [ketcherReady]);

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
      const trimmed = smiles.trim();
      // Compare the accept-time canonical SMILES against the baseline we
      // captured right after setMolecule. Both come from Ketcher's own
      // serialiser so equal strings = equivalent molecules. When the
      // baseline is empty (no initialSmiles, or the baseline grab
      // failed), default to "changed" so consumers don't suppress a
      // genuine create-from-scratch save.
      const baseline = baselineSmilesRef.current;
      const unchanged = baseline.length > 0 && trimmed === baseline;

      // Fail-fast SMILES validation BEFORE we close the modal.
      // Ketcher's own getSmiles can produce strings that look fine to
      // it but trip RDKit downstream (radical centres, weird hybrid
      // states, atom-mapping quirks). Catching it here means the user
      // sees "this won't dock" while they're still in the editor and
      // can fix it — instead of seeing it as a failed compound row in
      // step 3 of the new-job form after they've moved on.
      //
      // We use the existing /assist/properties endpoint (RDKit-only,
      // no LLM, ~5ms server-side, free). It returns valid:false +
      // error when the SMILES doesn't parse. Any unexpected failure
      // here (network, 401, 5xx) we treat as "skip the check" rather
      // than blocking — better to let the user proceed and have the
      // downstream pipeline catch it than to falsely block on a
      // transient API hiccup.
      try {
        const props = await api.assistProperties(trimmed);
        if (props && props.valid === false) {
          setPending(false);
          setError(
            `This structure can't be docked: ${props.error || "RDKit couldn't parse it"}. ` +
            `Adjust the structure in the editor, or click Close to start over.`,
          );
          return;
        }
        // valid:true OR network/transport issue → proceed. Downstream
        // pipeline still has its own validation as a safety net.
      } catch {
        // Validation request failed (network, auth). Proceed silently
        // — better than blocking on a transient backend issue.
      }

      setPending(false);
      onAccept(trimmed, unchanged);
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
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-7xl flex flex-col overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700"
        style={{ height: "min(88vh, 800px)" }}
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

        {/* Body — split into Ketcher iframe (left, ~70%) + AI sidebar
            (right, ~320px). The sidebar reads/writes SMILES via the
            same getKetcherApi helper the Accept button uses. */}
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 relative bg-slate-50 dark:bg-slate-800/40 min-w-0">
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
          <AiSidebar
            ketcherReady={ketcherReady}
            getApi={() => getKetcherApi(iframeRef.current)}
            targetPdb={targetPdb}
            mutations={mutations}
          />
        </div>

        {/* Validation error banner — sits ABOVE the footer when present.
            Pulled out of the footer's tiny status text because save-time
            errors ("this structure can't be docked") need to grab the
            user's attention, not whisper from the corner. */}
        {error && (
          <div className="px-5 py-2.5 border-t border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-900/20 text-[13px] text-rose-800 dark:text-rose-200 shrink-0">
            <div className="flex items-start gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="mt-0.5 shrink-0" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="leading-relaxed">{error}</span>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 dark:border-slate-700 shrink-0 bg-white dark:bg-slate-900">
          <div className="text-xs text-slate-600 dark:text-slate-400 flex-1 min-w-0">
            <span>
              Powered by <a href="https://lifescience.opensource.epam.com/ketcher/" target="_blank" rel="noopener noreferrer" className="underline hover:text-ink dark:hover:text-slate-100">EPAM Ketcher</a>{" "}
              — open-source 2D structure editor
            </span>
          </div>
          {/* Cancel is always shown — it's the safe, no-side-effects exit
              and equally valid whether or not the user has drawn anything.
              "Use this structure" only appears once `hasChanges` flips
              true, so a user who opens the editor to look at a compound
              and closes without modifying never accidentally creates a
              duplicate library entry. */}
          <button onClick={onClose} className="btn-secondary btn-sm">
            {hasChanges ? "Cancel" : "Close"}
          </button>
          {hasChanges && (
            <button
              onClick={handleAccept}
              disabled={!ketcherReady || pending}
              className="btn-primary btn-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending ? "Checking structure…" : "Use this structure"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// AiSidebar — the right-hand pane inside KetcherModal.
//
// What it does:
//  - "Predict properties" — RDKit-only, instant. MW / logP / TPSA / QED
//    + Lipinski/Veber pass + PAINS hit count.
//  - "Suggest 5 analogs" — sends the current SMILES to /assist/compound
//    with a fixed instruction, returns 5 sensible variants.
//  - Free-text input — natural language ("swap COOH for tetrazole",
//    "add a methyl at the para position", "make this more soluble").
//    Returns one new SMILES + rationale.
//
// All three actions read the LIVE SMILES from Ketcher (via getSmiles)
// at click time, so the user can sketch freely and the AI always sees
// what's currently on canvas.
//
// "Apply to canvas" pushes the new SMILES back into Ketcher via
// setMolecule. The user can still tweak it manually before clicking
// "Use this structure" to commit the result back to the form.
//
// Pocket awareness: when the parent passes targetPdb + mutations
// (NewJobPage flow), the AI gets that context and tailors suggestions
// to the specific pocket and resistance mutation. On standalone
// CompoundsPage there's no target context and the AI is generic.
// ──────────────────────────────────────────────────────────────────────

interface AiSidebarProps {
  ketcherReady: boolean;
  getApi: () => any | null;
  targetPdb?: string;
  mutations?: string;
}

type ActionStatus = "idle" | "running" | "ok" | "error";

interface AssistResult {
  new_smiles: string;
  rationale: string;
  warnings: string[];
  applied: boolean;
}

interface PropertiesResult {
  valid?: boolean;
  canonical_smiles?: string;
  mw?: number;
  logp?: number;
  tpsa?: number;
  hba?: number;
  hbd?: number;
  rotatable_bonds?: number;
  heavy_atoms?: number;
  qed?: number;
  lipinski_pass?: boolean;
  veber_pass?: boolean;
  pains_hits?: { name: string; description: string }[];
  error?: string;
}

function AiSidebar({ ketcherReady, getApi, targetPdb, mutations }: AiSidebarProps) {
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<AssistResult | null>(null);
  const [properties, setProperties] = useState<PropertiesResult | null>(null);
  // Track which kind of action ran last so the result panel labels itself
  // ("Properties:" vs "Suggested edit:" vs "5 analogs:").
  const [lastAction, setLastAction] = useState<"none" | "edit" | "props" | "analogs">("none");

  /** Read SMILES from Ketcher. Returns null + sets an error if the
   *  canvas is empty or Ketcher hasn't finished loading. */
  async function readSmiles(): Promise<string | null> {
    const apiObj = getApi();
    if (!apiObj?.getSmiles) {
      setErrorMsg("Ketcher hasn't finished loading — wait a moment.");
      return null;
    }
    try {
      const smi: string = await apiObj.getSmiles();
      if (!smi || smi.trim().length === 0) {
        setErrorMsg("The canvas is empty — sketch something first.");
        return null;
      }
      return smi.trim();
    } catch (e) {
      setErrorMsg(`Couldn't read SMILES from Ketcher: ${(e as Error).message}`);
      return null;
    }
  }

  async function runEdit(text: string) {
    if (!text.trim()) return;
    const smi = await readSmiles();
    if (!smi) return;
    setStatus("running");
    setErrorMsg(null);
    setResult(null);
    setLastAction("edit");
    try {
      const r = await api.assistCompound({
        smiles: smi,
        instruction: text.trim(),
        target_pdb: targetPdb,
        mutations: mutations,
      });
      setResult(r);
      setStatus("ok");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof ApiError ? e.message : "AI request failed");
    }
  }

  async function runAnalogs() {
    const smi = await readSmiles();
    if (!smi) return;
    setStatus("running");
    setErrorMsg(null);
    setResult(null);
    setLastAction("analogs");
    try {
      // Reuse /assist/compound with a fixed "suggest analogs" instruction
      // so we don't need a separate endpoint. The AI returns ONE smiles
      // + rationale per the contract, but we phrase the instruction so
      // the rationale reads as a "5 analogs to consider" list.
      const r = await api.assistCompound({
        smiles: smi,
        instruction:
          "Suggest 5 promising medchem analogs of this compound. Return the most" +
          " interesting one as new_smiles, and list the other 4 + brief rationale" +
          " for each in the rationale field.",
        target_pdb: targetPdb,
        mutations: mutations,
      });
      setResult(r);
      setStatus("ok");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof ApiError ? e.message : "AI request failed");
    }
  }

  async function runProperties() {
    const smi = await readSmiles();
    if (!smi) return;
    setStatus("running");
    setErrorMsg(null);
    setProperties(null);
    setLastAction("props");
    try {
      const p = await api.assistProperties(smi);
      setProperties(p);
      setStatus("ok");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof ApiError ? e.message : "Property calculation failed");
    }
  }

  async function applyResultToCanvas() {
    if (!result?.new_smiles || !result.applied) return;
    const apiObj = getApi();
    if (!apiObj?.setMolecule) {
      setErrorMsg("Ketcher hasn't finished loading.");
      return;
    }
    try {
      await apiObj.setMolecule(result.new_smiles);
    } catch (e) {
      setErrorMsg(`Ketcher rejected the SMILES: ${(e as Error).message}`);
    }
  }

  return (
    <aside className="w-[320px] shrink-0 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink dark:text-slate-100">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-delta-600 dark:text-delta-400" aria-hidden="true">
            <path d="M8 1v3M8 12v3M1 8h3M12 8h3M3 3l2 2M11 11l2 2M3 13l2-2M11 5l2-2" />
          </svg>
          AI assistant
          <span className="ml-auto text-[10px] font-normal text-slate-400 dark:text-slate-500 uppercase tracking-wide">beta</span>
        </div>
        {targetPdb && (
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Pocket-aware for <span className="font-mono text-slate-600 dark:text-slate-300">{targetPdb}</span>
            {mutations && <> · {mutations}</>}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-700 space-y-1.5">
        <button
          type="button"
          disabled={!ketcherReady || status === "running"}
          onClick={runProperties}
          className="w-full text-left text-[12px] px-2.5 py-2 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          ⚡ <span className="font-medium">Predict properties</span>
          <span className="block text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">MW · logP · TPSA · QED · PAINS</span>
        </button>
        <button
          type="button"
          disabled={!ketcherReady || status === "running"}
          onClick={runAnalogs}
          className="w-full text-left text-[12px] px-2.5 py-2 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          🔬 <span className="font-medium">Suggest 5 analogs</span>
          <span className="block text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Medchem variants worth docking</span>
        </button>
      </div>

      {/* Result panel — scrolls if long */}
      <div className="flex-1 overflow-y-auto p-3 text-[12px]">
        {status === "idle" && lastAction === "none" && (
          <div className="text-slate-400 dark:text-slate-500 text-[11px] leading-relaxed">
            Sketch a structure on the left, then ask for an edit below or run a quick action above.
          </div>
        )}
        {status === "running" && (
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Spinner size={12} /> Thinking…
          </div>
        )}
        {status === "error" && errorMsg && (
          <div className="rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 px-2.5 py-2 text-rose-800 dark:text-rose-200">
            {errorMsg}
          </div>
        )}
        {status === "ok" && lastAction === "props" && properties && (
          <PropertiesPanel p={properties} />
        )}
        {status === "ok" && (lastAction === "edit" || lastAction === "analogs") && result && (
          <ResultPanel result={result} onApply={applyResultToCanvas} />
        )}
      </div>

      {/* Free-text input — sticks to bottom */}
      <form
        className="p-3 border-t border-slate-200 dark:border-slate-700"
        onSubmit={(e) => { e.preventDefault(); runEdit(instruction); setInstruction(""); }}
      >
        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={!ketcherReady || status === "running"}
          placeholder="e.g. swap COOH for tetrazole"
          className="w-full text-[12px] px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 placeholder-slate-400 focus:border-delta-500 focus:ring-1 focus:ring-delta-500 outline-none"
        />
        <button
          type="submit"
          disabled={!ketcherReady || status === "running" || !instruction.trim()}
          className="mt-2 w-full text-[12px] font-semibold px-3 py-1.5 rounded-md bg-delta-600 hover:bg-delta-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white transition-colors"
        >
          {status === "running" ? "Sending…" : "✨ Improve"}
        </button>
      </form>
    </aside>
  );
}

function PropertiesPanel({ p }: { p: PropertiesResult }) {
  if (!p.valid) {
    return (
      <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 px-2.5 py-2 text-amber-800 dark:text-amber-200">
        {p.error ?? "Couldn't compute properties."}
      </div>
    );
  }
  const passLip = p.lipinski_pass;
  const passVeb = p.veber_pass;
  const painsCount = (p.pains_hits ?? []).length;
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Properties</div>
      <div className="grid grid-cols-2 gap-1.5">
        <Stat label="MW" value={p.mw} unit="g/mol" />
        <Stat label="logP" value={p.logp} />
        <Stat label="TPSA" value={p.tpsa} unit="Å²" />
        <Stat label="QED" value={p.qed} />
        <Stat label="HBA / HBD" value={`${p.hba} / ${p.hbd}`} />
        <Stat label="Rot. bonds" value={p.rotatable_bonds} />
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1">
        <Pill ok={passLip} okLabel="Lipinski ✓" badLabel="Lipinski ✗" />
        <Pill ok={passVeb} okLabel="Veber ✓" badLabel="Veber ✗" />
        <Pill
          ok={painsCount === 0}
          okLabel="PAINS clean"
          badLabel={`${painsCount} PAINS hit${painsCount === 1 ? "" : "s"}`}
        />
      </div>
      {painsCount > 0 && (
        <details className="mt-1 text-[10px] text-slate-600 dark:text-slate-400">
          <summary className="cursor-pointer hover:text-ink dark:hover:text-slate-200">PAINS details</summary>
          <ul className="mt-1 ml-3 list-disc space-y-0.5">
            {(p.pains_hits ?? []).map((h, i) => <li key={i}>{h.name}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function ResultPanel({ result, onApply }: { result: AssistResult; onApply: () => void }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">AI suggestion</div>
      {result.applied ? (
        <div className="rounded-md bg-delta-50 dark:bg-delta-900/20 border border-delta-200 dark:border-delta-800/40 p-2.5">
          <div className="font-mono text-[10px] text-delta-900 dark:text-delta-200 break-all">
            {result.new_smiles}
          </div>
          <div className="text-[11px] text-slate-700 dark:text-slate-300 mt-1.5 leading-relaxed">
            {result.rationale}
          </div>
          <button
            type="button"
            onClick={onApply}
            className="mt-2 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-delta-600 hover:bg-delta-700 text-white transition-colors"
          >
            Apply to canvas →
          </button>
        </div>
      ) : (
        <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 p-2.5">
          <div className="text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed">
            {result.rationale || "AI didn't propose a change."}
          </div>
        </div>
      )}
      {result.warnings.length > 0 && (
        <ul className="text-[10px] text-amber-700 dark:text-amber-300 space-y-0.5 ml-3 list-disc">
          {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: number | string | undefined; unit?: string }) {
  return (
    <div className="rounded-md bg-slate-50 dark:bg-slate-800/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-[12px] font-semibold text-ink dark:text-slate-100">
        {value ?? "—"}{unit ? <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400 ml-0.5">{unit}</span> : null}
      </div>
    </div>
  );
}

function Pill({ ok, okLabel, badLabel }: { ok: boolean | undefined; okLabel: string; badLabel: string }) {
  if (ok === undefined) return null;
  return ok ? (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40">
      {okLabel}
    </span>
  ) : (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/40">
      {badLabel}
    </span>
  );
}
