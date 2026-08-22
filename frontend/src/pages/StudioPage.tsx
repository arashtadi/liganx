// Build verification tag — surfaces the deploy tag in the bundled JS so a
// `curl liganx.com/assets/index-*.js | grep LIGANX_BUILD_TAG` confirms which
// version is live. Cheap, ~50 bytes; replace each release.
const LIGANX_BUILD_TAG = "v1.23.2-2026-05-12-homepage-audit-and-refresh";
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
import { useAuth } from "../lib/auth";
import AdmetChips from "../components/AdmetChips";
import LiganxAIPanel from "../components/LiganxAIPanel";
import MobileDesktopOnlyBanner from "../components/MobileDesktopOnlyBanner";
import PodStatusBanner from "../components/PodStatusBanner";
import ProGateModal, { type ProFeature } from "../components/ProGateModal";
import { useQuery } from "@tanstack/react-query";
import { KNOWN_MUTATIONS_BY_UNIPROT } from "../lib/knownMutations";
import { api, type Job } from "../api";
import { useSmilesValidity, useSmilesSaScore, type SmilesValidity } from "../components/MoleculePreview";
import { upsertDraft, listDrafts, deleteDraft, type StudioDraft } from "../lib/drafts";
import { appendDockHistory, listDockHistory, deleteDockHistoryEntry, clearDockHistory, type DockHistoryEntry } from "../lib/dockHistory";
import { validateSmiles } from "../lib/smilesValidate";
import ProductionViewer3D from "../components/studio/ProductionViewer3D";
import type { QuickDockResult } from "../types/studio";

const KETCHER_SRC = "/ketcher/index.html";


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

/** Tiny risk indicator used in the prominent ADMET pill in Docking
 *  Results: 1.5×1.5 dot colored emerald (low) / amber (medium) /
 *  rose (high). Browser tooltip carries the channel name + tier so
 *  hovering shows e.g. "hERG: low". Defensive against unknown labels
 *  by falling back to a slate dot — keeps the dot visible even if
 *  pipeline returns a tier we don't recognize yet. */
function RiskDot({ tier, title }: { tier: string; title: string }) {
  const t = (tier || "").toLowerCase();
  const color =
    t === "low" ? "bg-emerald-400"
    : t === "medium" ? "bg-amber-400"
    : t === "high" ? "bg-rose-400"
    : "bg-slate-400";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} title={title} />;
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
  // (Ensemble docking) Opt-in flag for docking against an MD-relaxed
  // receptor conformer ensemble. Optional so snapshots written before
  // the feature shipped still deserialise (defaults to false on restore).
  ensemble?: boolean;
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

/**
 * Demo reseed catalog — keyed by URL slug. /studio?demo=braf-v600e lands
 * a first-time visitor on a Studio page with target / mutation / compound
 * already staged, so the user can hit RUN DOCK and see a real
 * selectivity result without having to figure out the form first.
 *
 * Each demo is curated to be:
 *   - A well-known oncogenic mutation a reviewer will recognize
 *   - In our catalog (pdb_id resolvable, mutation in our curated list)
 *   - Tractable on the free-tier pod (small enough to dock in ~10s)
 *
 * Add new demos by adding entries here. The slug becomes part of the
 * URL so keep it short + URL-safe.
 */
const DEMO_RESEEDS: Record<string, {
  compounds: { name: string; smiles: string }[];
  mutations: string[];
  pdb_id: string;
  catalog_target_id?: string;
  include_wt: boolean;
  replaceSession: true;
}> = {
  "braf-v600e": {
    // (Bug H1) Vemurafenib SMILES was missing the azaindole core —
    // c2cnc(Nc3...)c2 is a plain pyridine, not the 7-azaindole
    // c2c[nH]c3ncc(-c4...)cc23 that vemurafenib actually has.
    // RDKit parsed the malformed string and Ketcher rendered a
    // structure missing two rings, which triggered "Invalid SMILES"
    // on the canvas re-parse. Replaced with the canonical SMILES from
    // backend/src/deltadock/catalog.py (cross-verified against PubChem
    // CID 42611257 / DrugBank DB08881).
    compounds: [{
      name: "Vemurafenib (demo)",
      smiles: "CCCS(=O)(=O)Nc1ccc(F)c(C(=O)c2c[nH]c3ncc(-c4ccc(Cl)cc4)cc23)c1F",
    }],
    mutations: ["V600E"],
    pdb_id: "4mne",
    catalog_target_id: "braf",
    include_wt: true,
    replaceSession: true,
  },
  "egfr-t790m": {
    compounds: [{ name: "Osimertinib (demo)", smiles: "COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1" }],
    mutations: ["T790M"],
    pdb_id: "4zau",
    catalog_target_id: "egfr",
    include_wt: true,
    replaceSession: true,
  },
  "abl-t315i": {
    compounds: [{ name: "Imatinib (demo)", smiles: "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1" }],
    mutations: ["T315I"],
    pdb_id: "2hyy",
    catalog_target_id: "abl1",
    include_wt: true,
    replaceSession: true,
  },
};

export default function StudioPage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  // (v0.75) Read the session snapshot ONCE at mount so each useState's
  // initial-value lambda can pull from the same source. If the user
  // arrived with a `reseed` payload (e.g. from JobPage's Edit & re-dock
  // or from HistoryPage), the reseed wins — we want the new compound
  // loaded fresh, not the prior session restored over it.
  // /studio?demo=<slug> support — when a first-time visitor lands with
  // a demo slug, we synthesize a reseed payload from a built-in catalog
  // (DEMO_RESEEDS below). The goal is "first impression = a working
  // selectivity result, not an empty form." Falls back to a no-op when
  // the slug is unknown so a bad link doesn't break the page.
  const urlReseed = (() => {
    if (location.state && (location.state as any).reseed) return undefined;
    const params = new URLSearchParams(location.search);
    const slug = params.get("demo") || "";
    if (!slug) return undefined;
    const demo = DEMO_RESEEDS[slug.toLowerCase()];
    if (!demo) return undefined;
    return demo;
  })();
  const reseed = ((location.state as any)?.reseed ?? urlReseed) as
    | { compounds?: { name?: string | null; smiles: string }[]; mutations?: string[]; pdb_id?: string; chain?: string; catalog_target_id?: string; include_wt?: boolean; replaceSession?: boolean; sourceJobKey?: string }
    | undefined;
  // (Studio v0.94) When the reseed payload explicitly asks for a clean
  // replace (HistoryPage Re-run sets this), skip session restoration
  // entirely — every initializer below pulls from reseed only and any
  // prior sessionStorage state is ignored. Edit & re-dock from JobPage
  // does NOT set this flag, so it keeps the merge-with-session
  // semantics from v0.76.
  const reseedReplaces = !!reseed?.replaceSession;
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
    // (v0.94) reseedReplaces wins over restore — History Re-run wants
    // a clean Studio with only the rerun's data, not a merge.
    reseedReplaces ? null : (shouldRestoreSession ? readStudioSession() : null),
  ).current;
  // For the manual resume pill — does sessionStorage contain anything
  // worth resuming? Read it lazily so a fresh visit doesn't pay the
  // JSON.parse cost unless the pill is actually rendered.
  const [pendingSnapshot] = useState<StudioSessionSnapshot | null>(() =>
    !shouldRestoreSession ? readStudioSession() : null,
  );
  const [ketcherReady, setKetcherReady] = useState(false);
  const [currentSmiles, setCurrentSmiles] = useState("");
  // v1.24 — Pro tier gating. is_pro=true users see GNINA + Virtual
  // Screening as normal; free tier sees them disabled with a 🔒 lock
  // icon and clicking opens proGateFeature modal. Admin toggles per-user
  // from /admin. Defaults to false until the profile fetch completes so
  // we never *accidentally* expose Pro features to a free user during
  // the brief loading window.
  const [isPro, setIsPro] = useState(false);
  // Admin gate (2026-06-03): non-Vina engines are admin-only; everyone else
  // is steered to Contact us. Derived from the auth email (same source as
  // App.tsx + the backend admin_user dependency).
  const { user: _authUser } = useAuth();
  const [proGateFeature, setProGateFeature] = useState<ProFeature | null>(null);
  // Ensemble-docking access. UNGATED BY DEFAULT — initialised true so the
  // toggle is usable during the profile-fetch window and for anonymous
  // users. Flipped to false only if the profile fetch comes back with an
  // explicit ensemble_enabled === false (admin kill-switch). This is the
  // opposite default from isPro: Pro features fail closed, ensemble fails
  // open, because ensemble is ungated-by-default by design.
  const [ensembleAllowed, setEnsembleAllowed] = useState(true);

  // Warm the GPU worker the moment Studio opens, so it's booting while the
  // user picks a target/compounds — turns a cold-start wait into no wait for
  // the common flow. Fire-and-forget; the backend debounces (services/warmup).
  useEffect(() => {
    const base = import.meta.env.VITE_API_URL || "/api";
    fetch(`${base}/warmup`, { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getMyProfile()
      .then((p) => {
        if (!cancelled) {
          setIsPro(Boolean(p?.is_pro));
          // Only an explicit `false` revokes — undefined (older API) or
          // true both mean "allowed".
          setEnsembleAllowed(p?.ensemble_enabled !== false);
        }
      })
      .catch(() => {
        /* swallow — anonymous users see free tier (correct) */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // (v0.30) Silent autosave bookkeeping. activeDraft holds the most
  // recently upserted draft so subsequent edits update the SAME record
  // (not a fresh draft per keystroke). lastSavedAt drives the tiny
  // "saved · 3s ago" pill in the status bar so the user has visible
  // confirmation that their work is on disk.
  const [activeDraft, setActiveDraft] = useState<StudioDraft | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // (v0.32) Toast for the Promote button result. Auto-clears after 3-5s.
  const [promoteToast, setPromoteToast] = useState<string | null>(null);
  // (v1.12) Paste-SMILES modal state — replaces the old blocking
  // window.prompt() dialog (native prompt froze browser tooling/automation
  // and looked out of place vs the rest of the app's modals).
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
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
  // (Ensemble docking) Opt-in: dock against an MD-relaxed receptor conformer
  // ensemble instead of one rigid crystal snapshot, keeping the best score+
  // pose per cell. Full Job only — never wired into Quick Dock. Restored
  // from the session snapshot; defaults off.
  const [ensemble, setEnsemble] = useState<boolean>(initialSession?.ensemble ?? false);
  // Ensemble docking needs the GPU dock pod (POD_DOCK_URL). While that pod is
  // not configured in production the runner silently ignores an ensemble
  // request and runs a single rigid snapshot — so offering the toggle would
  // promise something the backend can't deliver. Hide the UI until the pod is
  // live; flip this to `true` (and confirm POD_DOCK_URL is set) to re-enable.
  // The `ensemble`/`setEnsemble` state stays wired so re-enabling is one line.
  const ENSEMBLE_UI_ENABLED = false;
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
  const MAX_MUTATIONS = 5;  // matches curated mutation depth (KRAS/EGFR carry 5)
  const MAX_COMPOUNDS = 5;  // free-tier interactive cap (halves GPU load vs 10); bulk = Pro screening
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
  // Per-compound submit-validation failures, keyed by (trimmed) SMILES.
  // Populated from the backend's 422 invalid_compounds payload so the
  // SPECIFIC staged rows that can't be docked get flagged inline with
  // their reason — instead of a vague "1 of 3 failed". Keying by SMILES
  // means removing or editing the offending compound clears its flag
  // automatically (its row no longer matches the map).
  const [invalidCompounds, setInvalidCompounds] = useState<
    Map<string, { reason: string; suggestion?: string }>
  >(new Map());
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
  // (v0.95) iframeKey now mutable so the retry button can force a
  // remount of the Ketcher iframe — useful when the bundle download
  // stalls on a flaky connection. Bumping the key triggers React to
  // unmount + remount the iframe, which restarts the download from
  // scratch instead of waiting indefinitely.
  const [iframeKey, setIframeKey] = useState(0);
  // (v0.95) Timeout flag for the loading banner. Flips true after
  // KETCHER_INIT_TIMEOUT_MS without an init message — usually means
  // the bundle is taking forever to download (slow network) or the
  // postMessage handshake never landed (rare). Reset on each remount.
  const [ketcherTimedOut, setKetcherTimedOut] = useState(false);
  const KETCHER_INIT_TIMEOUT_MS = 30_000;
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
        if (!cancelled) setHealthOk(
          // Prod docks on RunPod serverless, not the legacy dedicated
          // POD_DOCK_URL pod — so a configured RunPod key also means the
          // dock engine is live. Without this the "Pod" dot was always red
          // even though docking worked.
          j?.pod_dock_status === "ok" || j?.runpod_api_key === "configured"
        );
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

  // (v0.95) Detect Ketcher init timeouts. If the iframe hasn't posted
  // its 'init' message within KETCHER_INIT_TIMEOUT_MS of a fresh
  // mount, surface a "taking longer than expected" banner with a
  // Reload Editor button so the user knows it's not just a forever
  // spinner. Cleared whenever ketcherReady flips true OR iframeKey
  // changes (manual retry triggers a fresh window).
  useEffect(() => {
    setKetcherTimedOut(false);
    if (ketcherReady) return;
    const t = window.setTimeout(() => {
      // Only surface the timeout if Ketcher STILL isn't ready when
      // the timer fires. The closure captures the ketcherReady value
      // at effect-creation time, so we re-check via the state ref to
      // avoid a stale-flag race.
      setKetcherTimedOut(true);
    }, KETCHER_INIT_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [iframeKey, ketcherReady]);

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
    }, 350);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [ketcherReady]);

  // Live validity + SA score for whatever's on the canvas. Both hooks
  // share the same React Query cache key so this is ONE network round-
  // trip per unique SMILES, not two. Updates within ~10ms of the
  // 350ms polling tick — feels live to the user. (Was 700ms; tightened
  // in v1.27 so 3D viewer follows 2D edits with less perceived lag.)
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
  type EnrichStatus = "pending" | "done-empty" | "done" | "failed" | "non-human" | "curated";
  const [enrichmentStatus, setEnrichmentStatus] = useState<Record<string, EnrichStatus>>({});

  const targetMeta = useMemo(
    () => mergedCatalog.find((t: any) => t.id === selectedTarget),
    [mergedCatalog, selectedTarget]
  );
  // (multi-target) Union curated mutations across EVERY selected target,
  // tagging each row with the target it belongs to. Previously this read
  // only the first target's mutations, so ALK+KRAS showed ALK mutations
  // only. The targetId lets the picker label each row by gene and lets
  // Run Dock route each mutation back to its owning target.
  const availableMutations = useMemo(() => {
    const out: { code: string; label: string; significance: string; targetId: string }[] = [];
    const seen = new Set<string>();
    for (const tid of selectedTargets) {
      const meta = mergedCatalog.find((t: any) => t.id === tid) as any;
      for (const m of (meta?.mutations ?? [])) {
        const key = `${tid}:${m.code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ code: m.code, label: m.label, significance: m.significance, targetId: tid });
      }
    }
    return out;
  }, [mergedCatalog, selectedTargets]);

  // (multi-target) Route each selected mutation to the target it belongs to.
  // A curated code goes only to the target whose catalog lists it; a custom
  // typed code (not curated on ANY selected target) applies to every target
  // as best-effort (the backend mutant-build gate flags any it can't build).
  // For a single target this returns selectedMutations unchanged.
  const mutationsForJob = (tid: string): string[] => {
    const meta = mergedCatalog.find((t: any) => t.id === tid) as any;
    const thisCurated = new Set<string>((meta?.mutations ?? []).map((m: any) => m.code));
    const anyCurated = new Set<string>();
    for (const t of selectedTargets) {
      const tm = mergedCatalog.find((x: any) => x.id === t) as any;
      for (const m of (tm?.mutations ?? [])) anyCurated.add(m.code);
    }
    return selectedMutations.filter((code) => thisCurated.has(code) || !anyCurated.has(code));
  };

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

  // (Studio v1.07) When reseed carries a pdb_id that isn't in the
  // curated catalog (e.g. Edit & re-dock or History Re-run from a job
  // run against an ad-hoc PDB like 4OBE), the id lands in
  // selectedTargets but mergedCatalog has no entry for it — so the
  // submit-time lookup at runFullJob falls through with "Couldn't
  // resolve a PDB id for target …". Auto-register an ad-hoc target
  // row to keep mergedCatalog whole. Fires once after the curated
  // catalog query resolves, so we know reliably whether the id is
  // curated. RCSB title is fetched in the background to make the
  // chip readable; chain defaults to the reseed value or "A".
  const reseedAdHocAddedRef = useRef(false);
  useEffect(() => {
    if (reseedAdHocAddedRef.current) return;
    if (!catalog) return; // wait for curated catalog to land
    const pdbStr = reseed?.pdb_id;
    if (!pdbStr) { reseedAdHocAddedRef.current = true; return; }
    const lower = pdbStr.toLowerCase();
    if (catalog.some((c: any) => c.id === lower)) {
      reseedAdHocAddedRef.current = true; // already curated; nothing to do
      return;
    }
    if (adHocTargets.some((t) => t.id === lower)) {
      reseedAdHocAddedRef.current = true; // session-restored already
      return;
    }
    reseedAdHocAddedRef.current = true;
    const upper = pdbStr.toUpperCase();
    setAdHocTargets((prev) => [
      ...prev,
      {
        id: lower,
        pdb_id: upper,
        chain: (reseed?.chain || "A").toUpperCase(),
        name: upper, // placeholder until RCSB title resolves
        mutations: [],
        pocket: null,
        isAdHoc: true,
      },
    ]);
    // Background-fetch RCSB title so the chip + dropdown show the
    // protein name instead of just the 4-char id. Best-effort —
    // failures leave the placeholder, which still works for docking.
    fetch(`https://data.rcsb.org/rest/v1/core/entry/${upper}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: any) => {
        const title: string | undefined = m?.struct?.title;
        if (!title) return;
        setAdHocTargets((prev) =>
          prev.map((t) => (t.id === lower ? { ...t, name: title } : t)),
        );
      })
      .catch(() => { /* silent — placeholder is fine */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

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

    // (2026-08) Curated-gene reuse. If this searched structure is the SAME
    // protein (same UniProt accession) as one of our curated catalog
    // targets, reuse that gene's hand-picked mutation set instead of the
    // thin UniProt variant list — this is what makes "pick a different
    // EGFR / KRAS / ... structure" auto-populate the good mutations like the
    // built-in 13. Numbering is canonical for these so it usually maps; the
    // backend validates buildability on submit regardless.
    const curatedHit = (catalog || []).find(
      (c: any) => (c?.uniprot || "").toUpperCase() === (uniprotAcc as string).toUpperCase()
    );
    if (curatedHit && Array.isArray(curatedHit.mutations) && curatedHit.mutations.length > 0) {
      const curatedChips = curatedHit.mutations.map((m: any) => ({
        code: m.code, label: m.label, significance: m.significance,
      }));
      setAdHocTargets((prev) =>
        prev.map((t) => (t.id === targetId ? { ...t, mutations: curatedChips } : t)),
      );
      setEnrichmentStatus((prev) => ({ ...prev, [targetId]: "curated" }));
      return;
    }

    // (Phase 2) Known-mutations table for high-value oncology genes not in
    // the curated catalog (ESR1, AR, JAK2, RET, FGFR2/3, IDH2, NRAS, AKT1,
    // SMO, NTRK1). Same treatment as a catalog match — auto-fill the picker
    // so ANY human structure of these genes behaves like the built-in 13.
    const knownList = KNOWN_MUTATIONS_BY_UNIPROT[(uniprotAcc as string).toUpperCase()];
    if (knownList && knownList.length > 0) {
      const knownChips = knownList.map((m) => ({
        code: m.code, label: m.label, significance: m.significance,
      }));
      setAdHocTargets((prev) =>
        prev.map((t) => (t.id === targetId ? { ...t, mutations: knownChips } : t)),
      );
      setEnrichmentStatus((prev) => ({ ...prev, [targetId]: "curated" }));
      return;
    }

    // Step 2: fetch UniProt entry, extract Natural variant features.
    // We filter to variants that have any disease/cancer/clinical
    // significance annotation in the description so the user gets
    // a focused chip set (P53 has hundreds of raw variants; only the
    // pathogenic ones are useful as docking inputs).
    // (v0.86) NO ?fields= param. UniProt's API returns 400 for
    // ?fields=features (the param naming uses prefixed forms like
    // ft_variant, not bare 'features'), and getting the right name
    // wrong silently kills enrichment for every PDB. The bare URL
    // returns the full entry (~50 KB max for typical proteins),
    // which is small enough not to matter; we filter the variant
    // features client-side anyway.
    const upRes = await fetch(`https://rest.uniprot.org/uniprotkb/${uniprotAcc}.json`);
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
    // (v0.87) Strict format guard: backend's mutation parser expects
    // <orig><pos><new> like "T790M". Anything else (range deletions,
    // missing original AA, multi-residue substitutions) is dropped
    // here so we don't surface chips that the backend will reject at
    // submit. The previous parser had a precedence bug — orig fell
    // back to the position NUMBER instead of the AA letter, producing
    // chips like "428D" that the backend correctly rejected with
    // value_error · invalid mutation code(s).
    const codePattern = /^[A-Z]\d+[A-Z]$/;
    for (const v of variants) {
      // UniProt variant feature shape: alternativeSequence has
      // originalSequence (1-letter wild-type residue) and
      // alternativeSequences (array of 1-letter substitutions).
      // Some variants encode insertions / deletions instead — skip
      // those by demanding both sides be single letters.
      const orig: unknown = v?.alternativeSequence?.originalSequence;
      const start = v?.location?.start?.value;
      const altList: string[] = v?.alternativeSequence?.alternativeSequences || [];
      if (typeof start !== "number" || altList.length === 0) continue;
      if (typeof orig !== "string" || orig.length !== 1) continue;
      const wt = orig;
      for (const alt of altList) {
        if (!alt || alt.length !== 1) continue;
        const code = `${wt}${start}${alt}`;
        if (!codePattern.test(code)) continue; // belt-and-suspenders
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
      // Distinguish a human protein with no annotated variants from a
      // non-human structure (a fish/mouse ortholog has no HUMAN clinical
      // mutations by definition — e.g. the rainbowfish ESR1 structures),
      // so the empty state tells the user why and what to do.
      const taxon = (upData as any)?.organism?.taxonId;
      const nonHuman = typeof taxon === "number" && taxon !== 9606;
      setEnrichmentStatus((prev) => ({ ...prev, [targetId]: nonHuman ? "non-human" : "done-empty" }));
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
          // (v1.27) Stamp the docked SMILES onto the result so the 3D
          // viewer's edit-detection is deterministic, not ref-timed.
          res.smiles = baseArgs.smiles;
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
  // (Studio v1.06) On Edit & re-dock and History Re-run, the reseed
  // payload carries the source job's share_id. Seed fullJobKey from
  // it so the existing polling loop (line ~1494) re-hydrates the 3D
  // viewer + score panel + per-compound results from /jobs/{key}.
  // initialSession wins when both are present (continuing a session
  // that already had a different fullJobKey takes priority — the user
  // came back from a JobPage tab, not from a reseed). When reseed has
  // replaceSession=true initialSession is null, so reseed.sourceJobKey
  // is what lands.
  const [fullJobKey, setFullJobKey] = useState<string | null>(
    initialSession?.fullJobKey ?? reseed?.sourceJobKey ?? null,
  );
  // (Studio v1.06) When a reseed names a specific compound (Edit & re-dock
  // is always single-compound), prefer THAT compound's row when the
  // polling effect promotes rows into the legacy dockResult slots. Without
  // this, a multi-compound prior job would show the STRONGEST compound's
  // pose, not the one the user clicked Edit on. Ref-based so it survives
  // the polling effect's deps without retriggering, and we clear it after
  // first use so subsequent Run Docks fall back to the standard "show
  // strongest" semantics.
  const reseedFocusCompoundNameRef = useRef<string | null>(
    reseed?.compounds?.length === 1 && reseed.compounds[0].name
      ? reseed.compounds[0].name.toLowerCase()
      : null,
  );
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
    // True when that variant's cell failed docking (runner wrote
    // best_score=0.0 + a *_failed extra, no pose). The score 0.00 is a
    // placeholder, NOT a result — the table renders "✗ failed" instead
    // of a fake 0.00, and loadIn3D won't feed the 3D viewer a phantom
    // poseless dockResult (which rendered a conformer floating at the
    // origin, miles from the receptor).
    mutantFailed?: boolean;
    wtFailed?: boolean;
    // (v1.32) Human-readable reason the compound failed to dock, derived
    // from the runner's `extra` prefix. Shown in the inline note when the
    // user clicks a fully-failed row (no pose for either variant).
    failReason?: string;
    // (v1.00) ADMET payload from job.compounds[].admet — drug-likeness +
    // extended risk profile (hERG / BBB / CYP / DILI). Optional; absent
    // when RDKit failed to parse the SMILES on the backend.
    admet?: import("../api").Admet | null;
  };
  const [fullJobRows, setFullJobRows] = useState<FullJobRow[]>(
    initialSession?.fullJobRows ? (initialSession.fullJobRows as FullJobRow[]) : [],
  );
  // Which row is currently shown in the 3D viewer + score panel
  // (defaults to the strongest mutant once results land).
  const [selectedRowCompoundId, setSelectedRowCompoundId] = useState<number | null>(
    initialSession?.selectedRowCompoundId ?? null,
  );
  // (v1.00) Per-row ADMET expand state. Set of compoundIds whose
  // result row is currently showing the AdmetChips drawer below the
  // score line. Click the ⓘ ADMET button on any row to toggle.
  const [admetExpandedIds, setAdmetExpandedIds] = useState<Set<number>>(new Set());
  const toggleAdmetExpanded = (cid: number) =>
    setAdmetExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
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
  // (v0.92) Reseed always lands on an EDITABLE setup. The user came
  // back to tweak something — collapsing the selectors and forcing
  // them to click "edit" first is unnecessary friction. Only honour
  // the saved collapsed state when restoring a session that wasn't
  // triggered by a reseed (e.g. Back to Studio after viewing a
  // completed run, where they're inspecting not editing).
  const [setupCollapsed, setSetupCollapsed] = useState(
    reseed ? false : (initialSession?.setupCollapsed ?? false),
  );
  // (v0.93) v0.73's auto-collapse-on-completion was removed — it kept
  // re-collapsing after every Run Dock, forcing the user to click
  // 'edit ↗' just to tweak a compound and re-run. The manual ▾ setup
  // toggle in the panel header is enough; users who want the results-
  // focused layout can collapse explicitly. The reseed-editable
  // initial state above (v0.92) still applies on first mount.
  void fullJobStatus; void fullJobRows; // referenced elsewhere; effect dropped
  // (v1.08) setFullJobKey is no longer called from the submit path
  // (we redirect to /jobs instead of polling in-Studio) but the
  // setter is kept on the useState so the variable type stays a tuple
  // — voiding it silences the strict 'declared but never read' warning.
  void setFullJobKey;

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
        ensemble,
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
    selectedTargets, selectedMutations, includeWt, ensemble, adHocTargets,
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
  async function runFullJob(engine: "quickvina2_gpu" | "gnina" = "quickvina2_gpu") {
    // (v1.04) Engine is now an explicit parameter passed from the
    // split RUN DOCK button (Vina | GNINA). Default stays Vina so
    // any existing call sites that don't pass engine still get the
    // current behaviour. GNINA dispatches to the pod's /dock_gnina
    // endpoint; on the current Blackwell pod cnn_mode=none is forced
    // so the result is sampling-equivalent to Vina with slightly
    // different log output, but on the planned 4090 deploy GNINA's
    // CNN rerank will produce genuinely different (better) pose
    // ranking. UI surfaces this via a tooltip on the GNINA half.
    // (v0.62-0.64) Build the compound list. If the user has staged
    // compounds, use those; otherwise fall back to currentSmiles
    // (the singleton path). Filter out empties.
    //
    // (bugfix 2026-05-22) Dock WHAT'S IN THE EDITOR. The user can edit the
    // sketcher canvas (currentSmiles) without explicitly "committing" the
    // change into the active staged row — most notably via Edit & re-dock,
    // which stages the ORIGINAL compound and loads it into the canvas. If we
    // submit the staged `compounds` verbatim, an uncommitted canvas edit is
    // silently dropped and the ORIGINAL molecule gets docked (→ for a
    // "changed" molecule the user sees the original's score, often served
    // straight from the dock cache). So before building the payload, fold the
    // live canvas into the active staged compound when it differs. Same
    // "stagedDirty" condition the unsaved-edits guard uses (see the
    // beforeunload effect). The brand-new-compound case (canvas not pointing
    // at a staged row) is untouched: activeCompoundIdx is out of range, so no
    // overwrite happens.
    const canvasOverridesActive =
      activeCompoundIdx >= 0 &&
      activeCompoundIdx < compounds.length &&
      !!currentSmiles &&
      currentSmiles !== compounds[activeCompoundIdx].smiles;
    const compoundList: { name?: string | null; smiles: string }[] = compounds.length > 0
      ? compounds
          .map((c, i) =>
            canvasOverridesActive && i === activeCompoundIdx
              ? { ...c, smiles: currentSmiles }
              : c,
          )
          .filter((c) => c.smiles)
          .map((c) => ({ name: c.name || null, smiles: c.smiles }))
      : currentSmiles
      ? [{ name: loadedCompound?.name || activeDraft?.name || "Studio compound", smiles: currentSmiles }]
      : [];
    if (compoundList.length === 0) { setDockError("Canvas is empty — sketch a structure first."); return; }
    if (selectedTargets.length === 0) { setDockError("Pick a target."); return; }
    setDockError(null);
    setInvalidCompounds(new Map());  // fresh validation each submit
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
        // (v1.07) Defensive fallback: if mergedCatalog has no entry
        // for this id (race between catalog query + auto-register
        // effect, or session restored before catalog hydrated), use
        // tid as the PDB id directly when it looks like one (4 chars).
        // Ad-hoc targets always use id = pdb_id.toLowerCase(), so
        // the conversion is lossless. Without this fallback, a
        // perfectly-staged target like 4OBE produces the "Couldn't
        // resolve a PDB id" error even when the answer is obvious.
        const fallbackPdb = /^[a-z0-9]{4}$/i.test(tid) ? tid.toUpperCase() : "";
        const tPdb = (tMeta?.pdb_id || fallbackPdb).trim();
        if (!tPdb) throw new Error(`Couldn't resolve a PDB id for target "${tid}".`);
        const jobMutations = mutationsForJob(tid);
        const job = await api.createJob({
          pdb_id: tPdb,
          chain: tMeta?.chain || "A",
          uniprot_id: tMeta?.uniprot,
          mutations: jobMutations,
          compounds: compoundList,
          include_wt: includeWt,
          // Ensemble docking v1 runs on the QuickVina batch path — it does
          // NOT combine with GNINA. Send false for GNINA jobs so the job
          // row honestly reflects what runs (the runner ignores ensemble
          // for engine=gnina anyway, but keeping the row accurate means
          // History/JobPage don't show a misleading "ensemble" badge).
          // Also force false when the user's ensemble access has been
          // revoked by an admin — the toggle is already disabled in that
          // case, this is belt-and-suspenders so a stale toggle state
          // can't slip an ensemble=true past the backend's 402 gate.
          ensemble: engine === "gnina" || !ensembleAllowed ? false : ensemble,
          engine,
          title: `Studio · ${tid.toUpperCase()}${jobMutations.length > 0 ? ` · ${jobMutations.join("+")}` : ""}${compoundList.length > 1 ? ` · ${compoundList.length} compounds` : ""}${engine === "gnina" ? " · GNINA" : ""}${engine !== "gnina" && ensembleAllowed && ensemble ? " · Ensemble" : ""}`,
        });
        return { tid, job, pdbId: tPdb };
      });
      const results = await Promise.allSettled(tasks);
      // First successful job drives Studio's in-page polling; any
      // others are submitted but the user views them via /history.
      let primary: { tid: string; job: Job } | null = null;
      let firstError: string | null = null;
      // Per-compound validation failures from a 422 — collected once and
      // pushed into invalidCompounds state so the SPECIFIC staged rows get
      // flagged inline (by name, with the reason + a remove/edit hint).
      let invalidFromSubmit: Array<{
        name: string | null; smiles?: string; reason: string; suggestion?: string;
      }> | null = null;
      for (const r of results) {
        if (r.status === "fulfilled" && !primary) primary = r.value;
        else if (r.status === "rejected" && !firstError) {
          // The backend's 422 carries invalid_compounds with a specific
          // reason + actionable suggestion per row. We flag the rows in
          // the compound list (see invalidCompounds) AND set a short
          // banner pointing at them — instead of the old vague "1 of 3
          // compound SMILES failed validation" with no names.
          const reason = r.reason as {
            message?: string;
            detail?: {
              invalid_compounds?: Array<{
                name: string | null; smiles?: string;
                reason: string; suggestion?: string;
              }>;
            };
          };
          const invalid = reason?.detail?.invalid_compounds;
          if (Array.isArray(invalid) && invalid.length > 0) {
            invalidFromSubmit = invalid;
            const names = invalid
              .map((ic) => (ic.name ? `"${ic.name}"` : "an unnamed compound"))
              .join(", ");
            firstError =
              invalid.length === 1
                ? `${names} can't be docked — see the flagged row below for the reason.`
                : `${invalid.length} compounds can't be docked (${names}) — see the flagged rows below.`;
          } else {
            firstError = reason?.message || "Submit failed";
          }
        }
      }
      if (invalidFromSubmit) {
        const m = new Map<string, { reason: string; suggestion?: string }>();
        for (const ic of invalidFromSubmit) {
          if (ic.smiles) {
            m.set(ic.smiles.trim(), { reason: ic.reason, suggestion: ic.suggestion });
          }
        }
        setInvalidCompounds(m);
      }
      if (!primary) { setDockError(firstError || "All Full Job submissions failed."); return; }
      const jobKey = (primary.job as any).share_id ?? String((primary.job as any).id ?? "");
      if (!jobKey) {
        setDockError("Job created but no id returned — refresh /history to find it.");
        return;
      }
      // (Studio v1.08) Studio is for compose; JobPage is for analyze.
      // On submit, hand off to the JobPage so the user sees the
      // richer in-flight view (engine-aware progress stages, ProLIF
      // 2D map, PoseBusters, share/report buttons) without us
      // duplicating that UI inline. The bidirectional flow:
      //   • Submit here → land on JobPage with ?from=studio
      //   • JobPage's "Back to Studio" link restores this session
      //     and the polling effect re-hydrates results
      //   • JobPage's "Edit & re-dock" carries sourceJobKey (v1.06)
      //     so Studio comes back with results pre-populated for the
      //     compound being iterated on
      // Persist the session snapshot SYNCHRONOUSLY before navigating
      // because the debounced autosave (400 ms) won't fire before
      // the unmount on route change. We save the staged setup + the
      // new fullJobKey so "Back to Studio" lands the user on a
      // Studio that knows about this job.
      const snap: StudioSessionSnapshot = {
        v: 1,
        savedAt: Date.now(),
        selectedTargets,
        selectedMutations,
        includeWt,
        ensemble,
        adHocTargets,
        compounds,
        activeCompoundIdx,
        currentSmiles,
        fullJobKey: jobKey,
        fullJobStatus: primary.job.status || "pending",
        fullJobStage: primary.job.stage || null,
        fullJobRows: [],
        selectedRowCompoundId: null,
        dockResult: null,
        dockResultWt: null,
        setupCollapsed,
        loadedCompound,
      };
      writeStudioSession(snap);
      // Multi-target submissions: redirect to the first job's page;
      // the others are submitted and visible in /history. The
      // in-Studio promoteToast about "polling first; check /history
      // for the rest" no longer makes sense post-redirect, so we
      // drop it — the History page is one click from JobPage's
      // header and lists everything.
      navigate(`/jobs/${jobKey}?from=studio`);
      return;
    } catch (e: any) {
      setDockError(e?.message || "Full Job submission failed.");
    } finally {
      setSubmittingFull(false);
    }
  }

  // (v1.18, #209) Virtual screening submit — sibling to runFullJob but
  // targets POST /screening. Differs from a Full Job in three ways the
  // user feels:
  //   1. Multiple compounds × variants are RANKED (not displayed as a
  //      matrix). The selectivity_index column on /screening/:shareId
  //      sorts compounds by how cleanly they prefer the mutant over WT.
  //   2. Lower exhaustiveness (4 vs 8) — screening is about ranking
  //      across many compounds, not nailing absolute scores per cell.
  //   3. Pre-stages every (compound, variant) row at submit time so the
  //      progress bar has its denominator immediately.
  // Single target only in v1 (multi-target screening would mean
  // separate runs, easier to surface as separate buttons later).
  async function runScreening() {
    // Reuse the same compound-and-target gating as runFullJob so the
    // disabled-state logic on the button stays in sync.
    // The createScreening API uses `{name?: string, smiles: string}` — name is
    // optional/undefined (never null), matching the matching CompoundIn schema.
    // Filter `null` to `undefined` when staging so the optional-name contract
    // holds end-to-end.
    const compoundList: { name?: string; smiles: string }[] = compounds.length > 0
      ? compounds.filter((c) => c.smiles).map((c) => ({ name: c.name || undefined, smiles: c.smiles }))
      : currentSmiles
      ? [{ name: loadedCompound?.name || activeDraft?.name || "Studio compound", smiles: currentSmiles }]
      : [];
    if (compoundList.length === 0) { setDockError("Stage at least one compound first."); return; }
    if (selectedTargets.length === 0) { setDockError("Pick a target."); return; }
    setDockError(null);
    setSubmittingFull(true);
    try {
      // Resolve the target the same way runFullJob does (mergedCatalog
      // first, then fall back to PDB-shaped id). Screening is single-
      // target in v1 — use the first selected target.
      const tid = selectedTargets[0];
      const tMeta = mergedCatalog.find((c: any) => c.id === tid) as any;
      const fallbackPdb = /^[a-z0-9]{4}$/i.test(tid) ? tid.toUpperCase() : "";
      const tPdb = (tMeta?.pdb_id || fallbackPdb).trim();
      if (!tPdb) { setDockError(`Couldn't resolve a PDB id for target "${tid}".`); return; }

      const screenMutations = mutationsForJob(tid).slice(0, 2);
      const screening = await api.createScreening({
        pdb_id: tPdb,
        chain: tMeta?.chain || "A",
        uniprot_id: tMeta?.uniprot,
        // Backend caps screening at 2 mutations (matches the Studio
        // multi-mutation picker). Slice as a defensive guard against
        // future picker bumps so the server validation stays the
        // contract.
        mutations: screenMutations,
        compounds: compoundList,
        include_wt: includeWt,
        engine: "quickvina2_gpu",
        exhaustiveness: 4,
        title: `Studio screen · ${tid.toUpperCase()}${screenMutations.length > 0 ? ` · ${screenMutations.join("+")}` : ""} · ${compoundList.length} cmpd`,
      });
      const screeningKey = (screening as any).share_id ?? String((screening as any).id ?? "");
      if (!screeningKey) {
        setDockError("Screening created but no id returned — refresh /history to find it.");
        return;
      }
      // Persist session snapshot synchronously (same reason as
      // runFullJob: the debounced autosave won't fire before
      // route unmount).
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
        fullJobKey: null,
        fullJobStatus: null,
        fullJobStage: null,
        fullJobRows: [],
        selectedRowCompoundId: null,
        dockResult: null,
        dockResultWt: null,
        setupCollapsed,
        loadedCompound,
      };
      writeStudioSession(snap);
      navigate(`/screening/${screeningKey}?from=studio`);
      return;
    } catch (e: any) {
      setDockError(e?.message || "Virtual screening submission failed.");
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
              admet: c.admet ?? null,
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
            // A failed cell: the runner writes best_score=0.0 as a
            // placeholder + a *_failed prefix in `extra`, and there's no
            // pose. Either signal alone is sufficient; OR them for safety.
            const cellFailed =
              (r.best_score === 0 && !posePdbqtB64) ||
              /^(ligand_prep_failed|docking_failed|mutant_build_failed)/.test(
                r.extra || "",
              );
            if (isWt) {
              row.wtScore = r.best_score;
              row.wtPoseB64 = posePdbqtB64;
              row.wtFailed = cellFailed;
            } else {
              row.mutantScore = r.best_score;
              row.mutantPoseB64 = posePdbqtB64;
              row.mutantFailed = cellFailed;
            }
            // (v1.32) Capture a friendly failure reason from the runner's
            // `extra` prefix so the inline note can tell the user WHY a
            // compound failed (not just "it failed").
            if (cellFailed && !row.failReason) {
              const ex = r.extra || "";
              row.failReason = /^ligand_prep_failed/.test(ex)
                ? "Ligand prep failed — RDKit couldn't build a 3D structure from this SMILES."
                : /^mutant_build_failed/.test(ex)
                ? "Mutant receptor build failed for this compound."
                : /^docking_failed/.test(ex)
                ? "Docking produced no pose — usually means the molecule is too large or has chemistry the docking engine can't handle (e.g. big cyclic peptides)."
                : "This compound failed to dock — no pose was produced.";
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
            // (v1.06) If the user landed via Edit & re-dock with a
            // specific compound name, prefer THAT row over the
            // strongest. Falls through to "strongest" semantics
            // otherwise. Ref is one-shot: cleared after first use so
            // subsequent Run Docks from this session use the normal
            // "show strongest" promotion.
            const focusName = reseedFocusCompoundNameRef.current;
            const focusedIdx = focusName
              ? rows.findIndex((r) => (r.name || "").toLowerCase() === focusName)
              : -1;
            const best = focusedIdx >= 0 ? rows[focusedIdx] : rows[0];
            if (focusName) reseedFocusCompoundNameRef.current = null;
            setSelectedRowCompoundId(best.compoundId);
            // Gate on POSE presence, not score-non-null. A failed cell
            // has best_score=0.0 (a placeholder) but no pose — building a
            // dockResult from it gives the 3D viewer a poseless result it
            // renders as a conformer stuck at the origin, floating far
            // from the receptor. Only build a result when there's a real
            // pose to show.
            const mut: QuickDockResult | null = best.mutantPoseB64 ? {
              ok: true,
              score: best.mutantScore ?? 0,
              hits: [],
              misses: [],
              pose_pdbqt_b64: best.mutantPoseB64,
              pdb_id: job.pdb_id,
              chain: job.chain,
              receptor_variant: "mutant",
              smiles: best.smiles,  // (v1.27) deterministic edit-detection
            } : null;
            const wt: QuickDockResult | null = best.wtPoseB64 ? {
              ok: true,
              score: best.wtScore ?? 0,
              hits: [],
              misses: [],
              pose_pdbqt_b64: best.wtPoseB64,
              pdb_id: job.pdb_id,
              chain: job.chain,
              receptor_variant: "wt",
              smiles: best.smiles,  // (v1.27) deterministic edit-detection
            } : null;
            // Single-target rule: mut → primary slot if any, else WT
            // takes the primary slot. When neither has a pose (every
            // cell failed) leave both null — no phantom dock result.
            if (mut) { setDockResult(mut); setDockResultWt(wt); }
            else if (wt) { setDockResult(wt); setDockResultWt(null); }
            else { setDockResult(null); setDockResultWt(null); }
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
      <MobileDesktopOnlyBanner pageName="Studio" />
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
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 text-xs font-mono z-10 bg-[#070b15] gap-3 px-4">
                {ketcherTimedOut ? (
                  // (v0.95) Past the 30 s timeout — give the user
                  // actionable options instead of an infinite spinner.
                  // Reload Editor remounts the iframe with a fresh
                  // key so the bundle download starts over. Reload
                  // Page is the nuclear option.
                  <>
                    <div className="flex items-center gap-2 text-amber-300">
                      <span className="text-base">⏱</span>
                      <span className="font-bold">Editor is taking longer than expected</span>
                    </div>
                    <div className="text-slate-500 text-[10px] max-w-md text-center leading-relaxed">
                      The 2D editor bundle (~5–8 MB) usually loads in 5–10 s, but on slow networks
                      or stalled CDN edges it can hang. Try the Reload Editor button below first;
                      if that still doesn't work, your connection may need to be checked.
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => setIframeKey((k) => k + 1)}
                        className="px-3 py-1.5 rounded border border-cyan-600/60 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/60 hover:border-cyan-500 text-[10px] uppercase tracking-wider"
                        title="Remount the iframe — restarts the Ketcher bundle download"
                      >
                        ↻ Reload editor
                      </button>
                      <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="px-3 py-1.5 rounded border border-slate-700/60 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 text-[10px] uppercase tracking-wider"
                        title="Full page reload"
                      >
                        ↻ Reload page
                      </button>
                    </div>
                  </>
                ) : (
                  <span className="animate-pulse">▮ initializing editor</span>
                )}
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
                  {/* (v1.01) Removed duplicate "full view ↗" — the same
                      link already lives in the Telemetry header right
                      above ('✓ full job done · view ↗'). Two of them
                      next to each other read as confusion. */}
                  <span className="font-mono text-[9px] text-slate-600">
                    {fullJobRows.length} · best first
                  </span>
                </div>
                <div className="rounded border border-slate-800 divide-y divide-slate-800/60 max-h-[260px] overflow-y-auto">
                  {fullJobRows.map((row) => {
                    const isSelected = row.compoundId === selectedRowCompoundId;
                    // (v1.31) A delta is only meaningful when BOTH
                    // variants actually docked. If either cell failed,
                    // the score is a 0 placeholder, not a real binding
                    // energy — subtracting them produces a fake Δ that
                    // looks like a result. Suppress it.
                    const delta = (row.mutantScore != null && row.wtScore != null
                                   && !row.mutantFailed && !row.wtFailed)
                      ? row.mutantScore - row.wtScore
                      : null;
                    // (v1.22.1) Click targets reshuffled. v0.73 had the
                    // body navigate to JobPage and a tiny ▶ button stay
                    // in Studio — which is backwards for the workflow:
                    // 99% of in-Studio clicks are "show this pose in
                    // the 3D viewer above", not "yank me to a different
                    // page." User feedback explicitly called this out.
                    //
                    // New layout:
                    //   - body click → loadIn3D, stays in Studio.
                    //   - explicit "Full job →" mini-button on the right
                    //     side navigates to /jobs/{key}.
                    // The ▶ glyph stays as a visual selection indicator
                    // (filled when active) — no longer a separate click
                    // target. ↗ removed from the body since the body
                    // doesn't navigate anymore.
                    // (v1.32) A row with no pose for EITHER variant is a
                    // fully-failed compound — there is nothing to load
                    // into the 3D viewer or the 2D editor.
                    const rowHasNoPose = !row.mutantPoseB64 && !row.wtPoseB64;
                    const loadIn3D = () => {
                      // (v1.32) Fully-failed row → non-destructive click.
                      // The old behavior cleared dockResult/dockResultWt
                      // and loaded the (often unparseable) failed SMILES
                      // into the 2D editor. That wiped the successful
                      // compounds' poses out of the 3D viewer and swapped
                      // the canvas — so clicking the failed row felt like
                      // the whole app reset to "just the failed one." A
                      // failed compound has nothing to show, so clicking
                      // it now only moves the selection highlight; the 3D
                      // + 2D views stay on whatever successful compound
                      // was last loaded, and the inline note below
                      // explains why this row has no pose.
                      if (rowHasNoPose) {
                        setSelectedRowCompoundId(row.compoundId);
                        return;
                      }
                      setSelectedRowCompoundId(row.compoundId);
                      // (v1.31) Gate the 3D result objects on the PRESENCE
                      // OF A POSE, not on `score != null`. A failed
                      // compound (oversized peptide, bad SMILES, docking
                      // crash) comes back with best_score=0 and NO
                      // pose_pdbqt — `0` is not null, so the old guard
                      // built a truthy dockResult with an empty pose.
                      // Downstream, ProductionViewer3D saw hasDock=true
                      // but had no pose coordinates, so it rendered the
                      // raw RDKit conformer at the origin — a molecule
                      // "floating far away" from the receptor. Gating on
                      // the pose means a poseless compound feeds the
                      // viewer nothing, and the viewer falls back to its
                      // live-conformer mode cleanly.
                      const mut: QuickDockResult | null = row.mutantPoseB64 ? {
                        ok: true,
                        score: row.mutantScore ?? 0,
                        hits: [],
                        misses: [],
                        pose_pdbqt_b64: row.mutantPoseB64,
                        pdb_id: dockResult?.pdb_id || dockResultWt?.pdb_id,
                        chain: dockResult?.chain || dockResultWt?.chain,
                        receptor_variant: "mutant",
                        smiles: row.smiles,  // (v1.27) deterministic edit-detection
                      } : null;
                      const wt: QuickDockResult | null = row.wtPoseB64 ? {
                        ok: true,
                        score: row.wtScore ?? 0,
                        hits: [],
                        misses: [],
                        pose_pdbqt_b64: row.wtPoseB64,
                        pdb_id: dockResult?.pdb_id || dockResultWt?.pdb_id,
                        chain: dockResult?.chain || dockResultWt?.chain,
                        receptor_variant: "wt",
                        smiles: row.smiles,  // (v1.27) deterministic edit-detection
                      } : null;
                      if (mut) { setDockResult(mut); setDockResultWt(wt); }
                      else if (wt) { setDockResult(wt); setDockResultWt(null); }
                      else { setDockResult(null); setDockResultWt(null); }
                      // Keep the 2D editor in sync with the 3D pose.
                      // Previously a docking-results row click only
                      // updated the 3D viewer — the Ketcher canvas stayed
                      // on whatever was last loaded, so clicking through
                      // the 3 result compounds changed the 3D but not the
                      // 2D. Mirror the staged-compounds list, which loads
                      // the structure on click. Fire-and-forget: the 3D
                      // update above is synchronous, the 2D follows when
                      // Ketcher finishes setMolecule.
                      if (row.smiles) {
                        void loadIntoCanvas(row.smiles, {
                          libraryName: row.name || undefined,
                        });
                      }
                    };
                    const admetExpanded = admetExpandedIds.has(row.compoundId);
                    return (
                      <div
                        key={row.compoundId}
                        className={`text-[10px] font-mono ${
                          isSelected ? "bg-cyan-950/30" : "hover:bg-slate-800/30"
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          {/* (v1.22.1) ▶ is now a passive selection
                              indicator, not a click target. The whole
                              row body clicks to load the pose; this
                              glyph just shows which compound is active. */}
                          <span
                            className={`shrink-0 px-1.5 py-1 ${isSelected ? "text-cyan-300" : "text-slate-700"}`}
                            aria-hidden
                          >
                            ▶
                          </span>
                          <button
                            type="button"
                            onClick={loadIn3D}
                            className="flex-1 flex items-center gap-2 text-left px-1 py-1 hover:bg-slate-800/40 transition-colors"
                            title={rowHasNoPose
                              ? `${row.name} failed to dock — no pose to display. Click for details.`
                              : `Load ${row.name}'s pose into the 3D viewer above (stays in Studio).`}
                          >
                            <span className={`flex-1 text-left truncate ${isSelected ? "text-cyan-200" : "text-slate-200"}`}>
                              {row.name}
                            </span>
                            {/* (v1.31) A failed cell shows "✗ failed" in
                                rose — NOT a fake score. Previously a
                                failed compound (best_score=0, no pose)
                                rendered "+0.00" in the normal score
                                color, which reads as a real — even
                                good — binding energy. Users clicked it,
                                got a broken 3D view, and concluded the
                                product was broken. The score is only a
                                number when the compound actually
                                docked; otherwise it's a failure. */}
                            <span className={`tabular-nums w-12 text-right ${
                              row.mutantFailed ? "text-rose-400"
                                : row.mutantScore != null ? scoreTier(row.mutantScore) : "text-slate-700"
                            }`} title={row.mutantFailed
                              ? "This compound failed to dock against the mutant receptor — no pose was produced."
                              : "Mutant score (kcal/mol)"}>
                              {row.mutantFailed ? "✗ failed"
                                : row.mutantScore != null ? fmtScore(row.mutantScore) : "—"}
                            </span>
                            {includeWt && (
                              <span className={`tabular-nums w-12 text-right ${
                                row.wtFailed ? "text-rose-400"
                                  : row.wtScore != null ? "text-slate-400" : "text-slate-700"
                              }`} title={row.wtFailed
                                ? "This compound failed to dock against the WT receptor — no pose was produced."
                                : "WT score (kcal/mol)"}>
                                {row.wtFailed ? "✗ failed"
                                  : row.wtScore != null ? fmtScore(row.wtScore) : "—"}
                              </span>
                            )}
                            {delta != null && (
                              <span className={`tabular-nums w-12 text-right ${
                                delta < -0.3 ? "text-emerald-300" : delta > 0.3 ? "text-rose-300" : "text-slate-500"
                              }`} title="Δ = mutant − WT · negative ⇒ tighter to mutant">
                                {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
                              </span>
                            )}
                          </button>
                          {/* (v1.22.1) Explicit "Full job →" mini-button.
                              The only thing in this row that navigates
                              away from Studio. Compact + clearly
                              labelled so users don't trigger it
                              accidentally while scanning the table. */}
                          <button
                            type="button"
                            onClick={() => {
                              if (!fullJobKey) return;
                              navigate(`/jobs/${fullJobKey}?from=studio`);
                            }}
                            disabled={!fullJobKey}
                            className="shrink-0 inline-flex items-center gap-1 rounded border border-violet-700/60 text-violet-300 hover:bg-violet-900/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title={`Open the full Job results page for "${row.name}" (pose viewer + ADMET + AI Variants).`}
                          >
                            Full job →
                          </button>
                          {/* (v1.01) ADMET button — promoted from a
                              tiny outline chip to a solid violet pill
                              with an inline risk-summary so users see
                              the safety profile at a glance without
                              expanding. Three colored dots represent
                              hERG / liver (DILI) / CYP risk; users
                              can scan a column of rows and see "this
                              compound is amber-amber-green" without
                              clicking anything. Click expands the full
                              chip card below for the descriptors +
                              evidence strings. */}
                          <button
                            type="button"
                            onClick={() => toggleAdmetExpanded(row.compoundId)}
                            disabled={!row.admet}
                            className={`shrink-0 px-2 py-1 mx-1 my-0.5 rounded font-semibold text-[10px] uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                              !row.admet
                                ? "bg-slate-900/30 text-slate-700 cursor-not-allowed border border-slate-800"
                                : admetExpanded
                                ? "bg-violet-600 text-white hover:bg-violet-500 shadow-sm shadow-violet-900/50"
                                : "bg-violet-900/40 text-violet-200 hover:bg-violet-800/60 border border-violet-700/50 hover:border-violet-500/70"
                            }`}
                            title={!row.admet
                              ? "ADMET descriptors unavailable for this SMILES"
                              : admetExpanded ? "Hide ADMET / drug-likeness panel" : "Show ADMET — drug-likeness, hERG, BBB, CYP, DILI risk"}
                          >
                            <span className="text-[11px]">⚕</span>
                            <span>ADMET</span>
                            {/* Risk-summary dots — only render when we
                                actually have extended predictions to
                                summarize. Three most actionable axes
                                in priority order. */}
                            {row.admet?.extended && (
                              <span className="flex items-center gap-0.5 ml-0.5">
                                <RiskDot tier={row.admet.extended.herg.label} title={`hERG: ${row.admet.extended.herg.label}`} />
                                <RiskDot tier={row.admet.extended.dili.label} title={`DILI: ${row.admet.extended.dili.label}`} />
                                <RiskDot tier={row.admet.extended.cyp3a4.label} title={`CYP3A4: ${row.admet.extended.cyp3a4.label}`} />
                              </span>
                            )}
                          </button>
                        </div>
                        {/* (v1.32) Inline failure note. Shown when the
                            user selects a fully-failed row (no pose for
                            either variant). Clicking such a row is
                            intentionally non-destructive — it doesn't
                            touch the 3D viewer or 2D editor — so this
                            note is the feedback that the click landed,
                            and it explains WHY there's nothing to show
                            instead of leaving the user staring at an
                            unchanged screen wondering if the click
                            registered. */}
                        {isSelected && rowHasNoPose && (
                          <div className="px-3 py-2 bg-rose-950/30 border-t border-rose-900/50 text-rose-200 text-[10px] leading-relaxed">
                            <span className="font-semibold">✗ {row.name} failed to dock.</span>{" "}
                            {row.failReason || "No pose was produced for either receptor variant."}{" "}
                            <span className="text-rose-300/70">
                              There's no 3D pose to display — the viewer above still shows the last compound you opened. Use “Full job →” for the full report, or edit/remove this compound and re-run.
                            </span>
                          </div>
                        )}
                        {admetExpanded && row.admet && (
                          <div className="px-3 py-2 bg-slate-950/40 border-t border-slate-800/60 text-slate-200">
                            <AdmetChips admet={row.admet} layout="card" />
                          </div>
                        )}
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
              {/* (v1.03) Selected-targets row with per-target X buttons,
                  matching the Mutation section's pattern. Always visible
                  when at least one target is selected so the user can
                  remove ANY selected target — including ad-hoc PDB IDs
                  reseeded from history that don't appear in the chip
                  list below (mergedCatalog only includes catalog +
                  adHocTargets, so a bare reseed pdb_id has no chip
                  to toggle). The X here drops the target from
                  selectedTargets directly, no dropdown roundtrip. */}
              {selectedTargets.length > 0 && (
                <div className="mb-2 flex items-center gap-1.5 flex-wrap text-[10px] font-mono">
                  <span className="text-slate-600">selected</span>
                  {selectedTargets.map((tid) => {
                    const meta = mergedCatalog.find((t: any) => t.id === tid);
                    const isAdHoc = !!(meta as any)?.isAdHoc || !meta;
                    return (
                      <span
                        key={tid}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                          isAdHoc
                            ? "border-violet-700/60 bg-violet-950/40 text-violet-200"
                            : "border-cyan-700/60 bg-cyan-950/40 text-cyan-200"
                        }`}
                        title={meta?.name || (isAdHoc ? `RCSB PDB ${tid.toUpperCase()}` : tid.toUpperCase())}
                      >
                        {isAdHoc && <span className="opacity-70">⌬</span>}
                        {tid.toUpperCase()}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTargets((prev) => prev.filter((x) => x !== tid));
                          }}
                          className={`leading-none ${isAdHoc ? "text-violet-400/60 hover:text-rose-300" : "text-cyan-400/60 hover:text-rose-300"}`}
                          title={`Remove ${tid.toUpperCase()} from the selection`}
                          aria-label={`Remove ${tid.toUpperCase()}`}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
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
                      return <span className="text-slate-500">no annotated variants · type a code</span>;
                    }
                    if (status === "non-human") {
                      return <span className="text-amber-400/70">non-human structure · human mutations may not apply · type a code</span>;
                    }
                    const srcLabel = status === "curated" ? "curated" : (isAdHoc ? "from UniProt" : "curated");
                    return all > 0 ? `${all} ${srcLabel}` : "0 — type a code below";
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
              {/* (v1.09/v1.10) Bulk-stage compounds — Paste + Upload
                  share the same parser. CSV/TSV/SMI/.txt: one SMILES
                  per line, optional name after comma/tab. SDF: rough
                  parser pulls SMILES from <SMILES> data tags between
                  $$$$ separators. Full RDKit.js MOL→SMILES conversion
                  is heavy (3 MB wasm) and deferred to a future v;
                  most lead-opt teams export SDFs WITH SMILES tags
                  embedded so the text-based path covers ~80% of real
                  uploads. */}
              <div className="mt-1.5 flex gap-1.5">
                {(() => {
                  /* Shared parser: text → up to N staged compounds.
                     Renders a toast summary so the user knows what
                     landed and what got dropped. */
                  const stageSmilesText = (text: string, source: "paste" | "csv" | "sdf") => {
                    const room = MAX_COMPOUNDS - compounds.length;
                    if (room <= 0) {
                      setPromoteToast(`⚠ Suite is full at ${MAX_COMPOUNDS} compounds.`);
                      window.setTimeout(() => setPromoteToast(null), 4000);
                      return;
                    }
                    const dups = new Set(compounds.map((c) => c.smiles));
                    const staged: { smiles: string; name?: string }[] = [];
                    let totalCandidates = 0;
                    let skippedDup = 0;
                    let skippedInvalid = 0;
                    if (source === "sdf") {
                      // Split SDF into records on $$$$ and pull out the
                      // <SMILES> data tag value. Falls back to looking
                      // for the title line (first non-blank line of a
                      // record) but that's almost always a name not a
                      // SMILES, so we skip when the tag is absent.
                      const records = text.split(/^\$\$\$\$\s*$/m);
                      for (const rec of records) {
                        if (!rec.trim()) continue;
                        totalCandidates++;
                        // Look for <SMILES> data tag (case-insensitive,
                        // standard SDF data block convention).
                        const smiMatch = rec.match(/>\s*<\s*(?:smiles|canonical_smiles)\s*>\s*[\r\n]+([^\r\n]+)/i);
                        if (!smiMatch) continue;
                        const smiles = smiMatch[1].trim();
                        if (!smiles) continue;
                        // Lightweight validity gate — reject obvious non-SMILES
                        // (unbalanced brackets, truncated rings, stray text) up
                        // front instead of failing at dock time.
                        if (!validateSmiles(smiles).ok) { skippedInvalid++; continue; }
                        // Optional name from <NAME> tag, or the first
                        // non-blank line of the record (the title line).
                        let name: string | undefined;
                        const nameMatch = rec.match(/>\s*<\s*(?:name|title|_name|chembl_id)\s*>\s*[\r\n]+([^\r\n]+)/i);
                        if (nameMatch) {
                          name = nameMatch[1].trim();
                        } else {
                          const firstLine = rec.split(/\r?\n/).map((l) => l.trim()).find((l) => l);
                          if (firstLine && firstLine.length < 60 && !/^[A-Z]\s/.test(firstLine)) {
                            name = firstLine;
                          }
                        }
                        if (dups.has(smiles)) { skippedDup++; continue; }
                        dups.add(smiles);
                        staged.push({ smiles, name });
                        if (staged.length >= room) break;
                      }
                    } else {
                      // paste / csv path — line-based parser with
                      // comma OR tab separator, optional # comment
                      // lines, and skip CSV header rows that look like
                      // "smiles,name" or similar (first row is text
                      // not chemistry).
                      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
                      for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        const parts = line.split(/[\t,]/).map((p) => p.trim());
                        const smiles = parts[0] || "";
                        if (!smiles) continue;
                        // Skip header row: a CSV header like
                        // "smiles,name" or "SMILES\tID" contains only
                        // letters/underscore/spaces in the first
                        // field. Real SMILES always have at least one
                        // non-letter char (digit, parens, =, # etc).
                        if (i === 0 && /^[A-Za-z_ ]+$/.test(smiles)) continue;
                        totalCandidates++;
                        // Lightweight validity gate (see lib/smilesValidate).
                        if (!validateSmiles(smiles).ok) { skippedInvalid++; continue; }
                        if (dups.has(smiles)) { skippedDup++; continue; }
                        dups.add(smiles);
                        staged.push({ smiles, name: parts[1] || undefined });
                        if (staged.length >= room) break;
                      }
                    }
                    if (staged.length === 0) {
                      const msg = skippedInvalid > 0 && source !== "sdf"
                        ? `⚠ ${skippedInvalid} line${skippedInvalid === 1 ? "" : "s"} weren't valid SMILES — check for typos, spaces, or unbalanced brackets.`
                        : source === "sdf"
                        ? "⚠ No usable SMILES in the SDF. Records need a <SMILES> data tag — export from RDKit/ChemDraw with that tag enabled."
                        : skippedDup > 0
                        ? `⚠ All ${skippedDup} pasted SMILES were already staged.`
                        : "⚠ No valid SMILES found.";
                      setPromoteToast(msg);
                      window.setTimeout(() => setPromoteToast(null), 5000);
                      return;
                    }
                    setCompounds((prev) => [
                      ...prev,
                      ...staged.map((s) => ({
                        id: `c_${source}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                        smiles: s.smiles,
                        name: s.name,
                      })),
                    ]);
                    const overflow = totalCandidates - staged.length - skippedDup;
                    let msg = `✓ Staged ${staged.length} compound${staged.length === 1 ? "" : "s"}`;
                    if (skippedDup > 0) msg += ` (skipped ${skippedDup} duplicate${skippedDup === 1 ? "" : "s"})`;
                    if (skippedInvalid > 0) msg += ` · ${skippedInvalid} invalid skipped`;
                    if (overflow > 0) msg += ` — ${overflow} dropped (suite cap ${MAX_COMPOUNDS})`;
                    setPromoteToast(msg);
                    window.setTimeout(() => setPromoteToast(null), 6000);
                  };
                  const disabled = compounds.length >= MAX_COMPOUNDS;
                  return <>
                    <button
                      type="button"
                      onClick={() => {
                        setPasteText("");
                        setPasteModalOpen(true);
                      }}
                      disabled={disabled}
                      className={`flex-1 px-3 py-1.5 rounded border font-mono text-[10px] flex items-center gap-2 transition-colors ${
                        disabled
                          ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                          : "border-violet-700/50 bg-violet-950/30 text-violet-200 hover:bg-violet-900/40"
                      }`}
                      title="Paste a multi-line SMILES list (one per line, optional name after comma). Great for screening 10-50 compounds at once."
                    >
                      <span className="text-[11px]">📋</span>
                      <span className="uppercase tracking-wider">Paste SMILES</span>
                    </button>
                    {/* (v1.10) Real file picker — CSV/TSV/SMI/TXT all
                        share the line parser; SDF uses the per-record
                        parser. The hidden <input> is triggered by the
                        button click; the .target.value=null reset lets
                        the user re-pick the SAME file (common when
                        they edit it externally and re-upload). */}
                    <button
                      type="button"
                      onClick={() => {
                        if (disabled) return;
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = ".csv,.tsv,.smi,.smiles,.txt,.sdf";
                        input.onchange = async () => {
                          const f = input.files?.[0];
                          if (!f) return;
                          const text = await f.text();
                          const isSdf = /\.sdf$/i.test(f.name) || text.includes("$$$$");
                          stageSmilesText(text, isSdf ? "sdf" : "csv");
                        };
                        input.click();
                      }}
                      disabled={disabled}
                      className={`flex-1 px-3 py-1.5 rounded border font-mono text-[10px] flex items-center gap-2 transition-colors ${
                        disabled
                          ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                          : "border-violet-700/50 bg-violet-950/30 text-violet-200 hover:bg-violet-900/40"
                      }`}
                      title="Upload a CSV/TSV/SMI/SDF file. CSV: one SMILES per row, optional name in column 2. SDF: needs a <SMILES> data tag per record."
                    >
                      <span className="text-[11px]">📂</span>
                      <span className="uppercase tracking-wider">Upload file</span>
                      <span className="ml-auto text-[9px] text-violet-400/70 normal-case">
                        csv · sdf · up to {MAX_COMPOUNDS}
                      </span>
                    </button>
                    {/* (v1.12) Paste-SMILES modal — in-app replacement for the
                        old window.prompt(). Rendered here so stageSmilesText /
                        compounds / MAX_COMPOUNDS are in closure scope. */}
                    {pasteModalOpen && (
                      <div
                        className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
                        onClick={() => setPasteModalOpen(false)}
                      >
                        <div
                          className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <header className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                            <h2 className="text-base font-semibold text-ink dark:text-white">Paste SMILES</h2>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                              One SMILES per line, with an optional name after a comma or tab.
                              Up to {Math.max(0, MAX_COMPOUNDS - compounds.length)} more compound
                              {MAX_COMPOUNDS - compounds.length === 1 ? "" : "s"}.
                            </p>
                          </header>
                          <div className="px-5 py-4 space-y-3">
                            <textarea
                              autoFocus
                              value={pasteText}
                              onChange={(e) => setPasteText(e.target.value)}
                              rows={8}
                              spellCheck={false}
                              placeholder={"CC(=O)Oc1ccccc1C(=O)O, aspirin\nCC(C)Cc1ccc(C(C)C(=O)O)cc1"}
                              className="input font-mono text-xs w-full resize-y"
                              onKeyDown={(e) => {
                                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && pasteText.trim()) {
                                  e.preventDefault();
                                  stageSmilesText(pasteText, "paste");
                                  setPasteText("");
                                  setPasteModalOpen(false);
                                }
                              }}
                            />
                            <div className="flex items-center justify-between gap-2 pt-1">
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                ⌘/Ctrl + Enter to add
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setPasteModalOpen(false)}
                                  className="btn-ghost btn-sm"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={!pasteText.trim()}
                                  onClick={() => {
                                    stageSmilesText(pasteText, "paste");
                                    setPasteText("");
                                    setPasteModalOpen(false);
                                  }}
                                  className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Add compounds
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>;
                })()}
              </div>
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
                    // Submit-validation failure for THIS compound — matched
                    // by SMILES against the backend's 422 invalid_compounds.
                    // Flags the exact row (rose ring) + shows the reason
                    // inline, so the user knows which compound and why, with
                    // the × remove button right there.
                    const invalidInfo = invalidCompounds.get((c.smiles || "").trim());
                    return (
                    <div key={c.id}>
                    <div className={`px-2 py-1.5 flex items-center gap-2 text-[10px] font-mono ${
                      invalidInfo ? "bg-rose-950/30 ring-1 ring-inset ring-rose-800/50"
                      : isEdited ? "bg-amber-950/20"
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
                        {/* (v0.97) Name no longer truncated — long
                            variant names like "Terolut · variant" got
                            chopped at 12ch. Now the name takes whatever
                            width it needs (with title= for the rare
                            case it overflows the container), and the
                            SMILES below it is the only thing that
                            truncates. */}
                        <span
                          className={`shrink-0 ${isEdited ? "text-amber-200" : isActive ? "text-cyan-200" : "text-slate-200"}`}
                          title={c.name || `untitled #${i + 1}`}
                        >
                          {c.name || `untitled #${i + 1}`}{isEdited && <span className="text-amber-400 ml-1">✎</span>}
                        </span>
                        <span className="text-[9px] text-slate-500 truncate min-w-0" title={isEdited ? currentSmiles : c.smiles}>
                          {isEdited ? currentSmiles : c.smiles}
                        </span>
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
                        onClick={async () => {
                          // 2026-05-12 bug fix: removing the LAST compound
                          // used to leave the Ketcher 2D canvas + 3D viewer
                          // + dock results showing the deleted compound's
                          // ghost. Now when the row count drops to zero we
                          // wipe the canvas, the loaded-compound banner,
                          // the dirty-edit pill, the active draft, and
                          // both dock-result slots so the panel returns
                          // to its empty pre-load state.
                          const willBeEmpty = compounds.length === 1; // removing the only one
                          setCompounds((prev) => prev.filter((_, j) => j !== i));
                          if (activeCompoundIdx >= compounds.length - 1) setActiveCompoundIdx(0);
                          if (willBeEmpty) {
                            setLoadedCompound(null);
                            setActiveDraft(null);
                            setCurrentSmiles("");
                            setDockResult(null);
                            setDockResultWt(null);
                            try {
                              const a = getKetcherApi(iframeRef.current);
                              if (a?.setMolecule) await a.setMolecule("");
                            } catch { /* canvas already gone or not ready */ }
                          }
                        }}
                        className="text-slate-600 hover:text-rose-400 px-1 shrink-0"
                        title="Remove this compound from the suite"
                      >×</button>
                    </div>
                    {invalidInfo && (
                      <div className="px-2 pb-1.5 text-[9px] leading-snug text-rose-300/90">
                        <span className="text-rose-400 font-semibold">✗ can&apos;t be docked.</span>{" "}
                        {invalidInfo.reason}
                        {invalidInfo.suggestion && (
                          <span className="text-rose-300/70"> {invalidInfo.suggestion}</span>
                        )}
                        <span className="text-slate-500">
                          {" "}— remove it with ✕ above, or click the row to edit the structure.
                        </span>
                      </div>
                    )}
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
                            // Re-seed Studio with the current target + mutation
                            // + SMILES so the user can fall back to a Full Job
                            // (CPU path) without losing their setup. Used to
                            // navigate to /new (legacy NewJobPage) — that
                            // page is gone since 2026-05-08, so we re-seed
                            // /studio in place. Studio's reseed handler
                            // picks up the same payload shape unchanged.
                            navigate("/studio", {
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
                          title="Re-seed Studio so you can submit this as a Full Job (CPU path, ~minutes vs ~30 s GPU, but no scaffold limits)."
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
              {/* Pod status — self-gates on healthOk. Renders nothing
                  on healthy pod; renders amber "warming up ~30s" banner
                  when /health is failing so the user understands the
                  upcoming wait instead of thinking the Run Dock click
                  did nothing. */}
              <PodStatusBanner />

              {/* (Ensemble docking) Opt-in toggle — Full Job only. Docking
                  against an MD-relaxed receptor conformer ensemble removes
                  the "single rigid crystal snapshot" blind spot at the cost
                  of ~30-60 s extra per variant. Sits directly above RUN DOCK
                  so it reads as a docking-setup knob, peer to the engine
                  choice. Sky-blue when on so it's distinct from the
                  emerald/violet RUN DOCK buttons below. Applies to the Vina
                  path; the GNINA half ignores it (ensemble v1 is
                  QuickVina-only — runFullJob sends ensemble=false for GNINA).
                  HIDDEN while the GPU dock pod is offline (ENSEMBLE_UI_ENABLED)
                  so users aren't offered a toggle the backend would ignore. */}
              {ENSEMBLE_UI_ENABLED && (
              <button
                type="button"
                disabled={!ensembleAllowed}
                onClick={() => { if (ensembleAllowed) setEnsemble((v) => !v); }}
                className={`mb-2 w-full flex items-center gap-2.5 px-3 py-2 rounded border text-left transition-all ${
                  !ensembleAllowed
                    ? "border-slate-800 bg-slate-900/20 cursor-not-allowed opacity-60"
                    : ensemble
                    ? "border-sky-600/60 bg-sky-950/30 hover:bg-sky-900/30"
                    : "border-slate-800 bg-slate-900/30 hover:bg-slate-800/40"
                }`}
                title={
                  !ensembleAllowed
                    ? "Ensemble docking has been disabled for your account by an administrator. Contact us at liganx.com/contact if you believe this is a mistake."
                    : "Ensemble docking: relax the receptor with a short GPU molecular-dynamics run, dock each ligand against several conformers, and keep the best score + pose. Removes the artefact of docking against one arbitrary rigid crystal snapshot. Adds roughly 30-60 s per variant. Full Job only — applies to the Vina engine."
                }
              >
                <span
                  className={`inline-flex shrink-0 items-center justify-center w-4 h-4 rounded-sm border text-[10px] leading-none ${
                    ensembleAllowed && ensemble
                      ? "border-sky-300 bg-sky-400 text-slate-900"
                      : "border-slate-600 text-transparent"
                  }`}
                >
                  {ensembleAllowed && ensemble ? "✓" : ""}
                </span>
                <span className="flex-1 min-w-0">
                  <span
                    className={`block font-mono text-[11px] uppercase tracking-wider ${
                      ensembleAllowed && ensemble ? "text-sky-200" : "text-slate-400"
                    }`}
                  >
                    {!ensembleAllowed ? "Ensemble docking 🔒" : "Ensemble docking"}
                  </span>
                  <span className="block text-[9px] text-slate-500 leading-tight mt-0.5">
                    {!ensembleAllowed
                      ? "Disabled for your account by an administrator — contact us to restore."
                      : "Dock against an MD-relaxed receptor ensemble, not one rigid snapshot. +~30-60 s/variant."}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    ensembleAllowed && ensemble ? "bg-sky-900/60 text-sky-300" : "bg-slate-800 text-slate-500"
                  }`}
                >
                  {!ensembleAllowed ? "n/a" : ensemble ? "on" : "off"}
                </span>
              </button>
              )}

              {(() => {
                const hasCompound = !!currentSmiles || compounds.length > 0;
                const isDisabled = docking || submittingFull
                  || (!!fullJobKey && fullJobStatus !== "completed" && fullJobStatus !== "failed" && fullJobStatus !== "cancelled")
                  || !ketcherReady || !hasCompound || !selectedTarget;
                const isCoolingOff = !!fullJobKey && fullJobStatus !== "completed" && fullJobStatus !== "failed" && fullJobStatus !== "cancelled";
                // (v1.04) Split RUN DOCK into Vina (left) and GNINA (right).
                // Same disabled/busy logic for both halves — engine choice
                // doesn't change ready-state. Two distinct colour systems
                // so users can tell at a glance which engine they're
                // committing to: emerald for Vina (the steady default,
                // fast and well-understood), violet for GNINA (the
                // research-grade rerank option). The GNINA half carries
                // an honest tooltip about CNN status — on the current
                // Blackwell pod cnn_mode=none means the rerank itself
                // is offline; the planned 4090 swap unlocks the CNN.
                const sharedBusyClasses = submittingFull
                  ? "cursor-wait animate-pulse"
                  : isCoolingOff
                  ? "cursor-wait"
                  : !ketcherReady || !hasCompound || !selectedTarget
                  ? "cursor-not-allowed"
                  : "";
                const baseLabel = submittingFull ? "▶ submitting…"
                  : isCoolingOff ? "▶ docking…"
                  : "⇢ Run Dock";
                return (
                  <div className="flex w-full gap-2">
                    {/* Vina half — primary, ~65% width, emerald.
                        Wider because it's the default and most clicks
                        land here. */}
                    <button
                      onClick={() => runFullJob("quickvina2_gpu")}
                      disabled={isDisabled}
                      className={`w-full px-4 py-2.5 rounded border font-mono text-xs uppercase tracking-[0.18em] transition-all ${sharedBusyClasses} ${
                        submittingFull
                          ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300"
                          : isCoolingOff
                          ? "border-emerald-700/40 bg-emerald-950/20 text-emerald-300/60"
                          : !ketcherReady || !hasCompound || !selectedTarget
                          ? "border-slate-800 bg-slate-900/30 text-slate-600"
                          : "border-emerald-600/60 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 hover:border-emerald-500"
                      }`}
                      title={
                        !selectedTarget ? "Pick a target first."
                        : !hasCompound ? "Stage at least one compound first."
                        : "Dock with QuickVina2-GPU (default). Fast, well-benchmarked, Vina-family physics scoring."
                      }
                    >
                      <span>{baseLabel}</span>
                      <span className="opacity-60 ml-1.5">· Vina</span>
                    </button>
                  </div>
                );
              })()}

              {/* (v1.18, #209) Virtual screening button — peer to RUN DOCK.
                  Sits below the Vina/GNINA split so the visual hierarchy
                  is: docks side-by-side first (the common path), then VS
                  as the secondary high-throughput option. Distinct cyan
                  color so it doesn't get confused with the dock buttons
                  on the green/violet scale. Lands the user on
                  /screening/:shareId for the ranked-hit results page. */}
              {(() => {
                const hasCompound = !!currentSmiles || compounds.length > 0;
                const compoundCount = compounds.length > 0
                  ? compounds.filter((c) => c.smiles).length
                  : currentSmiles ? 1 : 0;
                const isDisabled = docking || submittingFull
                  || !ketcherReady || !hasCompound || !selectedTarget;
                const variantCount = (includeWt ? 1 : 0) + Math.min(2, selectedMutations.length);
                const cellCount = compoundCount * Math.max(1, variantCount);
                return (
                  <button
                    onClick={() => {
                      if (!isPro) {
                        setProGateFeature("screening");
                        return;
                      }
                      runScreening();
                    }}
                    disabled={isPro && isDisabled}
                    className={`mt-2 w-full px-4 py-2.5 rounded border font-mono text-xs uppercase tracking-[0.18em] transition-all ${
                      !isPro
                        ? "border-cyan-700/40 bg-cyan-950/15 text-cyan-300/60 hover:bg-cyan-950/30 hover:border-cyan-600/60 cursor-pointer"
                        : submittingFull
                        ? "border-cyan-500/40 bg-cyan-950/30 text-cyan-300/70 cursor-wait animate-pulse"
                        : !ketcherReady || !hasCompound || !selectedTarget
                        ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                        : "border-cyan-600/60 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 hover:border-cyan-500"
                    }`}
                    title={
                      !isPro ? "Virtual Screening is a Pro feature — click for details."
                      : !selectedTarget ? "Pick a target first."
                      : !hasCompound ? "Stage at least one compound first."
                      : "Submit as a virtual screening run — pre-stages every (compound × variant) row, lower exhaustiveness (4), and lands you on the ranked-hit results page sorted by selectivity index (mutant tighter than WT)."
                    }
                  >
                    <span>{!isPro && <span className="mr-1">🔒</span>}⇢ Run Virtual Screening</span>
                    {isPro && cellCount > 0 && (
                      <span className="opacity-60 ml-1.5">
                        · {compoundCount} cmpd × {variantCount} variant{variantCount === 1 ? "" : "s"} ({cellCount} cells)
                      </span>
                    )}
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
            // (bugfix 2026-05-22) Whichever save path fired, the user named
            // the current structure (e.g. Sotorasib → "Testi"). The top
            // "Save compound" button routes through PROMOTE *or* FORK mode
            // depending on whether a loadedCompound lock exists (e.g. after a
            // session resume it's promote), so the rename has to be handled
            // independent of mode — previously only the fork path updated the
            // staged row, so a promote-mode save left the suite reading the
            // original name. The ONLY case that must NOT rename in place is an
            // explicit "Save as new" from a staged row (stageAfterIdx set),
            // which deliberately preserves the original and inserts a new row.
            const isExplicitInsert =
              promoteDialog.mode === "fork" && promoteDialog.stageAfterIdx !== undefined;

            // Mode-specific side effects.
            if (promoteDialog.mode === "promote" && activeDraft) {
              deleteDraft(activeDraft.id);
              setActiveDraft(null);
            } else if (promoteDialog.mode === "fork" && promoteDialog.stageAfterIdx !== undefined) {
              // SAVE AS NEW from a staged row → insert a brand-new staged
              // entry right after the parent, leaving the parent intact.
              const insertAt = promoteDialog.stageAfterIdx + 1;
              const newId = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
              const newC: CompoundEntry = { id: newId, smiles: currentSmiles, name: savedName };
              setCompounds((prev) => {
                // Cap-aware insert — refuse gracefully if the suite filled
                // up between opening the dialog and submitting.
                if (prev.length >= MAX_COMPOUNDS) return prev;
                const next = [...prev];
                next.splice(insertAt, 0, newC);
                return next;
              });
              setActiveCompoundIdx(insertAt);
            }

            // The editor's loaded reference now is the saved compound.
            setLoadedCompound({ name: savedName, smiles: currentSmiles });

            // Rename + re-SMILES the ACTIVE staged row so the suite label and
            // the docked structure both match the save. Skipped for the
            // explicit "save as new" insert (which keeps the original row).
            const renamesStaged =
              !isExplicitInsert &&
              activeCompoundIdx >= 0 &&
              activeCompoundIdx < compounds.length;
            if (renamesStaged) {
              setCompounds((prev) =>
                prev.map((entry, j) =>
                  j === activeCompoundIdx
                    ? { ...entry, name: savedName, smiles: currentSmiles }
                    : entry,
                ),
              );
            }

            setPromoteToast(
              isExplicitInsert
                ? `✓ "${savedName}" saved to library + staged for this run`
                : renamesStaged
                ? `✓ "${savedName}" saved`
                : `✓ "${savedName}" saved to your library`,
            );
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
      {/* Liganx AI Beta — only mounts after a Full Job has produced a
          share key. Pre-dock there's nothing on the page to ask about,
          so we hide the FAB to avoid a confusing empty-context chat. */}
      {fullJobKey && <LiganxAIPanel jobKey={fullJobKey} />}

      {/* v1.24 — Pro gate modal. Opens when a free-tier user clicks
          the locked GNINA or VS button. Stateless / parent-owned. */}
      <ProGateModal
        feature={proGateFeature}
        onClose={() => setProGateFeature(null)}
      />
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
  availableMutations: { code: string; label: string; significance: string; targetId?: string }[];
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
              {(m.targetId || targetId) && (
                <span className="text-[9px] uppercase tracking-[0.18em] text-slate-500 shrink-0">
                  {m.targetId || targetId}
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
  // (v0.89) Stamp each applied variant with the (target_pdb, mutation)
  // it was generated against, so the panel can scope the displayed
  // history to the current dock context. Old entries that pre-date
  // this stamping default to ad-hoc context strings — they keep
  // showing up under "all" but won't pollute a fresh KRAS Q61H run
  // when their context was EGFR T790M.
  type AppliedVariant = AiVariant & { appliedAt: string; targetPdb?: string; mutation?: string };
  const [appliedVariants, setAppliedVariants] = useState<AppliedVariant[]>(() => {
    if (typeof localStorage === "undefined") return [];
    try {
      const raw = localStorage.getItem(APPLIED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  // (v0.89) Filter the displayed applied list to entries matching
  // the current (target, mutation). Falls through to the unfiltered
  // list when there's no current target (so you don't lose visibility
  // entirely on a fresh Studio mount). Toggle via the "show all"
  // button in the header.
  const [showAllApplied, setShowAllApplied] = useState(false);
  const ctxKey = (a: { targetPdb?: string; mutation?: string }) =>
    `${(a.targetPdb || "").toUpperCase()}|${(a.mutation || "WT").toUpperCase()}`;
  const currentCtxKey = ctxKey({ targetPdb, mutation });
  const visibleApplied = showAllApplied || !targetPdb
    ? appliedVariants
    : appliedVariants.filter((a) => ctxKey(a) === currentCtxKey);
  const hiddenAppliedCount = appliedVariants.length - visibleApplied.length;
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
        // (v0.89) Prominent in-panel generation banner — replaces the
        // tiny pulsing line that the user said wasn't visible enough.
        // Cyan gradient + pulsing orb + shimmer stripe + a "this may
        // take 20-40 s" copy line so the user has no doubt the system
        // is working on their request.
        <div className="relative px-4 py-3 bg-gradient-to-r from-cyan-950/80 via-cyan-900/60 to-cyan-950/80 border-b-2 border-cyan-500/60 shadow-lg shadow-cyan-900/30 overflow-hidden">
          <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
            <div
              className="h-full w-1/3 bg-gradient-to-r from-transparent via-cyan-300 to-transparent"
              style={{ animation: "studio-aivar-shimmer 1.8s linear infinite" }}
            />
          </div>
          <style>{`
            @keyframes studio-aivar-shimmer {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(400%); }
            }
            @keyframes studio-aivar-pulse-ring {
              0%, 100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.7); }
              50% { box-shadow: 0 0 0 6px rgba(34, 211, 238, 0); }
            }
          `}</style>
          <div className="flex items-center gap-3 font-mono">
            <div className="relative shrink-0">
              <span className="block w-3 h-3 rounded-full bg-cyan-400 animate-pulse" />
              <span
                className="absolute inset-0 rounded-full"
                style={{ animation: "studio-aivar-pulse-ring 1.6s ease-out infinite" }}
              />
            </div>
            <div className="flex flex-col">
              <span className="text-cyan-100 font-bold uppercase tracking-[0.18em] text-[12px]">
                ✨ AI generating 3 variants
              </span>
              <span className="text-cyan-300/80 text-[10px]">
                generate → score → filter → dock · ~20-40 s typical
              </span>
            </div>
          </div>
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
                    // Persist this as an applied variant with timestamp
                    // AND the (target, mutation) context it ran in so
                    // the panel can scope the history correctly later.
                    const stamped: AppliedVariant = {
                      ...v,
                      appliedAt: new Date().toISOString(),
                      targetPdb: targetPdb || "",
                      mutation: mutation || "WT",
                    };
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
      {visibleApplied.length > 0 && (
        <div className="border-t border-slate-800/70">
          <div className="px-3 py-1.5 flex items-center justify-between gap-2 text-[10px] font-mono">
            <span className="text-slate-500 uppercase tracking-[0.18em]">
              ✓ applied ({visibleApplied.length}{showAllApplied || !targetPdb ? "" : ` · ${targetPdb}${mutation && mutation !== "WT" ? `·${mutation}` : ""}`})
            </span>
            <div className="flex items-center gap-2">
              {/* (v0.89) Toggle when there are entries from other
                  (target, mutation) contexts — by default we hide
                  them so the user only sees variants relevant to the
                  current dock setup. */}
              {hiddenAppliedCount > 0 && !showAllApplied && (
                <button
                  type="button"
                  onClick={() => setShowAllApplied(true)}
                  className="text-cyan-400/80 hover:text-cyan-300 text-[10px]"
                  title="Show variants applied against other targets/mutations too"
                >
                  show all (+{hiddenAppliedCount} other)
                </button>
              )}
              {showAllApplied && (
                <button
                  type="button"
                  onClick={() => setShowAllApplied(false)}
                  className="text-slate-500 hover:text-slate-300 text-[10px]"
                  title="Show only variants applied against the current target/mutation"
                >
                  current run only
                </button>
              )}
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
          </div>
          <div className="divide-y divide-slate-800/60">
            {visibleApplied.map((a) => {
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
                    {/* (v0.89) Show the (target, mutation) context for
                        each row when we're displaying entries from
                        multiple runs — gives the user an at-a-glance
                        reason why this entry is in the list. */}
                    {showAllApplied && (a.targetPdb || a.mutation) && (
                      <span
                        className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border ${
                          ctxKey(a) === currentCtxKey
                            ? "border-cyan-700/50 bg-cyan-950/30 text-cyan-300"
                            : "border-slate-700/60 bg-slate-900/30 text-slate-500"
                        }`}
                        title={`Applied against ${a.targetPdb || "?"}${a.mutation && a.mutation !== "WT" ? ` · ${a.mutation}` : ""}`}
                      >
                        {(a.targetPdb || "?").toUpperCase()}{a.mutation && a.mutation !== "WT" ? `·${a.mutation}` : ""}
                      </span>
                    )}
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
