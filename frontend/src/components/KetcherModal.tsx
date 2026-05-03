import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Close, Spinner } from "./Icons";
import { api, ApiError, type AIHistoryEntry } from "../api";

// 3D viewers (Mol3DPreview, DockedPoseViewer) used to live in this
// modal as an inline thumbnail + fullscreen overlay. Removed 2026-05-02
// because (a) JobPage's full 3D viewer is much richer (cartoon/surface,
// pose styles, ProLIF coloring, measure mode at usable size) so the
// 138px modal thumb was always inferior, (b) the Quick-dock drafty
// repositioning made the iterate-loop fundamentally non-visual (chemists
// iterate on score deltas, not pose inspection at this scale), and
// (c) dropping them frees ~600KB of 3Dmol.js from the modal-open path.
// Users who want to inspect a pose visually now do that on JobPage
// after Promote-to-Full-Job.

/** Defensive atob — base64 decoding can throw on padding errors or
 *  Unicode characters. Returns empty string on any failure so the
 *  caller renders a graceful empty state instead of crashing. */
function safeAtob(b64: string): string {
  try {
    return atob(b64);
  } catch {
    return "";
  }
}

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
  /** When the user opened the modal to edit an EXISTING saved compound,
   *  pass its DB id here. The AI sidebar uses it to PUT history updates
   *  back to /me/compounds/{id}/ai-history so the conversation persists
   *  across sessions. Leave undefined for create-from-scratch and the
   *  NewJobPage flow — history stays in-memory only. */
  compoundId?: number;
  /** When opening for an existing saved compound, hydrate the AI sidebar
   *  with this compound's prior AI history so re-opening days later
   *  restores the conversation. Empty / undefined = start fresh. */
  initialAIHistory?: AIHistoryEntry[];
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

export default function KetcherModal({ initialSmiles, onClose, onAccept, targetPdb, mutations, compoundId, initialAIHistory }: Props) {
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

      // Fail-fast dockability check BEFORE we close the modal.
      // Catches the full set of "this won't make it through Vina/GNINA
      // ligand prep" cases at the editor instead of letting them
      // propagate into the new-job form: malformed SMILES, unsupported
      // atoms (arsenic, lead, etc.), salt forms with disconnected
      // counter-ions, molecules too small or too large for Vina's
      // flexibility model. Each rejection comes back with a friendly
      // human-readable reason + actionable suggestion the user can
      // act on immediately.
      //
      // Network/auth failures here fall through silently — better to
      // let the user proceed (the runner has its own validation as a
      // safety net + the new FAILED → Telegram + Re-run UX) than to
      // false-block on a transient backend hiccup.
      try {
        const dock = await api.assistDockability(trimmed);
        if (dock && dock.dockable === false) {
          setPending(false);
          const reason = dock.reason || "This structure can't be docked.";
          const suggestion = dock.suggestion ? ` ${dock.suggestion}` : "";
          setError(reason + suggestion);
          return;
        }
        // dockable:true OR network/transport issue → proceed.
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

        {/* Body — Option E right rail (2026-05-02 redesign). Ketcher
            fills the left ~70% of the modal; AI rail is a 380px column
            on the right. The rail stacks always-visible compact stat
            cards (live properties · 3D thumbnail · Quick dock score)
            at the top with the AI chat as the dominant action below.
            Click any stat card to expand into a focused-mode overlay
            (3D fullscreen, dock detail). The sidebar reads/writes
            SMILES via the same getKetcherApi helper. */}
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 relative bg-slate-50 dark:bg-slate-800/40 min-w-0 min-h-0">
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
            compoundId={compoundId}
            initialAIHistory={initialAIHistory}
            onAccept={onAccept}
            onClose={onClose}
          />
        </div>

        {/* Validation error banner — sits ABOVE the footer when present.
            A "stop" indicator: prominent rose-colored block with a clear
            heading ("Can't dock this compound") so the user immediately
            understands the structure was rejected, not just hinted at.
            The reason + suggestion from the dockability check come
            verbatim from the backend so the message stays specific
            (e.g. "contains As" vs the generic "couldn't process"). */}
        {error && (
          <div className="px-5 py-3 border-t border-rose-300 dark:border-rose-800/50 bg-rose-50 dark:bg-rose-900/25 text-rose-900 dark:text-rose-100 shrink-0">
            <div className="flex items-start gap-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="mt-0.5 shrink-0" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm mb-0.5">Can't dock this compound</div>
                <div className="text-[13px] leading-relaxed text-rose-800 dark:text-rose-200">
                  {error}
                </div>
              </div>
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
              {pending ? "Checking structure…" : "Check & use this structure"}
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
  /** When the parent opened the modal to edit an existing saved compound,
   *  this is the compound's DB id. The sidebar uses it to PUT history
   *  changes back to the server. Undefined for in-memory-only flows. */
  compoundId?: number;
  /** Hydrate the history list with this compound's prior AI conversation
   *  on mount. Mutations after mount are tracked by local state. */
  initialAIHistory?: AIHistoryEntry[];
  /** Threaded down so the Promote-to-Full-Job button on the drafty
   *  Quick-dock card can apply the current SMILES to the parent's
   *  compound list and close the modal before navigating to /new. */
  onAccept: (smiles: string, unchanged: boolean) => void;
  onClose: () => void;
}

// Cap matches the server's MAX_AI_HISTORY_PER_COMPOUND constant. The
// frontend prunes pre-emptively (drop oldest unstarred when adding the
// 11th) so the user sees a stable scrolling list rather than a full one
// that suddenly truncates after a save. Server is the source of truth —
// it'll re-prune anything we send over the cap.
const MAX_AI_HISTORY = 10;

// Debounce window for persisting the history array. Long enough that a
// burst of toggles (star + reject + delete) coalesce into one PATCH but
// short enough that closing the modal immediately after a flag change
// still saves before the user navigates away.
const AI_HISTORY_PERSIST_DELAY_MS = 1200;

/** Generate a stable-ish id for a new history entry. crypto.randomUUID
 *  exists in every browser we support; the timestamp fallback keeps the
 *  app from crashing in vintage WebViews where it doesn't. */
function newEntryId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Apply the same star-protection prune the server uses. Keep all
 *  starred entries plus the most-recent unstarred entries up to the
 *  cap. Order in the input is assumed newest-first; output preserves
 *  that ordering with starred floating to the top. */
function pruneHistory(entries: AIHistoryEntry[]): AIHistoryEntry[] {
  if (entries.length <= MAX_AI_HISTORY) return entries;
  const starred = entries.filter((e) => e.flag === "star");
  const unstarred = entries.filter((e) => e.flag !== "star");
  if (starred.length >= MAX_AI_HISTORY) {
    // More starred than the cap — keep all of them (chemists' bookmarks
    // shouldn't disappear silently). Server will do the same.
    return starred;
  }
  return [...starred, ...unstarred.slice(0, MAX_AI_HISTORY - starred.length)];
}

// Curated medchem hints for well-known oncogenic mutations. When the
// sidebar opens with one of these in the user's mutation context, we
// surface the hint as a small chip BELOW the pocket-aware indicator
// so the user gets a domain-grounded starting point instead of staring
// at a blank canvas. These are short by design — anything longer
// belongs in the AI's response, not the chrome.
//
// The map is keyed by mutation code in canonical "L858R" / "T790M"
// form. Multi-mutation strings (e.g. "T790M+C797S") get split on +
// and the FIRST recognised hint wins. Order in the map doesn't matter.
//
// Sources: review articles + the FDA labels for the named drugs.
// References for each are in the comment line so a reviewer can audit.
const MUTATION_HINTS: Record<string, string> = {
  // EGFR L858R: gain-of-function in the activation loop. The L→R swap
  // creates a positively-charged sidechain; H-bond donors that reach
  // it tend to score better. (Gefitinib/Erlotinib lit.)
  L858R: "Activating L→R adds a positive charge near the activation loop. H-bond donors reaching that region often score better.",
  // EGFR T790M / ALK L1196M: gatekeeper mutations. Replace polar Thr
  // with bulky hydrophobic Met → less room for compounds reaching
  // the back pocket. Smaller substituents on the hinge-binding
  // scaffold often retain activity (Osimertinib design principle).
  T790M: "Gatekeeper Thr→Met fills space near the ATP cleft. Smaller substituents at the back-pocket position usually retain activity.",
  L1196M: "Gatekeeper Leu→Met fills the back pocket. Smaller substituents on the hinge-binding scaffold tend to retain activity.",
  // BCR-ABL T315I: gatekeeper. Thr→Ile loses an H-bond donor AND
  // adds steric clash. Compounds that survive (Ponatinib) extend into
  // a different sub-pocket via a triple bond linker.
  T315I: "Gatekeeper Thr→Ile loses an H-bond donor and adds steric bulk. Linkers that bypass the gatekeeper region often survive.",
  // BTK C481S: covalent-inhibitor escape mutation. Cys→Ser removes
  // the thiol that warhead-bearing inhibitors (Ibrutinib) rely on.
  // Reversible (non-covalent) compounds work; the warhead is dead.
  C481S: "Cys→Ser removes the thiol covalent inhibitors target. Reversible (non-covalent) binders are the workaround — drop any warhead.",
  // BRAF V600E: most common BRAF activating mutation. Creates a
  // hydrophobic gain-of-function pocket. Vemurafenib-class compounds
  // are designed around this — para/meta methyl/F substituents on
  // their phenyl ring fill the new hydrophobic space.
  V600E: "Adds a hydrophobic gain near residue 600. Methyl, ethyl, or fluoro at meta/para of an aryl group often fills the new pocket.",
  // KRAS G12C: covalent target (Sotorasib). The Cys is the unique
  // site for warhead attachment. Swap-out warheads for reversible
  // chemistry usually loses everything.
  G12C: "Cys12 is the warhead anchor. Acrylamide/propenamide tethers near the switch-II pocket are the design point.",
  // KIT D816V: similar to BRAF V600E — activates by hydrophobic gain.
  D816V: "Activating Asp→Val adds a hydrophobic patch near the activation loop. Lipophilic substituents in that direction often help.",
  // MET D1228V/Y1230H/F1200I: kinase domain resistance set. These
  // typically appear together (D1228 + Y1230 cluster) in clinical
  // resistance to type-I MET inhibitors. PhD audit (2026-05-01)
  // corrected earlier wording that mischaracterised Y1230H as a
  // pure aromatic-stacking loss — the dominant effect is a Tyr→His
  // charge change (His often protonated at physiological pH inside
  // the pocket) plus loss of the OH H-bond, not stacking per se.
  D1228V: "Activation-loop Asp→Val removes a polar/charged contact and adds hydrophobic bulk. Often appears clustered with Y1230 mutations — design with the cluster in mind. Smaller, less rigid scaffolds tend to retain activity.",
  Y1230H: "Tyr→His swap loses the Tyr hydroxyl H-bond and introduces a (often protonated) imidazole that can clash or repel basic ligand groups in the pocket. Avoid relying on the Y1230 OH; consider neutral, smaller substituents in that region.",
  // PIK3CA H1047R: hotspot in the helical/kinase-domain interface.
  // PhD audit (medchem-phd v2, 2026-05-02) noted this is an allosteric/
  // distant mutation (Class 4 in mutation_classes.md) — its binding
  // effect propagates through long-range conformational coupling that
  // rigid-receptor docking cannot model. The design suggestion below
  // is a directional starting point only; treat any rigid-docking Δ
  // for H1047R as suggestive, not predictive, and validate
  // experimentally before acting on it.
  H1047R: "Activating swap near the C-terminus reshapes the allosteric pocket via long-range conformational coupling. Note: this is an allosteric mutation — rigid-receptor docking has limited predictive power here. Larger, basic-leaning substituents have re-engaged this site in the literature; treat any Δ as a directional hint and validate experimentally.",
};

/** Resolve a mutations string ("V600E" or "T790M+C797S" or "T315I, F317L")
 *  to the FIRST matching curated hint. Returns null when nothing matches.
 *  Splits on common separators so users typing in any reasonable format
 *  get a hit if one applies. */
function resolveMutationHint(mutations?: string): string | null {
  if (!mutations) return null;
  const codes = mutations
    .split(/[,+\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const c of codes) {
    if (MUTATION_HINTS[c]) return MUTATION_HINTS[c];
  }
  return null;
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

function AiSidebar({ ketcherReady, getApi, targetPdb, mutations, compoundId, initialAIHistory, onAccept, onClose }: AiSidebarProps) {
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<AssistResult | null>(null);
  const [properties, setProperties] = useState<PropertiesResult | null>(null);

  // ── AI conversation history ─────────────────────────────────────────
  // Chronological log of AI responses for this compound. Newest-first
  // by convention: append to the front in addToHistory(). Persisted
  // server-side when compoundId is set; in-memory-only otherwise (e.g.
  // create-from-scratch in CompoundsPage, or the NewJobPage flow where
  // there isn't a saved row yet).
  const [aiHistory, setAiHistory] = useState<AIHistoryEntry[]>(() =>
    initialAIHistory && initialAIHistory.length > 0 ? initialAIHistory : [],
  );
  // Banner shown when the most recent persistence call failed. Doesn't
  // block the UI — the user can keep flagging/deleting; we just retry
  // on the next change.
  const [historySaveError, setHistorySaveError] = useState<string | null>(null);
  // Skip the very first persistence run so opening the modal for a saved
  // compound doesn't trigger a no-op PATCH that bumps updated_at.
  const skipNextPersistRef = useRef<boolean>(true);

  // Persist aiHistory to the backend whenever it changes — debounced so
  // a burst of toggles (star + delete + reject) coalesces into one PATCH.
  // Only runs when compoundId is set; in-memory-only flows skip entirely.
  useEffect(() => {
    if (!compoundId) return;
    if (skipNextPersistRef.current) {
      // First run after mount or compoundId change: just record the
      // initial array and skip the network round-trip. Without this,
      // every modal open would write the same data back unchanged.
      skipNextPersistRef.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      api.saveMyCompoundAIHistory(compoundId, aiHistory)
        .then(() => setHistorySaveError(null))
        .catch((e) => {
          // Persistence is best-effort. Log + show a small banner so the
          // user knows their flag/delete didn't make it to the server,
          // but don't tear down the UI state — they can keep working
          // and the next change will retry.
          const msg = e instanceof ApiError ? e.message : "couldn't save AI history";
          setHistorySaveError(msg);
        });
    }, AI_HISTORY_PERSIST_DELAY_MS);
    return () => window.clearTimeout(handle);
    // aiHistory is the only dependency that should re-trigger persistence;
    // compoundId only changes on remount which is handled by the skip flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiHistory]);

  /** Prepend a new history entry. Used by runEdit and runAnalogs after
   *  a successful AI response. No-op when the result is empty (no SMILES
   *  to record). pruneHistory keeps the list at MAX_AI_HISTORY entries
   *  with star-protection. */
  function addToHistory(instructionText: string, r: AssistResult) {
    if (!r?.new_smiles) return;  // nothing useful to log
    const entry: AIHistoryEntry = {
      id: newEntryId(),
      ts: new Date().toISOString(),
      instruction: instructionText,
      smiles: r.new_smiles,
      rationale: r.rationale || "",
      warnings: r.warnings || [],
      flag: null,
    };
    setAiHistory((prev) => pruneHistory([entry, ...prev]));
  }

  /** Remove a history entry by id. Triggers a debounced PATCH if
   *  compoundId is set. */
  function deleteHistoryEntry(id: string) {
    setAiHistory((prev) => prev.filter((e) => e.id !== id));
  }

  /** Toggle the star flag on an entry. Starred entries are protected
   *  from auto-prune both client- and server-side. Re-toggling a starred
   *  entry clears the flag. */
  function toggleHistoryStar(id: string) {
    setAiHistory((prev) => prev.map((e) =>
      e.id === id ? { ...e, flag: e.flag === "star" ? null : "star" } : e,
    ));
  }

  /** Toggle the reject flag — visual marker only, doesn't change retention.
   *  Useful for chemists to mark a suggestion as "tried, didn't pan out". */
  function toggleHistoryReject(id: string) {
    setAiHistory((prev) => prev.map((e) =>
      e.id === id ? { ...e, flag: e.flag === "reject" ? null : "reject" } : e,
    ));
  }

  /** Push a history entry's SMILES back to the canvas. Same setMolecule
   *  path as the main result panel's Apply button. */
  async function applyHistoryEntry(smiles: string) {
    const apiObj = getApi();
    if (!apiObj?.setMolecule) {
      setErrorMsg("Ketcher hasn't finished loading.");
      return;
    }
    try {
      await apiObj.setMolecule(smiles);
    } catch (e) {
      setErrorMsg(`Ketcher rejected the SMILES: ${(e as Error).message}`);
    }
  }

  // Live property strip — auto-updates as the user draws so they see
  // MW / logP / QED / Lipinski feedback without clicking anything.
  // Separate from `properties` (which is the click-driven detailed
  // panel) so the user can keep a Predict-properties result expanded
  // while the strip continues to refresh as they edit.
  const [liveProps, setLiveProps] = useState<PropertiesResult | null>(null);
  // Live SMILES from the canvas — separate from liveProps because the
  // 3D preview wants the raw SMILES (to embed) not the parsed property
  // object. Updated by the same 2.5s polling loop that feeds liveProps,
  // so we don't add a second timer to the modal.
  const [liveSmiles, setLiveSmiles] = useState<string>("");
  // (3D viewer state — view3DMode, fullscreen3D, show3D, plus the ESC
  // handler that toggled it — was removed 2026-05-02 along with the
  // inline thumbnail and fullscreen overlay. See the import-block note.)
  const navigate = useNavigate();

  // Auto-scroll the sidebar to the ResultPanel when a fresh AI suggestion
  // lands. Without this the most-recent suggestion frequently lands below
  // the visible scroll area (especially when 3D preview, Quick dock
  // results, and Optimize variants are all stacked above), and users
  // assume the AI didn't respond. The ref is attached to the wrapper
  // <div> below; the effect fires whenever `result` flips from null to
  // a populated object after a successful runEdit/runAnalogs call.
  const resultPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (status === "ok" && result && resultPanelRef.current) {
      // block: 'start' aligns the panel with the top of the scroll
      // viewport so the rationale is visible immediately, not just the
      // header. behavior: 'smooth' keeps it from feeling like a jump.
      resultPanelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result, status]);
  // Track which kind of action ran last so the result panel labels itself
  // ("Properties:" vs "Suggested edit:" vs "5 analogs:").
  const [lastAction, setLastAction] = useState<"none" | "edit" | "props" | "analogs">("none");

  // Live property strip: every 2.5s, read the current SMILES from
  // Ketcher and ask the backend for its property panel. Cheap
  // (RDKit-only, no LLM, ~5ms server-side) but rate-limited
  // (300/hr/IP — at one call every 2.5s that's 1440/hr if the modal
  // is left open all day, well above the cap, so we also debounce
  // against unchanged SMILES).
  const lastQueriedSmilesRef = useRef<string>("");
  useEffect(() => {
    if (!ketcherReady) return;
    let cancelled = false;
    const tick = async () => {
      const apiObj = getApi();
      if (!apiObj?.getSmiles) return;
      try {
        const smi: string = await apiObj.getSmiles();
        if (cancelled) return;
        const trimmed = (smi || "").trim();
        // Mirror the live SMILES into state so the 3D preview can
        // re-render when the canvas changes. Cheap setState — only
        // fires when the value differs.
        setLiveSmiles((prev) => (prev === trimmed ? prev : trimmed));
        // Empty canvas → clear the strip.
        if (!trimmed) {
          if (liveProps !== null) setLiveProps(null);
          lastQueriedSmilesRef.current = "";
          return;
        }
        // Skip if we already fetched for this exact SMILES — keeps the
        // 300/hr cap healthy when the user is just staring at a stable
        // structure with the modal open.
        if (trimmed === lastQueriedSmilesRef.current) return;
        lastQueriedSmilesRef.current = trimmed;
        const p = await api.assistProperties(trimmed);
        if (!cancelled) setLiveProps(p);
      } catch {
        // Live strip is best-effort. A transient failure just means the
        // strip lags by one tick.
      }
    };
    // Fire one immediately on mount, then on a 2.5s interval.
    tick();
    const interval = window.setInterval(tick, 2500);
    return () => { cancelled = true; window.clearInterval(interval); };
    // liveProps deliberately not in deps — including it would cause
    // the interval to be re-created on every fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ketcherReady, getApi]);

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
      // Docking-aware mode: pass the current dock result through to the
      // AI ONLY when its smiles matches what's on the canvas right now.
      // After the user clicks Apply on an AI suggestion, the canvas
      // changes but `dockResult` still holds the OLD compound's data.
      // Sending stale dock info to a new compound would actively mislead
      // the AI into reasoning about residue contacts that no longer
      // apply. The smiles-equality check is the staleness guard.
      const dockFresh = dockResult && dockResult.smiles === smi;
      const r = await api.assistCompound({
        smiles: smi,
        instruction: text.trim(),
        target_pdb: targetPdb,
        mutations: mutations,
        // Only spread dock context when fresh. The backend treats all
        // three optional fields as a unit — score-with-no-hits would
        // be ambiguous, so we either send everything or nothing.
        ...(dockFresh ? {
          score: dockResult!.score,
          hits: dockResult!.hits,
          misses: dockResult!.misses,
        } : {}),
      });
      setResult(r);
      setStatus("ok");
      // Log to history so re-opening the compound restores this turn.
      addToHistory(text.trim(), r);
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
      //
      // Docking-aware spread: same staleness guard as runEdit. When a
      // fresh dock matches the live SMILES, pass score/hits/misses so
      // the AI's analog suggestions are biased toward fixing the
      // missed residues. Without this the analogs are generic medchem
      // ideas; with it they're targeted at the specific binding
      // problem the user just measured.
      const dockFresh = dockResult && dockResult.smiles === smi;
      const instruction = dockFresh
        ? "Suggest 5 promising medchem analogs of this compound that would" +
          " improve binding to the target pocket — especially address the" +
          " missed residues from the dock results. Return the most promising" +
          " one as new_smiles, and list the other 4 + brief rationale for" +
          " each (referencing the relevant residue interactions) in the" +
          " rationale field."
        : "Suggest 5 promising medchem analogs of this compound. Return the most" +
          " interesting one as new_smiles, and list the other 4 + brief rationale" +
          " for each in the rationale field.";
      const r = await api.assistCompound({
        smiles: smi,
        instruction,
        target_pdb: targetPdb,
        mutations: mutations,
        ...(dockFresh ? {
          score: dockResult!.score,
          hits: dockResult!.hits,
          misses: dockResult!.misses,
        } : {}),
      });
      setResult(r);
      setStatus("ok");
      addToHistory(dockFresh ? "Suggest 5 medchem analogs (docking-aware)" : "Suggest 5 medchem analogs", r);
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

  // ── Quick dock + Optimize loop (the moat feature) ──
  // Quick dock state. dockResult holds the most recent quick-dock
  // outcome; needed by the Optimize button + variant ranking.
  // dockGated tracks whether the backend returned 403 (feature off
  // for this account) so we render a "By request" CTA inline.
  // (No useNavigate needed here — the only routing action is the
  // "Contact us to enable" CTA, which now opens in a new tab via
  // window.open so the user keeps their in-progress canvas state.)
  const [quickDockStatus, setQuickDockStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [quickDockError, setQuickDockError] = useState<string | null>(null);
  const [quickDockGated, setQuickDockGated] = useState(false);
  const [dockResult, setDockResult] = useState<{
    smiles: string;
    score: number;
    hits: string[];
    misses: string[];
    /** PDBQT text of the docked ligand pose — base64-decoded server
     *  output. Fed straight into 3Dmol.js's addModel(text, "pdbqt").
     *  Empty when the dock pipeline produced no parseable pose. */
    posePdbqt?: string;
    /** Resolved RCSB PDB id (e.g. "4OBE") so the receptor can be
     *  fetched via /structures for the docked-pose 3D viewer. */
    pdbId?: string;
    /** Resolved chain id (e.g. "A"). Same use as pdbId. */
    chain?: string;
  } | null>(null);
  // (3D column mode state — ligand vs pose — was removed with the
  // inline 3D viewers on 2026-05-02.)
  const [optimizeStatus, setOptimizeStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizedVariants, setOptimizedVariants] = useState<
    Array<{ new_smiles: string; rationale: string; score?: number; status: "queued" | "docking" | "done" | "error"; error?: string }>
  >([]);

  /** Is the current dockResult applicable to the live canvas SMILES?
   *  Used by runEdit to decide whether to forward dock context to the
   *  AI, and by the mode pill to label the AI's current information
   *  level. After the user edits the structure (or applies an AI
   *  suggestion), the cached dockResult belongs to the OLD molecule;
   *  liveSmiles will differ and this returns false. Declared here
   *  (after dockResult + liveSmiles state) rather than next to the
   *  AI helpers because const declarations can't precede the state
   *  they read. */
  const dockFreshForLive = !!(
    dockResult && liveSmiles && dockResult.smiles === liveSmiles
  );

  /** Promote-to-Full-Job — converts the current "drafty" Quick-dock
   *  iteration into a real submitted docking job with the full
   *  validation pipeline (PoseBusters, ProLIF, Vinardo refined score,
   *  R2 pose storage, shareable UUID URL, engine choice).
   *
   *  Reads the live SMILES from Ketcher, applies it to the parent's
   *  compound list via onAccept (so when the user lands on /new the
   *  compound is already there), closes the modal, then navigates to
   *  /new with reseed state so the form pre-selects the same target +
   *  mutation. The user picks engine/exhaustiveness/name and clicks
   *  Run docking from there.
   *
   *  When Quick dock has been run we use the resolved PDB id from the
   *  dockResult; otherwise we fall back to whatever the parent passed
   *  in `targetPdb` (which may be a catalog id like "kras" — handled
   *  by the new `catalog_target_id` reseed field on NewJobPage). */
  async function promoteToFullJob() {
    const apiObj = getApi();
    if (!apiObj?.getSmiles) return;
    let smi: string;
    try {
      smi = (await apiObj.getSmiles() || "").trim();
    } catch {
      return;
    }
    if (!smi) return;
    // Apply to parent's compound list (idempotent — parent dedupes).
    onAccept(smi, false);
    onClose();
    // Reseed payload: pass the resolved PDB id when we have it (post-
    // Quick-dock), else fall back to catalog_target_id so the
    // NewJobPage reseed handler can map it back to a catalog target.
    const reseed: Record<string, unknown> = {
      compounds: [{ name: "", smiles: smi }],
    };
    if (dockResult?.pdbId) {
      reseed.pdb_id = dockResult.pdbId;
      if (dockResult.chain) reseed.chain = dockResult.chain;
    } else if (targetPdb) {
      reseed.catalog_target_id = targetPdb;
    }
    if (mutations) {
      reseed.mutations = mutations.split(/[, ]+/).map((s) => s.trim()).filter(Boolean);
    }
    navigate("/new", { state: { reseed } });
  }

  /** (runDockAndImprove — the single-click "dock then immediately
   *  fire the AI with dock context" combo function — was removed
   *  2026-05-02 along with its bottom-of-form button. Now that the
   *  Quick Dock card has its own prominent CTA at the top, the combo
   *  was a confusing duplicate. The two-step flow is: click Run Quick
   *  dock → wait for the green docking-aware pill → Chat with AI.) */

  /** Quick dock the current canvas SMILES. Requires a target+mutation
   *  context (not available on standalone CompoundsPage). */
  async function runQuickDock() {
    if (!targetPdb) {
      setQuickDockError("Quick dock needs a target. Open the editor from the New job page after picking a target.");
      setQuickDockStatus("error");
      return;
    }
    // readSmiles() sets `errorMsg` on empty canvas, but that state is
    // tied to the AI-chat result panel — Quick dock has its own
    // panel + error state, so we need to surface "draw something
    // first" via setQuickDockError or the user sees nothing happen
    // (caught in QA).
    const apiObj = getApi();
    if (!apiObj?.getSmiles) {
      setQuickDockError("Ketcher hasn't finished loading — wait a moment.");
      setQuickDockStatus("error");
      return;
    }
    let smi: string;
    try {
      const raw: string = await apiObj.getSmiles();
      smi = (raw || "").trim();
    } catch (e) {
      setQuickDockError(`Couldn't read SMILES: ${(e as Error).message}`);
      setQuickDockStatus("error");
      return;
    }
    if (!smi) {
      setQuickDockError("Draw a structure on the left first, then click Quick dock.");
      setQuickDockStatus("error");
      return;
    }
    setQuickDockStatus("running");
    setQuickDockError(null);
    setDockResult(null);
    setOptimizedVariants([]);
    setOptimizeStatus("idle");
    setOptimizeError(null);
    try {
      const r = await api.assistQuickDock({
        smiles: smi,
        target_pdb: targetPdb,
        mutation: mutations,
      });
      if (!r.ok) {
        setQuickDockStatus("error");
        setQuickDockError(r.error || "Quick dock failed.");
        return;
      }
      setDockResult({
        smiles: smi,
        score: r.score ?? 0,
        hits: r.hits ?? [],
        misses: r.misses ?? [],
        // Decode the base64 PDBQT pose and capture the resolved PDB id
        // + chain so the 3D column can switch into docked-pose mode
        // immediately without another round-trip.
        posePdbqt: r.pose_pdbqt_b64 ? safeAtob(r.pose_pdbqt_b64) : "",
        pdbId: r.pdb_id,
        chain: r.chain,
      });
      setQuickDockStatus("done");
    } catch (e) {
      // 403 → feature is gated. Render the By-request CTA instead of
      // a generic error so the user has a clear path forward.
      if (e instanceof ApiError && e.status === 403) {
        setQuickDockGated(true);
        setQuickDockStatus("idle");
        return;
      }
      setQuickDockStatus("error");
      setQuickDockError(e instanceof ApiError ? e.message : "Quick dock failed");
    }
  }

  /** Optimize: ask the AI for 3 variants targeting the missed
   *  residues, then auto-quick-dock each variant in parallel and
   *  display ranked by score. */
  async function runOptimize() {
    if (!dockResult || !targetPdb) return;
    setOptimizeStatus("running");
    setOptimizeError(null);
    setOptimizedVariants([]);
    try {
      const opt = await api.assistOptimize({
        smiles: dockResult.smiles,
        score: dockResult.score,
        hits: dockResult.hits,
        misses: dockResult.misses,
        target_pdb: targetPdb,
        mutations: mutations,
      });
      if (!opt.variants || opt.variants.length === 0) {
        setOptimizeStatus("error");
        setOptimizeError("AI didn't propose any valid variants. Try again, or refine the structure manually.");
        return;
      }
      // Initialise as queued; we'll dock each one in parallel below.
      const initial = opt.variants.map((v) => ({
        new_smiles: v.new_smiles,
        rationale: v.rationale,
        status: "docking" as const,
        score: undefined as number | undefined,
        error: undefined as string | undefined,
      }));
      setOptimizedVariants(initial);
      setOptimizeStatus("done");
      // Fan out 3 quick docks in parallel. Each updates its own slot
      // on completion so the user sees scores trickle in.
      initial.forEach((v, idx) => {
        api.assistQuickDock({
          smiles: v.new_smiles,
          target_pdb: targetPdb,
          mutation: mutations,
        })
          .then((r) => {
            setOptimizedVariants((cur) => cur.map((cv, i) =>
              i === idx
                ? r.ok
                  ? { ...cv, status: "done", score: r.score }
                  : { ...cv, status: "error", error: r.error || "dock failed" }
                : cv,
            ));
          })
          .catch((e) => {
            setOptimizedVariants((cur) => cur.map((cv, i) =>
              i === idx
                ? { ...cv, status: "error", error: e instanceof ApiError ? e.message : "dock failed" }
                : cv,
            ));
          });
      });
    } catch (e) {
      setOptimizeStatus("error");
      setOptimizeError(e instanceof ApiError ? e.message : "Optimize failed");
    }
  }

  /** Apply a variant SMILES to the canvas — same setMolecule path as
   *  applyResultToCanvas but for the optimized variants. */
  async function applyVariantToCanvas(smiles: string) {
    const apiObj = getApi();
    if (!apiObj?.setMolecule) return;
    try { await apiObj.setMolecule(smiles); }
    catch (e) { setQuickDockError(`Ketcher rejected the SMILES: ${(e as Error).message}`); }
  }

  /** Open the Contact form pre-filled with a quick-dock-access request.
   *  Reuses the same routing pattern as the Boltz-2 "By request" card
   *  on NewJobPage. */
  function requestQuickDockAccess() {
    // Open in a NEW TAB so the user doesn't lose their in-progress work
    // (Ketcher canvas, drawn structure, AI suggestion history). In-tab
    // navigation would unmount the modal and discard everything. Reason
    // is passed as a query param because router state doesn't survive
    // a new-tab boundary; ContactPage reads from either state OR query.
    // noopener+noreferrer is the modern security default — prevents the
    // new tab from being able to manipulate window.opener.
    window.open(
      "/contact?reason=quick_dock_request",
      "_blank",
      "noopener,noreferrer",
    );
  }

  // Curated mutation hint — surfaced as a chip when the user's
  // selected mutation matches one of the well-known oncogenic
  // variants in MUTATION_HINTS. Domain-grounded starting point so
  // the user has direction even before clicking anything.
  const mutationHint = resolveMutationHint(mutations);

  return (
    <aside className="w-[380px] shrink-0 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col overflow-hidden relative">
      {/* ── Option E right rail (2026-05-02 redesign) ──────────────────
          Vertical 380px rail. Top: thin AI-assistant context strip.
          Then always-visible compact stat cards (live properties · 3D
          thumbnail · Quick dock score) so the chemist can glance at
          MW/logP/score without clicking anything. Bottom half is the
          AI chat — the dominant action. Each stat card is clickable:
          3D card → fullscreen viewer; Dock card → fullscreen pose. */}
      <div className="px-3 py-1 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1.5 text-[11px] bg-slate-50/40 dark:bg-slate-900/40 shrink-0">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-delta-600 dark:text-delta-400" aria-hidden="true">
          <path d="M8 1v3M8 12v3M1 8h3M12 8h3M3 3l2 2M11 11l2 2M3 13l2-2M11 5l2-2" />
        </svg>
        <span className="font-semibold text-slate-700 dark:text-slate-200 text-[12px]">AI assistant</span>
        <span className="text-[9px] uppercase tracking-wide text-slate-400">beta</span>
        {targetPdb && (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            · Pocket-aware for <span className="font-mono text-slate-600 dark:text-slate-300">{targetPdb}</span>
            {mutations && <> · {mutations}</>}
          </span>
        )}
        {mutationHint && (
          <span className="ml-auto px-2 py-0.5 rounded bg-delta-50 dark:bg-delta-900/20 border border-delta-200 dark:border-delta-800/40 text-[10px] text-delta-900 dark:text-delta-100 truncate max-w-[600px]" title={mutationHint}>
            <span className="font-semibold">Hint:</span> {mutationHint}
          </span>
        )}
      </div>

      {/* ── Properties strip ───────────────────────────────────────────
          Full-width chip row matching JobPage's "MW 180 / LogP 1.3 / QED
          0.55 / Ro5 ✓" idiom. Slim — properties are a sanity-check
          glance, not the headline content. Tap "Predict full" for the
          PropertiesPanel inline below. (3D thumbnail card removed
          2026-05-02 — JobPage's full viewer is much richer.) */}
      <div className="px-3 pt-2 pb-1.5 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Properties</span>
          <button
            type="button"
            disabled={!ketcherReady || status === "running"}
            onClick={runProperties}
            className="text-[10px] text-delta-700 dark:text-delta-300 hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:no-underline"
            title="Compute the full RDKit property panel (HBA/HBD, rotatable bonds, Veber, PAINS detail)"
          >
            {status === "running" && lastAction === "props" ? "Computing…" : "Predict full →"}
          </button>
        </div>
        {liveProps && liveProps.valid ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* JobPage-idiom pill chips: each property gets its own
                bordered chip with label + value inline. Matches the
                "MW 180 / LogP 1.3 / QED 0.55 / Ro5 ✓" pattern from the
                results page so the editor feels like the same product. */}
            <PropChip label="MW" value={liveProps.mw} />
            <PropChip label="logP" value={liveProps.logp} />
            <PropChip label="QED" value={liveProps.qed} />
            <PropChip label="TPSA" value={liveProps.tpsa} />
            {liveProps.lipinski_pass !== undefined && (
              <span
                className={
                  "px-2 py-0.5 rounded-md border text-[11px] font-medium " +
                  (liveProps.lipinski_pass
                    ? "border-emerald-300 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                    : "border-rose-300 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300")
                }
                title="Lipinski rule of 5"
              >
                Ro5 {liveProps.lipinski_pass ? "✓" : "✗"}
              </span>
            )}
            {(liveProps.pains_hits?.length ?? 0) > 0 && (
              <span className="px-2 py-0.5 rounded-md border border-amber-300 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 text-[11px] font-medium text-amber-700 dark:text-amber-300" title="PAINS substructure alert">
                PAINS {liveProps.pains_hits!.length}
              </span>
            )}
          </div>
        ) : (
          <div className="text-slate-400 dark:text-slate-500 text-[11px] leading-tight">
            Sketch above to see MW · logP · QED · Lipinski.
          </div>
        )}
        {status === "error" && errorMsg && lastAction === "props" && (
          <div className="text-[11px] text-rose-700 dark:text-rose-300 mt-1">{errorMsg}</div>
        )}
      </div>

      {/* ── Quick dock score card ──────────────────────────────────────
          Shown only when a target is picked (or quick-dock gated copy).
          Compact: score + hits/misses + Run/Re-dock button + Optimize.
          The full optimized variants list lives below in the chat
          scroll area; this card stays small to keep the chat above the
          fold. */}
      {targetPdb && (
        <div
          className="mx-3 mb-2 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800/20 px-3 py-2.5 shrink-0 space-y-2"
          title="Quick dock is a draft estimate — fast Vina re-dock for iteration. For a publishable result with PoseBusters validation, ProLIF interactions, and a shareable URL, click Promote to Full Job."
        >
          {/* Drafty header — tiny "DRAFT" tag is the key visual cue.
              Dashed border + neutral slate (vs solid amber) makes the
              card feel like a sketch rather than a published result. */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Quick dock</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Draft</span>
              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">· {targetPdb}</span>
            </div>
          </div>
          {quickDockGated ? (
            <>
              <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-tight italic">
                Real Vina on our GPU pod — enabled per account. Use it to iterate fast before committing to a full validated job.
              </div>
              <button
                type="button"
                onClick={requestQuickDockAccess}
                className="w-full text-[11px] font-semibold px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white transition-colors"
              >
                Contact us →
              </button>
            </>
          ) : quickDockStatus === "running" ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 italic">
              <Spinner size={12} /> Docking on GPU pod…
            </div>
          ) : quickDockStatus === "error" && quickDockError ? (
            <>
              <div className="text-[11px] text-rose-700 dark:text-rose-300 leading-tight">{quickDockError}</div>
              <button
                type="button"
                disabled={!ketcherReady}
                onClick={runQuickDock}
                className="w-full text-[11px] font-semibold px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                🎯 Retry
              </button>
            </>
          ) : dockResult ? (
            <>
              {/* Drafty score — italic, smaller font, muted color, no
                  bold. The "draft estimate" caveat is in the hover tooltip
                  on the card AND surfaced here as plain text so the user
                  can't miss it. */}
              <div className="space-y-0.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[18px] font-medium italic text-slate-600 dark:text-slate-300 leading-none">~{dockResult.score.toFixed(2)}</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">kcal/mol</span>
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 italic leading-tight">
                  Estimate · no PoseBusters · no ProLIF · not shareable
                </div>
              </div>
              {/* Hits/misses are heuristic residue contacts, not real
                  ProLIF interactions. De-emphasized vs the JobPage. */}
              {dockResult.hits.length > 0 && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                  <span className="text-emerald-700 dark:text-emerald-400">contact ~</span>{" "}
                  {dockResult.hits.slice(0, 5).join(", ")}{dockResult.hits.length > 5 && ` +${dockResult.hits.length - 5}`}
                </div>
              )}
              {dockResult.misses.length > 0 && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                  <span className="text-amber-700 dark:text-amber-400">missing ~</span>{" "}
                  {dockResult.misses.slice(0, 5).join(", ")}{dockResult.misses.length > 5 && ` +${dockResult.misses.length - 5}`}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!ketcherReady}
                  onClick={runQuickDock}
                  className="flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  🎯 Re-dock
                </button>
                {dockResult.misses.length > 0 && optimizeStatus === "idle" && (
                  <button
                    type="button"
                    onClick={runOptimize}
                    className="flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md border border-delta-300 dark:border-delta-700/50 bg-white dark:bg-slate-800/40 hover:bg-delta-50 dark:hover:bg-delta-900/20 text-delta-700 dark:text-delta-300 transition-colors"
                    title="Ask AI for 3 variants targeting the missed residues, then dock each one"
                  >
                    ✨ Optimize
                  </button>
                )}
                {optimizeStatus === "running" && (
                  <span className="flex-1 flex items-center justify-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 px-2 py-1.5 italic">
                    <Spinner size={10} /> variants…
                  </span>
                )}
              </div>
              {optimizeStatus === "error" && optimizeError && (
                <div className="text-[11px] text-rose-700 dark:text-rose-300 leading-tight">{optimizeError}</div>
              )}
              {/* Promote-to-Full-Job — the conversion path from "drafty
                  estimate" to "publishable validated result." Solid
                  delta-blue button so it stands out as the next action
                  once the user has found a winner. Thin dashed divider
                  visually separates "iterate here" from "ship it." */}
              <div className="pt-2 mt-1 border-t border-dashed border-slate-300 dark:border-slate-700">
                <button
                  type="button"
                  onClick={promoteToFullJob}
                  className="w-full text-[12px] font-semibold px-3 py-2 rounded-md bg-delta-600 hover:bg-delta-700 text-white transition-colors flex items-center justify-center gap-1.5"
                  title="Submit this compound for a full validated docking job (PoseBusters, ProLIF, Vinardo refined score, shareable URL)"
                >
                  ⚡ Promote to Full Job →
                </button>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 italic text-center mt-1">
                  Validated score · contact map · shareable
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 italic leading-tight">
                Run a 5-second draft dock to see an estimated score before committing to a full job.
              </div>
              <button
                type="button"
                disabled={!ketcherReady}
                onClick={runQuickDock}
                className="w-full text-[11px] font-medium px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                🎯 Run Quick dock (draft)
              </button>
            </>
          )}
        </div>
      )}

      {/* ── AI chat scroll area ────────────────────────────────────────
          This is the dominant region of the rail — it grows to fill
          remaining vertical space. Holds the result panel, optimized
          variants list (when present), and history. The chat form
          sticks to the very bottom (sibling, not inside this scroll). */}
      <div className="px-2 pt-1 pb-1 flex items-center justify-between text-[9px] uppercase tracking-wide text-slate-500 dark:text-slate-400 shrink-0">
        <span>AI assistant</span>
        {aiHistory.length > 0 && (
          <span className="text-slate-400 normal-case">
            {aiHistory.length}/{MAX_AI_HISTORY}
            {historySaveError && (
              <span className="ml-1 text-amber-700 dark:text-amber-300" title={historySaveError}>· retry</span>
            )}
            {!historySaveError && !compoundId && (
              <span className="ml-1 text-slate-400" title="Save the compound to persist history">· unsaved</span>
            )}
          </span>
        )}
      </div>
      <div ref={resultPanelRef} className="flex-1 overflow-y-auto px-2 pb-2 text-[11px] min-h-0 space-y-2">
        {/* Full RDKit panel inline, shown when the user clicked
            "Predict full →" on the Properties stat card. */}
        {status === "ok" && lastAction === "props" && properties && (
          <PropertiesPanel p={properties} />
        )}
        {/* Suggest 5 analogs — only appears after a fresh Quick dock
            against the live SMILES. Reasoning: without dock context the
            AI gives generic medchem ideas, which is much less useful
            than analogs targeted at the specific missed residues from
            the dock. Gating the button behind dockFreshForLive removes
            the "weaker" version of this action entirely — the chemist
            either sees no button (run Quick dock first) or sees the
            docking-aware one (real value). */}
        {dockFreshForLive && (
          <button
            type="button"
            disabled={!ketcherReady || status === "running"}
            onClick={runAnalogs}
            title="AI will use the dock score and missed residues to bias the analog suggestions toward fixing the binding gaps"
            className="w-full text-left text-[11px] px-2 py-1.5 rounded-md border border-emerald-300 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/15 hover:bg-emerald-100 dark:hover:bg-emerald-900/25 text-emerald-800 dark:text-emerald-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🔬 <span className="font-medium">Suggest 5 analogs</span>
            <span className="text-[10px] ml-1 opacity-70">(docking-aware)</span>
          </button>
        )}
        {status === "idle" && lastAction === "none" && (
          <div className="text-slate-400 dark:text-slate-500 text-[11px] leading-relaxed">
            {targetPdb
              ? "Run Quick dock above to unlock docking-aware analog suggestions, or ask the AI for an edit below."
              : "Sketch above, then ask the AI for an edit below."}
          </div>
        )}
        {status === "running" && lastAction !== "props" && (
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-[10px]">
            <Spinner size={11} /> Thinking…
          </div>
        )}
        {status === "error" && errorMsg && lastAction !== "props" && (
          <div className="rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 px-2 py-1.5 text-[10px] text-rose-800 dark:text-rose-200">
            {errorMsg}
          </div>
        )}
        {status === "ok" && (lastAction === "edit" || lastAction === "analogs") && result && (
          <ResultPanel result={result} onApply={applyResultToCanvas} />
        )}
        {/* Optimized variants list — collapsed compact card per variant.
            Sorted by score; pending docks at the end. Lives in the chat
            scroll area so it doesn't push the score card off-screen. */}
        {optimizedVariants.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700 pt-2 space-y-1">
            <div className="text-[9px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Optimized variants
            </div>
            {[...optimizedVariants]
              .sort((a, b) => {
                const aHas = typeof a.score === "number";
                const bHas = typeof b.score === "number";
                if (aHas && bHas) return (a.score as number) - (b.score as number);
                if (aHas) return -1;
                if (bHas) return 1;
                return 0;
              })
              .map((v) => (
                <div key={v.new_smiles} className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1">
                  <div className="flex items-center justify-between gap-1">
                    {v.status === "docking" && (
                      <span className="text-[9px] text-slate-400 flex items-center gap-1">
                        <Spinner size={8} /> docking
                      </span>
                    )}
                    {v.status === "done" && typeof v.score === "number" && (
                      <span className="text-[10px] font-semibold text-ink dark:text-slate-100">
                        {v.score.toFixed(2)}
                        {dockResult && (
                          <span className={"ml-1 text-[9px] " + (v.score < dockResult.score ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                            ({(v.score - dockResult.score).toFixed(2)})
                          </span>
                        )}
                      </span>
                    )}
                    {v.status === "error" && (
                      <span className="text-[9px] text-rose-600 dark:text-rose-400 truncate" title={v.error || "dock failed"}>{v.error || "fail"}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => applyVariantToCanvas(v.new_smiles)}
                      className="text-[9px] font-semibold text-delta-700 dark:text-delta-300 hover:underline"
                    >
                      Apply →
                    </button>
                  </div>
                  <div className="text-[9px] text-slate-600 dark:text-slate-300 leading-tight mt-0.5 line-clamp-2" title={v.rationale}>
                    {v.rationale}
                  </div>
                </div>
              ))}
          </div>
        )}
        {aiHistory.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700 pt-2 space-y-1">
            <div className="text-[9px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              History
            </div>
            <ul className="space-y-1">
              {aiHistory.map((entry) => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  onApply={() => applyHistoryEntry(entry.smiles)}
                  onToggleStar={() => toggleHistoryStar(entry.id)}
                  onToggleReject={() => toggleHistoryReject(entry.id)}
                  onDelete={() => deleteHistoryEntry(entry.id)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Sticky chat form (bottom of rail) ──────────────────────────
          Always visible at the bottom regardless of scroll. Context
          pill shows what info the AI will get (structure / target /
          docking-aware). Below that: text input + Improve button. When
          a target is picked but no fresh dock exists, the Dock+Improve
          combo button appears so a single click runs both. */}
      <form
        className="p-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5 shrink-0 bg-white dark:bg-slate-900"
        onSubmit={(e) => {
          e.preventDefault();
          const text = instruction.trim() || (
            dockFreshForLive
              ? "Based on the docking results, suggest the highest-impact structural edit to improve binding."
              : "Suggest the most meaningful medchem improvement to this compound."
          );
          runEdit(text);
          setInstruction("");
        }}
      >
        {/* Compact AI context pill — three states (green/amber/slate). */}
        <div
          className={
            "flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border " +
            (dockFreshForLive
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-200"
              : targetPdb
                ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/15 dark:text-amber-200"
                : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300")
          }
          title={
            dockFreshForLive
              ? `Docking-aware: ${dockResult!.score.toFixed(2)} kcal/mol, ${dockResult!.hits.length} hits, ${dockResult!.misses.length} misses`
              : targetPdb
                ? `Target ${targetPdb}${mutations ? ` · ${mutations}` : ""}; no fresh dock yet`
                : "Structure only — no target context"
          }
        >
          <span aria-hidden="true">{dockFreshForLive ? "🟢" : targetPdb ? "🟡" : "⚪"}</span>
          <span className="truncate">
            {dockFreshForLive
              ? `Docking-aware · ${dockResult!.score.toFixed(2)} · ${dockResult!.hits.length}h/${dockResult!.misses.length}m`
              : targetPdb
                ? "Structure + target hints"
                : "Structure only"}
          </span>
        </div>
        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={!ketcherReady || status === "running" || quickDockStatus === "running"}
          placeholder="Type here…"
          className="w-full text-[11px] px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 placeholder-slate-400 focus:border-delta-500 focus:ring-1 focus:ring-delta-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!ketcherReady || status === "running" || quickDockStatus === "running"}
          title={
            instruction.trim()
              ? "Send your instruction to the AI."
              : "Click without typing for an open-ended improvement; or type a specific edit."
          }
          className="w-full text-[11px] font-semibold px-2 py-1.5 rounded-md bg-delta-600 hover:bg-delta-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white transition-colors"
        >
          {status === "running" && quickDockStatus !== "running" ? "Sending…" : "💬 Chat with AI"}
        </button>
        {/* (Dock + Improve combo button removed 2026-05-02 — was a
            second "dock" CTA below the prominent Quick Dock card,
            confusing because it duplicated that card's job. The two-step
            flow — click Run Quick dock above, then Suggest improvement
            here once the context pill flips to docking-aware — is one
            extra click but the intent at each step is now obvious.) */}
      </form>

      {/* (Fullscreen 3D overlay block lived here. Removed 2026-05-02
          along with the inline 3D thumbnails — the JobPage 3D viewer
          is the single source of truth for pose inspection now.) */}
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

/** (LivePropPair was the un-bordered inline label/value used by the
 *  Option E stat-card layout; replaced by PropChip below when the
 *  editor switched to the JobPage idiom on 2026-05-02.) */

/** JobPage-style pill chip for properties. Matches the bordered chip
 *  pattern from the results page ("MW 180 / LogP 1.3 / QED 0.55 / Ro5 ✓")
 *  so the editor's properties strip feels like the same product as the
 *  matrix's per-row property chips. */
function PropChip({ label, value }: { label: string; value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <span className="px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 text-[11px]">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>{" "}
      <span className="font-medium text-slate-700 dark:text-slate-200">{value}</span>
    </span>
  );
}

/** One row in the AI history list. Compact card: instruction + suggested
 *  SMILES + rationale, with Apply / Star / Reject / Delete actions on
 *  the right. The expanded rationale is gated behind a click-to-expand
 *  to keep the list dense — chemists scanning history want to see SMILES
 *  + ts at a glance, then drill in. Reject styling is muted (greyscale
 *  + line-through on the SMILES) so failed turns are visually demoted
 *  but still clickable to reapply if the chemist changes their mind. */
function HistoryRow({
  entry,
  onApply,
  onToggleStar,
  onToggleReject,
  onDelete,
}: {
  entry: AIHistoryEntry;
  onApply: () => void;
  onToggleStar: () => void;
  onToggleReject: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isStarred = entry.flag === "star";
  const isRejected = entry.flag === "reject";
  // Format ts as "Apr 30 · 14:22" — short, scannable, keeps within the
  // tight 320px sidebar width. Falls back to the raw ISO string if the
  // browser's Date parser doesn't like the input (defensive — should
  // never trigger since we mint the ISO ourselves).
  let prettyTs = entry.ts;
  try {
    const d = new Date(entry.ts);
    if (!isNaN(d.getTime())) {
      prettyTs = d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        + " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
  } catch { /* keep raw ts */ }

  return (
    <li
      className={
        "rounded-md border px-2 py-1.5 transition-colors " +
        (isStarred
          ? "border-amber-300 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/15"
          : isRejected
            ? "border-slate-200 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/30 opacity-70"
            : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40")
      }
    >
      {/* Top row — instruction + actions. Truncate the instruction so a
          long prompt doesn't push actions off-screen; full text shows on
          expand. */}
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 text-left group"
          title={expanded ? "Collapse" : "Show details"}
        >
          <div className="text-[11px] text-ink dark:text-slate-100 leading-snug truncate group-hover:text-delta-700 dark:group-hover:text-delta-300">
            {entry.instruction}
          </div>
          <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">{prettyTs}</div>
        </button>
        {/* Action cluster — small icon-only buttons to keep the row narrow.
            Star → amber when active, Reject → muted slate, Delete → rose
            on hover. All three are 18px tap targets, big enough on touch
            but still compact. */}
        <button
          type="button"
          onClick={onToggleStar}
          title={isStarred ? "Unstar" : "Star (protected from auto-prune)"}
          className={
            "p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors " +
            (isStarred ? "text-amber-500" : "text-slate-300 dark:text-slate-600 hover:text-amber-500")
          }
        >
          {/* Star — filled when starred, outline otherwise */}
          <svg width="12" height="12" viewBox="0 0 20 20" fill={isStarred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <polygon points="10,2 12.5,7.5 18,8.3 14,12.3 15,18 10,15.3 5,18 6,12.3 2,8.3 7.5,7.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onToggleReject}
          title={isRejected ? "Clear reject mark" : "Mark as rejected (visual only)"}
          className={
            "p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors " +
            (isRejected ? "text-slate-600 dark:text-slate-300" : "text-slate-300 dark:text-slate-600 hover:text-slate-500")
          }
        >
          {/* Slash circle for reject */}
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" />
            <line x1="5" y1="5" x2="15" y2="15" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete this entry"
          className="p-1 rounded text-slate-300 dark:text-slate-600 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <line x1="5" y1="5" x2="15" y2="15" />
            <line x1="15" y1="5" x2="5" y2="15" />
          </svg>
        </button>
      </div>

      {/* SMILES line — always visible, font-mono and break-all so a long
          SMILES wraps gracefully inside the sidebar width. Click to apply. */}
      <button
        type="button"
        onClick={onApply}
        title="Apply this SMILES to the canvas"
        className={
          "block w-full text-left mt-1 font-mono text-[9px] break-all leading-tight hover:underline " +
          (isRejected
            ? "text-slate-400 dark:text-slate-500 line-through"
            : "text-delta-700 dark:text-delta-300")
        }
      >
        {entry.smiles}
      </button>

      {/* Expanded body — rationale + warnings + a more prominent Apply
          button. Hidden by default to keep the list dense. */}
      {expanded && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-700/50 space-y-1.5">
          {entry.rationale && (
            <div className="text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed">
              {entry.rationale}
            </div>
          )}
          {entry.warnings && entry.warnings.length > 0 && (
            <ul className="text-[9px] text-amber-700 dark:text-amber-300 space-y-0.5 ml-3 list-disc">
              {entry.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <button
            type="button"
            onClick={onApply}
            className="text-[10px] font-semibold text-delta-700 dark:text-delta-300 hover:underline"
          >
            Apply to canvas →
          </button>
        </div>
      )}
    </li>
  );
}
