// Build verification tag — surfaces the deploy tag in the bundled JS so a
// `curl liganx.com/assets/index-*.js | grep LIGANX_BUILD_TAG` confirms which
// version is live. Cheap, ~50 bytes; replace each release.
const LIGANX_BUILD_TAG = "v0.85-2026-05-07-uniprot-enrichment-status";
if (typeof window !== "undefined") (window as any).__LIGANX_BUILD_TAG__ = LIGANX_BUILD_TAG;

/**
 * Studio (v0.1) — unified workspace, control-center aesthetic.
 *
 * Design principles, drawn from spacecraft mission control / Bloomberg
 * terminal / SpaceX MCC:
 *
 *  1. Critical telemetry is always visible. The score, pose status, and
 *     pod connectivity sit in fixed positions and never collapse. The
 *     operator never has to "find" them.
 *  2. Secondary tools are collapsible. Properties, AI variants, history
 *     hide behind chevrons but are one click away. Closed by default
 *     so the canvas + KPI panel get the visual real estate.
 *  3. Numbers are monospace. Digits don't jump as values update — the
 *     score reads "−7.20" cleanly even when it's transitioning.
 *  4. Status by shape, not by text. ●○✓✗▶▾ communicate state at a
 *     glance. Color reinforces (cyan = active, amber = caution, rose
 *     = failure, emerald = pass) but is never the only signal.
 *  5. Dark by default. The chemist will stare at this for hours.
 *  6. Minimal chrome. Borders are 1px slate-800. No drop shadows. No
 *     gradients. Information density first; ornament never.
 *
 * Lives at /studio. Existing pages are untouched and remain canonical.
 * If users prefer this, it gets promoted; if not, deleted with no
 * downstream impact.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Job } from "../api";
import { useSmilesValidity, useSmilesSaScore, type SmilesValidity } from "../components/MoleculePreview";
import { upsertDraft, listDrafts, deleteDraft, type StudioDraft } from "../lib/drafts";
import { appendDockHistory, listDockHistory, deleteDockHistoryEntry, clearDockHistory, type DockHistoryEntry } from "../lib/dockHistory";

const KETCHER_SRC = "/ketcher/index.html";

interface QuickDockResult {
  ok: boolean;
  score?: number;
  hits?: string[];
  misses?: string[];
  pose_pdbqt_b64?: string;
  pdb_id?: string;
  chain?: string;
  error?: string;
  receptor_variant?: "mutant" | "wt";
  mutation_caveat?: string;
  pose_in_pocket?: boolean;
  pose_offset_a?: number;
  dock_attempts?: number;
}

function getKetcherApi(iframe: HTMLIFrameElement | null): any | null {
  if (!iframe) return null;
  try {
    return (iframe.contentWindow as any)?.ketcher ?? null;
  } catch {
    return null;
  }
}

function fmtScore(s: number | undefined | null): string {
  if (s == null) return "—.——";
  return s >= 0 ? `+${s.toFixed(2)}` : s.toFixed(2);
}

/** Convert Vina ΔG (kcal/mol) → Kd estimate as a human-readable string.
 *  Kd = exp(ΔG / RT) at 298 K, RT = 0.5925 kcal/mol. The result is a rough
 *  order-of-magnitude estimate — Vina's absolute scores aren't physical
 *  binding energies — but it gives a much more familiar number than
 *  "−7.30 kcal/mol" for med chemists who think in nM/μM/mM. */
function fmtScoreKd(s: number | undefined | null): string {
  if (s == null || s >= 0) return "";
  const kd_M = Math.exp(s / 0.5925);  // molar
  if (kd_M < 1e-9) return `${(kd_M * 1e12).toFixed(0)} pM`;
  if (kd_M < 1e-6) return `${(kd_M * 1e9).toFixed(0)} nM`;
  if (kd_M < 1e-3) return `${(kd_M * 1e6).toFixed(0)} µM`;
  if (kd_M < 1) return `${(kd_M * 1e3).toFixed(1)} mM`;
  return `${kd_M.toFixed(2)} M`;
}

/** Tier a Vina score into a Tailwind text color so the panel visually
 *  signals strength at a glance. Anchors:
 *    • s ≤ −9      → emerald-300 (sub-nM, likely too good for Vina —
 *                    treat as "very strong" but verify)
 *    • −9 < s ≤ −7 → emerald-400 ("strong" — typical hit)
 *    • −7 < s ≤ −5 → cyan-300    ("moderate" — needs optimization)
 *    • s > −5      → amber-300   ("weak" — pocket isn't holding it)
 *    • null        → slate-600   (no score yet) */
function scoreTier(s: number | undefined | null): string {
  if (s == null) return "text-slate-600";
  if (s <= -9) return "text-emerald-300";
  if (s <= -7) return "text-emerald-400";
  if (s <= -5) return "text-cyan-300";
  return "text-amber-300";
}

function fmtClock(d: Date): string {
  return d.toISOString().slice(11, 19) + " UTC";
}

/** Relative-time helper for the autosave indicator. Driven by the
 *  existing 1Hz clock tick (which already re-renders the header), so
 *  the label updates roughly every second without a separate timer. */
function fmtSavedAgo(nowMs: number, savedMs: number): string {
  const dt = Math.max(0, Math.floor((nowMs - savedMs) / 1000));
  if (dt < 5) return "just now";
  if (dt < 60) return `${dt}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  return `${Math.floor(dt / 3600)}h ago`;
}

/** Parse the residue number out of a mutation tag like "T790M" or
 *  "L858R" or "G12C". Returns null for malformed inputs. */
function parseMutationResidue(tag: string): number | null {
  if (!tag) return null;
  const m = tag.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** Parse the CA atom coordinates for a specific residue from a PDB
 *  text. Returns null if the residue isn't found. Used to compute the
 *  mutation-to-pocket-center distance — same semantic as JobPage's
 *  `outsidePocketA` field, which flags mutations Vina can't see
 *  because they sit beyond the docking box reach. */
function parseCaCoords(pdb: string, residueN: number, chain: string = "A"): [number, number, number] | null {
  const lines = pdb.split("\n");
  for (const line of lines) {
    // PDB ATOM record: cols 13-16 atom name, col 22 chain, cols 23-26 resi
    if (!line.startsWith("ATOM")) continue;
    const atomName = line.slice(12, 16).trim();
    if (atomName !== "CA") continue;
    const lineChain = line.slice(21, 22).trim();
    if (chain && lineChain && lineChain !== chain) continue;
    const resiStr = line.slice(22, 26).trim();
    const resi = parseInt(resiStr, 10);
    if (resi !== residueN) continue;
    const x = parseFloat(line.slice(30, 38));
    const y = parseFloat(line.slice(38, 46));
    const z = parseFloat(line.slice(46, 54));
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return [x, y, z];
    }
  }
  return null;
}

function distance3D(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// JobPage threshold: residues farther than ~11 Å from box center are
// outside Vina's reach for a 22 Å box. Bumped slightly looser (12 Å) to
// account for catalog targets with widened boxes (BRAF 36 Å, EGFR 30 Å).
const MUTATION_OUTSIDE_POCKET_THRESHOLD_A = 12.0;

// (v0.75) Studio session persistence. The user often clicks "view ↗"
// to inspect a result on the full /jobs/{id} page, then expects to
// come back to Studio with the entire workspace intact (compounds,
// docking results, fullJobKey, dockResult/Wt poses, score panel).
// React state alone is wiped on navigation, so we mirror the
// session-relevant slice into sessionStorage on every meaningful
// state change and rehydrate on mount.
//
// Why sessionStorage, not localStorage: the snapshot is tied to the
// current tab/session. Two Studio tabs in the same browser shouldn't
// stomp on each other's results. Cleared automatically when the user
// closes the tab — that's the right TTL for "I'm in the middle of
// docking".
//
// Pose data (PDBQT base64) lives on dockResult/Wt and the per-row
// pose blobs in fullJobRows. A 7-compound × 2-variant run is roughly
// 70 KB of pose data — well within sessionStorage's 5 MB cap.
const STUDIO_SESSION_KEY = "liganx-studio-session-v1";

interface StudioSessionSnapshot {
  // Schema-versioned so a future shape change can wipe stale snapshots
  // without surfacing a deserialise error to the user.
  v: 1;
  savedAt: number;
  selectedTargets: string[];
  selectedMutations: string[];
  includeWt: boolean;
  // (v0.83) Ad-hoc targets the user picked from the RCSB PDB search
  // tier. Persisted so a Back-to-Studio round trip can resolve the
  // PDB id back into a usable target entry — otherwise selectedTargets
  // would point to an id that's not in the curated catalog.
  adHocTargets?: any[];
  // Compounds + active index — restoring these is the load-bearing part:
  // the user expects their staged compound list to be exactly as they
  // left it.
  compounds: { id: string; smiles: string; name?: string }[];
  activeCompoundIdx: number;
  currentSmiles: string;
  // Job state — when the user "view ↗"s and comes back, this is what
  // makes the docking-results panel re-appear instantly without re-
  // polling. dockResult / Wt include pose blobs so the 3D viewer also
  // restores the previously-shown pose.
  fullJobKey: string | null;
  fullJobStatus: "pending" | "running" | "completed" | "failed" | "cancelled" | null;
  fullJobStage: string | null;
  fullJobRows: any[];
  selectedRowCompoundId: number | null;
  dockResult: any | null;
  dockResultWt: any | null;
  setupCollapsed: boolean;
  loadedCompound: { name: string; smiles: string } | null;
}

function readStudioSession(): StudioSessionSnapshot | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STUDIO_SESSION_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as StudioSessionSnapshot;
    if (snap?.v !== 1) return null;
    // Soft TTL: 24 h. The user could leave Studio open across days and
    // expect "fresh page" semantics if they nav back; sessionStorage
    // already clears on tab close so this is just a belt-and-suspenders
    // guard for unusual browser behaviour.
    if (Date.now() - snap.savedAt > 24 * 60 * 60 * 1000) return null;
    return snap;
  } catch {
    return null;
  }
}

function writeStudioSession(snap: StudioSessionSnapshot): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STUDIO_SESSION_KEY, JSON.stringify(snap));
  } catch {
    // Quota exceeded (very large pose blob set) or private mode —
    // silently no-op. The user keeps the session in-memory; only the
    // round-trip-via-JobPage feature degrades.
  }
}

export default function StudioPage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  // (v0.75) Read the session snapshot ONCE at mount so each useState's
  // initial-value lambda can pull from the same source. If the user
  // arrived with a `reseed` payload (e.g. from JobPage's Edit & re-dock
  // or from HistoryPage), the reseed wins — we want the new compound
  // loaded fresh, not the prior session restored over it.
  const reseed = (location.state as any)?.reseed as
    | { compounds?: { name?: string | null; smiles: string }[]; mutations?: string[]; pdb_id?: string; catalog_target_id?: string; include_wt?: boolean }
    | undefined;
  const restoreRequested = (location.state as any)?.restoreSession === true;
  // (v0.79-0.82) Conditional rehydration — pure empty-by-default.
  // Restore the snapshot only when intent is EXPLICIT:
  //   1. location.state.restoreSession=true → set by JobPage's Back
  //      to Studio link AND by the in-header Resume pill.
  //   2. location.state.reseed → Edit & re-dock + history rerun.
  // Everything else (direct URL, refresh, browser back/forward,
  // new tabs, header nav clicks, BFCache-served pages) → empty.
  // (v0.82) Dropped browser-back/forward auto-restore too. Reason:
  // Chrome's BFCache can serve a previously-rendered page on what
  // looks like a fresh address-bar visit, with navType="back_forward",
  // which kept making Studio look "not empty". The Resume pill is
  // the single, predictable recovery path; everything else is empty.
  const shouldRestoreSession = restoreRequested || !!reseed;
  const initialSession = useRef<StudioSessionSnapshot | null>(
    shouldRestoreSession ? readStudioSession() : null,
  ).current;
  // For the manual resume pill — does sessionStorage contain anything
  // worth resuming? Read it lazily so a fresh visit doesn't pay the
  // JSON.parse cost unless the pill is actually rendered.
  const [pendingSnapshot] = useState<StudioSessionSnapshot | null>(() =>
    !shouldRestoreSession ? readStudioSession() : null,
  );
  const [ketcherReady, setKetcherReady] = useState(false);
  const [currentSmiles, setCurrentSmiles] = useState("");
  // (v0.30) Silent autosave bookkeeping. activeDraft holds the most
  // recently upserted draft so subsequent edits update the SAME record
  // (not a fresh draft per keystroke). lastSavedAt drives the tiny
  // "saved · 3s ago" pill in the status bar so the user has visible
  // confirmation that their work is on disk.
  const [activeDraft, setActiveDraft] = useState<StudioDraft | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // (v0.32) Toast for the Promote button result. Auto-clears after 3-5s.
  const [promoteToast, setPromoteToast] = useState<string | null>(null);
  // (v0.36) Inline Promote modal. When non-null, renders a custom
  // modal (Studio aesthetic, monospace, dark) instead of the v0.32
  // window.prompt. The `mode` distinguishes "promote a draft to the
  // library" from "save a fork as new", which differ only in the
  // initial name suggestion + button label + post-save behavior.
  const [promoteDialog, setPromoteDialog] = useState<
    | { mode: "promote"; initialName: string }
    | { mode: "fork"; initialName: string; originalName: string; stageAfterIdx?: number }
    | null
  >(null);
  // (v0.33) Loaded named compound — set when the user picks something
  // from the library / reference / PubChem (anything that has a name).
  // While set, edits are treated as forks: the user is asked to choose
  // between "Save changes to <name>" (overwrite) and "Save as new"
  // (keep the original). Cleared when the user explicitly forks or
  // sketches from scratch.
  // (v0.76) loadedCompound: prefer session restoration (so the prior
  // fork-on-edit lock survives a JobPage round-trip). Reseed overrides
  // it only if there was no session — i.e. fresh load from /new-style
  // history reseed where there's nothing to restore.
  const [loadedCompound, setLoadedCompound] = useState<{ name: string; smiles: string } | null>(() => {
    if (initialSession?.loadedCompound) return initialSession.loadedCompound;
    if (reseed?.compounds?.[0]) {
      const c = reseed.compounds[0];
      return c.name ? { name: c.name, smiles: c.smiles } : null;
    }
    return null;
  });

  // (v0.62-0.64) Studio supports up to 2 targets, 2 mutations, and
  // 10 compounds per Full Job. State shape: arrays for all three.
  // To avoid touching every existing call site that read the
  // singleton primary, we derive selectedTarget and selectedMutation
  // helpers below as 'first-of-array' shims. New code should prefer
  // the array forms.
  const [selectedTargets, setSelectedTargets] = useState<string[]>(
    initialSession?.selectedTargets && initialSession.selectedTargets.length > 0
      ? initialSession.selectedTargets
      : (reseed?.catalog_target_id ? [reseed.catalog_target_id] : reseed?.pdb_id ? [reseed.pdb_id.toLowerCase()] : []),
  );
  // Selection model: WT can be ON or OFF, and up to TWO mutation tags.
  // Default is WT-only (the conservative starting point — without a
  // mutation, dock against wild-type). Adding mutation chips alongside
  // keeps WT selected, so the trigger shows e.g. "WT + Q61H + L597R"
  // and Run Dock fires all in parallel.
  const [includeWt, setIncludeWt] = useState<boolean>(initialSession?.includeWt ?? reseed?.include_wt ?? true);
  const [selectedMutations, setSelectedMutations] = useState<string[]>(
    initialSession?.selectedMutations && initialSession.selectedMutations.length > 0
      ? initialSession.selectedMutations
      : (reseed?.mutations ?? []),
  );
  // Singleton shims — every existing reference to selectedTarget /
  // selectedMutation reads the first array entry. Setters that pass a
  // single string (or empty string to clear) are mapped onto the
  // array form too. New multi-select call sites should use the arrays
  // directly.
  const selectedTarget = selectedTargets[0] || "";
  const selectedMutation = selectedMutations[0] || "";
  const setSelectedTarget = (t: string) => setSelectedTargets(t ? [t] : []);
  const setSelectedMutation = (m: string) => setSelectedMutations(m ? [m] : []);
  const MAX_TARGETS = 2;
  const MAX_MUTATIONS = 2;
  const MAX_COMPOUNDS = 10;
  // (v0.64) Compound list — up to 10 compounds per job. Each entry is
  // a SMILES + optional name + a stable id. activeCompoundIdx is the
  // one currently loaded into the 2D Ketcher canvas. The legacy
  // currentSmiles state is kept and synced with the active compound
  // so existing rendering paths (live conformer, score panel, etc.)
  // keep working without touching dozens of call sites.
  type CompoundEntry = { id: string; smiles: string; name?: string };
  // (v0.76) Compounds: restore the session's staged list FIRST, then
  // overlay the reseed compound if any. The reseed compound either
  // (a) replaces the existing entry whose name matches (Edit & re-dock
  //     of an already-staged compound — the modified SMILES updates
  //     the existing row in place), or
  // (b) appends as a new staged entry if no name match (Edit & re-dock
  //     produced a renamed variant we haven't seen before, or there's
  //     no prior session).
  // Cap at MAX_COMPOUNDS — never overflow.
  const [compounds, setCompounds] = useState<CompoundEntry[]>(() => {
    const restored = initialSession?.compounds ?? [];
    if (!reseed?.compounds || reseed.compounds.length === 0) return restored;
    const merged = [...restored];
    for (const c of reseed.compounds) {
      const matchIdx = c.name
        ? merged.findIndex((m) => (m.name || "").toLowerCase() === c.name!.toLowerCase())
        : -1;
      if (matchIdx >= 0) {
        merged[matchIdx] = { ...merged[matchIdx], smiles: c.smiles };
      } else if (merged.length < 10) {
        merged.push({
          id: `c_reseed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          smiles: c.smiles,
          name: c.name || undefined,
        });
      }
    }
    return merged;
  });
  // (v0.76) When reseed is present, make the reseeded compound active
  // so the canvas loads it and the user lands on the row they came
  // back to edit. Otherwise restore the prior active row.
  const [activeCompoundIdx, setActiveCompoundIdx] = useState<number>(() => {
    if (reseed?.compounds?.[0]) {
      const restored = initialSession?.compounds ?? [];
      const matchIdx = reseed.compounds[0].name
        ? restored.findIndex((m) => (m.name || "").toLowerCase() === reseed.compounds![0].name!.toLowerCase())
        : -1;
      if (matchIdx >= 0) return matchIdx;
      // Newly appended at the end of the merged list:
      return Math.min(restored.length, 9);
    }
    return initialSession?.activeCompoundIdx ?? 0;
  });
  // Typeahead query strings — filter the chip rows live as the user
  // types. Empty string = show all chips (default).
  const [targetQuery, setTargetQuery] = useState("");
  const [mutationQuery, setMutationQuery] = useState("");

  const [docking, setDocking] = useState(false);
  const [dockError, setDockError] = useState<string | null>(null);
  // Two result slots: one keyed for WT, one for the mutant. When the
  // user has selected a mutation AND compareWt is on, both fire in
  // parallel and we display a side-by-side comparison. When WT-only
  // or mutant-only, one slot stays null. The 3D viewer always shows
  // the mutant pose if available, otherwise WT — that's the "primary"
  // view, with the other surfaced as a secondary readout in the panel.
  const [dockResult, setDockResult] = useState<QuickDockResult | null>(
    initialSession?.dockResult ?? null,
  ); // primary (mutant if selected, else WT)
  const [dockResultWt, setDockResultWt] = useState<QuickDockResult | null>(
    initialSession?.dockResultWt ?? null,
  ); // WT comparison slot
  // Mutation-residue-to-pocket-center distance. Same semantic as
  // JobPage's outsidePocketA: when a mutation sits far from the
  // docking box, Vina can't capture geometric effects of that
  // mutation, so the WT-vs-mutant Δ is unreliable. Computed
  // client-side from the WT receptor PDB after dock completes.
  const [mutationOutsidePocketA, setMutationOutsidePocketA] = useState<number | null>(null);

  const [now, setNow] = useState(new Date());
  const [healthOk, setHealthOk] = useState<boolean | null>(null);

  // (v0.61) Warn the user if they try to close the tab / refresh /
  // navigate away while they have un-promoted work in the canvas.
  // Autosave drafts protect against data loss inside Studio (the
  // user can come back and find their sketch), but they don't make
  // the compound show up in /compounds for re-use elsewhere — for
  // that you have to hit Save / Promote. This warning catches the
  // case of "I sketched something, didn't promote, and was about to
  // close my tab".
  //
  // Browser-native confirm prompt — modern browsers ignore the
  // returnValue text and show their own copy ("Reload site?"), but
  // setting it is still the standard way to opt in. Only fires on
  // tab-close / refresh / external nav; in-app navigation uses
  // React Router which doesn't trigger beforeunload.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      // (v0.69) Also catch unsaved edits to a staged suite compound —
      // the user can edit the canvas, walk away, and lose the edit
      // unless we prompt. Treats staged-row drift the same as any
      // other dirty state.
      const stagedDirty =
        activeCompoundIdx >= 0 &&
        activeCompoundIdx < compounds.length &&
        !!currentSmiles &&
        currentSmiles !== compounds[activeCompoundIdx].smiles;
      const libraryDirty = !!currentSmiles && (
        !loadedCompound ||
        currentSmiles !== loadedCompound.smiles
      );
      // Library dirty fires for any non-staged sketch; ignore it when
      // the user is mid-edit on a staged compound (stagedDirty owns
      // that case) so we don't double-count.
      const hasUnsaved = stagedDirty || (libraryDirty && !stagedDirty);
      if (!hasUnsaved) return;
      e.preventDefault();
      // Returning a string is the legacy spec; modern browsers ignore
      // the text but require the property to be set + a return value.
      e.returnValue = "You have unsaved compound edits. Save before leaving?";
      return e.returnValue;
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [currentSmiles, loadedCompound, activeCompoundIdx, compounds]);

  // (v0.30) Silent autosave loop — debounced 600 ms after the user
  // stops editing. The contract: every meaningful state the user
  // touched is on disk. No popup, no friction. Naming is a separate
  // act handled by an explicit Promote button (v0.31+).
  //
  // We watch SMILES + target + mutation because those three together
  // define "the exploration". Empty SMILES skips — there's nothing
  // worth persisting until the user has actually drawn something.
  useEffect(() => {
    if (!currentSmiles) return;
    const t = window.setTimeout(() => {
      const draft = upsertDraft(
        {
          smiles: currentSmiles,
          target: selectedTarget || undefined,
          mutation: selectedMutation || undefined,
        },
        activeDraft?.id,
      );
      // Only update React state when the id changed (new draft) so we
      // don't trigger a re-render on every keystroke. lastSavedAt does
      // need to update each save though — that's how the indicator
      // ticks.
      if (!activeDraft || activeDraft.id !== draft.id) setActiveDraft(draft);
      setLastSavedAt(Date.now());
    }, 600);
    return () => window.clearTimeout(t);
    // activeDraft is read but not in deps — including it would loop
    // (we set it inside the effect). The id stays stable across edits
    // so reading the latest via closure is correct here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSmiles, selectedTarget, selectedMutation]);

  const [showProps, setShowProps] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // (v0.35) Session dock history tab — separate from the Drafts tab
  // because they answer different questions: drafts = "compounds I've
  // sketched", history = "docks I've run".
  const [showDockHist, setShowDockHist] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  // Dropdown open/closed state for target & mutation pickers. Closed
  // by default — current selection shows as a chip with a chevron;
  // clicking expands to show full filtered list. The search input on
  // the right stays visible always (typing into it auto-opens the
  // dropdown so users don't have to click twice).
  const [targetDropdownOpen, setTargetDropdownOpen] = useState(false);
  const [mutationDropdownOpen, setMutationDropdownOpen] = useState(false);
  // (v0.39) Click-outside ref for the mutation popover.
  // (v0.40) Plus a "direction" state: when the trigger sits in the
  // bottom half of the viewport, the dropdown opens UPWARD so it
  // doesn't push Run Dock off-screen and isn't clipped by the right
  // rail's overflow-y-auto. Recomputed every time the popover opens.
  const mutationWrapRef = useRef<HTMLDivElement | null>(null);
  const mutationTriggerRef = useRef<HTMLDivElement | null>(null);
  const [mutationDropdownDir, setMutationDropdownDir] = useState<"up" | "down">("down");
  useEffect(() => {
    if (!mutationDropdownOpen) return;
    // Measure trigger position to pick direction. ~320px is the rough
    // dropdown height (WT + 5 curated rows + Done bar fits in that).
    const rect = mutationTriggerRef.current?.getBoundingClientRect();
    if (rect) {
      const dropdownH = 320;
      const spaceBelow = window.innerHeight - rect.bottom - 16;
      const spaceAbove = rect.top - 16;
      setMutationDropdownDir(
        spaceBelow >= dropdownH || spaceBelow >= spaceAbove ? "down" : "up"
      );
    }
    function onDocMouseDown(e: MouseEvent) {
      if (mutationWrapRef.current && !mutationWrapRef.current.contains(e.target as Node)) {
        setMutationDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [mutationDropdownOpen]);
  // 2D editor theme — Ketcher's bundled build doesn't honor ?theme=dark,
  // so we fake dark mode with the "dark reader" CSS filter trick:
  // invert(1) hue-rotate(180deg) flips the background to black while
  // re-rotating hues so red atoms still look red. This works on any
  // 2D molecular editor (or any web content) without needing the iframe
  // to cooperate. Imperfect on raster images and gradients but Ketcher
  // is line art so the result is clean. 2026-05-05 user fallback.
  //
  // v0.27: editor theme is no longer independent — it derives from the
  // global site theme (`<html>.dark` class, owned by ThemeToggle in the
  // header). One toggle, both flip together. We watch the html class via
  // a MutationObserver so changes from anywhere on the page propagate.
  const [editorTheme, setEditorTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light"
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const obs = new MutationObserver(() => {
      setEditorTheme(root.classList.contains("dark") ? "dark" : "light");
    });
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  const [iframeKey] = useState(0);  // reserved for future remounts
  const darkFilter = "invert(0.92) hue-rotate(180deg) brightness(1.1) contrast(0.95)";

  const { data: catalog } = useQuery({
    queryKey: ["catalog"],
    queryFn: api.catalog,
  });
  const { data: myCompounds } = useQuery({
    queryKey: ["my-compounds"],
    queryFn: api.getMyCompounds,
    staleTime: 60_000,
  });

  /** Load a SMILES into the Ketcher canvas. Used by the compound picker
   *  to start from a known structure (drug or saved library entry).
   *
   *  (v0.68) `opts.stagedId` and `opts.libraryName` opt into "canonical
   *  baseline sync": after Ketcher rewrites the SMILES on load (it
   *  canonicalizes atom ordering, H placement, etc.), we update the
   *  matching compounds[].smiles and/or loadedCompound.smiles to the
   *  rewritten form. Without this, every staged-row click fires the
   *  SAVE EDITS button on load, because compounds[i].smiles holds the
   *  pre-canonical string while currentSmiles holds the post-canonical
   *  one — and the !== check trips falsely. With the sync in place,
   *  the dirty check only fires on REAL user edits in the canvas.
   */
  async function loadIntoCanvas(
    smiles: string,
    opts?: { stagedId?: string; libraryName?: string },
  ) {
    if (!smiles) return;
    const a = getKetcherApi(iframeRef.current);
    if (!a?.setMolecule) {
      setDockError("Editor not ready yet — wait a moment and try again.");
      return;
    }
    try {
      await a.setMolecule(smiles);
      setShowLoader(false);
      // Trigger an immediate poll-style update so currentSmiles refreshes
      setTimeout(async () => {
        try {
          const s = ((await a.getSmiles()) || "").trim();
          setCurrentSmiles(s);
          // (v0.68) Canonical-baseline sync. Treat whatever Ketcher
          // emits on load as the "untouched" state for this load.
          if (s) {
            if (opts?.stagedId) {
              setCompounds((prev) =>
                prev.map((entry) =>
                  entry.id === opts.stagedId ? { ...entry, smiles: s } : entry,
                ),
              );
            }
            if (opts?.libraryName) {
              setLoadedCompound((prev) =>
                prev && prev.name === opts.libraryName
                  ? { name: opts.libraryName, smiles: s }
                  : prev,
              );
            }
          }
        } catch { /* polling will catch it */ }
      }, 100);
    } catch (e: any) {
      setDockError(`Failed to load structure: ${e?.message || e}`);
    }
  }

  // When target or mutation changes, the previous dock result is no
  // longer valid — clear it so the 3D viewer drops back to live-conformer
  // mode and the score/hits/misses don't lie. Without this, switching
  // from EGFR to KRAS leaves the EGFR ribbon + EGFR pose on screen with
  // a stale -6.50 score even though the panel now says KRAS · Q61H.
  // 2026-05-05 user-reported bug.
  // (v0.81) Skip the first run so a session restore (reseed or
  // restoreSession) doesn't wipe the dockResult/Wt that we just
  // initialized from sessionStorage. The deps haven't actually
  // CHANGED on mount — useEffect just always fires the first time —
  // and wiping freshly-restored state was the cause of "Edit & re-dock
  // landed in Studio without docking results".
  const didMountClearRef = useRef(false);
  useEffect(() => {
    if (!didMountClearRef.current) {
      didMountClearRef.current = true;
      return;
    }
    setDockResult(null);
    setDockResultWt(null);
    setDockError(null);
    setMutationOutsidePocketA(null);
  }, [selectedTarget, selectedMutation, includeWt]);


  // Tick clock every second; probe pod health every 30s
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const r = await fetch("https://api.liganx.com/health/full");
        const j = await r.json();
        if (!cancelled) setHealthOk(j?.pod_dock_status === "ok");
      } catch {
        if (!cancelled) setHealthOk(false);
      }
    };
    probe();
    const t = window.setInterval(probe, 30_000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, []);

  // Ketcher init detection
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e?.data?.eventType === "init") setKetcherReady(true);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // (v0.82) BFCache eviction. Chrome's back-forward cache can restore
  // a previously-rendered Studio with all its in-memory state intact
  // even on a fresh address-bar visit, which made the "empty by
  // default" rule look broken to the user. The pageshow event with
  // persisted=true is the standard signal that this happened — we
  // reload so the next render runs through the v0.79-0.82 empty-
  // by-default mount logic. The sessionStorage snapshot survives
  // (v0.81 protects it), so the Resume pill is still available.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // (v0.76) When Studio mounts with a restored session OR a reseed
  // compound, load the active staged compound's SMILES into the
  // Ketcher canvas as soon as the editor is ready. Without this, the
  // canvas stays blank after navigation back from JobPage / Edit &
  // re-dock, even though the staged list and results are restored.
  // One-shot — runs only on the first ketcherReady=true after mount.
  const didMountLoadRef = useRef(false);
  useEffect(() => {
    if (!ketcherReady || didMountLoadRef.current) return;
    didMountLoadRef.current = true;
    // Prefer the reseed compound if present (the user explicitly
    // came back to edit this one). Otherwise the active staged
    // compound from the restored session.
    const reseedSmiles = reseed?.compounds?.[0]?.smiles;
    const reseedName = reseed?.compounds?.[0]?.name;
    if (reseedSmiles) {
      // Pull the staged id of the reseed compound (we either matched
      // by name or appended at the tail in the compounds initializer).
      const stagedId = compounds.find((c) => (c.name || "").toLowerCase() === (reseedName || "").toLowerCase())?.id;
      loadIntoCanvas(reseedSmiles, { stagedId, libraryName: reseedName || undefined });
      return;
    }
    if (compounds.length > 0 && activeCompoundIdx >= 0 && activeCompoundIdx < compounds.length) {
      const c = compounds[activeCompoundIdx];
      loadIntoCanvas(c.smiles, { stagedId: c.id, libraryName: c.name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ketcherReady]);

  // SMILES polling
  useEffect(() => {
    if (!ketcherReady) return;
    let cancelled = false;
    const t = window.setInterval(async () => {
      const a = getKetcherApi(iframeRef.current);
      if (!a?.getSmiles) return;
      try {
        const s: string = await a.getSmiles();
        if (cancelled) return;
        setCurrentSmiles((s || "").trim());
      } catch {
        /* polling errors non-fatal */
      }
    }, 700);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [ketcherReady]);

  // Live validity + SA score for whatever's on the canvas. Both hooks
  // share the same React Query cache key so this is ONE network round-
  // trip per unique SMILES, not two. Updates within ~10ms of the
  // 700ms polling tick — feels live to the user.
  const liveValidity = useSmilesValidity(currentSmiles);
  const liveSaScore = useSmilesSaScore(currentSmiles);

  // (v0.83) Ad-hoc targets — entries the user picked from the RCSB
  // PDB search tier rather than the curated catalog. They look like
  // catalog entries (id / pdb_id / chain / name) but have no curated
  // pocket box or mutation list. The backend's custom-PDB path
  // auto-detects the pocket from the bound ligand or fpocket.
  type AdHocTarget = {
    id: string;          // lowercased PDB id (matches catalog id convention)
    pdb_id: string;      // 4-char PDB id, uppercase
    chain: string;       // defaults to "A"
    name: string;        // RCSB title
    mutations: { code: string; label: string; significance: string }[];
    pocket: null;
    isAdHoc: true;
  };
  const [adHocTargets, setAdHocTargets] = useState<AdHocTarget[]>(
    (initialSession?.adHocTargets as AdHocTarget[] | undefined) ?? [],
  );
  // (v0.83) Merged catalog — curated entries + user-picked PDB hits.
  // Every downstream lookup (target selection, mutation list, pdb id
  // resolution at submit time) reads from this combined view so an
  // ad-hoc target is indistinguishable from a curated one for the
  // rest of the UI.
  const mergedCatalog = useMemo(
    () => [...(catalog || []), ...adHocTargets],
    [catalog, adHocTargets],
  );
  // (v0.83) RCSB search state. Fires on debounce when targetQuery
  // has no catalog match. Cleared on each new keystroke.
  type PdbHit = { id: string; title: string; resolution: number | null; organism: string | null };
  const [pdbResults, setPdbResults] = useState<PdbHit[]>([]);
  const [pdbSearching, setPdbSearching] = useState(false);
  // (v0.85) Per-target UniProt enrichment status. Lets the mutation
  // dropdown show "fetching variants…" / "no clinical variants found"
  // / a chip count, instead of leaving the user staring at "0 curated"
  // with no feedback while the UniProt call is in flight or a request
  // returned an empty/failed result.
  type EnrichStatus = "pending" | "done-empty" | "done" | "failed";
  const [enrichmentStatus, setEnrichmentStatus] = useState<Record<string, EnrichStatus>>({});

  const targetMeta = useMemo(
    () => mergedCatalog.find((t: any) => t.id === selectedTarget),
    [mergedCatalog, selectedTarget]
  );
  const availableMutations = (targetMeta?.mutations ?? []) as { code: string; label: string; significance: string }[];

  // (v0.83) Debounced RCSB full-text search. Only fires when the
  // current targetQuery has no catalog hit (curated + ad-hoc); we
  // don't want to spam the API while the user is typing matches
  // for their existing favorites. Aborts on next keystroke.
  useEffect(() => {
    if (!targetQuery || targetQuery.length < 3) {
      setPdbResults([]);
      setPdbSearching(false);
      return;
    }
    const q = targetQuery.toLowerCase();
    const hasLocalMatch = mergedCatalog.some((t: any) =>
      t.id.toLowerCase().includes(q) || (t.name || "").toLowerCase().includes(q),
    );
    if (hasLocalMatch) {
      setPdbResults([]);
      setPdbSearching(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setPdbSearching(true);
      try {
        // RCSB full-text search → entry IDs. POST JSON body, top 8
        // hits sorted by relevance score.
        const searchRes = await fetch("https://search.rcsb.org/rcsbsearch/v2/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            query: {
              type: "terminal",
              service: "full_text",
              parameters: { value: targetQuery },
            },
            return_type: "entry",
            request_options: {
              paginate: { start: 0, rows: 8 },
              sort: [{ sort_by: "score", direction: "desc" }],
            },
          }),
        });
        if (!searchRes.ok) { setPdbResults([]); return; }
        const searchData = await searchRes.json();
        const hits: { identifier: string }[] = searchData?.result_set ?? [];
        if (hits.length === 0) { setPdbResults([]); return; }
        // Fetch metadata for each hit in parallel — short title,
        // resolution, source organism — so the chip is informative.
        const metaResults = await Promise.allSettled(
          hits.map((h) =>
            fetch(`https://data.rcsb.org/rest/v1/core/entry/${h.identifier}`, { signal: ctrl.signal })
              .then((r) => (r.ok ? r.json() : null)),
          ),
        );
        const enriched: PdbHit[] = hits.map((h, i) => {
          const m = metaResults[i].status === "fulfilled" ? (metaResults[i] as PromiseFulfilledResult<any>).value : null;
          return {
            id: h.identifier,
            title: m?.struct?.title || "",
            resolution: m?.rcsb_entry_info?.resolution_combined?.[0] ?? null,
            organism: m?.rcsb_entry_container_identifiers?.entity_source_organism_scientific_name?.[0]
              ?? m?.rcsb_entity_source_organism?.[0]?.ncbi_scientific_name
              ?? null,
          };
        }).filter((r) => r.title);
        if (!ctrl.signal.aborted) setPdbResults(enriched);
      } catch {
        // AbortError or network — silent. Catalog still works.
      } finally {
        if (!ctrl.signal.aborted) setPdbSearching(false);
      }
    }, 400);
    return () => { window.clearTimeout(timer); ctrl.abort(); };
  }, [targetQuery, mergedCatalog]);

  // (v0.85) Auto-fire enrichment for any ad-hoc target that hasn't
  // been enriched yet — this catches the session-restore case
  // (target restored from sessionStorage with empty mutations and no
  // status). Each lookup runs once per (target id, mutations.length=0)
  // pair to avoid retry loops; manual retry happens via the dropdown
  // status pill.
  useEffect(() => {
    for (const t of adHocTargets) {
      if (t.mutations.length > 0) continue;
      if (enrichmentStatus[t.id]) continue; // already pending/done/failed
      enrichWithUniProtVariants(t.id, t.pdb_id).catch(() => { /* status handled inside */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adHocTargets]);

  // (v0.83) Pick an RCSB hit → register it as an ad-hoc target and
  // add it to the selected suite. Subsequent lookups treat it like
  // any catalog entry.
  // (v0.84) After registering, fire-and-forget UniProt enrichment to
  // auto-populate clinically relevant mutation chips. Two-step: RCSB
  // GraphQL → UniProt accession, then UniProt REST → variant features.
  // Failures are silent (catalog mutations stay empty; user can still
  // type custom codes).
  function pickPdbResult(r: PdbHit) {
    const adHoc: AdHocTarget = {
      id: r.id.toLowerCase(),
      pdb_id: r.id,
      chain: "A",
      name: r.title || r.id,
      mutations: [],
      pocket: null,
      isAdHoc: true,
    };
    setAdHocTargets((prev) => prev.some((p) => p.id === adHoc.id) ? prev : [...prev, adHoc]);
    setSelectedTargets((prev) => {
      if (prev.includes(adHoc.id)) return prev;
      if (prev.length >= MAX_TARGETS) return prev;
      if (prev.length === 0) setSelectedMutations([]);
      return [...prev, adHoc.id];
    });
    setTargetQuery("");
    setPdbResults([]);
    // Async: enrich with UniProt variants. Don't await — the target
    // is already usable; chips just appear when the lookup returns.
    enrichWithUniProtVariants(adHoc.id, r.id).catch(() => { /* silent */ });
  }

  // (v0.84) Walk RCSB → UniProt → mutation list. Run in the background
  // after pickPdbResult so the user can immediately work with WT while
  // the chips populate. Mutations are merged into the already-registered
  // ad-hoc target via a setAdHocTargets update.
  // (v0.85) Status is published into enrichmentStatus so the mutation
  // dropdown can render an honest "fetching…" / "none found" / count.
  async function enrichWithUniProtVariants(targetId: string, pdbId: string): Promise<void> {
    setEnrichmentStatus((prev) => ({ ...prev, [targetId]: "pending" }));
    try {
      await enrichWithUniProtVariantsInner(targetId, pdbId);
    } catch {
      setEnrichmentStatus((prev) => ({ ...prev, [targetId]: "failed" }));
    }
  }
  async function enrichWithUniProtVariantsInner(targetId: string, pdbId: string): Promise<void> {
    // Step 1: get UniProt accession for the first polymer entity via
    // RCSB's GraphQL endpoint. One round trip, no need to enumerate
    // entity ids beforehand.
    const gqlRes = await fetch("https://data.rcsb.org/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query GetUniProt($id: String!) {
          entry(entry_id: $id) {
            polymer_entities {
              rcsb_polymer_entity_container_identifiers {
                reference_sequence_identifiers {
                  database_accession
                  database_name
                }
              }
            }
          }
        }`,
        variables: { id: pdbId },
      }),
    });
    if (!gqlRes.ok) {
      setEnrichmentStatus((prev) => ({ ...prev, [targetId]: "failed" }));
      return;
    }
    const gqlData = await gqlRes.json();
    const entities: any[] = gqlData?.data?.entry?.polymer_entities ?? [];
    let uniprotAcc: string | null = null;
    for (const e of entities) {
      const refs: any[] = e?.rcsb_polymer_entity_container_identifiers?.reference_sequence_identifiers ?? [];
      const hit = refs.find((x) => (x?.database_name || "").toUpperCase() === "UNIPROT");
      if (hit?.database_accession) { uniprotAcc = hit.database_accession; break; }
    }
    if (!uniprotAcc) {
      setEnrichmentStatus((prev) => ({ ...prev, [targetId]: "failed" }));
      return;
    }

    // Step 2: fetch UniProt entry, extract Natural variant features.
    // We filter to variants that have any disease/cancer/clinical
    // significance annotation in the description so the user gets
    // a focused chip set (P53 has hundreds of raw variants; only the
    // pathogenic ones are useful as docking inputs).
    const upRes = await fetch(`https://rest.uniprot.org/uniprotkb/${uniprotAcc}.json?fields=features`);
    if (!upRes.ok) {
      setEnrichmentStatus((prev) => ({ ...prev, [targetId]: "failed" }));
      return;
    }
    const upData = await upRes.json();
    const features: any[] = upData?.features ?? [];
    const variants = features.filter((f) => {
      if (f?.type !== "Variant" && f?.type !== "Natural variant") return false;
      const desc = String(f?.description || "").toLowerCase();
      // Heuristic clinical filter — keeps the chip count tractable.
      return /carcinoma|cancer|tumor|tumour|leukemia|lymphoma|melanoma|sarcoma|neoplas|adenocarcinoma|disease|pathogen|resistance|somatic|gain[- ]of[- ]function|loss[- ]of[- ]function/i.test(desc);
    });

    type ChipShape = { code: string; label: string; significance: string };
    const chips: ChipShape[] = [];
    const seen = new Set<string>();
    for (const v of variants) {
      const orig = v?.alternativeSequence?.originalSequence
                ?? v?.location?.start?.modifier === "EXACT" ? v?.location?.start?.value : null;
      const start = v?.location?.start?.value;
      const altList: string[] = v?.alternativeSequence?.alternativeSequences || [];
      if (!start || altList.length === 0) continue;
      const wt = (typeof orig === "string" && orig.length === 1) ? orig : "";
      for (const alt of altList) {
        if (!alt || alt.length !== 1) continue;
        const code = `${wt}${start}${alt}`;
        if (seen.has(code)) continue;
        seen.add(code);
        // Trim long descriptions; keep the first clause.
        const rawDesc = String(v?.description || "");
        const label = rawDesc.length > 80 ? rawDesc.slice(0, 77) + "…" : rawDesc;
        chips.push({ code, label, significance: "uniprot" });
      }
      if (chips.length >= 30) break; // hard cap on chip count
    }
    if (chips.length === 0) {
      setEnrichmentStatus((prev) => ({ ...prev, [targetId]: "done-empty" }));
      return;
    }
    setAdHocTargets((prev) =>
      prev.map((t) => (t.id === targetId ? { ...t, mutations: chips } : t)),
    );
    setEnrichmentStatus((prev) => ({ ...prev, [targetId]: "done" }));
  }

  // Compute mutation-residue-to-pocket-center distance after a dock
  // completes. Same semantic as JobPage's outsidePocketA: when a
  // mutation sits far from the docking box, Vina can't capture
  // geometric effects of that mutation, so the WT-vs-mutant Δ is
  // unreliable. This is the badge JobPage shows as "◌ outside pocket".
  useEffect(() => {
    if (!dockResult || !selectedMutation || !targetMeta?.pocket?.center) {
      setMutationOutsidePocketA(null);
      return;
    }
    const resi = parseMutationResidue(selectedMutation);
    if (resi == null) { setMutationOutsidePocketA(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `https://api.liganx.com/structures/${dockResult.pdb_id || targetMeta.pdb_id}/${dockResult.chain || targetMeta.chain || "A"}/WT`
        );
        if (!r.ok) return;
        const pdb = await r.text();
        if (cancelled) return;
        const ca = parseCaCoords(pdb, resi, targetMeta.chain || "A");
        if (!ca) return;
        const center = targetMeta.pocket.center as [number, number, number];
        const dist = distance3D(ca, center);
        if (!cancelled) setMutationOutsidePocketA(dist);
      } catch { /* defensive */ }
    })();
    return () => { cancelled = true; };
  }, [dockResult, selectedMutation, targetMeta]);

  // (v0.56) runQuickDock is retained but no longer wired to the UI —
  // Quick Dock was hidden in favour of Full Job as the sole entry
  // point. Kept in the file so re-enabling is a one-line button add.
  // The void-reference at the bottom of the function keeps TS's
  // noUnusedLocals quiet without disabling the rule globally.
  async function runQuickDock(): Promise<void> {
    if (!currentSmiles) { setDockError("Canvas is empty — sketch a structure first."); return; }
    if (!selectedTarget) { setDockError("Pick a target."); return; }
    setDocking(true);
    setDockError(null);
    setDockResult(null);
    setDockResultWt(null);

    // Decide what to dock based on the chip selection:
    //   - includeWt + mutation → two parallel docks (mutant + WT)
    //   - includeWt only → WT dock only
    //   - mutation only → mutant dock only
    //   - neither → guarded earlier (Run Dock disabled)
    const wantMutant = !!selectedMutation;
    const wantWt = includeWt;
    if (!wantMutant && !wantWt) {
      setDockError("Pick WT or a mutation in the Mutations section.");
      setDocking(false);
      return;
    }
    const baseArgs = {
      smiles: currentSmiles,
      target_pdb: selectedTarget,
      chain: targetMeta?.chain || "A",
    };

    try {
      const tasks: Promise<{ kind: "mut" | "wt"; res: QuickDockResult }>[] = [];
      if (wantMutant) {
        tasks.push(
          api.assistQuickDock({ ...baseArgs, mutation: selectedMutation })
            .then((res) => ({ kind: "mut" as const, res: res as QuickDockResult }))
        );
      }
      if (wantWt) {
        tasks.push(
          api.assistQuickDock({ ...baseArgs, mutation: undefined })
            .then((res) => ({ kind: "wt" as const, res: res as QuickDockResult }))
        );
      }
      const settled = await Promise.allSettled(tasks);
      let firstError: string | null = null;
      for (const s of settled) {
        if (s.status === "fulfilled") {
          const { kind, res } = s.value;
          if (!res.ok) {
            if (!firstError) firstError = res.error || "Dock failed.";
            continue;
          }
          if (kind === "mut") setDockResult(res);
          else if (wantMutant) setDockResultWt(res);
          else setDockResult(res);  // WT-only run uses the primary slot
          // (v0.35) Log every successful run into the session dock
          // history so the user can flick through results without
          // re-docking. Mutant + WT both get their own row when both
          // are run.
          appendDockHistory({
            smiles: currentSmiles,
            compoundName: loadedCompound?.name,
            target: selectedTarget,
            mutation: kind === "mut" ? (selectedMutation || "") : "WT",
            score: res.score ?? null,
            hits: res.hits || [],
            poseInPocket: res.pose_in_pocket,
            kdLabel: res.score != null ? fmtScoreKd(res.score) : undefined,
          });
        } else if (!firstError) {
          firstError = (s.reason as Error)?.message || "Dock failed.";
        }
      }
      if (firstError && !dockResult && !dockResultWt) setDockError(firstError);
    } catch (e: any) {
      setDockError(e?.message || "Dock failed.");
    } finally {
      setDocking(false);
    }
  }

  // (v0.44) Full Job submission — same /jobs endpoint NewJobPage uses.
  // Async by design: backend queues the run, returns a job id, the
  // user lands on /jobs/{id} where the existing JobPage shows live
  // progress (build mutant → fix structure → dock each compound) and
  // the persistent results page once it's done. ~3 minutes typical for
  // 1 compound × 1 mutation, no scaffold flexibility cap, full
  // exhaustiveness controls. Studio's role here is just "compose the
  // payload and hand off"; the heavy lifting lives in JobPage.
  const [submittingFull, setSubmittingFull] = useState(false);
  // (v0.47) Full Job state — kept in Studio so the user can stay in
  // the cockpit instead of being thrown to /jobs/{id}. Once submitted,
  // we poll /jobs/{key} every 3s, surface the runner stage in the
  // score panel header, and populate dockResult/dockResultWt when the
  // job completes. A "view full results page" link in the header
  // gets the user to JobPage when they want the deeper UI.
  const [fullJobKey, setFullJobKey] = useState<string | null>(initialSession?.fullJobKey ?? null);
  const [fullJobStatus, setFullJobStatus] = useState<"pending" | "running" | "completed" | "failed" | "cancelled" | null>(
    initialSession?.fullJobStatus ?? null,
  );
  const [fullJobStage, setFullJobStage] = useState<string | null>(initialSession?.fullJobStage ?? null);
  // (v0.77) Wall-clock start time for the prominent in-flight banner's
  // elapsed counter. Set on submit, cleared on completion/failure.
  // Not persisted across navigation — if the user comes back mid-run,
  // we just don't show the elapsed time (the banner still pulses).
  const [dockStartedAt, setDockStartedAt] = useState<number | null>(null);
  // (v0.71) Multi-compound result table. job.results contains one row
  // per (compound, variant) pair — for a 7-compound run with WT, that's
  // 14 rows. The legacy dockResult / dockResultWt slots can only hold
  // ONE compound's result, so the per-row loop in the polling handler
  // would overwrite all of them and the user only saw the last one.
  // This array preserves every row; the score panel renders a table
  // and clicking a row promotes that compound into dockResult/Wt so
  // the existing 3D viewer machinery shows that pose.
  type FullJobRow = {
    compoundId: number;
    name: string;
    smiles: string;
    mutantScore: number | null;
    wtScore: number | null;
    mutantPoseB64?: string;
    wtPoseB64?: string;
  };
  const [fullJobRows, setFullJobRows] = useState<FullJobRow[]>(
    initialSession?.fullJobRows ? (initialSession.fullJobRows as FullJobRow[]) : [],
  );
  // Which row is currently shown in the 3D viewer + score panel
  // (defaults to the strongest mutant once results land).
  const [selectedRowCompoundId, setSelectedRowCompoundId] = useState<number | null>(
    initialSession?.selectedRowCompoundId ?? null,
  );
  // (v0.73) Setup section (Target / Mutation / Compound) collapse state.
  // Pre-dock, the user is configuring — selectors stay open. Post-dock,
  // the user is inspecting — selectors auto-collapse to a one-line
  // summary so the SCORE + per-compound results table take the visual
  // focus. A header toggle re-opens the selectors when the user wants
  // to tweak and re-run.
  // (v0.76) Even when the user lands via Edit & re-dock, the prior
  // collapsed-setup state is preserved — they came back to inspect/iterate
  // on results, so keep the results-focused layout. They can ▾ setup to
  // open if they want to tweak inputs.
  const [setupCollapsed, setSetupCollapsed] = useState(initialSession?.setupCollapsed ?? false);
  useEffect(() => {
    if (fullJobStatus === "completed" && fullJobRows.length > 0) {
      setSetupCollapsed(true);
    }
  }, [fullJobStatus, fullJobRows.length]);

  // (v0.75) Continuous session snapshot. Mirrors the slice of state that
  // makes Studio "the place I left it" into sessionStorage, so the user
  // can click view ↗, land on /jobs, click Back to Studio, and find the
  // workspace exactly as it was. Debounced so we don't thrash on every
  // SMILES keystroke.
  // (v0.81) Only persist when the user actually has something worth
  // restoring. After v0.79-0.80, a fresh visit to /studio renders an
  // empty cockpit by design — but the autosave effect was eagerly
  // writing that empty state, which clobbered the prior snapshot.
  // Net effect: Edit & re-dock from JobPage restored an empty session
  // because the autosave had just wiped the docking results out of
  // sessionStorage. Skip writes when there's nothing meaningful in
  // state; the prior snapshot stays intact until the user does
  // something worth persisting.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const hasMeaningfulState =
        compounds.length > 0 ||
        !!fullJobKey ||
        fullJobRows.length > 0 ||
        !!dockResult ||
        !!dockResultWt ||
        currentSmiles.length > 0 ||
        selectedTargets.length > 0;
      if (!hasMeaningfulState) return;
      const snap: StudioSessionSnapshot = {
        v: 1,
        savedAt: Date.now(),
        selectedTargets,
        selectedMutations,
        includeWt,
        adHocTargets,
        compounds,
        activeCompoundIdx,
        currentSmiles,
        fullJobKey,
        fullJobStatus,
        fullJobStage,
        fullJobRows,
        selectedRowCompoundId,
        dockResult,
        dockResultWt,
        setupCollapsed,
        loadedCompound,
      };
      writeStudioSession(snap);
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    selectedTargets, selectedMutations, includeWt, adHocTargets,
    compounds, activeCompoundIdx, currentSmiles,
    fullJobKey, fullJobStatus, fullJobStage,
    fullJobRows, selectedRowCompoundId,
    dockResult, dockResultWt,
    setupCollapsed, loadedCompound,
  ]);
  // Map a runner stage slug to a human label for the progress strip.
  // Mirrors the labels JobPage uses, condensed for one-line display.
  const fullJobStageLabel = (slug: string | null | undefined): string => {
    if (!slug) return "queued";
    if (slug === "fetching_pdb") return "fetching structure";
    if (slug === "cleaning_pdb") return "cleaning with PDBFixer";
    if (slug === "preparing_receptor") return "preparing receptor";
    if (slug.startsWith("building_mutant_")) return `building mutant (${slug.slice("building_mutant_".length)})`;
    if (slug === "preparing_compounds") return "preparing compound";
    if (slug === "extracting_sequence") return "extracting sequence";
    if (slug.startsWith("predicting_")) return `predicting ${slug.slice("predicting_".length)}`;
    if (slug.startsWith("docking_")) return `docking ${slug.slice("docking_".length)}`;
    if (slug === "validating_poses") return "validating poses";
    return slug.replaceAll("_", " ");
  };
  // (v0.56) Reference runQuickDock so TS noUnusedLocals doesn't fire
  // on the dead-but-retained function. void operator returns
  // undefined, so this is zero-cost at runtime.
  void runQuickDock;
  async function runFullJob() {
    // (v0.62-0.64) Build the compound list. If the user has staged
    // compounds, use those; otherwise fall back to currentSmiles
    // (the singleton path). Filter out empties.
    const compoundList: { name?: string | null; smiles: string }[] = compounds.length > 0
      ? compounds.filter((c) => c.smiles).map((c) => ({ name: c.name || null, smiles: c.smiles }))
      : currentSmiles
      ? [{ name: loadedCompound?.name || activeDraft?.name || "Studio compound", smiles: currentSmiles }]
      : [];
    if (compoundList.length === 0) { setDockError("Canvas is empty — sketch a structure first."); return; }
    if (selectedTargets.length === 0) { setDockError("Pick a target."); return; }
    setDockError(null);
    setSubmittingFull(true);
    try {
      // (v0.62-0.64) One Full Job per target. Backend /jobs accepts
      // multiple compounds + multiple mutations per job, but only
      // ONE pdb_id, so we fan out across selected targets in parallel
      // and use the first job's share_id for the in-Studio polling
      // (and link the user to /history for the rest). For 1 target,
      // this is a single createJob call (no behavior change).
      const tasks: Promise<{ tid: string; job: Job; pdbId: string }>[] = selectedTargets.map(async (tid) => {
        // (v0.83) mergedCatalog also covers ad-hoc PDB-search picks,
        // so this lookup resolves both curated targets and user-
        // searched ones via the same code path.
        const tMeta = mergedCatalog.find((c: any) => c.id === tid) as any;
        const tPdb = (tMeta?.pdb_id || "").trim();
        if (!tPdb) throw new Error(`Couldn't resolve a PDB id for target "${tid}".`);
        const job = await api.createJob({
          pdb_id: tPdb,
          chain: tMeta?.chain || "A",
          uniprot_id: tMeta?.uniprot,
          mutations: selectedMutations,
          compounds: compoundList,
          include_wt: includeWt,
          title: `Studio · ${tid.toUpperCase()}${selectedMutations.length > 0 ? ` · ${selectedMutations.join("+")}` : ""}${compoundList.length > 1 ? ` · ${compoundList.length} compounds` : ""}`,
        });
        return { tid, job, pdbId: tPdb };
      });
      const results = await Promise.allSettled(tasks);
      // First successful job drives Studio's in-page polling; any
      // others are submitted but the user views them via /history.
      let primary: { tid: string; job: Job } | null = null;
      let firstError: string | null = null;
      for (const r of results) {
        if (r.status === "fulfilled" && !primary) primary = r.value;
        else if (r.status === "rejected" && !firstError) firstError = (r.reason as Error)?.message || "Submit failed";
      }
      if (!primary) { setDockError(firstError || "All Full Job submissions failed."); return; }
      const jobKey = (primary.job as any).share_id ?? String((primary.job as any).id ?? "");
      if (!jobKey) {
        setDockError("Job created but no id returned — refresh /history to find it.");
        return;
      }
      setDockResult(null);
      setDockResultWt(null);
      setFullJobRows([]);
      setSelectedRowCompoundId(null);
      setFullJobKey(jobKey);
      setFullJobStatus(primary.job.status || "pending");
      setFullJobStage(primary.job.stage || null);
      // (v0.77) Stamp the docking start time so the prominent banner
      // can render an elapsed counter ("⏱ 0:42 elapsed · ~3 min typical").
      setDockStartedAt(Date.now());
      if (results.length > 1) {
        setPromoteToast(`✓ ${results.filter(r => r.status === "fulfilled").length}/${results.length} jobs submitted — polling first; check /history for the rest`);
        window.setTimeout(() => setPromoteToast(null), 6000);
      }
    } catch (e: any) {
      setDockError(e?.message || "Full Job submission failed.");
    } finally {
      setSubmittingFull(false);
    }
  }

  // (v0.47) Polling loop for in-flight Full Jobs. Fires every 3 s
  // while fullJobKey is set and status is pending/running. On
  // completion, fans the DockingResult rows out into dockResult /
  // dockResultWt so the existing TELEMETRY panel + 3D viewer light
  // up exactly the same way they do for Quick Dock. On failure,
  // surfaces error_message in dockError. Stops polling either way.
  useEffect(() => {
    if (!fullJobKey) return;
    if (fullJobStatus === "completed" || fullJobStatus === "failed" || fullJobStatus === "cancelled") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const job = await api.getJob(fullJobKey);
        if (cancelled) return;
        // (v0.74) Race fix: when the job has just completed, we must
        // FIRST build + commit fullJobRows, THEN flip fullJobStatus
        // to "completed". Reason: fullJobStatus is in this effect's
        // dep array, so flipping it triggers the cleanup (cancelled
        // = true), which races against the awaits in the pose fetch
        // loop below — every result-population tick was being
        // aborted before setFullJobRows ran. Pending/running/failed
        // paths keep the original "set status first" order since
        // they don't depend on async pose fetches.
        if (job.status === "completed") {
          // (v0.71) Group all DockingResult rows by compound_id and
          // collect one fullJobRows entry per compound — with both
          // mutant and (optional) WT scores side-by-side. The legacy
          // dockResult/Wt slots get filled from the strongest mutant
          // by default so the 3D viewer + score panel light up the
          // way they always have for the single-compound case.
          const byCompound = new Map<number, FullJobRow>();
          // Seed each row with name/smiles from job.compounds so the
          // table shows a friendly label ("Aspirin", "compound #3") even
          // before any pose fetches finish.
          for (const c of (job.compounds || [])) {
            byCompound.set(c.id, {
              compoundId: c.id,
              name: c.name || `compound #${c.id}`,
              smiles: c.smiles,
              mutantScore: null,
              wtScore: null,
            });
          }
          for (const r of (job.results || [])) {
            const isWt = (r.variant || "").toUpperCase() === "WT";
            // Pose fetch is best-effort — if it fails the score still
            // renders, the row is just non-interactive in 3D.
            let posePdbqtB64: string | undefined;
            try {
              const text = await api.pose(fullJobKey, r.compound_id, r.variant);
              posePdbqtB64 = btoa(unescape(encodeURIComponent(text)));
            } catch { /* non-critical */ }
            const row = byCompound.get(r.compound_id) || {
              compoundId: r.compound_id,
              name: `compound #${r.compound_id}`,
              smiles: "",
              mutantScore: null,
              wtScore: null,
            };
            if (isWt) {
              row.wtScore = r.best_score;
              row.wtPoseB64 = posePdbqtB64;
            } else {
              row.mutantScore = r.best_score;
              row.mutantPoseB64 = posePdbqtB64;
            }
            byCompound.set(r.compound_id, row);
          }
          const rows = Array.from(byCompound.values()).filter(
            (r) => r.mutantScore != null || r.wtScore != null,
          );
          // Strongest mutant first, fall back to strongest WT for
          // WT-only runs. Ties broken by compound order.
          rows.sort((a, b) => {
            const aS = a.mutantScore ?? a.wtScore ?? Infinity;
            const bS = b.mutantScore ?? b.wtScore ?? Infinity;
            return aS - bS;
          });
          if (cancelled) return;
          setFullJobRows(rows);
          // Promote the best row into the legacy dockResult/Wt slots
          // so the 3D viewer + score-vs panel render exactly as they
          // did for single-compound runs. The user can click a row in
          // the table to switch which compound's pose is on display.
          if (rows.length > 0) {
            const best = rows[0];
            setSelectedRowCompoundId(best.compoundId);
            const mut: QuickDockResult | null = best.mutantScore != null ? {
              ok: true,
              score: best.mutantScore,
              hits: [],
              misses: [],
              pose_pdbqt_b64: best.mutantPoseB64,
              pdb_id: job.pdb_id,
              chain: job.chain,
              receptor_variant: "mutant",
            } : null;
            const wt: QuickDockResult | null = best.wtScore != null ? {
              ok: true,
              score: best.wtScore,
              hits: [],
              misses: [],
              pose_pdbqt_b64: best.wtPoseB64,
              pdb_id: job.pdb_id,
              chain: job.chain,
              receptor_variant: "wt",
            } : null;
            // Single-target rule: mut → primary slot if any, else WT
            // takes the primary slot; mirror the prior semantics.
            if (mut) { setDockResult(mut); setDockResultWt(wt); }
            else { setDockResult(wt); setDockResultWt(null); }
          }
          // (v0.74) Now safe to flip status — rows are in state, the
          // cleanup-on-status-change race no longer drops results.
          setFullJobStatus(job.status);
          setFullJobStage(job.stage || null);
          setDockStartedAt(null);
        } else if (job.status === "failed") {
          setDockError(job.error_message || "Full Job failed (no message).");
          setFullJobStatus(job.status);
          setFullJobStage(job.stage || null);
          setDockStartedAt(null);
        } else {
          // pending / running — fast path, just publish progress
          setFullJobStatus(job.status);
          setFullJobStage(job.stage || null);
        }
      } catch {
        // Transient network errors — keep polling.
      }
    };
    // Fire immediately so the user sees the pending → running flip
    // without a 3 s delay, then settle into the 3 s cadence.
    tick();
    const t = window.setInterval(tick, 3000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [fullJobKey, fullJobStatus]);

  // Centralised tokens — change here, propagates everywhere
  const TOK = {
    label: "text-[10px] uppercase tracking-[0.18em] text-slate-500",
    valueLg: "font-mono text-3xl tabular-nums",
    cyan: "text-cyan-300",
    amber: "text-amber-300",
    rose: "text-rose-300",
    emerald: "text-emerald-300",
    dim: "text-slate-500",
  };

  const statusDot = (ok: boolean | null) => {
    if (ok === true) return <span className="text-emerald-400">●</span>;
    if (ok === false) return <span className="text-rose-400">●</span>;
    return <span className="text-slate-600">○</span>;
  };

  return (
    <div className="min-h-screen bg-[#070b15] text-slate-200 select-none">
      {/* ═══ STATUS BAR ═══ */}
      <header className="sticky top-0 z-30 bg-[#0d1422] border-b border-slate-800/70 px-4 py-2">
        <div className="flex items-center gap-6 text-[11px] tracking-wide">
          <div className="flex items-center gap-2">
            <span className="text-cyan-400 text-base leading-none">⦿</span>
            <span className="font-semibold tracking-[0.18em] uppercase">Studio</span>
            <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-cyan-900/40 text-cyan-300 border border-cyan-800/50">v0.1·BETA</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={TOK.label}>Target</span>
            <span className="font-mono uppercase tracking-wider">
              {targetMeta?.id?.toUpperCase() || "—"}
              {selectedMutation && <span className="text-cyan-300"> · {selectedMutation}</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">{statusDot(ketcherReady)} <span className={TOK.label}>Editor</span></div>
          <div className="flex items-center gap-2">{statusDot(healthOk)} <span className={TOK.label}>Pod</span></div>
          <div className="ml-auto flex items-center gap-4">
            {/* (v0.79-0.80) Resume-previous-session pill. Now the
                only recovery path for refresh + direct URL visits, so
                bumped in size + cyan glow + emoji to make it the
                obvious thing to click when returning to a session.
                Hidden as soon as the user starts working in the fresh
                cockpit (compounds added or job submitted). */}
            {pendingSnapshot && compounds.length === 0 && !fullJobKey && (pendingSnapshot.compounds.length > 0 || pendingSnapshot.fullJobRows.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  // Re-enter via React Router with restoreSession set;
                  // the next mount will rehydrate from sessionStorage.
                  // window.location.reload() preserves the history
                  // state set by navigate(), so on the next render
                  // location.state.restoreSession is true and
                  // shouldRestoreSession evaluates true.
                  navigate("/studio", { state: { restoreSession: true } });
                  window.location.reload();
                }}
                className="px-3 py-1 rounded border-2 border-cyan-500/70 bg-cyan-900/40 text-cyan-100 hover:bg-cyan-800/60 hover:border-cyan-400 text-[11px] font-mono uppercase tracking-wider shadow-[0_0_12px_rgba(34,211,238,0.25)] transition-all"
                title={`Bring back your last session: ${pendingSnapshot.compounds.length} compound${pendingSnapshot.compounds.length === 1 ? "" : "s"}${pendingSnapshot.selectedTargets.length ? ` · ${pendingSnapshot.selectedTargets.join(", ").toUpperCase()}` : ""}${pendingSnapshot.fullJobRows.length > 0 ? ` · ${pendingSnapshot.fullJobRows.length} dock results` : ""}`}
              >
                ↻ Resume last session
              </button>
            )}
            {/* (v0.30) Autosave indicator. Subtle on purpose — green
                check + relative time — so it's reassuring without being
                a UI element the user has to think about. Hidden until
                the first save lands. */}
            {lastSavedAt && (
              <span
                className="font-mono text-[10px] text-emerald-500/80"
                title={activeDraft?.name ? `Saved as draft: ${activeDraft.name}` : "Auto-saved as a draft"}
              >
                ✓ saved {fmtSavedAgo(now.getTime(), lastSavedAt)}
              </span>
            )}
            <span className={TOK.label}>SMILES</span>
            <span className="font-mono text-[10px] text-slate-400 max-w-[40ch] truncate" title={currentSmiles}>
              {currentSmiles || <span className="italic text-slate-600">empty</span>}
            </span>
            <span className="font-mono text-[10px] text-slate-500">{fmtClock(now)}</span>
          </div>
        </div>
      </header>

      {/* (v0.77) Prominent docking-in-progress banner. Renders only when
          a Full Job is in flight. Big, animated, full-width — sits flush
          under the sticky header so it's always in view, even when the
          user has scrolled the right rail or is looking at the 2D editor.
          Three layered cues:
            1. The pulsing emerald dot + bold uppercase "DOCKING" text —
               primary attention-grabber.
            2. Stage label + compound count + elapsed time — gives the
               user concrete progress info, not just "something happening".
            3. A shimmering gradient stripe across the bottom edge —
               continuous motion confirms the system is alive even when
               the stage label hasn't changed in 30 s. */}
      {(submittingFull || (!!fullJobKey && fullJobStatus !== "completed" && fullJobStatus !== "failed" && fullJobStatus !== "cancelled")) && (
        <div className="sticky top-[42px] z-20 bg-gradient-to-r from-emerald-950/90 via-emerald-900/80 to-emerald-950/90 border-b-2 border-emerald-500/60 shadow-lg shadow-emerald-900/40 backdrop-blur-sm">
          {/* Animated shimmer stripe — runs left-to-right continuously
              so the eye registers motion even when no other UI changes. */}
          <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
            <div
              className="h-full w-1/3 bg-gradient-to-r from-transparent via-emerald-300 to-transparent"
              style={{ animation: "studio-dock-shimmer 2s linear infinite" }}
            />
          </div>
          <style>{`
            @keyframes studio-dock-shimmer {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(400%); }
            }
            @keyframes studio-dock-pulse-ring {
              0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
              50% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
            }
          `}</style>
          <div className="px-4 py-2 flex items-center gap-4 font-mono">
            {/* Pulsing emerald orb. Two animations stacked — the inner
                dot scales, the outer ring expands & fades. Reads as
                "live signal" the way an ECG monitor does. */}
            <div className="relative shrink-0">
              <span className="block w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
              <span
                className="absolute inset-0 rounded-full"
                style={{ animation: "studio-dock-pulse-ring 1.6s ease-out infinite" }}
              />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-emerald-100 font-bold uppercase tracking-[0.18em] text-sm">
                Docking in progress
              </span>
              <span className="text-emerald-300 text-[11px]">
                {compounds.length > 0 && (<>· {compounds.length} compound{compounds.length === 1 ? "" : "s"}</>)}
                {selectedTargets.length > 0 && (<> · {selectedTargets.map(t => t.toUpperCase()).join(" + ")}</>)}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-4 text-[11px]">
              <span className="text-emerald-200">
                {submittingFull ? "▸ submitting to queue…"
                  : fullJobStatus === "pending" ? "▸ queued · waiting for runner"
                  : `▸ ${fullJobStageLabel(fullJobStage)}`}
              </span>
              {dockStartedAt && (() => {
                const sec = Math.max(0, Math.floor((now.getTime() - dockStartedAt) / 1000));
                const m = Math.floor(sec / 60);
                const s = sec % 60;
                return (
                  <span className="text-emerald-300/80 tabular-nums">
                    ⏱ {m}:{s.toString().padStart(2, "0")} <span className="text-emerald-400/50 text-[10px]">/ ~3 min typical</span>
                  </span>
                );
              })()}
              {fullJobKey && (
                <a href={`/jobs/${fullJobKey}?from=studio`} target="_blank" rel="noreferrer"
                   className="px-2 py-0.5 rounded border border-cyan-500/60 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/60 hover:border-cyan-400 text-[10px] uppercase tracking-wider"
                   title="Open the persistent results page in a new tab — full progress UI, runner logs, build steps.">
                  open ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ MAIN GRID ═══ */}
      <main className="grid grid-cols-12 gap-3 p-3" style={{ height: "calc(100vh - 88px)" }}>
        {/* LEFT — 2D Canvas */}
        <section className="col-span-7 bg-[#0d1422] border border-slate-800/70 rounded flex flex-col overflow-hidden relative">
          {/* (v0.64) Compound rail above the 2D editor was removed —
              the staged compound list now lives in the right-rail
              COMPOUND section below the search trigger, matching the
              user's mental model of 'open compound section → search
              and pick multiple → see them listed there'. The 2D
              editor still allows custom sketching and an inline
              '+ Add sketch to suite' button below. */}
          <div className="px-3 py-1.5 border-b border-slate-800/70 flex items-center justify-between text-[10px] gap-3">
            <div className="flex items-center gap-3">
              <span className={TOK.label}>2D · Ketcher</span>
              {/* Live SMILES validity + SA score pills — update every
                  ~700ms via the polling tick + shared inspect-smiles
                  cache. Same hooks the original editor uses. */}
              <ValidityPill validity={liveValidity} />
              <SaScorePill sa={liveSaScore} />
            </div>
            <div className="flex items-center gap-2">
              {/* (v0.27) The 2D theme toggle moved to the global header.
                  Editor theme now follows the site theme automatically —
                  see the MutationObserver wired to <html>.dark above. */}
              {/* (v0.57) Prominent Save button right next to the
                  Ketcher canvas. Visible whenever a SMILES is present
                  so the user has an obvious place to commit a sketch
                  to the library. The ⇡ promote button in the COMPOUND
                  section still works (and now opens the same dialog),
                  but a 'Save' CTA in the editor header is what users
                  intuit on first sketch. */}
              {!!currentSmiles && (
                <button
                  type="button"
                  onClick={() => {
                    // If we already have a fork-locked named compound,
                    // route through the fork prompt naturally; otherwise
                    // promote-from-draft. Either way, the modal handles
                    // the API call + draft cleanup.
                    if (loadedCompound && currentSmiles !== loadedCompound.smiles) {
                      setPromoteDialog({
                        mode: "fork",
                        initialName: `${loadedCompound.name} · variant`,
                        originalName: loadedCompound.name,
                      });
                    } else {
                      const suggested = activeDraft?.name?.startsWith("untitled")
                        ? ""
                        : (activeDraft?.name || loadedCompound?.name || "");
                      setPromoteDialog({ mode: "promote", initialName: suggested });
                    }
                  }}
                  className="px-2.5 py-1 rounded border border-emerald-600/60 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 hover:border-emerald-500/60 font-mono text-[10px] uppercase tracking-wider"
                  title="Save this compound to your library — picks a name now, available across sessions and pre-fills future docks."
                >
                  💾 Save compound
                </button>
              )}
              <span className="font-mono text-slate-500">{currentSmiles ? `${currentSmiles.length} chars` : "—"}</span>
            </div>
          </div>
          {/* (v0.28.1) CompoundLoader was rendered here — INSIDE the 2D
              editor section — which made the popover float on top of the
              Ketcher canvas. Moved it down to the StudioPage root so it
              renders as a global centered modal regardless of which panel
              the user came from. */}
          <div className="flex-1 relative bg-white">
            {!ketcherReady && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs font-mono z-10 bg-[#070b15]">
                <span className="animate-pulse">▮ initializing editor</span>
              </div>
            )}
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={KETCHER_SRC}
              title="Ketcher 2D editor"
              className="w-full h-full border-0"
              style={editorTheme === "dark" ? { filter: darkFilter } : undefined}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        </section>

        {/* RIGHT — 3D + KPI */}
        <section className="col-span-5 flex flex-col gap-3 min-h-0">
          {/* 3D viewer — live conformer until dock result, then docked pose */}
          <ProductionViewer3D
            smiles={currentSmiles}
            dockResult={dockResult}
            dockResultWt={dockResultWt}
            mutation={selectedMutation || null}
            targetMeta={targetMeta}
          />

          {/* KPI panel */}
          <div className="bg-[#0d1422] border border-slate-800/70 rounded flex flex-col flex-1 min-h-0">
            <div className="px-3 py-1.5 border-b border-slate-800/70 flex items-center justify-between text-[10px] gap-2">
              <div className="flex items-center gap-2">
                <span className={TOK.label}>Telemetry</span>
                {/* (v0.73) Setup show/hide toggle — auto-flips to hide
                    when a Full Job completes so results take focus.
                    User can manually re-open to tweak inputs and
                    re-run without losing the result table. */}
                {(selectedTargets.length > 0 || compounds.length > 0) && (
                  <button
                    type="button"
                    onClick={() => setSetupCollapsed((v) => !v)}
                    className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900/40 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 text-[9px] font-mono uppercase tracking-wider"
                    title={setupCollapsed
                      ? "Expand the Target / Mutation / Compound selectors to tweak inputs."
                      : "Collapse the selectors so docking results take focus."}
                  >
                    {setupCollapsed ? "▸ setup" : "▾ setup"}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 font-mono text-slate-500 min-w-0">
                {/* (v0.47) Full Job progress takes priority when in
                    flight so the user sees stage transitions without
                    having to leave Studio. Falls through to Quick
                    Dock states + idle. */}
                {fullJobKey && fullJobStatus && fullJobStatus !== "completed" && fullJobStatus !== "failed" && fullJobStatus !== "cancelled" ? (
                  <>
                    <span className="text-emerald-300 animate-pulse truncate">⇢ {fullJobStageLabel(fullJobStage)}</span>
                    <a href={`/jobs/${fullJobKey}?from=studio`} target="_blank" rel="noreferrer"
                       className="text-cyan-400 hover:text-cyan-300 underline-offset-2 hover:underline shrink-0"
                       title="Open the persistent results page in a new tab — full progress UI, runner logs, build steps.">
                      view ↗
                    </a>
                  </>
                ) : fullJobKey && fullJobStatus === "completed" ? (
                  <>
                    <span className="text-emerald-400">✓ full job done</span>
                    <a href={`/jobs/${fullJobKey}?from=studio`} target="_blank" rel="noreferrer"
                       className="text-cyan-400 hover:text-cyan-300 underline-offset-2 hover:underline">
                      view ↗
                    </a>
                  </>
                ) : docking ? (
                  <span className="text-cyan-300 animate-pulse">▶ docking…</span>
                ) : dockResult ? (
                  <>attempt {dockResult.dock_attempts || 1}</>
                ) : (
                  "ready"
                )}
              </div>
            </div>

            {/* Scrollable middle — Score / Hits / Target / Mutations / Compound.
                Without this wrapper the right rail's content would push the
                Run Dock button right out the bottom of the panel border on
                shorter viewports. flex-1 + min-h-0 makes the wrapper take all
                remaining height between the header above and the action
                area below; overflow-y-auto lets it scroll inside the panel
                instead of overflowing it. (v0.28.1) */}
            <div className="flex-1 min-h-0 overflow-y-auto">

            {/* (v0.48) Hide the Score / Pose / Hits / Misses blocks
                until there's something to display. Keeping them as
                empty "—" placeholders before any dock just adds visual
                noise; the user already knows they need to run a dock.
                Show only when at least one result has landed OR a
                run is in flight (so the user sees the dock-pending
                state instead of the panel jumping in late). */}
            {(dockResult || dockResultWt || docking || (fullJobKey && fullJobStatus !== "completed" && fullJobStatus !== "failed" && fullJobStatus !== "cancelled")) && <>
            {/* Score + Pose row — biggest type on the page.
                (v0.59) Padding/margins tightened across the board so
                the result section reads more compact: px-3, no top
                'Score' label (the column headers already carry the
                semantics), grid gap-2 between columns, and the
                three-column score grid uses gap-2 instead of gap-3. */}
            <div className="px-3 pt-2 pb-1.5 grid grid-cols-2 gap-3 border-b border-slate-800/70">
              <div>
                {/* Show 2-column WT vs mutation panel whenever the user
                    has BOTH selected — regardless of which results have
                    come back. Each slot can show a score, "loading", or
                    "—" so the user always sees what's happening. */}
                {(includeWt && selectedMutation) ? (
                  // (v0.42) Three columns with explicit, color-coded
                  // header pills above each score so it's unambiguous
                  // which number belongs to which receptor variant.
                  // Order: MUTANT (left, amber, primary — the new
                  // biology), WT (middle, slate, baseline),
                  // Δ (right, emerald/rose, the selectivity readout).
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {/* MUTANT column */}
                      <div className="flex flex-col">
                        <span className="text-[9px] font-mono uppercase tracking-[0.15em] text-amber-300 truncate">
                          MUT · {selectedMutation}
                        </span>
                        <span className={`font-mono text-lg tabular-nums leading-tight ${
                          dockResult?.score != null ? scoreTier(dockResult.score)
                          : docking ? "text-amber-300/40 animate-pulse"
                          : "text-slate-600"
                        }`} title={dockResult?.score != null ? `${fmtScore(dockResult.score)} kcal/mol · estimated Kd ≈ ${fmtScoreKd(dockResult.score)}` : "Mutant docking score (kcal/mol). Lower = stronger binder."}>
                          {dockResult?.score != null ? fmtScore(dockResult.score)
                            : docking ? "▮" : "—.——"}
                        </span>
                        {dockResult?.score != null && (
                          <span className="text-[9px] font-mono text-slate-500 leading-tight">
                            ~{fmtScoreKd(dockResult.score)}
                          </span>
                        )}
                      </div>
                      {/* WT column */}
                      <div className="flex flex-col border-l border-slate-800 pl-2">
                        <span className="text-[9px] font-mono uppercase tracking-[0.15em] text-slate-400 truncate">
                          WT
                        </span>
                        <span className={`font-mono text-lg tabular-nums leading-tight ${
                          dockResultWt?.score != null ? scoreTier(dockResultWt.score)
                          : docking ? "text-slate-400/40 animate-pulse"
                          : "text-slate-600"
                        }`} title={dockResultWt?.score != null ? `${fmtScore(dockResultWt.score)} kcal/mol · estimated Kd ≈ ${fmtScoreKd(dockResultWt.score)}` : "Wild-type docking score (kcal/mol). Lower = stronger binder."}>
                          {dockResultWt?.score != null ? fmtScore(dockResultWt.score)
                            : docking ? "▮" : "—.——"}
                        </span>
                        {dockResultWt?.score != null && (
                          <span className="text-[9px] font-mono text-slate-500 leading-tight">
                            ~{fmtScoreKd(dockResultWt.score)}
                          </span>
                        )}
                      </div>
                      {/* Δ column — selectivity readout. Negative =
                          mutant tighter (gain), positive = looser
                          (resistance). Only renders when both scores
                          are in. */}
                      <div className="flex flex-col border-l border-slate-800 pl-2">
                        <span className="text-[9px] font-mono uppercase tracking-[0.15em] text-cyan-300 truncate" title="Δ Selectivity = Mutant − WT score">
                          Δ SEL.
                        </span>
                        {dockResult?.score != null && dockResultWt?.score != null ? (() => {
                          const delta = dockResult.score - dockResultWt.score;
                          const tighter = delta < 0;
                          return (
                            <>
                              <span className={`font-mono text-lg tabular-nums leading-tight ${
                                Math.abs(delta) < 0.3 ? "text-slate-500"
                                : tighter ? "text-emerald-300"
                                : "text-rose-300"
                              }`} title="Δ = mutant − WT. Negative = mutant binds tighter (selectivity gain). Positive = mutant binds weaker (potential resistance).">
                                {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
                              </span>
                              <span className="text-[9px] font-mono leading-tight text-slate-500">
                                {Math.abs(delta) < 0.3 ? "noise floor"
                                  : tighter ? "mutant tighter ✓"
                                  : "mutant looser"}
                              </span>
                            </>
                          );
                        })() : (
                          <>
                            <span className="font-mono text-lg tabular-nums leading-tight text-slate-600">—.——</span>
                            <span className="text-[9px] font-mono text-slate-600 leading-tight">awaiting both</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-[9px] font-mono text-slate-600 mt-0.5">
                      kcal/mol
                      {docking && <span className="ml-2 text-cyan-300 animate-pulse">▶ docking…</span>}
                      {!docking && (!dockResult || !dockResultWt) && (dockResult || dockResultWt) && (
                        <span className="ml-2 text-amber-400">⚠ one dock failed — re-run</span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`${TOK.valueLg} ${dockResult?.score != null ? scoreTier(dockResult.score) : TOK.dim}`}
                         title={dockResult?.score != null ? `${fmtScore(dockResult.score)} kcal/mol · estimated Kd ≈ ${fmtScoreKd(dockResult.score)}` : undefined}>
                      {fmtScore(dockResult?.score)}
                      {dockResult?.score != null && (
                        <span className="text-[10px] text-slate-500 font-mono ml-2 normal-case">
                          ≈ {fmtScoreKd(dockResult.score)}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      kcal/mol · exh=8
                      {dockResult && (
                        <span className={`ml-2 px-1 rounded text-[9px] ${
                          dockResult.receptor_variant === "mutant"
                            ? "bg-amber-900/40 text-amber-200 border border-amber-800/50"
                            : "bg-slate-800 text-slate-400 border border-slate-700"
                        }`} title={
                          dockResult.receptor_variant === "mutant"
                            ? `Score is for ligand binding to the mutant receptor (${selectedMutation || "mutated"}).`
                            : "Score is for ligand binding to the wild-type receptor."
                        }>
                          vs {dockResult.receptor_variant === "mutant" ? (selectedMutation || "MUT") : "WT"}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div>
                <div className={TOK.label}>Pose</div>
                {(() => {
                  // Combined pose-validity logic — matches JobPage semantics.
                  // Three states:
                  //   1. mutation residue outside pocket box (>12Å from
                  //      center) → AMBER "◌ out · mutation Y Å away"
                  //      (Vina can't see geometric effect of this mutation
                  //      regardless of where the ligand landed)
                  //   2. ligand pose drifted off-pocket → AMBER "◌ drift"
                  //   3. pose centered + mutation in reach → EMERALD "✓ in"
                  const mutOut = mutationOutsidePocketA != null && mutationOutsidePocketA > MUTATION_OUTSIDE_POCKET_THRESHOLD_A;
                  const poseOut = dockResult?.pose_in_pocket === false;
                  if (mutOut) {
                    return (
                      <>
                        <div className={`${TOK.valueLg} ${TOK.amber}`}>◌ out</div>
                        <div className="text-[10px] font-mono text-amber-300/80" title={
                          `Residue ${parseMutationResidue(selectedMutation)} sits ${mutationOutsidePocketA?.toFixed(1)} Å from the docking box center. Vina can't see geometric effects of mutations beyond ~11 Å, so the WT vs mutant Δ here is unreliable. Same flag as JobPage's "outside pocket" badge.`
                        }>
                          mutation {mutationOutsidePocketA?.toFixed(1)} Å from box
                        </div>
                      </>
                    );
                  }
                  if (poseOut) {
                    return (
                      <>
                        <div className={`${TOK.valueLg} ${TOK.amber}`}>◌ drift</div>
                        <div className="text-[10px] font-mono text-amber-300/80">
                          {dockResult?.pose_offset_a?.toFixed(1)} Å · pose off-center
                        </div>
                      </>
                    );
                  }
                  return (
                    <>
                      <div className={`${TOK.valueLg} ${dockResult?.pose_in_pocket === true ? TOK.emerald : TOK.dim}`}>
                        {dockResult?.pose_in_pocket === true ? "✓ in" : "—"}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500">
                        {dockResult ? (
                          <>
                            {dockResult.pose_offset_a != null && (
                              <span title="Distance from docked pose centroid to the pocket box center. Threshold: 6 Å.">
                                {dockResult.pose_offset_a.toFixed(1)} Å ·{" "}
                              </span>
                            )}
                            {(dockResult.hits?.length || 0)} hits · {(dockResult.misses?.length || 0)} miss
                          </>
                        ) : "pocket box"}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Hits / Misses — only render when at least one has data.
                Full Job results currently don't populate hits/misses
                (Studio's polling synth zero-fills these arrays), so
                showing two empty em-dash columns wasted vertical
                real estate. (v0.59) */}
            {((dockResult?.hits?.length || 0) + (dockResult?.misses?.length || 0)) > 0 && (
              <div className="px-3 py-1.5 border-b border-slate-800/70">
                <div className="flex gap-4 text-[11px] font-mono">
                  {!!dockResult?.hits?.length && (
                    <div className="flex-1 min-w-0">
                      <div className={`${TOK.label} mb-0.5`}>Hits</div>
                      <div className="text-emerald-300 truncate" title={(dockResult?.hits || []).join(" · ")}>
                        {dockResult.hits.slice(0, 5).join(" · ") + (dockResult.hits.length > 5 ? ` +${dockResult.hits.length - 5}` : "")}
                      </div>
                    </div>
                  )}
                  {!!dockResult?.misses?.length && (
                    <div className="flex-1 min-w-0">
                      <div className={`${TOK.label} mb-0.5`}>Misses</div>
                      <div className="text-rose-300 truncate" title={(dockResult?.misses || []).join(" · ")}>
                        {dockResult.misses.slice(0, 5).join(" · ") + (dockResult.misses.length > 5 ? ` +${dockResult.misses.length - 5}` : "")}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* (v0.71) Per-compound results table — only renders for
                multi-compound runs. Shows every compound's mutant +
                WT score; click a row to load that pose into the 3D
                viewer (and rest of the score panel above). The
                score-tier color matches the big SCORE readout, so
                visual scanning of the column tells you "which
                compounds are strong binders" at a glance. */}
            {fullJobRows.length > 0 && (
              <div className="px-3 py-2 border-b border-slate-800/70">
                <div className="flex items-center justify-between mb-1.5">
                  <span className={TOK.label}>Docking results</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] text-slate-600">
                      {fullJobRows.length} · best first
                    </span>
                    {fullJobKey && (
                      <a href={`/jobs/${fullJobKey}?from=studio`}
                         target="_blank" rel="noreferrer"
                         className="text-cyan-400 hover:text-cyan-300 text-[9px] uppercase tracking-wider"
                         title="Open the full-page results view in a new tab — pose viewer, contact maps, runner logs, ADMET, etc.">
                        full view ↗
                      </a>
                    )}
                  </div>
                </div>
                <div className="rounded border border-slate-800 divide-y divide-slate-800/60 max-h-[260px] overflow-y-auto">
                  {fullJobRows.map((row) => {
                    const isSelected = row.compoundId === selectedRowCompoundId;
                    const delta = (row.mutantScore != null && row.wtScore != null)
                      ? row.mutantScore - row.wtScore
                      : null;
                    // (v0.73) Two click targets per row:
                    //  - the body (name + scores) navigates to JobPage
                    //    so the user lands in the full results UI for
                    //    this run, with this compound's pose preselected
                    //  - the small ▶ button on the left swaps the inline
                    //    3D viewer to this compound's pose without
                    //    leaving Studio (legacy v0.71 behaviour kept
                    //    for users who want to compare poses quickly)
                    const loadIn3D = () => {
                      setSelectedRowCompoundId(row.compoundId);
                      const mut: QuickDockResult | null = row.mutantScore != null ? {
                        ok: true,
                        score: row.mutantScore,
                        hits: [],
                        misses: [],
                        pose_pdbqt_b64: row.mutantPoseB64,
                        pdb_id: dockResult?.pdb_id || dockResultWt?.pdb_id,
                        chain: dockResult?.chain || dockResultWt?.chain,
                        receptor_variant: "mutant",
                      } : null;
                      const wt: QuickDockResult | null = row.wtScore != null ? {
                        ok: true,
                        score: row.wtScore,
                        hits: [],
                        misses: [],
                        pose_pdbqt_b64: row.wtPoseB64,
                        pdb_id: dockResult?.pdb_id || dockResultWt?.pdb_id,
                        chain: dockResult?.chain || dockResultWt?.chain,
                        receptor_variant: "wt",
                      } : null;
                      if (mut) { setDockResult(mut); setDockResultWt(wt); }
                      else { setDockResult(wt); setDockResultWt(null); }
                    };
                    return (
                      <div
                        key={row.compoundId}
                        className={`flex items-center gap-1 text-[10px] font-mono ${
                          isSelected ? "bg-cyan-950/30" : "hover:bg-slate-800/30"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={loadIn3D}
                          className={`shrink-0 px-1.5 py-1 ${isSelected ? "text-cyan-300" : "text-slate-600 hover:text-cyan-400"}`}
                          title="Show this compound's pose in the 3D viewer above (stay in Studio)."
                        >
                          ▶
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!fullJobKey) return;
                            navigate(`/jobs/${fullJobKey}?from=studio`);
                          }}
                          disabled={!fullJobKey}
                          className="flex-1 flex items-center gap-2 text-left px-1 py-1 hover:bg-slate-800/40 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={`Open the full-page results view for "${row.name}".`}
                        >
                          <span className={`flex-1 text-left truncate ${isSelected ? "text-cyan-200" : "text-slate-200"}`}>
                            {row.name}
                          </span>
                          <span className={`tabular-nums w-12 text-right ${
                            row.mutantScore != null ? scoreTier(row.mutantScore) : "text-slate-700"
                          }`} title="Mutant score (kcal/mol)">
                            {row.mutantScore != null ? fmtScore(row.mutantScore) : "—"}
                          </span>
                          {includeWt && (
                            <span className={`tabular-nums w-12 text-right ${
                              row.wtScore != null ? "text-slate-400" : "text-slate-700"
                            }`} title="WT score (kcal/mol)">
                              {row.wtScore != null ? fmtScore(row.wtScore) : "—"}
                            </span>
                          )}
                          {delta != null && (
                            <span className={`tabular-nums w-12 text-right ${
                              delta < -0.3 ? "text-emerald-300" : delta > 0.3 ? "text-rose-300" : "text-slate-500"
                            }`} title="Δ = mutant − WT · negative ⇒ tighter to mutant">
                              {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
                            </span>
                          )}
                          <span className="text-slate-600 text-[9px] shrink-0 pl-1">↗</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </>}
            {/* /v0.48 conditional close */}

            {/* (v0.73) When the user has run a job and is inspecting
                results, collapse the setup selectors to a one-line
                summary so the results panel doesn't have to scroll
                past three configuration sections. ▸ setup in the
                header reopens. */}
            {setupCollapsed ? (
              <div className="px-4 py-2 border-b border-slate-800/70 flex items-center gap-2 text-[10px] font-mono">
                <span className={TOK.label}>Setup</span>
                <span className="text-slate-300 truncate flex-1">
                  {selectedTargets.length > 0 ? selectedTargets.map(t => t.toUpperCase()).join(", ") : "—"}
                  <span className="text-slate-600 mx-1">·</span>
                  <span className="text-cyan-300">
                    {selectedMutations.length > 0
                      ? (includeWt ? `WT + ${selectedMutations.join(", ")}` : selectedMutations.join(", "))
                      : "WT only"}
                  </span>
                  <span className="text-slate-600 mx-1">·</span>
                  <span className="text-slate-400">
                    {compounds.length} compound{compounds.length === 1 ? "" : "s"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setSetupCollapsed(false)}
                  className="text-cyan-400 hover:text-cyan-300 text-[9px] uppercase tracking-wider shrink-0"
                  title="Open the selectors to tweak inputs and re-run."
                >
                  edit ↗
                </button>
              </div>
            ) : (<>

            {/* ─── TARGET (dropdown + search on right) ─── */}
            <div className="px-4 py-3 border-b border-slate-800/70">
              <div className="flex items-center justify-between mb-2">
                <span className={TOK.label}>Target</span>
                <span className="font-mono text-[9px] text-slate-600">
                  {(() => {
                    const all = mergedCatalog.length;
                    const filt = mergedCatalog.filter((t: any) =>
                      !targetQuery || t.id.toLowerCase().includes(targetQuery.toLowerCase()) ||
                      (t.name || "").toLowerCase().includes(targetQuery.toLowerCase())
                    ).length;
                    return targetQuery ? `${filt}/${all}` : `${all} available · search RCSB for more`;
                  })()}
                </span>
              </div>
              {/* Trigger row: dropdown showing current selection (LEFT) +
                  search input (RIGHT). Click trigger or type to expand
                  the option list below. */}
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setTargetDropdownOpen(!targetDropdownOpen)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-cyan-500/60 bg-cyan-900/30 text-cyan-200 font-mono text-[11px] uppercase tracking-wider hover:bg-cyan-900/50 min-w-[80px]"
                  title={targetMeta?.name || ""}
                >
                  <span className={`text-[8px] transition-transform ${targetDropdownOpen ? "rotate-90" : ""}`}>▸</span>
                  <span>{selectedTargets.length > 0 ? selectedTargets.map(s => s.toUpperCase()).join(" + ") : "—"}</span>
                </button>
                <input
                  type="text"
                  value={targetQuery}
                  onChange={(e) => { setTargetQuery(e.target.value); if (e.target.value) setTargetDropdownOpen(true); }}
                  onFocus={() => setTargetDropdownOpen(true)}
                  placeholder="search…"
                  className="flex-1 px-2 py-1 text-[10px] font-mono rounded border border-slate-700/60 text-slate-200 placeholder:text-slate-600 bg-[#070b15] focus:outline-none focus:border-cyan-500/60"
                />
              </div>
              {/* Expanded chip list — visible when dropdown is open OR
                  when there's a search query (forces visibility so the
                  user sees what their typing matches). */}
              {(targetDropdownOpen || targetQuery) && (
                <div className="pt-1 border-t border-slate-800/70 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5 max-h-32 overflow-auto">
                    {mergedCatalog
                      .filter((t: any) =>
                        !targetQuery ||
                        t.id.toLowerCase().includes(targetQuery.toLowerCase()) ||
                        (t.name || "").toLowerCase().includes(targetQuery.toLowerCase())
                      )
                      .map((t: any) => {
                        // (v0.63) Multi-target: clicking toggles in/out of
                        // selectedTargets, capped at MAX_TARGETS=2. Mutations
                        // also reset only when ADDING the first target (so
                        // mutations carry across when adding a second).
                        const active = selectedTargets.includes(t.id);
                        const atCap = !active && selectedTargets.length >= MAX_TARGETS;
                        // (v0.83) Ad-hoc PDB-search picks render with a
                        // subtle PDB icon prefix so users can tell them
                        // apart from the curated catalog at a glance.
                        const isAdHoc = !!t.isAdHoc;
                        return (
                          <button
                            key={t.id}
                            disabled={atCap}
                            onClick={() => {
                              setSelectedTargets((prev) => {
                                if (prev.includes(t.id)) return prev.filter((x) => x !== t.id);
                                if (prev.length >= MAX_TARGETS) return prev;
                                const next = [...prev, t.id];
                                // Clear mutations when going from empty → 1 target,
                                // since the mutation list is target-specific.
                                if (prev.length === 0) setSelectedMutations([]);
                                return next;
                              });
                              setTargetQuery("");
                            }}
                            className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded border transition-colors ${
                              active
                                ? (isAdHoc ? "border-violet-500/60 bg-violet-900/30 text-violet-200" : "border-cyan-500/60 bg-cyan-900/30 text-cyan-200")
                                : atCap
                                ? "border-slate-800 text-slate-700 cursor-not-allowed"
                                : (isAdHoc ? "border-violet-700/40 text-violet-300/70 hover:text-violet-200 hover:border-violet-500/60" : "border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600")
                            }`}
                            title={(isAdHoc ? `[RCSB] ${t.name}` : t.name) + (atCap ? ` (max ${MAX_TARGETS} targets)` : "")}
                          >
                            {isAdHoc && <span className="opacity-70 mr-0.5">⌬</span>}
                            {active ? `✓ ${t.id}` : t.id}
                          </button>
                        );
                      })}
                  </div>
                  {/* (v0.83) RCSB PDB search tier — only renders when
                      the user's query has no local match (catalog +
                      ad-hoc). Mirrors the PubChem tier in the compound
                      picker: live search, click a hit to add. Pose
                      auto-detection runs server-side (fpocket fallback)
                      since these targets have no curated pocket box. */}
                  {targetQuery && pdbSearching && (
                    <div className="text-[10px] font-mono text-cyan-400/70 italic animate-pulse pl-1">
                      ⇢ searching RCSB PDB…
                    </div>
                  )}
                  {targetQuery && !pdbSearching && pdbResults.length > 0 && (
                    <div className="rounded border border-violet-900/50 bg-violet-950/20 p-1.5 space-y-1">
                      <div className="text-[9px] font-mono text-violet-400/70 uppercase tracking-wider px-1">
                        RCSB PDB · {pdbResults.length} hit{pdbResults.length === 1 ? "" : "s"} · click to use (server auto-detects pocket)
                      </div>
                      <div className="max-h-40 overflow-auto space-y-0.5">
                        {pdbResults.map((r) => {
                          const alreadyAdded = selectedTargets.includes(r.id.toLowerCase());
                          const atCap = !alreadyAdded && selectedTargets.length >= MAX_TARGETS;
                          return (
                            <button
                              key={r.id}
                              disabled={atCap}
                              onClick={() => pickPdbResult(r)}
                              className={`w-full text-left px-2 py-1 rounded font-mono text-[10px] transition-colors ${
                                alreadyAdded
                                  ? "bg-violet-900/40 text-violet-200 border border-violet-600/50"
                                  : atCap
                                  ? "text-slate-600 cursor-not-allowed"
                                  : "text-slate-300 hover:bg-violet-900/30 hover:text-violet-100"
                              }`}
                              title={r.title + (atCap ? ` (max ${MAX_TARGETS} targets)` : "")}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-violet-300 uppercase tracking-wider w-12 shrink-0">{r.id}</span>
                                <span className="flex-1 truncate text-slate-300">{r.title}</span>
                                {r.resolution != null && (
                                  <span className="text-slate-500 tabular-nums shrink-0">{r.resolution.toFixed(1)} Å</span>
                                )}
                                {alreadyAdded && <span className="text-emerald-400 shrink-0">✓</span>}
                              </div>
                              {r.organism && (
                                <div className="text-[9px] text-slate-500 italic ml-14 truncate">{r.organism}</div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {targetQuery && !pdbSearching && pdbResults.length === 0 && !mergedCatalog.some((t: any) =>
                    t.id.toLowerCase().includes(targetQuery.toLowerCase()) ||
                    (t.name || "").toLowerCase().includes(targetQuery.toLowerCase())
                  ) && (
                    <span className="text-[10px] font-mono text-amber-400/80 italic pl-1">
                      no catalog match · {targetQuery.length < 3 ? "type ≥3 chars to search RCSB" : "no RCSB results either"}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ─── MUTATIONS (dropdown + search on right) ─── */}
            <div className="px-4 py-3 border-b border-slate-800/70">
              <div className="flex items-center justify-between mb-2">
                <span className={TOK.label}>Mutations</span>
                <span className="font-mono text-[9px] text-slate-600">
                  {(() => {
                    const all = availableMutations.length;
                    const filt = availableMutations.filter(m =>
                      !mutationQuery ||
                      m.code.toLowerCase().includes(mutationQuery.toLowerCase()) ||
                      (m.label || "").toLowerCase().includes(mutationQuery.toLowerCase())
                    ).length;
                    if (mutationQuery) return `${filt}/${all}`;
                    // (v0.85) For ad-hoc PDB picks the curated list is
                    // populated asynchronously from UniProt — surface
                    // the status so users know whether to wait, retry,
                    // or just type a custom code.
                    const tMetaAny = targetMeta as any;
                    const isAdHoc = !!tMetaAny?.isAdHoc;
                    const status = isAdHoc ? enrichmentStatus[tMetaAny.id] : null;
                    if (status === "pending") {
                      return <span className="text-cyan-400/70 italic animate-pulse">⇢ fetching from UniProt…</span>;
                    }
                    if (status === "failed") {
                      return <span className="text-amber-400/70">no UniProt match · type a code</span>;
                    }
                    if (status === "done-empty") {
                      return <span className="text-slate-500">no clinical variants · type a code</span>;
                    }
                    return all > 0 ? `${all} ${isAdHoc ? "from UniProt" : "curated"}` : "0 — type a code below";
                  })()}
                </span>
              </div>
              {/* (v0.39) Wrapper for the trigger row + dropdown so a
                  click outside this region closes the popover. Both
                  must live under the same ref'd parent — clicking
                  inside the dropdown to pick a mutation must NOT count
                  as outside. */}
              <div ref={mutationWrapRef}>
              {/* (v0.40) Dropdown rendered ABOVE the trigger row when
                  there's not enough space below. Inline rendering
                  avoids portals; the right rail's overflow-y-auto means
                  the dropdown can be tall, but flipping direction keeps
                  it in view in either case. */}
              {mutationDropdownOpen && mutationDropdownDir === "up" && (
                <MutationDropdown
                  availableMutations={availableMutations}
                  mutationQuery={mutationQuery}
                  selectedMutations={selectedMutations}
                  includeWt={includeWt}
                  setIncludeWt={setIncludeWt}
                  toggleMutation={(code) => {
                    setSelectedMutations((prev) => {
                      if (prev.includes(code)) return prev.filter((c) => c !== code);
                      if (prev.length >= MAX_MUTATIONS) return prev;
                      return [...prev, code];
                    });
                  }}
                  setMutationQuery={setMutationQuery}
                  setOpen={setMutationDropdownOpen}
                  targetId={targetMeta?.id}
                  maxMutations={MAX_MUTATIONS}
                />
              )}
              {/* Trigger row: current mutation chip on the LEFT (or "WT" if
                  none selected), search input on the RIGHT. Pressing Enter
                  on a non-matching query commits it as a custom mutation. */}
              <div ref={mutationTriggerRef} className="flex items-center gap-2 mb-2">
                {/* Trigger shows current selection: "WT", "WT + Q61H",
                    "Q61H", or "—" if user deselected everything. */}
                <button
                  onClick={() => setMutationDropdownOpen(!mutationDropdownOpen)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded border font-mono text-[11px] uppercase tracking-wider min-w-[110px] ${
                    selectedMutation && includeWt
                      ? "border-cyan-500/60 bg-cyan-900/30 text-cyan-200 hover:bg-cyan-900/50"
                      : selectedMutation
                      ? "border-amber-500/60 bg-amber-900/30 text-amber-200 hover:bg-amber-900/50"
                      : includeWt
                      ? "border-slate-500 bg-slate-700/40 text-slate-200 hover:bg-slate-700/60"
                      : "border-rose-700/50 bg-rose-950/30 text-rose-300 hover:bg-rose-950/50"
                  }`}
                  title={
                    selectedMutation && includeWt ? `Will dock against WT and ${selectedMutation} in parallel`
                    : selectedMutation ? `Will dock against ${selectedMutation} only`
                    : includeWt ? "Will dock against wild-type only"
                    : "Select WT or a mutation below to enable docking"
                  }
                >
                  <span className={`text-[8px] transition-transform ${mutationDropdownOpen ? "rotate-90" : ""}`}>▸</span>
                  <span>
                    {(() => {
                      const parts: string[] = [];
                      if (includeWt) parts.push("WT");
                      parts.push(...selectedMutations);
                      return parts.length > 0 ? parts.join(" + ") : "—";
                    })()}
                  </span>
                </button>
                <input
                  type="text"
                  value={mutationQuery}
                  onChange={(e) => { setMutationQuery(e.target.value.toUpperCase()); if (e.target.value) setMutationDropdownOpen(true); }}
                  onFocus={() => setMutationDropdownOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && mutationQuery.trim()) {
                      // (v0.62) Append custom mutation if room and not duplicate.
                      const code = mutationQuery.trim().toUpperCase();
                      setSelectedMutations((prev) => {
                        if (prev.includes(code)) return prev;
                        if (prev.length >= MAX_MUTATIONS) return prev;
                        return [...prev, code];
                      });
                      setMutationQuery("");
                      setMutationDropdownOpen(false);
                    }
                  }}
                  placeholder="search · ⏎ for custom"
                  className="flex-1 px-2 py-1 text-[10px] font-mono rounded border border-slate-700/60 text-slate-200 placeholder:text-slate-600 bg-[#070b15] focus:outline-none focus:border-amber-500/60"
                />
              </div>
              {/* Same dropdown component, rendered BELOW the trigger
                  when there's enough space (the common case for the
                  upper half of the rail). v0.40 picks up vs down via
                  the useEffect above; v0.39 ensures it only renders
                  when explicitly opened. */}
              {mutationDropdownOpen && mutationDropdownDir === "down" && (
                <MutationDropdown
                  availableMutations={availableMutations}
                  mutationQuery={mutationQuery}
                  selectedMutations={selectedMutations}
                  includeWt={includeWt}
                  setIncludeWt={setIncludeWt}
                  toggleMutation={(code) => {
                    setSelectedMutations((prev) => {
                      if (prev.includes(code)) return prev.filter((c) => c !== code);
                      if (prev.length >= MAX_MUTATIONS) return prev;
                      return [...prev, code];
                    });
                  }}
                  setMutationQuery={setMutationQuery}
                  setOpen={setMutationDropdownOpen}
                  targetId={targetMeta?.id}
                  maxMutations={MAX_MUTATIONS}
                />
              )}
              </div>
              {/* /v0.39 wrapper — closes mutationWrapRef */}
            </div>

            {/* ─── COMPOUND (v0.64: multi-add list, click-to-search) ─── */}
            <div className="px-4 py-3 border-b border-slate-800/70">
              <div className="flex items-center justify-between mb-2">
                <span className={TOK.label}>Compounds</span>
                <span className="font-mono text-[9px] text-slate-600">
                  {compounds.length}/{MAX_COMPOUNDS}{compounds.length === MAX_COMPOUNDS && <span className="text-amber-400 ml-1">· full</span>}
                </span>
              </div>
              {promoteToast && (
                <div className={`mb-2 px-2 py-1 rounded text-[10px] font-mono ${
                  promoteToast.startsWith("✓")
                    ? "bg-emerald-950/40 border border-emerald-900/60 text-emerald-200"
                    : "bg-rose-950/40 border border-rose-900/60 text-rose-200"
                }`}>
                  {promoteToast}
                </div>
              )}
              {/* (v0.33) Fork-on-edit pill. Only renders when the user
                  loaded a NAMED compound and has since edited it. Two
                  buttons: Save changes (overwrite) vs Save as new
                  (keep original safe; default by visual emphasis).
                  (v0.68) Hidden whenever the user is editing one of the
                  staged compounds in the suite — in that case the inline
                  SAVE EDITS button on the row covers the same intent
                  (apply the edit to this dock run), and showing both
                  fork buttons + SAVE EDITS together was confusing.
                  Library-overwrite / fork-as-new are still reachable
                  via the Promote action; the pill only nags when the
                  user has loaded a library compound that ISN'T already
                  staged in the current suite. */}
              {loadedCompound && currentSmiles && currentSmiles !== loadedCompound.smiles && !(
                activeCompoundIdx >= 0 &&
                activeCompoundIdx < compounds.length &&
                currentSmiles !== compounds[activeCompoundIdx].smiles
              ) && (
                <div className="mb-2 px-2 py-1.5 rounded bg-amber-950/30 border border-amber-900/60 text-[10px] font-mono">
                  <div className="text-amber-200 mb-1.5">
                    ✎ Modified from <span className="font-bold">{loadedCompound.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api.saveMyCompound({ name: loadedCompound.name, smiles: currentSmiles });
                          setLoadedCompound({ name: loadedCompound.name, smiles: currentSmiles });
                          setPromoteToast(`✓ "${loadedCompound.name}" updated`);
                          window.setTimeout(() => setPromoteToast(null), 3000);
                        } catch (e: any) {
                          setPromoteToast(`✗ ${e?.message || "Save failed"}`);
                          window.setTimeout(() => setPromoteToast(null), 5000);
                        }
                      }}
                      className="px-2 py-0.5 rounded border border-slate-700 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60 text-[10px] uppercase tracking-wider"
                      title={`Overwrite the saved compound "${loadedCompound.name}" with the current SMILES.`}
                    >
                      save changes
                    </button>
                    <button
                      type="button"
                      onClick={() => setPromoteDialog({
                        mode: "fork",
                        initialName: `${loadedCompound.name} · variant`,
                        originalName: loadedCompound.name,
                      })}
                      className="px-2 py-0.5 rounded border border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 hover:border-emerald-500/60 text-[10px] uppercase tracking-wider"
                      title={`Keep "${loadedCompound.name}" untouched and save the modified compound under a new name.`}
                    >
                      ⇡ save as new
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoadedCompound(null)}
                      className="ml-auto text-slate-600 hover:text-slate-400 text-[10px]"
                      title="Dismiss this prompt — the autosave draft will keep tracking the edited SMILES on its own."
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
              {/* (v0.64) Click anywhere on this row → opens the search
                  modal in multi-add mode. User can pick several
                  compounds (reference / library / PubChem / paste
                  SMILES) without closing; modal stays open until they
                  hit Done. Each pick lands in the staged list below. */}
              <button
                type="button"
                onClick={() => setShowLoader(true)}
                disabled={compounds.length >= MAX_COMPOUNDS}
                className={`w-full px-3 py-2 rounded border font-mono text-[11px] flex items-center gap-2 transition-colors ${
                  compounds.length >= MAX_COMPOUNDS
                    ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                    : "border-cyan-500/60 bg-cyan-900/30 text-cyan-200 hover:bg-cyan-900/50"
                }`}
                title="Search the curated reference list, your library, or PubChem. Click multiple compounds to stage them all at once. Run Dock submits all staged compounds in a single Full Job."
              >
                <span className="text-[12px]">🔍</span>
                <span className="uppercase tracking-wider">
                  {compounds.length === 0 ? "Search & add compounds" : "Add more compounds"}
                </span>
                <span className="ml-auto text-[9px] text-cyan-400/70 normal-case">
                  reference · library · pubchem · sketch
                </span>
              </button>
              {/* Staged compounds list — newest at the bottom. Each row
                  shows name + SMILES preview; click to load into 2D
                  for inspection/editing; × removes from the suite. */}
              {compounds.length > 0 && (
                <div className="mt-2 rounded border border-slate-800 divide-y divide-slate-800/60">
                  {compounds.map((c, i) => {
                    // (v0.67) When this row IS the active compound and
                    // the canvas SMILES has been edited away from the
                    // staged version, show an inline 'save changes'
                    // button that updates the staged entry's SMILES.
                    // The change is now part of the suite that Run
                    // Dock will submit.
                    const isActive = i === activeCompoundIdx;
                    const isEdited = isActive && !!currentSmiles && currentSmiles !== c.smiles;
                    // (v0.69) When ANOTHER row is mid-edit, clicking THIS
                    // row would silently discard those edits. Detect that
                    // case so we can prompt before navigating away.
                    const otherRowDirty =
                      !isActive &&
                      activeCompoundIdx >= 0 &&
                      activeCompoundIdx < compounds.length &&
                      !!currentSmiles &&
                      currentSmiles !== compounds[activeCompoundIdx].smiles;
                    return (
                    <div key={c.id} className={`px-2 py-1.5 flex items-center gap-2 text-[10px] font-mono ${
                      isEdited ? "bg-amber-950/20"
                      : isActive ? "bg-cyan-950/20"
                      : "hover:bg-slate-800/30"
                    }`}>
                      <button
                        type="button"
                        onClick={() => {
                          // (v0.69) If the user has uncommitted edits on
                          // a different staged row, switching loses those
                          // edits unless they save first. Confirm before
                          // discarding.
                          if (otherRowDirty) {
                            const otherIdx = activeCompoundIdx;
                            const otherName = compounds[otherIdx]?.name || `compound #${otherIdx + 1}`;
                            const ok = window.confirm(
                              `Discard your unsaved edits to "${otherName}"?\n\n` +
                              `Click Cancel to stay on that compound and use SAVE EDITS or SAVE AS NEW first.`
                            );
                            if (!ok) return;
                          }
                          setActiveCompoundIdx(i);
                          // (v0.68) Pass stagedId + libraryName so the
                          // canonical SMILES Ketcher emits gets folded
                          // back into the staged entry and into
                          // loadedCompound — both serve as "baseline"
                          // for the dirty checks below, so this is the
                          // load step where they need to be aligned.
                          loadIntoCanvas(c.smiles, { stagedId: c.id, libraryName: c.name });
                          if (c.name) setLoadedCompound({ name: c.name, smiles: c.smiles });
                        }}
                        className="flex-1 text-left flex items-center gap-2 min-w-0"
                        title={`Load ${c.name || `compound #${i + 1}`} into the 2D editor for inspection or editing.`}
                      >
                        <span className="text-[8px] text-slate-600 tabular-nums shrink-0">{i + 1}</span>
                        <span className={`shrink-0 truncate max-w-[12ch] ${isEdited ? "text-amber-200" : isActive ? "text-cyan-200" : "text-slate-200"}`}>
                          {c.name || `untitled #${i + 1}`}{isEdited && <span className="text-amber-400 ml-1">✎</span>}
                        </span>
                        <span className="text-[9px] text-slate-500 truncate min-w-0">{isEdited ? currentSmiles : c.smiles}</span>
                      </button>
                      {isEdited && (
                        <>
                        <button
                          type="button"
                          onClick={() => {
                            // (v0.67) Update the staged compound's
                            // SMILES with the canvas edit. The dock
                            // submission picks this up automatically.
                            setCompounds((prev) => prev.map((entry, j) => j === i ? { ...entry, smiles: currentSmiles } : entry));
                            // Clear the loadedCompound lock so the
                            // fork-on-edit pill stops nagging — the
                            // compound now matches the staged entry.
                            setLoadedCompound({ name: c.name || `compound #${i + 1}`, smiles: currentSmiles });
                            setPromoteToast(`✓ #${i + 1} updated`);
                            window.setTimeout(() => setPromoteToast(null), 2500);
                          }}
                          className="px-1.5 py-0.5 rounded border border-emerald-600/60 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50 hover:border-emerald-500 text-[9px] uppercase tracking-wider shrink-0"
                          title={`Replace compound #${i + 1}'s SMILES with what's currently in the canvas. The suite Run Dock will use the new structure.`}
                        >
                          save edits
                        </button>
                        {/* (v0.69) SAVE AS NEW — fork the edit into a
                            brand-new staged entry, leaving the original
                            compound intact in the suite. (v0.70) Now
                            opens the PromoteDialog so the user names
                            the variant AND it saves to their library
                            via api.saveMyCompound, then also stages it
                            in the suite for this dock run. Capped at
                            MAX_COMPOUNDS; if full, button is disabled. */}
                        <button
                          type="button"
                          disabled={compounds.length >= MAX_COMPOUNDS}
                          onClick={() => {
                            if (compounds.length >= MAX_COMPOUNDS) return;
                            const baseName = c.name || `untitled #${i + 1}`;
                            setPromoteDialog({
                              mode: "fork",
                              initialName: `${baseName} · variant`,
                              originalName: baseName,
                              stageAfterIdx: i,
                            });
                          }}
                          className={`px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider shrink-0 ${
                            compounds.length >= MAX_COMPOUNDS
                              ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                              : "border-cyan-600/60 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/50 hover:border-cyan-500"
                          }`}
                          title={
                            compounds.length >= MAX_COMPOUNDS
                              ? `Suite is full (${MAX_COMPOUNDS}/${MAX_COMPOUNDS}). Remove a compound to fork.`
                              : `Name the new compound, save it to your library, and stage it next to "${c.name || `compound #${i + 1}`}" for this dock run.`
                          }
                        >
                          save as new
                        </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setCompounds((prev) => prev.filter((_, j) => j !== i));
                          if (activeCompoundIdx >= compounds.length - 1) setActiveCompoundIdx(0);
                        }}
                        className="text-slate-600 hover:text-rose-400 px-1 shrink-0"
                        title="Remove this compound from the suite"
                      >×</button>
                    </div>
                    );
                  })}
                </div>
              )}
              {/* Inline 'add the canvas sketch' helper — shows when the
                  user has drawn something custom that isn't in the list. */}
              {!!currentSmiles && !compounds.some((c) => c.smiles === currentSmiles) && compounds.length < MAX_COMPOUNDS && (
                <button
                  type="button"
                  onClick={async () => {
                    const newC: CompoundEntry = {
                      id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                      smiles: currentSmiles,
                      name: loadedCompound?.name || (activeDraft?.name && !activeDraft.name.startsWith("untitled") ? activeDraft.name : undefined),
                    };
                    setCompounds((prev) => [...prev, newC]);
                    setLoadedCompound(null);
                    setActiveDraft(null);
                    setCurrentSmiles("");
                    try {
                      const a = getKetcherApi(iframeRef.current);
                      if (a?.setMolecule) await a.setMolecule("");
                    } catch { /* */ }
                  }}
                  className="mt-2 w-full px-2 py-1 rounded border border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 hover:border-emerald-500/60 font-mono text-[10px] uppercase tracking-wider"
                  title="Stage the current 2D sketch as compound and clear the canvas to draw the next one."
                >
                  + add 2D sketch to suite ({compounds.length + 1}/{MAX_COMPOUNDS})
                </button>
              )}
            </div>

            </>)}
            {/* (v0.73) /setupCollapsed ternary close */}

            </div>
            {/* /scrollable middle — closes the wrapper added in v0.28.1 */}

            {/* Action area — pinned to the bottom of the KPI panel; the
                scrollable middle above shrinks/scrolls instead of pushing
                this button outside the panel border. */}
            <div className="px-4 py-3 mt-auto border-t border-slate-800/70">
              {dockError && (() => {
                // (v0.41) Detect GPU-pipeline rejections. The backend
                // returns errors mentioning "GPU docker", "too large",
                // or "flexibility cap" when QuickVina2-GPU bails. We
                // replace the ambiguous "Promote to Full Job" wording
                // with our own copy and a real button that pre-fills
                // /new via location.state.reseed — the same channel
                // the legacy editor uses to hand off to the CPU path.
                const isGpuReject = /too large|flexibility|gpu docker/i.test(dockError);
                if (isGpuReject) {
                  return (
                    <div className="mb-2 px-3 py-2 rounded bg-rose-950/40 border border-rose-900/60 text-[11px] font-mono text-rose-200 space-y-1.5">
                      <div className="flex items-start gap-2">
                        <span className="text-rose-400">✗</span>
                        <span>
                          <strong>Compound exceeds the GPU pipeline's complexity cap</strong>{" "}
                          (≈MW &lt; 500, ≤32 rotatable bonds). The CPU pipeline at <span className="text-cyan-300">/new</span> has no such cap and handles arbitrary scaffolds.
                        </span>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            navigate("/new", {
                              state: {
                                reseed: {
                                  catalog_target_id: selectedTarget || undefined,
                                  mutations: selectedMutation ? [selectedMutation] : [],
                                  compounds: [{
                                    name: loadedCompound?.name || activeDraft?.name || "Studio compound",
                                    smiles: currentSmiles,
                                  }],
                                  include_wt: includeWt,
                                },
                              },
                            });
                          }}
                          className="px-2 py-1 rounded border border-cyan-600/60 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 hover:border-cyan-500/60 text-[10px] uppercase tracking-wider"
                          title="Open NewJobPage with this SMILES + target + mutation pre-filled. CPU path takes minutes (vs ~30s on GPU) but has no scaffold limits."
                        >
                          ⇢ run as full job (cpu)
                        </button>
                        <span className="text-[10px] text-rose-300/70 italic">
                          or trim a side chain and try Quick Dock again
                        </span>
                      </div>
                    </div>
                  );
                }
                // Generic dock error — original rendering.
                return (
                  <div className="mb-2 px-2 py-1.5 rounded bg-rose-950/40 border border-rose-900/60 text-[11px] text-rose-200 font-mono">
                    ✗ {dockError}
                  </div>
                );
              })()}
              {dockResult?.mutation_caveat && (
                <div className="mb-2 px-2 py-1.5 rounded bg-amber-950/40 border border-amber-900/60 text-[10px] text-amber-200 font-mono">
                  ⚠ {dockResult.mutation_caveat}
                </div>
              )}
              {/* (v0.56) Quick Dock removed — Full Job is the only path.
                  The runFullJob handler stays in scope but its peer
                  button is gone. Single full-width emerald button
                  plus a prominent in-flight progress banner directly
                  above it whenever a job is mid-run. */}
              {/* In-flight progress banner. Renders the moment a Full
                  Job is submitted and stays until completion/failure.
                  Big, colored, animated — impossible to miss. */}
              {(submittingFull || (!!fullJobKey && fullJobStatus !== "completed" && fullJobStatus !== "failed" && fullJobStatus !== "cancelled")) && (
                <div className="mb-2 px-3 py-2 rounded border border-emerald-600/60 bg-emerald-950/30 text-[11px] font-mono">
                  <div className="flex items-center gap-2 text-emerald-200">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-bold">Docking in progress…</span>
                    {fullJobKey && (
                      <a href={`/jobs/${fullJobKey}?from=studio`} target="_blank" rel="noreferrer"
                         className="ml-auto text-cyan-300 hover:text-cyan-200 underline-offset-2 hover:underline text-[10px]"
                         title="Open the persistent results page in a new tab — full progress UI, runner logs, build steps.">
                        view ↗
                      </a>
                    )}
                  </div>
                  <div className="mt-1 text-[10px] text-emerald-300/80">
                    {submittingFull ? "submitting to queue…"
                      : fullJobStatus === "pending" ? "queued — waiting for runner pickup"
                      : `▸ ${fullJobStageLabel(fullJobStage)}`}
                  </div>
                  <div className="mt-1 text-[9px] text-emerald-400/60 italic">
                    typical wall time ~3 min for 1 compound. results land in the score panel here AND at /jobs.
                  </div>
                </div>
              )}
              {/* (v0.72) Enable when EITHER the canvas has a SMILES OR
                  the user has at least one compound staged via the
                  picker. runFullJob already handles both paths (it
                  prefers staged, falls back to currentSmiles). The old
                  check required currentSmiles, so users who staged
                  compounds without ever clicking a row got a stuck
                  disabled button — they had to click a row just to
                  warm up the canvas. */}
              {(() => {
                const hasCompound = !!currentSmiles || compounds.length > 0;
                const isDisabled = docking || submittingFull
                  || (!!fullJobKey && fullJobStatus !== "completed" && fullJobStatus !== "failed" && fullJobStatus !== "cancelled")
                  || !ketcherReady || !hasCompound || !selectedTarget;
                const isCoolingOff = !!fullJobKey && fullJobStatus !== "completed" && fullJobStatus !== "failed" && fullJobStatus !== "cancelled";
                return (
              <button
                onClick={runFullJob}
                disabled={isDisabled}
                className={`w-full px-4 py-2.5 rounded border font-mono text-xs uppercase tracking-[0.18em] transition-all ${
                  submittingFull
                    ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300 cursor-wait animate-pulse"
                    : isCoolingOff
                    ? "border-emerald-700/40 bg-emerald-950/20 text-emerald-300/60 cursor-wait"
                    : !ketcherReady || !hasCompound || !selectedTarget
                    ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                    : "border-emerald-600/60 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 hover:border-emerald-500"
                }`}
                title={
                  !selectedTarget ? "Pick a target first."
                  : !hasCompound ? "Stage at least one compound first."
                  : "Submit a Full Job — CPU pipeline. ~3 min, no scaffold cap. Results stream in here AND persist at /jobs/{id}."
                }
              >
                {submittingFull ? "▶ submitting…"
                  : isCoolingOff ? "▶ docking in progress…"
                  : "⇢ Run Dock"}
              </button>
                );
              })()}
            </div>
          </div>
        </section>
      </main>

      {/* ═══ COMPOUND LOADER (centered modal, v0.28.1) ═══
          Rendered at the page root with a backdrop so it doesn't appear
          to be glued to the 2D editor or the right rail. Click the
          backdrop or press Esc (handled inside CompoundLoader) to close. */}
      {showLoader && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center pt-20 px-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowLoader(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] bg-[#0d1422] border border-slate-800/70 rounded shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <CompoundLoader
              targetMeta={targetMeta}
              myCompounds={myCompounds || []}
              stagedCount={compounds.length}
              maxStaged={MAX_COMPOUNDS}
              stagedSmiles={compounds.map((c) => c.smiles)}
              stagedNames={compounds.map((c) => c.name || "")}
              onPick={(smiles, name) => {
                // (v0.65) Toggle: clicking adds if not staged, removes
                // if already staged. The checkbox UI in CompoundLoader
                // reflects which compounds are currently in the suite,
                // so the user gets immediate visual feedback for each
                // click. Cap at MAX_COMPOUNDS still applies on add.
                if (!smiles) return;
                setCompounds((prev) => {
                  const existing = prev.findIndex((c) => c.smiles === smiles);
                  if (existing >= 0) return prev.filter((_, i) => i !== existing);
                  if (prev.length >= MAX_COMPOUNDS) return prev;
                  return [...prev, {
                    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                    smiles,
                    name: name || undefined,
                  }];
                });
              }}
              onClose={() => setShowLoader(false)}
            />
          </div>
        </div>
      )}

      {/* ═══ PROMOTE / SAVE-AS-NEW MODAL (v0.36) ═══
          Replaces the v0.32 window.prompt with a Studio-aesthetic
          inline modal. One component handles both the "promote a draft
          to the library" and "save a fork as new" flows — they differ
          only in copy and post-save side effects. */}
      {promoteDialog && (
        <PromoteDialog
          mode={promoteDialog.mode}
          initialName={promoteDialog.initialName}
          originalName={promoteDialog.mode === "fork" ? promoteDialog.originalName : undefined}
          smiles={currentSmiles}
          onClose={() => setPromoteDialog(null)}
          onSaved={(savedName) => {
            if (promoteDialog.mode === "promote" && activeDraft) {
              deleteDraft(activeDraft.id);
              setActiveDraft(null);
              setPromoteToast(`✓ "${savedName}" saved to your library`);
            } else if (promoteDialog.mode === "fork") {
              setLoadedCompound({ name: savedName, smiles: currentSmiles });
              // (v0.70) When SAVE AS NEW from a staged row drove this
              // dialog, the user wants the new compound BOTH in their
              // library AND staged for this run. PromoteDialog handled
              // the library save; we handle the suite insert here so
              // it lands right after the parent row and becomes active.
              if (promoteDialog.stageAfterIdx !== undefined) {
                const insertAt = promoteDialog.stageAfterIdx + 1;
                const newId = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
                const newC: CompoundEntry = { id: newId, smiles: currentSmiles, name: savedName };
                setCompounds((prev) => {
                  // Cap-aware insert — if user already filled the suite
                  // between opening the dialog and submitting, refuse
                  // gracefully rather than blowing past MAX_COMPOUNDS.
                  if (prev.length >= MAX_COMPOUNDS) return prev;
                  const next = [...prev];
                  next.splice(insertAt, 0, newC);
                  return next;
                });
                setActiveCompoundIdx(insertAt);
                setPromoteToast(`✓ "${savedName}" saved to library + staged for this run`);
              } else {
                setPromoteToast(`✓ "${savedName}" saved · "${promoteDialog.originalName}" preserved`);
              }
            }
            setPromoteDialog(null);
            window.setTimeout(() => setPromoteToast(null), 4000);
          }}
          onError={(msg) => {
            setPromoteToast(`✗ ${msg}`);
            window.setTimeout(() => setPromoteToast(null), 5000);
          }}
        />
      )}

      {/* ═══ COLLAPSIBLE BOTTOM STRIP ═══ */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0d1422] border-t border-slate-800/70 flex text-[10px] z-20">
        <CollapsibleTab label="Properties" open={showProps} onToggle={() => setShowProps(!showProps)}>
          <PropertiesPanel smiles={currentSmiles} />
        </CollapsibleTab>
        <CollapsibleTab label="AI Variants" open={showAi} onToggle={() => setShowAi(!showAi)}>
          <AiVariantsPanel
            dockResult={dockResult}
            currentSmiles={currentSmiles}
            targetPdb={targetMeta?.pdb_id || dockResult?.pdb_id}
            mutation={selectedMutation || undefined}
            // (v0.60) Pass Full Job submission state in so the panel
            // can show per-card "applying / docking" indicators and
            // re-trigger a dock automatically on Apply & Dock.
            submittingFull={submittingFull}
            fullJobKey={fullJobKey}
            fullJobStatus={fullJobStatus}
            runFullJob={runFullJob}
            onUseVariant={(variant) => {
              // (v0.41) Treat AI variants as a deliberate fork of
              // whatever's currently loaded. (v0.60) The actual
              // 'apply + dock' sequence is owned by the panel; this
              // callback just handles the Studio-side state changes
              // so the parent compound identity flows correctly.
              const parentName = loadedCompound?.name || activeDraft?.name;
              const parentSmiles = loadedCompound?.smiles || activeDraft?.smiles || currentSmiles;
              if (parentName && parentSmiles) {
                setLoadedCompound({ name: parentName, smiles: parentSmiles });
              }
              setActiveDraft(null);
              loadIntoCanvas(variant.new_smiles);
            }}
          />
        </CollapsibleTab>
        <CollapsibleTab label="Dock History" open={showDockHist} onToggle={() => setShowDockHist(!showDockHist)}>
          {/* (v0.35) Session dock history. Every successful Quick Dock
              gets logged here on completion (mutant + WT each get a
              row). Click a row to restore the SMILES + target +
              mutation back into Studio. */}
          <DockHistoryPanel
            onRestore={(e) => {
              loadIntoCanvas(e.smiles);
              setSelectedTarget(e.target);
              if (e.mutation && e.mutation !== "WT") {
                setSelectedMutation(e.mutation);
                setIncludeWt(false);
              } else {
                setSelectedMutation("");
                setIncludeWt(true);
              }
              setLoadedCompound(e.compoundName ? { name: e.compoundName, smiles: e.smiles } : null);
              setActiveDraft(null);
              setShowDockHist(false);
            }}
          />
        </CollapsibleTab>
        <CollapsibleTab label="Drafts" open={showHistory} onToggle={() => setShowHistory(!showHistory)}>
          {/* (v0.31) Drafts panel — shows every autosaved compound. Click
              a row to restore it (SMILES + target + mutation flow back
              into Studio); click ✕ to permanently delete. The active
              draft is highlighted so the user always knows which row
              their current work is being saved into. */}
          <DraftsPanel
            activeDraftId={activeDraft?.id ?? null}
            onRestore={(d) => {
              loadIntoCanvas(d.smiles);
              if (d.target) setSelectedTarget(d.target);
              if (d.mutation && d.mutation !== "WT") {
                setSelectedMutation(d.mutation);
                setIncludeWt(false);
              } else {
                setSelectedMutation("");
                setIncludeWt(true);
              }
              // Make the restored draft the active one so subsequent
              // edits update it in place rather than starting fresh.
              setActiveDraft(d);
              setShowHistory(false);
            }}
            onDelete={(id) => {
              deleteDraft(id);
              if (activeDraft?.id === id) setActiveDraft(null);
            }}
          />
        </CollapsibleTab>
      </div>
    </div>
  );
}

/** Collapsible bottom-strip tab. Closed = just a ▸ Label header.
 *  Open = expands upward as a 240px-tall panel above the strip. */
/** (v0.31) Drafts panel — list of every autosaved compound. Lives in
 *  the bottom-strip "Drafts" tab. State is a snapshot of localStorage
 *  taken on mount and every time the parent toggles the tab open;
 *  refresh via a small ✻ refresh button if needed. (Kept local rather
 *  than reactive because the autosave loop already owns the source of
 *  truth — pulling on demand avoids a storage-event subscription.)
 */
/** (v0.40) Mutation dropdown body — shared between the up-direction
 *  and down-direction render paths in the MUTATIONS section. Same
 *  visual treatment in both cases; only the relative position to the
 *  trigger row differs. Click-outside is owned by the parent (via
 *  mutationWrapRef); this component just handles the rows + the Done
 *  button. Selecting a row no longer auto-closes — user explicitly
 *  dismisses via Done or by clicking outside (v0.40 user request).
 */
function MutationDropdown({
  availableMutations, mutationQuery, selectedMutations, includeWt,
  setIncludeWt, toggleMutation, setMutationQuery, setOpen, targetId, maxMutations,
}: {
  availableMutations: { code: string; label: string; significance: string }[];
  mutationQuery: string;
  selectedMutations: string[];
  includeWt: boolean;
  setIncludeWt: (v: boolean) => void;
  toggleMutation: (code: string) => void;
  setMutationQuery: (v: string) => void;
  setOpen: (v: boolean) => void;
  targetId?: string;
  maxMutations: number;
}) {
  // (v0.62) Singleton-compat helper for code paths that reference
  // selectedMutation as a string — first selected mutation = primary.
  // Currently no callsite inside MutationDropdown uses it (we drive
  // off selectedMutations directly), but kept for future readers.
  void selectedMutations;  // referenced via selectedMutations.includes() below
  const filtered = availableMutations.filter(m =>
    !mutationQuery ||
    m.code.toLowerCase().includes(mutationQuery.toLowerCase()) ||
    (m.label || "").toLowerCase().includes(mutationQuery.toLowerCase()) ||
    (m.significance || "").toLowerCase().includes(mutationQuery.toLowerCase())
  );
  return (
    <div className="rounded border border-slate-800 bg-[#070b15] mb-2 shadow-xl flex flex-col" style={{ maxHeight: "min(320px, 60vh)" }}>
      <div className="overflow-auto divide-y divide-slate-800/60 flex-1 min-h-0">
        <button
          onClick={() => setIncludeWt(!includeWt)}
          className={`w-full px-3 py-1.5 flex items-center gap-2 text-left transition-colors ${
            includeWt ? "bg-slate-800/40 hover:bg-slate-800/60" : "hover:bg-slate-800/30"
          }`}
          title={includeWt ? "WT selected — click to deselect" : "Click to include WT in the dock"}
        >
          <span className={`w-3 h-3 rounded-sm border flex items-center justify-center text-[8px] shrink-0 ${
            includeWt ? "border-slate-300 bg-slate-300 text-slate-900" : "border-slate-600"
          }`}>
            {includeWt ? "✓" : ""}
          </span>
          <span className="font-mono text-[11px] font-bold text-slate-100">WT</span>
          <span className="text-[9px] uppercase tracking-[0.18em] text-slate-500 px-1.5 py-0.5 rounded bg-slate-800/60">baseline</span>
          <span className="text-[10px] font-mono text-slate-500 italic truncate">wild-type — always recommended</span>
        </button>
        {filtered.map((m) => {
          // (v0.62) Multi-select up to MAX_MUTATIONS. Active = currently
          // in the selected array. Click toggles in/out; tickets are
          // capped at maxMutations on the way in.
          const active = selectedMutations.includes(m.code);
          const atCap = !active && selectedMutations.length >= maxMutations;
          return (
            <button
              key={m.code}
              disabled={atCap}
              onClick={() => {
                toggleMutation(m.code);
                setMutationQuery("");
              }}
              className={`w-full px-3 py-1.5 flex items-center gap-2 text-left transition-colors ${
                active ? "bg-amber-950/30 hover:bg-amber-900/40" : "hover:bg-slate-800/30"
              }`}
              title={m.significance || m.label}
            >
              <span className={`w-3 h-3 rounded-sm border flex items-center justify-center text-[8px] shrink-0 ${
                active ? "border-amber-400 bg-amber-400 text-slate-900" : "border-slate-600"
              }`}>
                {active ? "✓" : ""}
              </span>
              <span className={`font-mono text-[11px] font-bold shrink-0 ${active ? "text-amber-200" : "text-slate-100"}`}>
                {m.code}
              </span>
              {targetId && (
                <span className="text-[9px] uppercase tracking-[0.18em] text-slate-500 shrink-0">
                  {targetId}
                </span>
              )}
              <span className="text-[10px] font-mono text-slate-400 truncate min-w-0 flex-1" title={m.significance}>
                {m.significance || m.label || "—"}
              </span>
              <span className="text-[8px] uppercase tracking-[0.18em] text-cyan-300/80 px-1.5 py-0.5 rounded border border-cyan-700/40 bg-cyan-950/30 shrink-0">
                curated
              </span>
            </button>
          );
        })}
        {mutationQuery && filtered.length === 0 && (
          <div className="px-3 py-2 text-[10px] font-mono text-amber-400/80 italic">
            no curated match for “{mutationQuery}” — press Enter to use it as a custom mutation
          </div>
        )}
      </div>
      {/* (v0.40) Done bar — explicit dismissal so the user can review
          their pick before closing. Click-outside also still works.
          (v0.84) Selected mutations now render as individual removable
          chips with an × per chip — previously the only "remove" path
          for custom-typed mutations was clicking the row in the curated
          list above, which doesn't have a row for free-text additions.
          Now T315I + Q561Z each have their own × that fires
          toggleMutation(code) and drops them from selectedMutations. */}
      <div className="px-3 py-1.5 border-t border-slate-800/70 flex items-center justify-between gap-2 text-[10px] font-mono shrink-0">
        <span className="text-slate-600 flex items-center gap-1.5 flex-wrap min-w-0">
          {selectedMutations.length > 0 ? (
            <>
              <span>selected</span>
              {selectedMutations.map((code) => (
                <span
                  key={code}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-700/60 bg-amber-950/40 text-amber-200"
                >
                  {code}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMutation(code);
                    }}
                    className="text-amber-400/60 hover:text-rose-300 leading-none"
                    title={`Remove ${code} from the selection`}
                    aria-label={`Remove ${code}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              {includeWt && <span className="text-slate-500">+ WT</span>}
            </>
          ) : includeWt ? (
            <span className="text-slate-400">WT only</span>
          ) : (
            <span className="text-rose-400">none — pick at least one</span>
          )}
          {selectedMutations.length >= maxMutations && (
            <span className="text-slate-700">(max {maxMutations})</span>
          )}
        </span>
        <button
          onClick={() => setOpen(false)}
          className="px-2 py-0.5 rounded border border-cyan-600/60 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 hover:border-cyan-500/60 uppercase tracking-wider shrink-0"
        >
          done
        </button>
      </div>
    </div>
  );
}

/** (v0.36) Promote / Save-as-new modal — Studio-aesthetic replacement
 *  for the v0.32 window.prompt. One component, two modes:
 *
 *    mode="promote" — turn an autosaved draft into a permanent
 *      library entry. Copy says "Save to library".
 *
 *    mode="fork" — the user edited a loaded named compound and is
 *      branching it. Copy reassures them the original (originalName)
 *      stays intact.
 *
 *  Cancel via Esc or backdrop click. Submit via Return. Empty name
 *  is rejected client-side. The actual API call lives here so the
 *  parent can stay declarative — onSaved fires with the chosen name
 *  on success.
 */
function PromoteDialog({
  mode, initialName, originalName, smiles, onClose, onSaved, onError,
}: {
  mode: "promote" | "fork";
  initialName: string;
  originalName?: string;
  smiles: string;
  onClose: () => void;
  onSaved: (name: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Focus input on mount so the user can just type.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  // Esc closes — same convenience as the CompoundLoader modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await api.saveMyCompound({ name: trimmed, smiles });
      onSaved(trimmed);
    } catch (e: any) {
      onError(e?.message || "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  const title = mode === "promote" ? "Save to library" : "Save fork as new";
  const subtitle = mode === "promote"
    ? "Pick a name. The autosaved draft will be cleaned up and replaced by a permanent library entry."
    : `Pick a name. "${originalName}" will stay untouched in your library and the modified compound will be saved alongside it.`;
  const submitLabel = submitting
    ? "▶ saving…"
    : mode === "promote" ? "⇡ Save to library" : "⇡ Save as new";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#0d1422] border border-slate-800/80 rounded shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2.5 border-b border-slate-800/70 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.18em] text-cyan-400">{title}</span>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300 text-[14px]" title="Cancel (Esc)">✕</button>
        </div>
        <div className="px-4 py-3">
          <p className="text-[11px] font-mono text-slate-400 leading-relaxed mb-3">{subtitle}</p>
          <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">Name</label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            placeholder="e.g. EGFR-T790M-lead-3 · Erlotinib variant"
            className="w-full px-3 py-2 text-[12px] font-mono rounded border border-slate-700/60 text-slate-200 placeholder:text-slate-600 bg-[#070b15] focus:outline-none focus:border-cyan-500/60"
          />
          <div className="mt-2 text-[10px] font-mono text-slate-600 truncate" title={smiles}>
            <span className="text-slate-700">SMILES </span>
            {smiles.length > 56 ? smiles.slice(0, 56) + "…" : smiles}
          </div>
        </div>
        <div className="px-4 py-2.5 border-t border-slate-800/70 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1 rounded border border-slate-700 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60 font-mono text-[11px] uppercase tracking-wider"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim()}
            className={`px-3 py-1 rounded border font-mono text-[11px] uppercase tracking-wider transition-colors ${
              submitting
                ? "border-cyan-500/50 bg-cyan-950/40 text-cyan-300 animate-pulse cursor-wait"
                : !name.trim()
                ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                : "border-emerald-600/60 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 hover:border-emerald-500"
            }`}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** (v0.35) Session dock-history panel. Lists every Quick Dock that
 *  ran in Studio this session (and across recent sessions, since the
 *  log lives in localStorage). Click a row to restore that run's
 *  SMILES + target + mutation back into Studio.
 */
function DockHistoryPanel({
  onRestore,
}: {
  onRestore: (e: DockHistoryEntry) => void;
}) {
  const [entries, setEntries] = useState<DockHistoryEntry[]>(() => listDockHistory());
  useEffect(() => {
    setEntries(listDockHistory());
    const t = window.setInterval(() => setEntries(listDockHistory()), 5000);
    return () => window.clearInterval(t);
  }, []);

  if (entries.length === 0) {
    return (
      <div className="p-3 text-[11px] font-mono text-slate-500">
        <div className="mb-1">No docks run yet this session.</div>
        <div className="text-slate-600 text-[10px]">
          Every successful Quick Dock gets logged here. Click a row to restore the SMILES, target, and mutation back into Studio
          so you can compare runs without re-docking.
        </div>
      </div>
    );
  }

  const fmtAgo = (iso: string): string => {
    const dt = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (dt < 60) return `${dt}s`;
    if (dt < 3600) return `${Math.floor(dt / 60)}m`;
    if (dt < 86400) return `${Math.floor(dt / 3600)}h`;
    return `${Math.floor(dt / 86400)}d`;
  };

  return (
    <div className="overflow-auto max-h-full">
      <div className="px-3 py-2 border-b border-slate-800/70 flex items-center justify-between text-[10px] font-mono">
        <span className="text-slate-500 uppercase tracking-[0.18em]">{entries.length} run{entries.length === 1 ? "" : "s"}</span>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Clear all ${entries.length} dock-history entries? This cannot be undone.`)) {
              clearDockHistory();
              setEntries([]);
            }
          }}
          className="text-slate-600 hover:text-rose-400 text-[10px]"
          title="Wipe the entire session dock history. Doesn't affect your /jobs archive."
        >
          clear all
        </button>
      </div>
      <div className="divide-y divide-slate-800/60">
        {entries.map((e) => (
          <div key={e.id} className="px-3 py-2 flex items-center gap-3 text-[11px] font-mono hover:bg-slate-800/30">
            <button
              onClick={() => onRestore(e)}
              className="flex-1 text-left flex items-center gap-3 min-w-0"
              title="Restore this run into Studio"
            >
              <span className={`tabular-nums shrink-0 ${
                e.score == null ? "text-slate-500"
                : e.score <= -9 ? "text-emerald-300"
                : e.score <= -7 ? "text-emerald-400"
                : e.score <= -5 ? "text-cyan-300"
                : "text-amber-300"
              }`}>
                {e.score != null ? `${e.score.toFixed(2)}` : "—.——"}
              </span>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider shrink-0">
                {e.target}{e.mutation && e.mutation !== "WT" ? ` · ${e.mutation}` : " · WT"}
              </span>
              {e.compoundName && (
                <span className="text-cyan-300 truncate min-w-0 max-w-[16ch]">{e.compoundName}</span>
              )}
              <span className="text-[10px] text-slate-500 truncate min-w-0" title={e.smiles}>
                {e.smiles.length > 36 ? e.smiles.slice(0, 36) + "…" : e.smiles}
              </span>
              {e.kdLabel && (
                <span className="text-[10px] text-slate-500 shrink-0" title="Estimated Kd at 298K from ΔG.">~{e.kdLabel}</span>
              )}
              {e.poseInPocket === false && (
                <span className="text-[10px] text-amber-400 shrink-0" title="Pose drifted off-pocket — score is real but pose isn't in the canonical site.">⚠ off</span>
              )}
              <span className="text-[10px] text-slate-600 ml-auto shrink-0">{fmtAgo(e.ranAt)} ago</span>
            </button>
            <button
              onClick={(e2) => {
                e2.stopPropagation();
                deleteDockHistoryEntry(e.id);
                setEntries(listDockHistory());
              }}
              className="text-slate-600 hover:text-rose-400 px-1 text-[12px] shrink-0"
              title="Remove this entry from history"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** (v0.34) AI Variants panel — generates 3 AI-suggested compound
 *  modifications based on the most recent dock result, then displays
 *  them as cards with score/Δ/SA/contacts and a "use this variant"
 *  button that loads the variant into Studio.
 *
 *  Hard requires a parent dock: the /assist/optimize endpoint needs
 *  parent score + hits + misses + receptor context to design useful
 *  modifications. Pre-dock the panel shows a "run a dock first" hint.
 */
type AiVariant = {
  new_smiles: string;
  rationale: string;
  score?: number;
  delta?: number;
  sa_score?: number;
  fitness?: number;
  mutation_contact?: boolean;
  hits?: string[];
  misses?: string[];
  pose_in_pocket?: boolean;
};
function AiVariantsPanel({
  dockResult, currentSmiles, targetPdb, mutation, onUseVariant,
  submittingFull, fullJobStatus, runFullJob,
}: {
  dockResult: QuickDockResult | null;
  currentSmiles: string;
  targetPdb?: string;
  mutation?: string;
  onUseVariant: (v: AiVariant) => void;
  // (v0.60) Full Job state passed in so we can show per-card
  // applying/docking indicators and chain Apply → Full Job in one
  // click without requiring the user to find the Run Dock button.
  submittingFull: boolean;
  fullJobKey: string | null;  // accepted but not read here; parent surfaces via Run Dock area
  fullJobStatus: "pending" | "running" | "completed" | "failed" | "cancelled" | null;
  runFullJob: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<AiVariant[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // (v0.60) Persistent history of variants the user has Apply &
  // Dock'd on. Stays visible across Generate clicks so the user can
  // always go back to a previously-applied variant. Each entry has
  // an ISO timestamp captured at apply time. localStorage-backed so
  // the history survives refreshes.
  const APPLIED_KEY = "liganx-studio-applied-variants";
  type AppliedVariant = AiVariant & { appliedAt: string };
  const [appliedVariants, setAppliedVariants] = useState<AppliedVariant[]>(() => {
    if (typeof localStorage === "undefined") return [];
    try {
      const raw = localStorage.getItem(APPLIED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  // The variant the user just clicked Apply & Dock on — used to
  // show a "applying compound + submitting dock…" mini-state on
  // that specific card while the dock is in flight.
  const [pendingVariantSmiles, setPendingVariantSmiles] = useState<string | null>(null);
  // Clear the pending state once Full Job submission lands AND the
  // job moved past the queued/pending phase. We can't just watch
  // submittingFull — it flips back to false in <1s once createJob
  // returns; we want to keep the indicator until the job's actually
  // running.
  useEffect(() => {
    if (!pendingVariantSmiles) return;
    if (fullJobStatus === "running" || fullJobStatus === "completed" || fullJobStatus === "failed" || fullJobStatus === "cancelled") {
      setPendingVariantSmiles(null);
    }
  }, [fullJobStatus, pendingVariantSmiles]);

  async function generate() {
    if (!dockResult || !currentSmiles || dockResult.score == null) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await api.assistOptimize({
        smiles: currentSmiles,
        score: dockResult.score,  // narrowed by guard above
        hits: dockResult.hits || [],
        misses: dockResult.misses || [],
        target_pdb: targetPdb,
        mutations: mutation,
        parent_pose_pdbqt_b64: dockResult.pose_pdbqt_b64,
      });
      setVariants(res.variants || []);
    } catch (e: any) {
      setErr(e?.message || "AI optimize failed");
    } finally {
      setLoading(false);
    }
  }

  if (!dockResult) {
    return (
      <div className="p-3 text-[11px] font-mono text-slate-500">
        <div className="mb-1">No dock result yet.</div>
        <div className="text-slate-600 text-[10px]">
          Run a Quick Dock first — the AI uses the parent score, hits, and pose to design 3 variants
          aimed at engaging missed pocket residues and the mutation site.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-auto max-h-full">
      <div className="px-3 py-2 border-b border-slate-800/70 flex items-center justify-between text-[10px] font-mono">
        <span className="text-slate-500 uppercase tracking-[0.18em]">
          AI variants {variants ? `· ${variants.length}` : ""}
        </span>
        <button
          type="button"
          onClick={generate}
          disabled={loading || !currentSmiles}
          className={`px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider transition-colors ${
            loading
              ? "border-cyan-500/50 bg-cyan-950/40 text-cyan-300 animate-pulse cursor-wait"
              : "border-cyan-700/50 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 hover:border-cyan-500/60"
          }`}
          title="Generate 3 AI-suggested variants designed to improve binding to the misses + mutation site."
        >
          {loading ? "▶ generating…" : variants ? "↻ regenerate" : "✨ generate variants"}
        </button>
      </div>
      {err && (
        <div className="px-3 py-2 text-[10px] font-mono text-rose-300 bg-rose-950/30 border-b border-rose-900/60">
          ✗ {err}
        </div>
      )}
      {!variants && !loading && !err && (
        <div className="p-3 text-[10px] font-mono text-slate-600 italic">
          Click ✨ generate variants to ask the AI for 3 candidates that engage the {((dockResult.misses || []).length || 0)} missed
          residues{mutation && mutation !== "WT" ? ` and the ${mutation} mutation site` : ""}.
        </div>
      )}
      {loading && (
        <div className="p-3 text-[10px] font-mono text-cyan-300/70 animate-pulse">
          ▮ asking the AI for 3 variants… typical wait 20-40 s (generate → score → filter → dock).
        </div>
      )}
      {variants && variants.length === 0 && (
        <div className="p-3 text-[10px] font-mono text-slate-600 italic">
          AI returned no variants for this query.
        </div>
      )}
      {variants && variants.length > 0 && (
        <div className="divide-y divide-slate-800/60">
          {variants.map((v, i) => {
            // (v0.60) Track per-card state. A variant is "pending" if
            // the user just clicked Apply & Dock and the job hasn't
            // moved to running yet; "applied" if it's in the history.
            const isPending = pendingVariantSmiles === v.new_smiles;
            const wasApplied = appliedVariants.some((a) => a.new_smiles === v.new_smiles);
            return (
            <div key={i} className={`px-3 py-2 text-[11px] font-mono ${isPending ? "bg-emerald-950/30" : "hover:bg-slate-800/30"}`}>
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <span className="text-[9px] uppercase tracking-[0.18em] text-slate-600">▸ variant {i + 1}</span>
                {v.score != null && (
                  <span className="text-cyan-300 tabular-nums" title={`Vina score (kcal/mol) of the docked variant — lower is stronger.`}>
                    {v.score.toFixed(2)} kcal/mol
                  </span>
                )}
                {v.delta != null && (
                  <span className={`text-[10px] tabular-nums ${v.delta > 0 ? "text-emerald-400" : "text-rose-400"}`}
                        title="Δ score versus parent (positive = improvement).">
                    {v.delta > 0 ? "+" : ""}{v.delta.toFixed(2)} Δ
                  </span>
                )}
                {v.sa_score != null && (
                  <span className="text-[10px] text-slate-500" title="Synthetic Accessibility (1=easy, 10=impossible).">
                    SA {v.sa_score.toFixed(1)}
                  </span>
                )}
                {v.mutation_contact && (
                  <span className="text-[10px] text-emerald-400" title="Variant pose contacts the mutation residue.">
                    ✓ engages mutation
                  </span>
                )}
                {v.pose_in_pocket === false && (
                  <span className="text-[10px] text-amber-400" title="Variant pose drifted off-pocket — score is real but pose isn't in the canonical site.">
                    ⚠ off-pocket
                  </span>
                )}
                {wasApplied && !isPending && (
                  <span className="text-[10px] text-emerald-300" title="You've already applied this variant. Click again to re-dock.">
                    ✓ applied
                  </span>
                )}
                <button
                  type="button"
                  disabled={isPending || submittingFull}
                  onClick={async () => {
                    setPendingVariantSmiles(v.new_smiles);
                    onUseVariant(v);
                    // Persist this as an applied variant with timestamp.
                    const stamped: AppliedVariant = { ...v, appliedAt: new Date().toISOString() };
                    setAppliedVariants((prev) => {
                      // Move-to-front behavior so newest applied is first
                      // and we don't keep duplicates of the same SMILES.
                      const filtered = prev.filter((p) => p.new_smiles !== v.new_smiles);
                      const next = [stamped, ...filtered].slice(0, 25);
                      try { localStorage.setItem(APPLIED_KEY, JSON.stringify(next)); } catch { /* */ }
                      return next;
                    });
                    // Wait a tick so currentSmiles propagates before
                    // runFullJob reads it, then submit.
                    setTimeout(() => { runFullJob(); }, 100);
                  }}
                  className={`ml-auto px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider transition-colors ${
                    isPending
                      ? "border-emerald-500/60 bg-emerald-950/40 text-emerald-300 cursor-wait animate-pulse"
                      : submittingFull
                      ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                      : "border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 hover:border-emerald-500/60"
                  }`}
                  title="Load this variant into Studio AND submit a Full Job in one click. The variant becomes a fork-draft of the parent compound and the dock starts immediately."
                >
                  {isPending ? "▶ applying + docking…" : "⤴ Apply & Dock"}
                </button>
              </div>
              <div className="text-[10px] text-slate-400 break-all" title={v.new_smiles}>
                <span className="text-slate-600">SMILES </span>
                {v.new_smiles}
              </div>
              {v.rationale && (
                <div className="text-[10px] text-slate-300/90 mt-1 italic leading-relaxed">
                  {v.rationale}
                </div>
              )}
            </div>
          );
          })}
        </div>
      )}
      {/* (v0.60) Applied history. Shows every variant the user has
          clicked Apply & Dock on, newest first, with timestamp so
          they can always go back to a previous experiment. Persists
          across Generate clicks AND across page refreshes via
          localStorage. */}
      {appliedVariants.length > 0 && (
        <div className="border-t border-slate-800/70">
          <div className="px-3 py-1.5 flex items-center justify-between text-[10px] font-mono">
            <span className="text-slate-500 uppercase tracking-[0.18em]">
              ✓ applied ({appliedVariants.length})
            </span>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Clear all ${appliedVariants.length} applied variants from history?`)) {
                  setAppliedVariants([]);
                  try { localStorage.removeItem(APPLIED_KEY); } catch { /* */ }
                }
              }}
              className="text-slate-600 hover:text-rose-400 text-[10px]"
              title="Wipe the applied history. Doesn't affect any docks already submitted to /jobs."
            >
              clear
            </button>
          </div>
          <div className="divide-y divide-slate-800/60">
            {appliedVariants.map((a) => {
              const isPending = pendingVariantSmiles === a.new_smiles;
              const dt = Math.max(0, Math.floor((Date.now() - new Date(a.appliedAt).getTime()) / 1000));
              const ago = dt < 60 ? `${dt}s` : dt < 3600 ? `${Math.floor(dt/60)}m` : dt < 86400 ? `${Math.floor(dt/3600)}h` : `${Math.floor(dt/86400)}d`;
              return (
                <div key={a.appliedAt + a.new_smiles} className={`px-3 py-1.5 text-[10px] font-mono ${isPending ? "bg-emerald-950/30" : "hover:bg-slate-800/30"}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.score != null && (
                      <span className="text-cyan-300 tabular-nums">{a.score.toFixed(2)}</span>
                    )}
                    {a.delta != null && (
                      <span className={`tabular-nums ${a.delta > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {a.delta > 0 ? "+" : ""}{a.delta.toFixed(2)} Δ
                      </span>
                    )}
                    <span className="text-slate-400 truncate min-w-0 flex-1" title={a.new_smiles}>
                      {a.new_smiles.length > 36 ? a.new_smiles.slice(0, 36) + "…" : a.new_smiles}
                    </span>
                    <span className="text-slate-600 shrink-0" title={a.appliedAt}>{ago} ago</span>
                    <button
                      type="button"
                      disabled={isPending || submittingFull}
                      onClick={() => {
                        setPendingVariantSmiles(a.new_smiles);
                        onUseVariant(a);
                        setTimeout(() => { runFullJob(); }, 100);
                      }}
                      className={`px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider shrink-0 transition-colors ${
                        isPending
                          ? "border-emerald-500/60 bg-emerald-950/40 text-emerald-300 cursor-wait animate-pulse"
                          : submittingFull
                          ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                          : "border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 hover:border-emerald-500/60"
                      }`}
                      title="Re-apply this variant and dock it again. Useful for re-running with a different mutation or comparing results."
                    >
                      {isPending ? "▶ applying…" : "⤴ re-dock"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DraftsPanel({
  activeDraftId, onRestore, onDelete,
}: {
  activeDraftId: string | null;
  onRestore: (draft: StudioDraft) => void;
  onDelete: (id: string) => void;
}) {
  const [drafts, setDrafts] = useState<StudioDraft[]>(() => listDrafts());
  const [tick, setTick] = useState(0);  // 'updated Xs ago' refresh
  // Re-read the bucket whenever the parent re-renders this panel and
  // every 5s while it's mounted. Cheap (localStorage read + sort).
  useEffect(() => {
    setDrafts(listDrafts());
    const t = window.setInterval(() => {
      setDrafts(listDrafts());
      setTick((n) => n + 1);
    }, 5000);
    return () => window.clearInterval(t);
  }, []);
  // Also resync when the active draft id changes — e.g. after a fresh
  // autosave or a restore — so the row highlight follows reality.
  useEffect(() => {
    setDrafts(listDrafts());
  }, [activeDraftId, tick]);

  if (drafts.length === 0) {
    return (
      <div className="p-3 text-[11px] font-mono text-slate-500">
        <div className="mb-1">No drafts yet.</div>
        <div className="text-slate-600 text-[10px]">
          Sketch a compound — every change is auto-saved here. Drafts persist across refreshes and tab closes.
        </div>
      </div>
    );
  }

  const fmtAgo = (iso: string): string => {
    const dt = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (dt < 60) return `${dt}s`;
    if (dt < 3600) return `${Math.floor(dt / 60)}m`;
    if (dt < 86400) return `${Math.floor(dt / 3600)}h`;
    return `${Math.floor(dt / 86400)}d`;
  };

  return (
    <div className="overflow-auto max-h-full">
      <div className="px-3 py-2 border-b border-slate-800/70 flex items-center justify-between text-[10px] font-mono">
        <span className="text-slate-500 uppercase tracking-[0.18em]">{drafts.length} draft{drafts.length === 1 ? "" : "s"}</span>
        <span className="text-slate-600 italic">
          autosave is on · click any row to restore
        </span>
      </div>
      <div className="divide-y divide-slate-800/60">
        {drafts.map((d) => {
          const isActive = d.id === activeDraftId;
          return (
            <div
              key={d.id}
              className={`px-3 py-2 flex items-center gap-3 text-[11px] font-mono transition-colors ${
                isActive ? "bg-cyan-950/20" : "hover:bg-slate-800/30"
              }`}
            >
              <button
                onClick={() => onRestore(d)}
                className="flex-1 text-left flex items-center gap-3 min-w-0"
                title="Restore this draft into Studio"
              >
                <span className={`text-[9px] uppercase tracking-[0.18em] ${isActive ? "text-cyan-400" : "text-slate-600"}`}>
                  {isActive ? "● active" : "▸"}
                </span>
                <span className={`truncate min-w-0 ${isActive ? "text-cyan-200" : "text-slate-200"}`}>
                  {d.name}
                </span>
                {d.target && (
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider shrink-0">
                    {d.target}{d.mutation && d.mutation !== "WT" ? ` · ${d.mutation}` : ""}
                  </span>
                )}
                <span className="text-[10px] text-slate-500 truncate min-w-0" title={d.smiles}>
                  {d.smiles.length > 40 ? d.smiles.slice(0, 40) + "…" : d.smiles}
                </span>
                <span className="text-[10px] text-slate-600 ml-auto shrink-0">{fmtAgo(d.updatedAt)} ago</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete draft "${d.name}"? This cannot be undone.`)) {
                    onDelete(d.id);
                    setDrafts(listDrafts());
                  }
                }}
                className="text-slate-600 hover:text-rose-400 px-1 text-[12px] shrink-0"
                title="Delete this draft permanently"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CollapsibleTab({
  label, open, onToggle, children,
}: {
  label: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="flex-1 border-r border-slate-800/70 last:border-r-0 relative">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-slate-800/30 transition-colors"
      >
        <span className={`text-cyan-400 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        <span className="uppercase tracking-[0.18em] text-slate-400 font-mono">{label}</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 h-60 bg-[#0d1422] border-t border-l border-r border-slate-800/70 overflow-auto">
          {children}
        </div>
      )}
    </div>
  );
}

/** Live SMILES validity pill — appears next to the 2D editor title.
 *  Five states (matches the underlying `SmilesValidity` type from
 *  MoleculePreview):
 *    empty      → faded "draw a structure" placeholder
 *    loading    → cyan pulsing "checking…"
 *    valid      → emerald "● Valid SMILES"
 *    invalid    → rose "✗ Invalid SMILES"  (turns red live as user edits!)
 *    fragments  → amber "⚠ Multi-fragment" (salt forms etc.)
 *  Compact (no border noise) so it sits inline with the title strip
 *  without dominating the header. */
function ValidityPill({ validity }: { validity: SmilesValidity }) {
  if (validity === "empty") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono italic text-slate-600 border border-dashed border-slate-700">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-700 inline-block" /> draw structure
      </span>
    );
  }
  const palette: Record<Exclude<SmilesValidity, "empty">, { dot: string; bg: string; label: string }> = {
    loading:   { dot: "bg-cyan-400 animate-pulse",  bg: "border-cyan-700/40 bg-cyan-950/30 text-cyan-200",         label: "checking…" },
    valid:     { dot: "bg-emerald-400",             bg: "border-emerald-700/40 bg-emerald-950/40 text-emerald-200", label: "Valid SMILES" },
    invalid:   { dot: "bg-rose-500",                bg: "border-rose-700/50 bg-rose-950/40 text-rose-200",          label: "Invalid SMILES" },
    fragments: { dot: "bg-amber-400",               bg: "border-amber-700/40 bg-amber-950/40 text-amber-200",       label: "Multi-fragment" },
  };
  const p = palette[validity];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono border ${p.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full inline-block ${p.dot}`} />
      <span>{p.label}</span>
    </span>
  );
}

/** Live Synthetic Accessibility score pill. SA score is on a [1, 10]
 *  scale where 1 = trivial to make, 10 = currently impossible. The
 *  three-bucket coloring matches medchem convention:
 *    ≤ 4   → emerald · "easy"     (Med chem labs make these in days)
 *    4-6   → amber  · "moderate"  (Achievable, multi-step synthesis)
 *    > 6   → rose   · "hard"      (Often skipped in real campaigns)
 *  Hidden when SMILES isn't valid yet (the parent ValidityPill covers
 *  that state). */
function SaScorePill({ sa }: { sa: { score: number; label: string } | null }) {
  if (!sa) return null;
  const tone =
    sa.score <= 4 ? { bg: "border-emerald-700/40 bg-emerald-950/40 text-emerald-200", dot: "bg-emerald-400" }
    : sa.score <= 6 ? { bg: "border-amber-700/40 bg-amber-950/40 text-amber-200", dot: "bg-amber-400" }
    : { bg: "border-rose-700/40 bg-rose-950/40 text-rose-200", dot: "bg-rose-500" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono border ${tone.bg}`}
      title={`Synthetic accessibility ${sa.score.toFixed(1)} / 10 (${sa.label}). 1 = trivial, 10 = currently impossible. Above 6 means a typical med chem lab will not attempt this.`}
    >
      <span className={`w-1.5 h-1.5 rounded-full inline-block ${tone.dot}`} />
      <span>SA {sa.score.toFixed(1)} · {sa.label}</span>
    </span>
  );
}

/** Compound loader panel — slides down below the canvas header when
 *  the user clicks "load compound". Three sources:
 *   1. Reference compounds for the currently-selected target (e.g. EGFR
 *      ships with gefitinib/erlotinib/osimertinib/afatinib). Most useful
 *      starting point — these are the ground-truth inhibitors the
 *      mutation set is calibrated against.
 *   2. The user's saved library (CompoundsPage entries).
 *   3. A free-form SMILES paste box for ad-hoc structures.
 *
 *  Selecting any entry calls Ketcher's setMolecule() and closes the
 *  panel. The 3D viewer picks up the change automatically via the
 *  SMILES polling tick. */
function CompoundLoader({
  targetMeta, myCompounds, onPick, onClose, stagedCount, maxStaged, stagedSmiles, stagedNames,
}: {
  targetMeta: any;
  myCompounds: any[];
  // (v0.65) onPick is a TOGGLE: clicking an unstaged compound adds
  // it; clicking a staged one removes it. Staged-state UI is driven
  // by two arrays: stagedSmiles (canonical match for Reference +
  // My Library rows) and stagedNames (case-insensitive match for
  // PubChem rows where the SMILES isn't known until /lookup
  // resolves). v0.66 added stagedNames so PubChem checkboxes light
  // up the moment a name has been added to the suite.
  onPick: (smiles: string, name?: string) => void;
  onClose: () => void;
  stagedCount: number;
  maxStaged: number;
  stagedSmiles: string[];
  stagedNames: string[];
}) {
  const [paste, setPaste] = useState("");
  const [search, setSearch] = useState("");
  // PubChem live autocomplete — debounced 250ms after typing settles.
  // Backed by /lookup/compound/suggest which proxies PubChem's
  // autocomplete endpoint. Returns up to 8 name suggestions.
  const [pubchemSuggestions, setPubchemSuggestions] = useState<string[]>([]);
  const [pubchemLoading, setPubchemLoading] = useState(false);
  const [pubchemErr, setPubchemErr] = useState<string | null>(null);
  // When a user clicks a PubChem name, we fire /lookup/compound to
  // resolve to SMILES. Loading state per-name so multiple clicks don't
  // race or flicker the global spinner.
  const [resolvingName, setResolvingName] = useState<string | null>(null);

  const refCompounds = (targetMeta?.compounds ?? []) as { name: string; smiles: string; mechanism?: string }[];
  const q = search.trim().toLowerCase();
  const filteredRef = q
    ? refCompounds.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.smiles.toLowerCase().includes(q) ||
        (c.mechanism || "").toLowerCase().includes(q))
    : refCompounds;
  const filteredLib = q
    ? myCompounds.filter(c =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.smiles || "").toLowerCase().includes(q))
    : myCompounds;

  // PubChem autocomplete — debounced 250ms. Skip when query is shorter
  // than 2 chars (too noisy) or matches an existing reference/library
  // name exactly (we already have it locally).
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed.length < 2) {
      setPubchemSuggestions([]);
      setPubchemErr(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setPubchemLoading(true);
      setPubchemErr(null);
      try {
        const res = await api.suggestCompound(trimmed);
        if (cancelled) return;
        setPubchemSuggestions(res.suggestions || []);
      } catch (e: any) {
        if (!cancelled) setPubchemErr(e?.message || "PubChem lookup failed");
      } finally {
        if (!cancelled) setPubchemLoading(false);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [search]);

  async function loadFromPubChem(name: string) {
    // (v0.66) If this PubChem name is already staged, just call
    // onPick with whatever SMILES the parent has under that name —
    // the toggle path will remove it. Saves a redundant /lookup.
    const alreadyStagedIdx = stagedNames.findIndex((n) => n.toLowerCase() === name.toLowerCase());
    if (alreadyStagedIdx >= 0) {
      const stagedSmiles_ = stagedSmiles[alreadyStagedIdx];
      if (stagedSmiles_) onPick(stagedSmiles_, name);
      return;
    }
    setResolvingName(name);
    setPubchemErr(null);
    try {
      const res = await api.lookupCompound(name);
      if (res?.smiles) {
        // Pass the PubChem name as the loaded-compound identity so
        // fork-on-edit treats post-load edits as a fork (v0.33).
        onPick(res.smiles, name);
      } else {
        setPubchemErr(`PubChem returned no SMILES for "${name}"`);
      }
    } catch (e: any) {
      setPubchemErr(e?.message || `Couldn't resolve "${name}"`);
    } finally {
      setResolvingName(null);
    }
  }

  return (
    // (v0.28.1) Outer positioning removed — this component now renders
    // inside a centered modal panel rendered at the StudioPage root, so
    // it just needs to fill its container. Caller controls the backdrop
    // and the close-on-click-outside behaviour.
    <div className="bg-[#0d1422] flex-1 overflow-auto flex flex-col">
      {/* (v0.64) Header bar — shows the running count of compounds
          staged so the user knows how many they've picked so far and
          how many slots remain. */}
      <div className="px-3 py-2 border-b border-slate-800/70 flex items-center justify-between text-[11px] font-mono shrink-0">
        <span className="text-slate-400">
          Pick compounds — <span className="text-cyan-300">{stagedCount}</span> / {maxStaged} staged
        </span>
        {stagedCount >= maxStaged && (
          <span className="text-amber-400 text-[10px]">max reached — click Done to dock</span>
        )}
      </div>
      {/* Search bar — filters both reference + library lists */}
      <div className="px-3 py-2 border-b border-slate-800/70 flex items-center gap-2">
        <span className="text-cyan-400 text-xs">🔍</span>
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter by name, SMILES, or mechanism…"
          className="flex-1 bg-transparent border-none outline-none font-mono text-xs text-slate-200 placeholder:text-slate-600"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-slate-500 hover:text-slate-200 font-mono text-[10px]">clear</button>
        )}
      </div>
      {/* PubChem live suggestions — populated as the user types.
          Click any pill to resolve via /lookup/compound and load the
          SMILES into Ketcher. This is the same data source NewJobPage's
          name-lookup uses, so anything you can type in /new also works
          here (drugs, metabolites, IUPAC names). */}
      {search.trim().length >= 2 && (pubchemLoading || pubchemSuggestions.length > 0 || pubchemErr) && (
        <div className="px-3 py-2 border-b border-slate-800/70 bg-[#070b15]">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] uppercase tracking-[0.18em] text-cyan-500">PubChem</span>
            {pubchemLoading && <span className="text-[10px] font-mono text-slate-500 animate-pulse">▮ searching…</span>}
            {!pubchemLoading && pubchemSuggestions.length > 0 && (
              <span className="text-[10px] font-mono text-slate-600">{pubchemSuggestions.length} matches</span>
            )}
            {!pubchemLoading && !pubchemErr && pubchemSuggestions.length === 0 && search.trim().length >= 2 && (
              <span className="text-[10px] font-mono text-slate-600 italic">no match</span>
            )}
            {pubchemErr && (
              <span className="text-[10px] font-mono text-rose-400">{pubchemErr}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pubchemSuggestions.map((name) => {
              // (v0.66) PubChem rows match by NAME since SMILES isn't
              // known client-side until /lookup resolves. The parent
              // stores compound.name on every staged entry that came
              // through onPick(smiles, name), so a case-insensitive
              // name lookup gives us the right answer for PubChem
              // names that have been added to the suite.
              const checked = stagedNames.some((n) => n.toLowerCase() === name.toLowerCase());
              const atCap = !checked && stagedCount >= maxStaged;
              return (
                <button
                  key={name}
                  onClick={() => loadFromPubChem(name)}
                  disabled={resolvingName !== null || atCap}
                  className={`px-2 py-1 font-mono text-[11px] rounded border transition-colors flex items-center gap-1.5 ${
                    resolvingName === name
                      ? "border-cyan-500/60 bg-cyan-900/40 text-cyan-200 animate-pulse"
                      : checked
                      ? "border-emerald-500/60 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40"
                      : atCap
                      ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                      : "border-cyan-700/40 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 hover:border-cyan-500/60 disabled:opacity-50 disabled:cursor-wait"
                  }`}
                  title={checked ? `"${name}" is staged — click to remove` : atCap ? `Max ${maxStaged} compounds reached` : `Resolve "${name}" via PubChem and add to suite`}
                >
                  <span className={`w-3 h-3 rounded-sm border inline-flex items-center justify-center text-[8px] shrink-0 ${
                    checked ? "border-emerald-400 bg-emerald-400 text-slate-900 font-bold" : "border-slate-600"
                  }`}>
                    {checked ? "✓" : ""}
                  </span>
                  {resolvingName === name ? `▮ ${name}` : name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* Empty-state hint — only when literally nothing matched anywhere */}
      {q && filteredRef.length === 0 && filteredLib.length === 0 && pubchemSuggestions.length === 0 && !pubchemLoading && (
        <div className="px-3 py-2 bg-amber-950/20 border-b border-amber-900/40 text-[11px] font-mono text-amber-200">
          ⚠ no match for &ldquo;<span className="text-amber-100">{search}</span>&rdquo; in reference compounds, your library, or PubChem.
          {" "}Use the <span className="text-amber-100">Paste SMILES</span> column on the right to load by structure instead.
        </div>
      )}
      <div className="grid grid-cols-3 divide-x divide-slate-800/70">
        {/* Reference compounds for current target */}
        <div className="p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2 flex items-center gap-2">
            <span>Reference · {targetMeta?.id?.toUpperCase() || "—"}</span>
            <span className="text-slate-700">{filteredRef.length}{q && refCompounds.length !== filteredRef.length ? `/${refCompounds.length}` : ""}</span>
          </div>
          <div className="space-y-1">
            {filteredRef.length > 0 ? filteredRef.map((c) => {
              const checked = stagedSmiles.includes(c.smiles);
              const atCap = !checked && stagedCount >= maxStaged;
              return (
                <button
                  key={c.name}
                  disabled={atCap}
                  onClick={() => onPick(c.smiles, c.name)}
                  className={`w-full text-left px-2 py-1.5 rounded border transition-colors group flex items-start gap-2 ${
                    checked
                      ? "border-emerald-500/60 bg-emerald-950/20"
                      : atCap
                      ? "border-slate-800 bg-slate-900/30 cursor-not-allowed opacity-50"
                      : "border-slate-800 hover:border-cyan-700/50 hover:bg-cyan-950/20"
                  }`}
                  title={checked ? "Already staged — click to remove from suite" : atCap ? `Max ${maxStaged} compounds reached` : "Click to add to suite"}
                >
                  <span className={`mt-0.5 w-4 h-4 rounded-sm border flex items-center justify-center text-[10px] shrink-0 ${
                    checked
                      ? "border-emerald-400 bg-emerald-400 text-slate-900 font-bold"
                      : "border-slate-600"
                  }`}>
                    {checked ? "✓" : ""}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={`font-mono text-xs ${checked ? "text-emerald-200" : "text-slate-200 group-hover:text-cyan-200"}`}>{c.name}</div>
                    {c.mechanism && (
                      <div className="font-mono text-[10px] text-slate-500 truncate" title={c.mechanism}>
                        {c.mechanism}
                      </div>
                    )}
                  </div>
                </button>
              );
            }) : (
              <div className="font-mono text-[11px] text-slate-600 italic">{q ? "no match" : "Pick a target first"}</div>
            )}
          </div>
        </div>

        {/* User's saved library */}
        <div className="p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2 flex items-center gap-2">
            <span>My Library</span>
            <span className="text-slate-700">{filteredLib.length}{q && myCompounds.length !== filteredLib.length ? `/${myCompounds.length}` : ""}</span>
          </div>
          <div className="space-y-1">
            {filteredLib.length > 0 ? filteredLib.slice(0, 30).map((c) => {
              const checked = stagedSmiles.includes(c.smiles);
              const atCap = !checked && stagedCount >= maxStaged;
              return (
                <button
                  key={c.id}
                  disabled={atCap}
                  onClick={() => onPick(c.smiles, c.name)}
                  className={`w-full text-left px-2 py-1.5 rounded border transition-colors group flex items-start gap-2 ${
                    checked
                      ? "border-emerald-500/60 bg-emerald-950/20"
                      : atCap
                      ? "border-slate-800 bg-slate-900/30 cursor-not-allowed opacity-50"
                      : "border-slate-800 hover:border-cyan-700/50 hover:bg-cyan-950/20"
                  }`}
                  title={checked ? "Already staged — click to remove from suite" : atCap ? `Max ${maxStaged} compounds reached` : "Click to add to suite"}
                >
                  <span className={`mt-0.5 w-4 h-4 rounded-sm border flex items-center justify-center text-[10px] shrink-0 ${
                    checked
                      ? "border-emerald-400 bg-emerald-400 text-slate-900 font-bold"
                      : "border-slate-600"
                  }`}>
                    {checked ? "✓" : ""}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={`font-mono text-xs truncate ${checked ? "text-emerald-200" : "text-slate-200 group-hover:text-cyan-200"}`}>{c.name}</div>
                    <div className="font-mono text-[10px] text-slate-500 truncate" title={c.smiles}>
                      {c.smiles}
                    </div>
                  </div>
                </button>
              );
            }) : (
              <div className="font-mono text-[11px] text-slate-600 italic">{q ? "no match" : "No saved compounds yet"}</div>
            )}
            {filteredLib.length > 30 && (
              <div className="font-mono text-[10px] text-slate-600 italic px-2">
                +{filteredLib.length - 30} more — refine search above
              </div>
            )}
          </div>
        </div>

        {/* Paste SMILES */}
        <div className="p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">Paste SMILES</div>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O"
            className="w-full h-20 p-2 bg-[#070b15] border border-slate-800 rounded font-mono text-[11px] text-slate-200 resize-none focus:outline-none focus:border-cyan-600/60"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => paste.trim() && onPick(paste.trim())}
              disabled={!paste.trim()}
              className="px-3 py-1 rounded border border-cyan-600/60 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 disabled:border-slate-800 disabled:bg-slate-900/30 disabled:text-slate-600 disabled:cursor-not-allowed font-mono text-[10px] uppercase tracking-wider transition-colors"
            >
              ⏵ Load
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1 rounded border border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-600 font-mono text-[10px] uppercase tracking-wider transition-colors"
            >
              cancel
            </button>
          </div>
          <div className="mt-2 text-[10px] font-mono text-slate-600">
            Examples: <button onClick={() => onPick("CC(=O)Oc1ccccc1C(=O)O")} className="text-cyan-500 hover:text-cyan-300 underline">aspirin</button>
            {" · "}
            <button onClick={() => onPick("CC(C)Cc1ccc(C(C)C(=O)O)cc1")} className="text-cyan-500 hover:text-cyan-300 underline">ibuprofen</button>
            {" · "}
            <button onClick={() => onPick("CN1CCC[C@H]1c1cccnc1")} className="text-cyan-500 hover:text-cyan-300 underline">nicotine</button>
          </div>
        </div>
      </div>
      {/* (v0.64) Sticky Done bar — explicit dismissal so the user can
          pick multiple compounds without the modal closing on each
          click. Backdrop click + Esc still close as before. */}
      <div className="px-3 py-2 border-t border-slate-800/70 flex items-center justify-between text-[11px] font-mono shrink-0 bg-[#0d1422]">
        <span className="text-slate-500">
          {stagedCount === 0
            ? "Pick at least one compound, or close to cancel."
            : <>{stagedCount} compound{stagedCount === 1 ? "" : "s"} staged</>}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1 rounded border border-cyan-600/60 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 hover:border-cyan-500/60 uppercase tracking-wider"
        >
          done
        </button>
      </div>
    </div>
  );
}

/** Production Viewer3D — unified interface using JobPage production components.
 *
 *  Reuses MutationOverlayViewer and DockedPoseViewer instead of custom inline code.
 *
 *    SMILES change (polled every 700ms from Ketcher)
 *      → debounce 350ms (avoid spamming the conformer endpoint while drawing)
 *      → POST /assist/conformer → SDF text (~100-200ms backend RDKit)
 *      → 3Dmol.js parses SDF, replaces the model in the existing scene
 *      → camera position is preserved across updates (no jarring resets)
 *
 *  Once a Quick Dock completes, this same viewer switches into "docked
 *  pose" mode: it shows the receptor (cartoon) + the docked ligand
 *  (sticks) instead of the loose conformer. Switching is automatic when
 *  `dockResult` arrives.
 *
 *  The viewer is lazy-loaded via `import("3dmol")` to keep the initial
 *  bundle small (3Dmol is ~600KB). The first SMILES change pays a one-
 *  time ~300ms cost; subsequent updates are fast.
 *
 *  Smoothness invariants:
 *   - We mount the GLViewer ONCE per component lifetime. Updates call
 *     viewer.removeAllModels() + addModel() + render() — never destroy/
 *     recreate the canvas.
 *   - Camera state (rotation/zoom) is preserved by NOT calling zoomTo()
 *     after the first model. The user's view stays put as the molecule
 *     morphs.
 *   - The conformer fetch is debounced AND deduped — if the same SMILES
 *     is asked twice, the second request short-circuits.
 */
/** Self-contained 3D viewer for Studio. Uses the same proven 3Dmol pattern
 *  as LiveConformerPlaceholder (which renders correctly) — no delegation to
 *  DockedPoseViewer (which is the kind of code path that produced an
 *  invisible canvas in v0.16/v0.16.1).
 *
 *  Pre-dock: shows the live SMILES conformer (re-fetched on edit, debounced).
 *  Post-dock: fetches the cleaned receptor PDB and overlays the docked
 *  ligand pose. Camera frames the pose centroid when available, else the
 *  whole receptor.
 */
type BackboneStyle = "cartoon" | "surface" | "line" | "hide";
type PoseStyle = "stick" | "ball" | "line" | "sphere";

function ProductionViewer3D({
  smiles,
  dockResult,
  dockResultWt,
  mutation,
  targetMeta,
}: {
  smiles: string;
  dockResult: QuickDockResult | null;
  dockResultWt: QuickDockResult | null;
  mutation: string | null;
  targetMeta: any;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const measurePicksRef = useRef<Array<{ x: number; y: number; z: number }>>([]);
  // SMILES that produced the current dockResult.pose. When the user edits
  // the 2D editor, currentSmiles diverges from this and we swap the docked
  // pose for a live conformer of the new structure (positioned at the
  // pocket center). Re-dock writes a new value and we go back to the
  // crystal-style docked pose. Stored in a ref so editing doesn't loop
  // through React state updates.
  const dockedSmilesRef = useRef<string>("");
  // Centroid of the docked pose in receptor coordinates. Used to (a) place
  // the live-conformer overlay inside the pocket when the user edits the
  // 2D structure, and (b) frame the camera consistently across pose /
  // conformer / re-dock cycles. Computed once when the pose loads.
  const poseCentroidRef = useRef<[number, number, number] | null>(null);
  const [conformerSdf, setConformerSdf] = useState<string | null>(null);
  const [conformerErr, setConformerErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // (v0.53) Both receptors fetched eagerly so the variant toggle is
  // a style change, not a fetch+rebuild. Computed values below derive
  // the "primary" and "alt" slots based on the current viewVariant for
  // backward compat with the existing build/style code.
  const [receptorPdbWt, setReceptorPdbWt] = useState<string | null>(null);
  const [receptorPdbMut, setReceptorPdbMut] = useState<string | null>(null);
  const [receptorErr, setReceptorErr] = useState<string | null>(null);
  // Live preview SMILES — set when currentSmiles diverges from the last
  // docked SMILES. Drives the conformer fetch + overlay logic below so
  // the 3D view reflects 2D edits without requiring a re-dock.
  const [editedConformerSdf, setEditedConformerSdf] = useState<string | null>(null);

  // Visual controls (mirrored from MutationOverlayViewer's toolbar). These
  // cover the 80%-case knobs a user wants when inspecting a docked pose:
  //   • backbone — cartoon (default), surface (pocket shape), line (X-ray-
  //     style), hide (pose-only). Sphere/spacefill is skipped — too heavy
  //     to render at our panel size and rarely useful for kinase work.
  //   • pose style — stick / ball-and-stick / line / sphere. Stick is the
  //     research default; ball is friendlier for outreach screenshots.
  //   • contacts — toggle the binding-pocket residue side chains.
  //   • measure — click two atoms to get distance in Å.
  // Default to line (wireframe) — matches the JobPage view users are
  // already familiar with, and keeps the receptor from occluding the
  // docked ligand. Cartoon is one click away on the toolbar for users
  // who want the publication-style ribbon view.
  const [backboneStyle, setBackboneStyle] = useState<BackboneStyle>("line");
  const [poseStyle, setPoseStyle] = useState<PoseStyle>("stick");
  const [showContacts, setShowContacts] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const [measureDistance, setMeasureDistance] = useState<number | null>(null);
  // Bumped every time createViewer runs. Click-handler / style effects
  // depend on this so they re-bind to the FRESH 3Dmol instance after a
  // rebuild (data change). Without this, measure mode silently lost its
  // click handler whenever a re-dock or 2D edit triggered a viewer
  // recreate.
  const [viewerVersion, setViewerVersion] = useState(0);
  // Fullscreen toggle — when true, the 3D panel covers the entire
  // viewport (escape key exits). Lets users zoom into atomic detail
  // without leaving the page. Same affordance as JobPage's hero viewer.
  const [fullscreen, setFullscreen] = useState(false);
  // (v0.29) View mode toggle. After a dock completes, the viewer
  // auto-switches to the docked-pose scene (receptor + bound ligand),
  // which is usually what the user wants — but sometimes they want to
  // pop back to the loose live conformer (e.g. while editing a follow-
  // up compound to compare unbound geometry vs. the docked pose). This
  // state lets the user override the default. Resets to "dock" each
  // time a fresh dockResult arrives so the new dock takes the spotlight.
  const [viewMode, setViewMode] = useState<"live" | "dock">("dock");
  // (v0.50) Variant toggle. Three states: "wt", "both", "mut". Both
  // mode overlays the WT and mutant receptors + poses in one scene
  // with distinct colors and opacity so the user can compare the
  // side-chain shift and pose differences side-by-side. "mut" is
  // the default (new biology) and auto-snaps back when a fresh
  // mutant result lands. WT-only runs default the view to "wt".
  const [viewVariant, setViewVariant] = useState<"wt" | "both" | "mut">("mut");
  useEffect(() => {
    if (dockResult) setViewVariant("mut");
    else if (dockResultWt && !dockResult) setViewVariant("wt");
  }, [dockResult, dockResultWt]);
  // (v0.53) Primary receptor = whichever the current viewVariant
  // points at. Alt = the OTHER one (used by 'both' mode for the
  // overlay). Both already in state; we just pick which slot is which
  // based on the current view.
  const receptorPdb = viewVariant === "wt" ? receptorPdbWt : receptorPdbMut;
  const receptorPdbAlt = viewVariant === "wt" ? receptorPdbMut : receptorPdbWt;

  // (v0.43) Pick which dock result drives the scene based on viewVariant.
  // Falls back gracefully when one of the two slots is empty (single-
  // variant runs default to whichever slot has a result).
  const activeDockResult = viewVariant === "wt"
    ? (dockResultWt || dockResult)
    : (dockResult || dockResultWt);
  const primary = activeDockResult;
  // pdbId/chain used to drive the (now-removed) primary-only receptor
  // fetch; replaced in v0.53 by the dual-fetch effects above. Kept the
  // variant string because it's used to color the primary receptor in
  // applyStyles (WT slate vs mutant amber).
  const variant = viewVariant === "wt" ? "WT" : (mutation || "WT");
  const hasDock = !!primary;
  // Vina returns multiple binding modes in one PDBQT (MODEL 1 ... ENDMDL ·
  // MODEL 2 ... etc — up to 9 by default). 3Dmol's addModel concatenates
  // all of them into a single model with 9× the atoms scattered across
  // space, which broke camera framing — zoomTo({model:1}) fit the bbox
  // of all 9 modes, leaving each individual mode tiny in the viewport.
  // Strip everything after the first ENDMDL so only the top-ranked pose
  // (mode 1, the one matching the score) is rendered.
  const posePdbqtFull = activeDockResult?.pose_pdbqt_b64 ? atob(activeDockResult.pose_pdbqt_b64) : "";
  // Convert PDBQT → simplified PDB before passing to 3Dmol. Two reasons:
  //   1. PDBQT contains up to 9 binding modes (MODEL/ENDMDL blocks). We
  //      only want mode 1 — the one whose score matches the panel.
  //   2. PDBQT's BRANCH / ENDBRANCH / ROOT / ENDROOT torsion-tree
  //      markers confuse 3Dmol's pdbqt parser — verified empirically:
  //      a 38-atom ligand only renders as a single OH fragment when
  //      passed as 'pdbqt' format, but renders fully when passed as
  //      'pdb'. We strip the AutoDock-specific markers and trailing
  //      charge/type columns, leaving plain PDB ATOM lines.
  const posePdbqt = (() => {
    if (!posePdbqtFull) return "";
    const endIdx = posePdbqtFull.indexOf("ENDMDL");
    const mode1 = endIdx >= 0 ? posePdbqtFull.slice(0, endIdx) : posePdbqtFull;
    const lines: string[] = [];
    for (const raw of mode1.split("\n")) {
      const line = raw.replace(/\r$/, "");
      // Keep only ATOM/HETATM lines; drop ROOT, ENDROOT, BRANCH, ENDBRANCH,
      // TORSDOF, REMARK, MODEL, etc. Trim PDBQT extras after column 66
      // (the standard PDB occupancy/B-factor fields end there) and append
      // an element guess so 3Dmol colors atoms correctly.
      if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        const trimmed = line.slice(0, 66).padEnd(66, " ");
        // Atom name is in cols 13-16 (1-indexed) = JS 12-16. Take the
        // first letter of the trimmed name as the element. AutoDock
        // names like "OA", "NA" map to O, N.
        const name = line.slice(12, 16).trim();
        const element = name.replace(/^[0-9]+/, "")[0] || "C";
        lines.push(trimmed + "          " + element.padStart(2, " "));
      }
    }
    return lines.join("\n") + "\nEND\n";
  })();
  const hasPose = hasDock && !!posePdbqt;
  // (v0.50) Alternate pose for "both" mode — the variant NOT currently
  // active. Same PDBQT→PDB conversion as the primary so 3Dmol's stable
  // 'pdb' parser handles all atoms (BRANCH atoms get dropped by the
  // pdbqt parser). Empty string when "both" isn't active or the alt
  // dock has no parseable pose.
  const altDockResult = viewVariant === "both"
    ? (variant === "WT" ? dockResult : dockResultWt)
    : null;
  const altPosePdbqtFull = altDockResult?.pose_pdbqt_b64 ? atob(altDockResult.pose_pdbqt_b64) : "";
  const altPosePdbqt = (() => {
    if (!altPosePdbqtFull) return "";
    const endIdx = altPosePdbqtFull.indexOf("ENDMDL");
    const mode1 = endIdx >= 0 ? altPosePdbqtFull.slice(0, endIdx) : altPosePdbqtFull;
    const lines: string[] = [];
    for (const raw of mode1.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        const trimmed = line.slice(0, 66).padEnd(66, " ");
        const name = line.slice(12, 16).trim();
        const element = name.replace(/^[0-9]+/, "")[0] || "C";
        lines.push(trimmed + "          " + element.padStart(2, " "));
      }
    }
    return lines.join("\n") + "\nEND\n";
  })();
  // Effective scene flag — drives the data-load effect and the
  // applyStyles branches. When the user has flipped the toolbar to
  // "live" we deliberately downgrade to the conformer-only path so
  // the receptor + pose disappear and the unbound ligand snaps to its
  // RDKit ETKDG geometry. The hasDock variable above is kept honest
  // so the score panel and other UI remain accurate.
  const showDockedScene = hasDock && viewMode === "dock";
  // Live-preview gate: true when the user has edited the 2D structure
  // since the dock that produced the current pose. While true, the 3D
  // view shows a live conformer of the edited SMILES (positioned at
  // the docked pose's centroid) instead of the now-stale docked pose.
  // Reset by a successful re-dock (which writes the new SMILES into
  // dockedSmilesRef).
  const smilesEdited = hasDock && !!smiles && !!dockedSmilesRef.current && smiles !== dockedSmilesRef.current;

  // Hits = pocket-contact residues from the dock result. Used to highlight
  // side chains and to decide whether to enable the Contacts toggle.
  // (v0.43) Track the ACTIVE dock result so flipping the variant toggle
  // updates the highlighted contacts to match the displayed pose.
  const contactResnums = useMemo<number[]>(() => {
    const hits = (activeDockResult?.hits || []) as string[];
    const out = new Set<number>();
    for (const h of hits) {
      const m = String(h).match(/(\d+)/);
      if (m) out.add(Number(m[1]));
    }
    return Array.from(out);
  }, [activeDockResult?.hits]);

  // (v0.29) When a fresh dockResult lands, default the view back to
  // the docked-pose scene. If the user manually flipped to "live"
  // before the next dock finished, we still want the new dock to
  // get the spotlight — they can flip back with one click.
  useEffect(() => {
    if (dockResult) setViewMode("dock");
  }, [dockResult]);

  // When a fresh dock arrives, snapshot the SMILES that produced it so
  // we can detect later 2D edits as "stale pose" and switch the 3D view
  // to a live conformer preview.
  useEffect(() => {
    if (hasDock && smiles && posePdbqt) {
      dockedSmilesRef.current = smiles;
      setEditedConformerSdf(null);  // clear any prior preview
      // Compute pose centroid from the PDBQT — atoms x/y/z columns are
      // 8-char fixed-width starting at col 30 (PDB format).
      try {
        const lines = posePdbqt.split("\n");
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const ln of lines) {
          if (!ln.startsWith("ATOM") && !ln.startsWith("HETATM")) continue;
          const x = parseFloat(ln.slice(30, 38));
          const y = parseFloat(ln.slice(38, 46));
          const z = parseFloat(ln.slice(46, 54));
          if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) {
            sx += x; sy += y; sz += z; n++;
          }
        }
        if (n > 0) poseCentroidRef.current = [sx/n, sy/n, sz/n];
      } catch { /* ignore — fallback to model:1 zoomTo */ }
    }
    // (v0.32) DELIBERATELY excluding `smiles` from deps. Including it
    // re-snapshots dockedSmilesRef on every keystroke, which makes
    // smilesEdited always false → LIVE mode + 2D edit kept rendering
    // the pre-edit conformer because nothing thought the SMILES had
    // diverged. We only want to snapshot when a NEW dock arrives
    // (posePdbqt changes), so deps are [hasDock, posePdbqt] only.
    // smiles is read inside the effect via closure on the current
    // render — that's fine because the effect runs once per dock and
    // the SMILES at that moment is the docked SMILES.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDock, posePdbqt]);

  // Fetch the live conformer in three cases:
  //   1. No dock yet — preview whatever the user is sketching.
  //   2. Dock done but the user has since edited the 2D structure —
  //      preview the new compound in the pocket so they can see how
  //      their edit fits before re-docking.
  //   3. (v0.29) User flipped the live/dock toggle to "live" while a
  //      dock exists — they want to see the unbound conformer of the
  //      docked compound. Skip the fetch if we already have a
  //      conformer for this SMILES (cached in conformerSdf).
  useEffect(() => {
    if (!smiles) return;
    if (hasDock && !smilesEdited && viewMode !== "live") return;  // docked pose is still current
    // (v0.30) Only short-circuit live-mode caching if the SMILES is
    // unchanged since the cached conformer was produced. After an edit
    // we MUST re-fetch — otherwise the live preview stays glued to the
    // pre-edit geometry. The smilesEdited flag means "the SMILES has
    // diverged from dockedSmilesRef", so when it's true we always fetch.
    if (viewMode === "live" && !smilesEdited && conformerSdf) return;
    const t = window.setTimeout(async () => {
      setLoading(true);
      setConformerErr(null);
      try {
        const res = await api.assistConformer(smiles);
        if (res.ok && res.sdf) {
          if (smilesEdited) setEditedConformerSdf(res.sdf);
          else setConformerSdf(res.sdf);
        } else {
          setConformerErr(res.error || "Conformer failed");
        }
      } catch (e: any) {
        setConformerErr(e?.message || "Conformer request failed");
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
    // viewMode + conformerSdf in deps so flipping to "live" triggers a
    // fetch when we don't already have a cached conformer for this
    // SMILES. eslint-disable: conformerSdf is intentionally read inside
    // the early-return so the rule doesn't see a hooks-rules violation,
    // but TS sees it as a non-deps usage. Manual list keeps the rebuild
    // count minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smiles, hasDock, smilesEdited, viewMode]);

  // (v0.53) Fetch the WT receptor whenever we have a WT dock result.
  // Independent of viewVariant — both receptors stay loaded so the
  // variant toggle is pure-style with no rebuild.
  useEffect(() => {
    if (!dockResultWt) { setReceptorPdbWt(null); return; }
    const wtPdb = dockResultWt.pdb_id || targetMeta?.pdb_id;
    const wtChain = dockResultWt.chain || targetMeta?.chain || "A";
    if (!wtPdb || !wtChain) return;
    let cancelled = false;
    setReceptorErr(null);
    api
      .structure(wtPdb, wtChain, "WT")
      .then((text) => {
        if (cancelled) return;
        if (!text || text.length < 100) return;
        setReceptorPdbWt(text);
      })
      .catch((e: Error) => {
        if (!cancelled) setReceptorErr(`WT receptor fetch failed: ${e.message}`);
      });
    return () => { cancelled = true; };
  }, [dockResultWt, targetMeta?.pdb_id, targetMeta?.chain]);

  // (v0.53) Mirror for the mutant receptor. Fetched only when there's
  // a mutant dock result AND the user actually selected a mutation
  // (mutation prop non-empty); otherwise the "mutant" structure
  // doesn't exist as a distinct PDB.
  useEffect(() => {
    if (!dockResult || !mutation) { setReceptorPdbMut(null); return; }
    const mPdb = dockResult.pdb_id || targetMeta?.pdb_id;
    const mChain = dockResult.chain || targetMeta?.chain || "A";
    if (!mPdb || !mChain) return;
    let cancelled = false;
    api
      .structure(mPdb, mChain, mutation)
      .then((text) => {
        if (cancelled) return;
        if (!text || text.length < 100) return;
        setReceptorPdbMut(text);
      })
      .catch(() => { /* mutant fetch is best-effort */ });
    return () => { cancelled = true; };
  }, [dockResult, mutation, targetMeta?.pdb_id, targetMeta?.chain]);

  // Apply visual styles based on toolbar state. This is the single place
  // styles are written to the 3Dmol viewer — both the data-load effect
  // (below) and the toolbar buttons trigger it via dependency.
  function applyStyles(viewer: any) {
    if (!viewer) return;
    try {
      // Receptor model — index 0. Conformer-only mode (no dock OR user
      // flipped to "live") skips this whole branch.
      if (showDockedScene && receptorPdb) {
        viewer.setStyle({ model: 0 }, {});
        try { viewer.removeAllSurfaces(); } catch { /* */ }
        // (v0.52) Color-code the receptor so the user can tell at a
        // glance whether they're looking at WT or the mutant.
        // - WT  → slate (#94a3b8) — neutral, the baseline.
        // - Mut → amber (#f59e0b) — warm, matches the score panel's
        //         amber-accented mutant column. In "both" mode this
        //         also distinguishes the two receptors when stacked.
        const recColor = variant === "WT" ? "#94a3b8" : "#f59e0b";
        if (backboneStyle === "cartoon") {
          viewer.setStyle({ model: 0 }, { cartoon: { color: recColor } });
        } else if (backboneStyle === "line") {
          viewer.setStyle({ model: 0 }, { line: { color: recColor } });
        } else if (backboneStyle === "surface") {
          viewer.setStyle({ model: 0 }, { cartoon: { color: recColor, opacity: 0.45 } });
          try { viewer.addSurface(2, { opacity: 0.55, color: "#475569" }, { model: 0 }); } catch { /* */ }
        }
        // hide: leave receptor empty
        // Side-chain sticks at pocket-contact residues.
        if (showContacts && contactResnums.length > 0) {
          for (const rn of contactResnums) {
            const sel = { model: 0, resi: rn, atom: ["CA","CB","CG","CG1","CG2","CD","CD1","CD2","CE","CE1","CE2","CZ","NE","NE1","NE2","NZ","NH1","NH2","ND1","ND2","OD1","OD2","OE1","OE2","OG","OG1","OH","SG","SD"] };
            try { viewer.addStyle(sel, { stick: { color: "#0ea5e9", radius: 0.18 } }); } catch { /* */ }
          }
        }
        // Mutation residue side chain — emerald green, fat radius. Matches
        // MutationOverlayViewer's color convention (WT side chain green,
        // mutant blue) so users coming from JobPage immediately recognize
        // 'green = the mutation'. Critically, green is distinct from any
        // common atom element color (no element renders green by default
        // except F/Cl), so it can't be confused with the docked ligand.
        // (v0.55) Mutation-residue side chain — color follows the
        // MutationOverlayViewer convention so users coming from JobPage
        // get the same visual mapping:
        //   • WT residue side chain  → emerald green (#10b981)
        //   • Mutant residue side chain → blue       (#3b6cf6)
        // This is what makes wt vs mut visually obvious in the close-
        // up viewer — the protein chain line color (slate vs amber) is
        // a wider-context cue, but the user looks at the side chain
        // because that's where the chemistry is. Without distinct
        // colors, both views looked 'green' which the user reported
        // as "WT and Q61H are the same color".
        if (mutation) {
          const m = String(mutation).match(/(\d+)/);
          if (m) {
            const rn = Number(m[1]);
            const sel = { model: 0, resi: rn };
            const sideColor = variant === "WT" ? "#10b981" : "#3b6cf6";
            try { viewer.addStyle(sel, { stick: { color: sideColor, radius: 0.32 } }); } catch { /* */ }
          }
        }
      }
      // Pose model (last loaded). With receptor: model:1. Without dock,
      // the conformer is at model:0. The edited-preview path also lives
      // at model:1 so the same selector covers it. (v0.29) Mirror the
      // showDockedScene flag here too — when the user picks "live"
      // there's no receptor in the scene, so the conformer is at 0.
      const poseIdx = showDockedScene && receptorPdb ? 1 : 0;
      const ligandPresent = (showDockedScene && (hasPose || (smilesEdited && editedConformerSdf))) || (!showDockedScene && conformerSdf);
      if (ligandPresent) {
        viewer.setStyle({ model: poseIdx }, {});
        // Thick element-colored ligand (radius 0.30) — same visual weight
        // as JobPage's MutationOverlayViewer, so the ligand reads as the
        // hero of the scene against either cartoon or wireframe receptor.
        // Element colors mean N=blue, O=red, F=green, Cl=green, etc —
        // standard chemistry-paper convention.
        if (poseStyle === "stick") {
          viewer.setStyle({ model: poseIdx }, { stick: { radius: 0.30, colorscheme: "Jmol" } });
        } else if (poseStyle === "ball") {
          viewer.setStyle({ model: poseIdx }, { stick: { radius: 0.20, colorscheme: "Jmol" }, sphere: { scale: 0.36 } });
        } else if (poseStyle === "line") {
          viewer.setStyle({ model: poseIdx }, { line: { colorscheme: "Jmol" } });
        } else if (poseStyle === "sphere") {
          viewer.setStyle({ model: poseIdx }, { sphere: { colorscheme: "Jmol" } });
        }
      }
      // (v0.50) Style the alt receptor + alt pose when in "both" mode.
      // Models 2 (alt receptor) and 3 (alt pose) live above the primary
      // receptor=0 + primary pose=1 indices. Alt receptor uses cartoon
      // with reduced opacity so the primary still reads as the focus
      // structure; alt pose gets a flat color (variant-specific) so the
      // user can tell the two ligand poses apart at a glance.
      if (viewVariant === "both" && receptorPdbAlt) {
        const altRecIdx = 2;
        // (v0.54) Alt receptor color matches the variant convention:
        // primary mutant → alt = WT slate; primary WT → alt = mutant
        // amber. Always rendered at 0.45 opacity so the primary stays
        // dominant. Backbone style mirrors the primary's so they
        // visually compare apples-to-apples — when the primary is
        // wireframe, the alt is wireframe too, just in the alt color.
        // Without this match, primary line + alt cartoon made the alt
        // ribbon visually drown out the primary and they appeared as
        // 'one' colored protein.
        const altRecColor = variant === "WT" ? "#f59e0b" : "#94a3b8";
        viewer.setStyle({ model: altRecIdx }, {});
        if (backboneStyle === "cartoon") {
          viewer.setStyle({ model: altRecIdx }, { cartoon: { color: altRecColor, opacity: 0.45 } });
        } else if (backboneStyle === "line") {
          viewer.setStyle({ model: altRecIdx }, { line: { color: altRecColor } });
        } else if (backboneStyle === "surface") {
          viewer.setStyle({ model: altRecIdx }, { cartoon: { color: altRecColor, opacity: 0.30 } });
        }
        // (v0.55) Alt receptor's mutation-residue side chain. In 'both'
        // mode this gives the user both WT (emerald) AND mutant (blue)
        // side chains visible at once — the visual payoff for the mode.
        // Color is the OPPOSITE of whatever the primary side chain
        // got, since the alt is by definition the other variant.
        if (mutation) {
          const m = String(mutation).match(/(\d+)/);
          if (m) {
            const rn = Number(m[1]);
            const altSel = { model: altRecIdx, resi: rn };
            const altSideColor = variant === "WT" ? "#3b6cf6" : "#10b981";
            try { viewer.addStyle(altSel, { stick: { color: altSideColor, radius: 0.32 } }); } catch { /* */ }
          }
        }
        // (v0.54) Alt pose intentionally NOT rendered — see build
        // effect comment. Showing two ligand copies looked like a
        // duplicated compound to the user; the score panel's Δ
        // already communicates pose-energy difference numerically.
      }
      viewer.render();
    } catch { /* defensive — ignore style errors */ }
  }

  // Build the scene when underlying DATA changes, then apply styles. To
  // avoid teardown-and-rebuild flicker on every parent re-render (the page
  // header's UTC clock alone ticks every second), we compare a content
  // signature against the last build. If nothing meaningful changed, skip
  // the rebuild entirely — the existing 3Dmol viewer keeps the user's
  // rotation/zoom state and continues to render. This is what was causing
  // the 'molecule disappears and comes back' artefact during drag.
  const lastBuildKeyRef = useRef<string>("");
  // (v0.58) Single snapshot of the dock-result fingerprints. The
  // build effect uses this to decide whether to re-frame the camera
  // (only when fingerprints differ — i.e. a NEW dock arrived). All
  // other rebuild causes (SMILES edits, conformer fetches, variant
  // flips, live↔docked toggles) preserve the user's camera state.
  const lastStructuralSnapshotRef = useRef<string>("");
  useEffect(() => {
    if (!containerRef.current) return;
    const buildKey = [
      // (v0.29) Use showDockedScene instead of hasDock so flipping the
      // live/dock toggle invalidates the cached scene and triggers a
      // rebuild. Without this the toggle would have no visible effect.
      showDockedScene ? "D" : "_",
      receptorPdb ? `r${receptorPdb.length}` : "_",
      posePdbqt ? `p${posePdbqt.length}` : "_",
      conformerSdf ? `c${conformerSdf.length}` : "_",
      smilesEdited && editedConformerSdf ? `e${editedConformerSdf.length}` : "_",
      // (v0.43) Variant in the key so flipping wt/mut/both forces a rebuild.
      `v${viewVariant}`,
      // (v0.50) Alt receptor + alt pose for "both" mode. Empty in other modes.
      viewVariant === "both" && receptorPdbAlt ? `a${receptorPdbAlt.length}` : "_",
      viewVariant === "both" && altPosePdbqt ? `q${altPosePdbqt.length}` : "_",
    ].join("|");
    if (buildKey === lastBuildKeyRef.current && viewerRef.current) {
      // Same data, viewer already exists — leave it alone.
      return;
    }
    // (v0.58) Generalised camera-preserve. Previously the camera was
    // only kept stable on variant flips (v0.52), but the same problem
    // applies whenever we rebuild the scene without changing the
    // underlying STRUCTURE — e.g. a SMILES edit that fetches an
    // edited conformer, a live/dock toggle, or a variant flip. The
    // user reported camera jumps on every 2D edit even after the
    // variant fix.
    //
    // New rule: capture viewer.getView() before rebuild and restore
    // it after, EXCEPT when one of the dock-result fingerprints just
    // changed (a fresh dock arrived → user expects re-framing on the
    // new pose centroid). Conformer-only / edited-conformer / variant
    // / mode changes all preserve camera.
    // (v0.61) Snapshot includes receptor + conformer presence too.
    // The previous snapshot was just the dock-result fingerprints,
    // which fired the "fresh structure" path the moment dockResult
    // arrived — but the receptor PDB fetches in a SEPARATE effect
    // and lands a few hundred ms later. By the time the receptor
    // arrived and the build effect re-fired, the snapshot was
    // unchanged → camera preserved at the conformer view → the
    // ligand was off-screen until the user manually zoomed.
    //
    // Now the snapshot also tracks receptor lengths and conformer
    // length, so the first time receptor or conformer data lands,
    // it counts as a structural change and the build effect
    // auto-frames on the new pose. Variant flip is unaffected
    // because both receptor lengths stay constant in state.
    const structuralSnapshot = [
      showDockedScene ? "D" : "L",
      dockResult?.pose_pdbqt_b64 || "_",
      dockResultWt?.pose_pdbqt_b64 || "_",
      receptorPdbWt?.length || 0,
      receptorPdbMut?.length || 0,
      conformerSdf?.length || 0,
    ].join("|");
    const isFreshStructure = lastStructuralSnapshotRef.current !== structuralSnapshot;
    let savedView: any = null;
    if (!isFreshStructure && viewerRef.current && typeof viewerRef.current.getView === "function") {
      try { savedView = viewerRef.current.getView(); } catch { /* no-op */ }
    }
    lastStructuralSnapshotRef.current = structuralSnapshot;
    lastBuildKeyRef.current = buildKey;
    let cancelled = false;
    (async () => {
      try {
        const mod: any = await import("3dmol");
        const $3Dmol: any = mod?.default ?? mod?.$3Dmol ?? mod;
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";
        const viewer = $3Dmol.createViewer(containerRef.current, {
          backgroundColor: "#0f172a",
          antialias: true,
        });
        viewerRef.current = viewer;
        // Tell dependents (measure-mode click binder, style effect) that
        // the viewer instance is brand new and they need to re-bind.
        setViewerVersion((v) => v + 1);

        if (showDockedScene && receptorPdb) {
          viewer.addModel(receptorPdb, "pdb");
          // Choose what to render as the ligand model:
          //   • smilesEdited + we have a fresh conformer → show the edit
          //     translated to the pocket centroid (live preview).
          //   • else if the dock returned a pose → show the docked pose.
          //   • else → no ligand.
          const useEditedPreview = smilesEdited && !!editedConformerSdf;
          if (useEditedPreview) {
            const m = viewer.addModel(editedConformerSdf!, "sdf");
            // Re-position the conformer at the pocket centroid. RDKit's
            // ETKDG conformer is centered around (0,0,0); the receptor
            // lives in PDB coords. Translate by (poseCentroid − conformer
            // centroid) so the new compound sits where the docked pose was.
            try {
              const atoms = m.selectedAtoms ? m.selectedAtoms({}) : [];
              if (atoms.length && poseCentroidRef.current) {
                let cx = 0, cy = 0, cz = 0;
                for (const a of atoms) { cx += a.x; cy += a.y; cz += a.z; }
                cx /= atoms.length; cy /= atoms.length; cz /= atoms.length;
                const [px, py, pz] = poseCentroidRef.current;
                if (typeof m.translate === "function") {
                  m.translate(px - cx, py - cy, pz - cz);
                } else {
                  for (const a of atoms) { a.x += px - cx; a.y += py - cy; a.z += pz - cz; }
                }
              }
            } catch { /* fallback to native conformer position */ }
          } else if (posePdbqt) {
            // We pre-converted PDBQT to PDB-format ATOM lines above, so
            // load with format 'pdb'. 3Dmol's pdbqt parser drops BRANCH
            // atoms (verified: only ROOT atoms render with 'pdbqt'), so
            // we strip the AutoDock markers and use the well-tested PDB
            // parser instead.
            viewer.addModel(posePdbqt, "pdb");
          }
          // (v0.50) "Both" mode — overlay the alternate receptor and
          // pose. Models added here become indices 2 and 3 (after the
          // primary receptor=0 and primary pose=1). applyStyles below
          // detects them via altModels and renders the alt receptor in
          // slate at 0.45 opacity and the alt pose with a flat color
          // (cyan-ish) so it's distinguishable from the Jmol-coloured
          // primary pose.
          // (v0.54) "Both" mode loads ONLY the alternate receptor —
          // not the alt pose. Showing two ligand copies (primary +
          // alt poses) read as a duplicated compound to the user
          // because the WT and mutant docked-pose centroids are
          // typically <1Å apart. The biology the user actually wants
          // to see in 'both' mode is the side-chain shift at the
          // mutation residue — that's encoded in the receptor, not
          // the ligand. The score panel's Δ column already conveys
          // the pose-energy difference numerically.
          if (viewVariant === "both" && receptorPdbAlt) {
            viewer.addModel(receptorPdbAlt, "pdb");
          }
          // Camera framing — IMPORTANT 3Dmol API quirks here:
          //   • zoomTo({selection}) fits the camera AND sets the rotation
          //     pivot to the selection's centroid. Critical for keeping
          //     the ligand on-screen during mouse rotation.
          //   • zoom(factor) — factor < 1 zooms IN (camera closer),
          //     factor > 1 zooms OUT. (Earlier version had this wrong
          //     and used 1.4 thinking it zoomed in — that left the
          //     ligand tiny in a wide protein view.)
          // 0.6 is what JobPage's MutationOverlayViewer uses (it does
          // 0.55-0.7 depending on mode) — gives the ligand ~150% of the
          // canvas-fit while keeping enough binding-site cartoon for
          // context.
          const ligandIdx = posePdbqt || useEditedPreview ? 1 : -1;
          // (v0.51) Skip the auto-frame zoom when this rebuild was
          // triggered by a variant flip — savedView will be applied
          // below to restore the camera the user already had.
          if (!savedView) {
            if (ligandIdx >= 0) {
              viewer.zoomTo({ model: ligandIdx });
              viewer.zoom(0.6, 0);
            } else {
              viewer.zoomTo();
            }
          }
        } else {
          // (v0.30) Live (no-receptor) branch. Render the FRESHEST
          // conformer we have for the current SMILES — that's
          // editedConformerSdf when the user has edited since the dock,
          // otherwise plain conformerSdf. Without this preference, live
          // mode after a 2D edit would re-render the pre-edit geometry
          // because the fetch effect routes edited SMILES into
          // editedConformerSdf rather than overwriting conformerSdf.
          const liveSdf = (smilesEdited && editedConformerSdf) ? editedConformerSdf : conformerSdf;
          if (liveSdf) {
            viewer.addModel(liveSdf, "sdf");
            // (v0.51) Same camera-preserve rule applies in the live
            // conformer branch.
            if (!savedView) viewer.zoomTo();
          }
        }
        // (v0.51) Restore the user's prior camera state if this was a
        // pure variant flip — keeps the scene stable instead of
        // re-framing on every wt/both/mut click.
        if (savedView && typeof viewer.setView === "function") {
          try { viewer.setView(savedView); } catch { /* ignore */ }
        }
        applyStyles(viewer);
      } catch (e) {
        if (!cancelled) setConformerErr(`Render failed: ${(e as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDockedScene, receptorPdb, posePdbqt, conformerSdf, editedConformerSdf, smilesEdited, viewVariant, receptorPdbAlt, altPosePdbqt]);

  // Re-apply styles when toolbar state OR the viewer instance changes.
  // viewerVersion bump ensures style re-applies after the data effect
  // creates a fresh viewer (otherwise the new viewer would render with
  // 3Dmol's defaults until the user clicks a toolbar button).
  useEffect(() => {
    if (viewerRef.current) applyStyles(viewerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backboneStyle, poseStyle, showContacts, mutation, viewerVersion]);

  // Wire / unwire the measure-mode click handler.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || typeof viewer.setClickable !== "function") return;
    if (!measureMode) {
      try { viewer.setClickable({}, false, null); } catch { /* */ }
      return;
    }
    const onClick = (atom: any) => {
      if (!atom) return;
      try {
        measurePicksRef.current.push({ x: atom.x, y: atom.y, z: atom.z });
        viewer.addSphere({ center: { x: atom.x, y: atom.y, z: atom.z }, radius: 0.35, color: "#f97316" });
        if (measurePicksRef.current.length === 2) {
          const [a, b] = measurePicksRef.current;
          const d = Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
          setMeasureDistance(d);
          viewer.addLine({ start: a, end: b, dashed: true, color: "#f97316" });
          const mid = { x: (a.x+b.x)/2, y: (a.y+b.y)/2, z: (a.z+b.z)/2 };
          viewer.addLabel(`${d.toFixed(2)} Å`, {
            position: mid, backgroundColor: "rgba(15,23,42,0.85)",
            backgroundOpacity: 0.85, fontColor: "white", fontSize: 12,
            borderThickness: 0, inFront: true,
          });
          measurePicksRef.current = [];
        }
        viewer.render();
      } catch { /* */ }
    };
    // 3Dmol's hit-test ray uses the canvas's screen bounding box to map
    // click pixels → 3D ray. Those bounds get stale if the user scrolled
    // or the panel resized between dock and toolbar-toggle. resize()
    // refreshes them, then render() rebuilds the hit-test geometry buffer
    // — without these calls the click handler fires but the picked atom
    // is wrong (or null), so the measurement silently does nothing.
    // Same pattern used by MutationOverlayViewer (the JobPage viewer).
    try {
      viewer.resize();
      viewer.setClickable({}, true, onClick);
      viewer.render();
    } catch { /* */ }
    return () => {
      // Pass an empty function rather than null — some 3Dmol versions
      // throw when null is passed as the callback.
      try { viewer.setClickable({}, false, () => {}); } catch { /* */ }
    };
    // viewerVersion in deps: when the viewer is rebuilt by the data
    // effect, this hook re-binds the click handler to the fresh
    // instance. Without it, measureMode would silently break after any
    // re-dock or 2D edit.
  }, [measureMode, viewerVersion]);

  // Fullscreen handling — Escape exits, and on toggle we tell 3Dmol to
  // resize so its WebGL viewport matches the new container size. Without
  // resize() the canvas would render at the original small size in the
  // top-left of a viewport-sized panel.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    // Defer one tick so the DOM has updated to the new layout before we
    // measure. Two RAFs is the standard idiom for "after style + layout".
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { v.resize(); v.render(); } catch { /* */ }
    }));
  }, [fullscreen]);

  // Camera helpers wired to toolbar buttons.
  const onResetView = () => {
    const v = viewerRef.current;
    if (!v) return;
    try {
      // Mirror the data-effect framing exactly so Reset returns to the
      // same view the user got after the dock. zoomTo({model: 1}) sets
      // both the camera AND the rotation pivot. zoom(0.6) zooms IN
      // (factor < 1 = closer in 3Dmol).
      if (hasDock && hasPose) {
        v.zoomTo({ model: 1 });
        v.zoom(0.6, 0);
      } else {
        v.zoomTo();
      }
      v.render();
    } catch { /* */ }
  };
  const onZoomIn = () => { try { viewerRef.current?.zoom(1.2, 200); } catch { /* */ } };
  const onZoomOut = () => { try { viewerRef.current?.zoom(0.8, 200); } catch { /* */ } };
  const onClearMeasure = () => {
    const v = viewerRef.current;
    if (!v) return;
    try {
      v.removeAllShapes();
      v.removeAllLabels();
      measurePicksRef.current = [];
      setMeasureDistance(null);
      applyStyles(v);
    } catch { /* */ }
  };

  const status = receptorErr || conformerErr;
  const statusBadge = hasDock
    ? smilesEdited
      ? editedConformerSdf
        ? <span className="text-amber-300">⚠ live preview · re-dock to score</span>
        : <span className="text-cyan-300 animate-pulse">▮ updating preview…</span>
      : receptorPdb && posePdbqt
        ? <span className="text-emerald-400">● docked pose · {variant}</span>
        : <span className="text-cyan-300 animate-pulse">▮ loading receptor…</span>
    : loading
      ? <span className="text-cyan-300 animate-pulse">▮ generating…</span>
      : conformerSdf
        ? <span className="text-emerald-400">● live conformer</span>
        : smiles
          ? <span className="text-slate-600">○ waiting</span>
          : <span className="text-slate-700">▢ empty</span>;

  // Show toolbar when there's content to control. Pre-conformer + no-dock
  // we still show pose/style toggles so users can preview the conformer
  // in different modes.
  const showToolbar = hasDock || !!conformerSdf;

  return (
    <div className={
      fullscreen
        ? "fixed inset-0 z-50 bg-[#0d1422] border border-slate-800/70 flex flex-col overflow-hidden"
        : "bg-[#0d1422] border border-slate-800/70 rounded flex flex-col overflow-hidden h-[40%] min-h-[280px]"
    }>
      <div className="px-3 py-1.5 border-b border-slate-800/70 flex items-center justify-between text-[10px]">
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">3D View{fullscreen ? " · fullscreen (esc)" : ""}</span>
        <span className="font-mono text-slate-500">{statusBadge}</span>
      </div>

      {showToolbar && (
        <div className="px-2 py-1.5 border-b border-slate-800/70 flex items-center gap-2 flex-wrap text-[9px] font-mono">
          {/* (v0.29) Live ↔ Dock toggle. Only meaningful once a dock has
              landed: before that, the live conformer is the only thing
              the viewer can show. After the dock, the user can flip
              back to the unbound conformer to compare geometries — and
              flip forward again to revisit the bound pose. The toggle
              auto-resets to "dock" each time a fresh dockResult lands. */}
          {hasDock && !!smiles && (
            <ViewerControlGroup label="VIEW MODE">
              <ViewerSegBtn active={viewMode === "live"} onClick={() => setViewMode("live")} title="Show the live (unbound) conformer of the current SMILES — RDKit ETKDG geometry, no receptor.">
                live
              </ViewerSegBtn>
              <ViewerSegBtn active={viewMode === "dock"} onClick={() => setViewMode("dock")} title="Show the docked pose with receptor (default after a dock completes).">
                docked
              </ViewerSegBtn>
            </ViewerControlGroup>
          )}
          {/* (v0.43) Variant toggle — visible only when BOTH a WT and
              a mutant result are loaded. Lets the user flip the 3D
              scene between the two receptor + pose pairs. The pose-
              contact highlights and the camera framing follow whichever
              variant is active. */}
          {!!dockResult && !!dockResultWt && (
            <ViewerControlGroup label="VARIANT">
              <ViewerSegBtn
                active={viewVariant === "wt"}
                onClick={() => setViewVariant("wt")}
                title="Show the wild-type receptor and the WT-docked pose."
              >
                wt
              </ViewerSegBtn>
              <ViewerSegBtn
                active={viewVariant === "both"}
                onClick={() => setViewVariant("both")}
                title="Overlay BOTH variants: primary receptor + pose at full opacity, the other variant's receptor (slate, 45% opacity) and pose (flat color, 85% opacity) on top so you can compare side-chain shifts and pose differences in one frame."
              >
                both
              </ViewerSegBtn>
              <ViewerSegBtn
                active={viewVariant === "mut"}
                onClick={() => setViewVariant("mut")}
                title={`Show the mutant receptor (${mutation || "mut"}) and its docked pose.`}
                tone="amber"
              >
                {mutation ? mutation.toLowerCase() : "mut"}
              </ViewerSegBtn>
            </ViewerControlGroup>
          )}
          {hasDock && (
            <ViewerControlGroup label="BACKBONE">
              <ViewerSegBtn active={backboneStyle === "cartoon"} onClick={() => setBackboneStyle("cartoon")} title="Cartoon ribbon">cartoon</ViewerSegBtn>
              <ViewerSegBtn active={backboneStyle === "surface"} onClick={() => setBackboneStyle("surface")} title="Translucent solvent surface — best to see the pocket shape">surface</ViewerSegBtn>
              <ViewerSegBtn active={backboneStyle === "line"} onClick={() => setBackboneStyle("line")} title="Bond line wireframe">line</ViewerSegBtn>
              <ViewerSegBtn active={backboneStyle === "hide"} onClick={() => setBackboneStyle("hide")} title="Hide receptor — pose only">hide</ViewerSegBtn>
            </ViewerControlGroup>
          )}
          <ViewerControlGroup label="POSE">
            <ViewerSegBtn active={poseStyle === "stick"} onClick={() => setPoseStyle("stick")} title="Sticks (default)">stick</ViewerSegBtn>
            <ViewerSegBtn active={poseStyle === "ball"} onClick={() => setPoseStyle("ball")} title="Ball-and-stick">ball</ViewerSegBtn>
            <ViewerSegBtn active={poseStyle === "line"} onClick={() => setPoseStyle("line")} title="Wireframe">line</ViewerSegBtn>
            <ViewerSegBtn active={poseStyle === "sphere"} onClick={() => setPoseStyle("sphere")} title="Space-filling spheres">sphere</ViewerSegBtn>
          </ViewerControlGroup>
          {hasDock && contactResnums.length > 0 && (
            <ViewerControlGroup label="CONTACTS">
              <ViewerSegBtn active={showContacts} onClick={() => setShowContacts(!showContacts)} title="Toggle binding-pocket side chains">
                {showContacts ? "on" : "off"}
              </ViewerSegBtn>
            </ViewerControlGroup>
          )}
          <div className="flex-1" />
          <ViewerControlGroup label="VIEW">
            <ViewerSegBtn active={false} onClick={onZoomOut} title="Zoom out">−</ViewerSegBtn>
            <ViewerSegBtn active={false} onClick={onZoomIn} title="Zoom in">+</ViewerSegBtn>
            <ViewerSegBtn active={false} onClick={onResetView} title="Reset camera to default framing">reset</ViewerSegBtn>
            <ViewerSegBtn active={fullscreen} onClick={() => setFullscreen(f => !f)} title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen — fill the entire viewport"}>
              {fullscreen ? "⊠ exit" : "⛶ full"}
            </ViewerSegBtn>
          </ViewerControlGroup>
          <ViewerControlGroup label="MEASURE">
            <ViewerSegBtn
              active={measureMode}
              onClick={() => setMeasureMode(!measureMode)}
              title="Click two atoms to measure distance (Å)"
              tone="amber"
            >
              {measureMode ? "click 2 atoms" : "off"}
            </ViewerSegBtn>
            {measureDistance !== null && (
              <span className="px-1.5 text-amber-300 tabular-nums">{measureDistance.toFixed(2)} Å</span>
            )}
            {(measureMode || measureDistance !== null) && (
              <ViewerSegBtn active={false} onClick={onClearMeasure} title="Clear measurement marks">clear</ViewerSegBtn>
            )}
          </ViewerControlGroup>
        </div>
      )}

      <div className="flex-1 relative bg-[#0f172a] overflow-hidden">
        <div ref={containerRef} className="absolute inset-0" />
        {/* Onboarding empty state — shows when there's no compound and no
            docking result yet. Walks the user through the 4-step flow so
            a first-time visitor doesn't stare at a black canvas. */}
        {!smiles && !dockResult && !dockResultWt && !status && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="max-w-md px-6 py-5 rounded-lg border border-slate-800/70 bg-[#0b1220]/80 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-cyan-400 text-[10px] font-mono tracking-[0.2em] uppercase">▸ studio · ready</span>
                <span className="flex-1 h-px bg-gradient-to-r from-cyan-500/40 to-transparent" />
              </div>
              <div className="text-slate-300 text-xs leading-relaxed font-mono">
                <div className="mb-2 text-slate-400">Mutation-aware docking in 4 steps:</div>
                <ol className="space-y-1.5">
                  <li className="flex gap-2">
                    <span className="text-cyan-400 tabular-nums">1.</span>
                    <span><span className="text-slate-200">Pick a target</span> <span className="text-slate-500">— select kinase + mutation, top-left</span></span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-cyan-400 tabular-nums">2.</span>
                    <span><span className="text-slate-200">Draw a compound</span> <span className="text-slate-500">— sketch in the editor or paste SMILES</span></span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-cyan-400 tabular-nums">3.</span>
                    <span><span className="text-slate-200">Quick Dock</span> <span className="text-slate-500">— ~30 s on GPU, scores both WT and mutant</span></span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-cyan-400 tabular-nums">4.</span>
                    <span><span className="text-slate-200">Inspect ΔΔG</span> <span className="text-slate-500">— color-coded score, Kd estimate, 3D pose</span></span>
                  </li>
                </ol>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800/50 text-[9px] font-mono text-slate-600 tracking-wider uppercase">
                live conformer renders here · 3D pose appears after dock
              </div>
            </div>
          </div>
        )}
        {status && (
          <div className="absolute bottom-2 left-2 right-2 px-2 py-1 rounded bg-rose-950/60 border border-rose-900/60 text-[10px] text-rose-200 font-mono">
            ✗ {status}
          </div>
        )}
      </div>
    </div>
  );
}

/** Tiny label + segmented-button group used by the 3D viewer toolbar.
 *  Designed to match the rest of Studio's control-center vibe: monospace,
 *  uppercase tiny labels, faint border, cyan accent for the active item. */
function ViewerControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[8px] tracking-[0.18em] text-slate-600 mr-0.5 select-none">{label}</span>
      <div className="flex items-center bg-[#070b15] rounded border border-slate-800 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

/** A single segmented-button cell. Active uses cyan; the amber tone is
 *  reserved for action modes (measure). */
function ViewerSegBtn({
  active, onClick, title, children, tone = "cyan",
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
  tone?: "cyan" | "amber";
}) {
  const accent = tone === "amber"
    ? "border-amber-500/60 bg-amber-900/40 text-amber-200"
    : "border-cyan-500/60 bg-cyan-900/40 text-cyan-200";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider border-r border-slate-800 last:border-r-0 transition-colors ${
        active ? accent : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
      }`}
    >
      {children}
    </button>
  );
}

// LiveConformerPlaceholder removed in v0.16.2 — ProductionViewer3D now
// handles both pre-dock conformer preview and post-dock receptor+pose
// in one self-contained component, using the same 3Dmol pattern that
// was already proven to render correctly here.

/** Compact properties readout — fetched only when smiles present + panel open. */
function PropertiesPanel({ smiles }: { smiles: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["assist-properties", smiles],
    queryFn: () => api.assistProperties(smiles),
    enabled: !!smiles,
    staleTime: 60_000,
  });
  if (!smiles) return <div className="text-slate-600 font-mono text-[11px] p-3">▢ canvas empty</div>;
  if (isLoading || !data) return <div className="text-slate-500 font-mono text-[11px] p-3 animate-pulse">▮ computing…</div>;
  const p: any = data;
  const Stat = ({ label, value, ok }: { label: string; value: any; ok?: boolean }) => (
    <div className="px-3 py-2 border-r border-slate-800/50 last:border-r-0">
      <div className="text-[9px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`font-mono text-sm tabular-nums ${
        ok === true ? "text-emerald-300" : ok === false ? "text-rose-300" : "text-slate-200"
      }`}>{value ?? "—"}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-7 text-[11px]">
      <Stat label="MW" value={p.mw?.toFixed(1)} />
      <Stat label="logP" value={p.logp?.toFixed(2)} />
      <Stat label="QED" value={p.qed?.toFixed(2)} />
      <Stat label="TPSA" value={p.tpsa?.toFixed(1)} />
      <Stat label="HBD/HBA" value={`${p.hbd ?? "—"}/${p.hba ?? "—"}`} />
      <Stat label="Ro5" value={p.lipinski_pass ? "pass" : "fail"} ok={!!p.lipinski_pass} />
      <Stat label="SA" value={p.sa_score?.toFixed(1)} ok={p.sa_score ? p.sa_score < 6 : undefined} />
    </div>
  );
}
