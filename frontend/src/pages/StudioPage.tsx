// Build verification tag — surfaces the deploy tag in the bundled JS so a
// `curl liganx.com/assets/index-*.js | grep LIGANX_BUILD_TAG` confirms which
// version is live. Cheap, ~50 bytes; replace each release.
const LIGANX_BUILD_TAG = "v0.51-2026-05-07-variant-camera-stable";
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
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
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

export default function StudioPage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const navigate = useNavigate();
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
    | { mode: "fork"; initialName: string; originalName: string }
    | null
  >(null);
  // (v0.33) Loaded named compound — set when the user picks something
  // from the library / reference / PubChem (anything that has a name).
  // While set, edits are treated as forks: the user is asked to choose
  // between "Save changes to <name>" (overwrite) and "Save as new"
  // (keep the original). Cleared when the user explicitly forks or
  // sketches from scratch.
  const [loadedCompound, setLoadedCompound] = useState<{ name: string; smiles: string } | null>(null);

  // No default target — user must explicitly pick. The earlier
  // "egfr" default was presumptuous.
  const [selectedTarget, setSelectedTarget] = useState<string>("");
  // Selection model: WT can be ON or OFF, and at most ONE mutation
  // tag at a time. Default is WT-only (the conservative starting
  // point — without a mutation, dock against wild-type). Adding a
  // mutation chip alongside keeps WT selected, so the dropdown shows
  // e.g. "WT + Q61H" and Run Dock fires both in parallel.
  const [includeWt, setIncludeWt] = useState<boolean>(true);
  const [selectedMutation, setSelectedMutation] = useState<string>("");
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
  const [dockResult, setDockResult] = useState<QuickDockResult | null>(null); // primary (mutant if selected, else WT)
  const [dockResultWt, setDockResultWt] = useState<QuickDockResult | null>(null); // WT comparison slot
  // Mutation-residue-to-pocket-center distance. Same semantic as
  // JobPage's outsidePocketA: when a mutation sits far from the
  // docking box, Vina can't capture geometric effects of that
  // mutation, so the WT-vs-mutant Δ is unreliable. Computed
  // client-side from the WT receptor PDB after dock completes.
  const [mutationOutsidePocketA, setMutationOutsidePocketA] = useState<number | null>(null);

  const [now, setNow] = useState(new Date());
  const [healthOk, setHealthOk] = useState<boolean | null>(null);

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
   *  to start from a known structure (drug or saved library entry). */
  async function loadIntoCanvas(smiles: string) {
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
          const s = await a.getSmiles();
          setCurrentSmiles((s || "").trim());
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
  useEffect(() => {
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

  const targetMeta = useMemo(
    () => catalog?.find((t: any) => t.id === selectedTarget),
    [catalog, selectedTarget]
  );
  const availableMutations = (targetMeta?.mutations ?? []) as { code: string; label: string; significance: string }[];

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

  async function runQuickDock() {
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
  const [fullJobKey, setFullJobKey] = useState<string | null>(null);
  const [fullJobStatus, setFullJobStatus] = useState<"pending" | "running" | "completed" | "failed" | "cancelled" | null>(null);
  const [fullJobStage, setFullJobStage] = useState<string | null>(null);
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
  async function runFullJob() {
    if (!currentSmiles) { setDockError("Canvas is empty — sketch a structure first."); return; }
    if (!selectedTarget) { setDockError("Pick a target."); return; }
    // (v0.46.1) Backend /jobs expects the REAL PDB id (e.g. "4OBE"),
    // not the catalog target id (e.g. "kras"). Earlier path passed the
    // catalog id and got a 'fetch_pdb pdb=KRAS' 404 from RCSB. Use
    // targetMeta.pdb_id, the same field NewJobPage sends.
    const realPdbId = (targetMeta?.pdb_id || "").trim();
    if (!realPdbId) {
      setDockError(`Couldn't resolve a PDB id for target "${selectedTarget}". Pick a different target or use NewJobPage.`);
      return;
    }
    setDockError(null);
    setSubmittingFull(true);
    try {
      const job = await api.createJob({
        pdb_id: realPdbId,
        chain: targetMeta?.chain || "A",
        uniprot_id: targetMeta?.uniprot,
        mutations: selectedMutation ? [selectedMutation] : [],
        compounds: [{
          name: loadedCompound?.name || activeDraft?.name || "Studio compound",
          smiles: currentSmiles,
        }],
        include_wt: includeWt,
        title: `Studio · ${selectedTarget?.toUpperCase() || "?"}${selectedMutation ? ` · ${selectedMutation}` : ""}`,
      });
      // (v0.47) Stay in Studio. Use share_id (URL-safe), fall back to
      // numeric id for legacy. Set status to pending and let the
      // polling effect take over.
      const jobKey = (job as any).share_id ?? String((job as any).id ?? "");
      if (!jobKey) {
        setDockError("Job created but no id returned — refresh /history to find it.");
        return;
      }
      // Clear previous Quick Dock results so the score panel reflects
      // the new in-flight Full Job, not stale GPU numbers.
      setDockResult(null);
      setDockResultWt(null);
      setFullJobKey(jobKey);
      setFullJobStatus(job.status || "pending");
      setFullJobStage(job.stage || null);
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
        setFullJobStatus(job.status);
        setFullJobStage(job.stage || null);
        if (job.status === "completed") {
          // Map DockingResult rows back into Studio's dockResult shape.
          // We only sent ONE compound, so each result corresponds to a
          // (compound, variant) pair — typically one mutant + one WT.
          for (const r of (job.results || [])) {
            const isWt = (r.variant || "").toUpperCase() === "WT";
            // Try to fetch the pose so the 3D viewer can render it.
            // Best-effort: if the fetch fails, the score still shows
            // (without the 3D pose) — user can click the link to
            // /jobs/{key} for full machinery.
            let posePdbqtB64: string | undefined;
            try {
              const text = await api.pose(fullJobKey, r.compound_id, r.variant);
              posePdbqtB64 = btoa(unescape(encodeURIComponent(text)));
            } catch { /* ignore — pose fetch is non-critical */ }
            const synth: QuickDockResult = {
              ok: true,
              score: r.best_score,
              hits: [],
              misses: [],
              pose_pdbqt_b64: posePdbqtB64,
              pdb_id: job.pdb_id,
              chain: job.chain,
              receptor_variant: isWt ? "wt" : "mutant",
            };
            if (isWt) setDockResultWt(synth);
            else setDockResult(synth);
          }
        } else if (job.status === "failed") {
          setDockError(job.error_message || "Full Job failed (no message).");
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

      {/* ═══ MAIN GRID ═══ */}
      <main className="grid grid-cols-12 gap-3 p-3" style={{ height: "calc(100vh - 88px)" }}>
        {/* LEFT — 2D Canvas */}
        <section className="col-span-7 bg-[#0d1422] border border-slate-800/70 rounded flex flex-col overflow-hidden relative">
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
              <span className={TOK.label}>Telemetry</span>
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
            {/* Score + Pose row — biggest type on the page */}
            <div className="px-4 pt-3 pb-2 grid grid-cols-2 gap-2 border-b border-slate-800/70">
              <div>
                <div className={TOK.label}>Score</div>
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
                    <div className="grid grid-cols-3 gap-3 mt-1">
                      {/* MUTANT column */}
                      <div className="flex flex-col">
                        <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-amber-300 mb-0.5">
                          ▸ Mutant · {selectedMutation}
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
                      <div className="flex flex-col border-l border-slate-800 pl-3">
                        <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-slate-400 mb-0.5">
                          ▸ Wild-type
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
                      <div className="flex flex-col border-l border-slate-800 pl-3">
                        <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-cyan-300 mb-0.5">
                          ▸ Δ Selectivity
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
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      kcal/mol · exh=8
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

            {/* Hits / Misses */}
            <div className="px-4 py-3 border-b border-slate-800/70">
              <div className="flex gap-6 text-[11px] font-mono">
                <div className="flex-1 min-w-0">
                  <div className={`${TOK.label} mb-1`}>Hits</div>
                  <div className="text-emerald-300 truncate" title={(dockResult?.hits || []).join(" · ")}>
                    {dockResult?.hits?.length
                      ? dockResult.hits.slice(0, 5).join(" · ") + (dockResult.hits.length > 5 ? ` +${dockResult.hits.length - 5}` : "")
                      : <span className="text-slate-600">—</span>}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`${TOK.label} mb-1`}>Misses</div>
                  <div className="text-rose-300 truncate" title={(dockResult?.misses || []).join(" · ")}>
                    {dockResult?.misses?.length
                      ? dockResult.misses.slice(0, 5).join(" · ") + (dockResult.misses.length > 5 ? ` +${dockResult.misses.length - 5}` : "")
                      : <span className="text-slate-600">—</span>}
                  </div>
                </div>
              </div>
            </div>
            </>}
            {/* /v0.48 conditional close */}

            {/* ─── TARGET (dropdown + search on right) ─── */}
            <div className="px-4 py-3 border-b border-slate-800/70">
              <div className="flex items-center justify-between mb-2">
                <span className={TOK.label}>Target</span>
                <span className="font-mono text-[9px] text-slate-600">
                  {(() => {
                    const all = catalog?.length || 0;
                    const filt = catalog?.filter((t: any) =>
                      !targetQuery || t.id.toLowerCase().includes(targetQuery.toLowerCase()) ||
                      (t.name || "").toLowerCase().includes(targetQuery.toLowerCase())
                    ).length || 0;
                    return targetQuery ? `${filt}/${all}` : `${all} available`;
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
                  <span>{targetMeta?.id?.toUpperCase() || "—"}</span>
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
                <div className="flex flex-wrap items-center gap-1.5 max-h-32 overflow-auto pt-1 border-t border-slate-800/70">
                  {catalog
                    ?.filter((t: any) =>
                      !targetQuery ||
                      t.id.toLowerCase().includes(targetQuery.toLowerCase()) ||
                      (t.name || "").toLowerCase().includes(targetQuery.toLowerCase())
                    )
                    .map((t: any) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setSelectedTarget(t.id);
                          setSelectedMutation("");
                          setTargetQuery("");
                          setTargetDropdownOpen(false);
                        }}
                        className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded border transition-colors ${
                          selectedTarget === t.id
                            ? "border-cyan-500/60 bg-cyan-900/30 text-cyan-200"
                            : "border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600"
                        }`}
                        title={t.name}
                      >
                        {t.id}
                      </button>
                    ))}
                  {targetQuery && !catalog?.some((t: any) =>
                    t.id.toLowerCase().includes(targetQuery.toLowerCase()) ||
                    (t.name || "").toLowerCase().includes(targetQuery.toLowerCase())
                  ) && (
                    <span className="text-[10px] font-mono text-amber-400/80 italic">no match</span>
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
                    return mutationQuery ? `${filt}/${all}` : `${all} curated`;
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
                  selectedMutation={selectedMutation}
                  includeWt={includeWt}
                  setIncludeWt={setIncludeWt}
                  setSelectedMutation={setSelectedMutation}
                  setMutationQuery={setMutationQuery}
                  setOpen={setMutationDropdownOpen}
                  targetId={targetMeta?.id}
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
                    {includeWt && selectedMutation ? `WT + ${selectedMutation}`
                      : selectedMutation ? selectedMutation
                      : includeWt ? "WT"
                      : "—"}
                  </span>
                </button>
                <input
                  type="text"
                  value={mutationQuery}
                  onChange={(e) => { setMutationQuery(e.target.value.toUpperCase()); if (e.target.value) setMutationDropdownOpen(true); }}
                  onFocus={() => setMutationDropdownOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && mutationQuery.trim()) {
                      setSelectedMutation(mutationQuery.trim());
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
                  selectedMutation={selectedMutation}
                  includeWt={includeWt}
                  setIncludeWt={setIncludeWt}
                  setSelectedMutation={setSelectedMutation}
                  setMutationQuery={setMutationQuery}
                  setOpen={setMutationDropdownOpen}
                  targetId={targetMeta?.id}
                />
              )}
              </div>
              {/* /v0.39 wrapper — closes mutationWrapRef */}
            </div>

            {/* ─── COMPOUND (trigger-chip + search row, mirrors Target/Mutation) ─── */}
            <div className="px-4 py-3 border-b border-slate-800/70">
              <div className="flex items-center justify-between mb-2">
                <span className={TOK.label}>Compound</span>
                <div className="flex items-center gap-2">
                  {/* (v0.32) Promote-to-library button. Only meaningful
                      when there's a draft to promote. Click → name
                      prompt → POST /me/compounds → delete the local
                      draft. The user's first explicit "I want to keep
                      this" moment in the whole flow. */}
                  {!!currentSmiles && !!activeDraft && (
                    <button
                      type="button"
                      onClick={() => {
                        const suggested = activeDraft.name?.startsWith("untitled")
                          ? ""
                          : (activeDraft.name || "");
                        setPromoteDialog({ mode: "promote", initialName: suggested });
                      }}
                      className="px-2 py-0.5 rounded border border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 hover:border-emerald-500/60 font-mono text-[10px] uppercase tracking-wider transition-colors"
                      title="Save this compound permanently to your library — picks a name now, available across sessions."
                    >
                      ⇡ promote
                    </button>
                  )}
                  <span className="font-mono text-[9px] text-slate-600">
                    {currentSmiles ? `${currentSmiles.length} chars` : "empty"}
                  </span>
                </div>
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
                  (keep original safe; default by visual emphasis). */}
              {loadedCompound && currentSmiles && currentSmiles !== loadedCompound.smiles && (
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
              {/* Trigger row: chip on the left shows current SMILES preview
                  (or "—" when empty); input on the right opens the loader
                  popover on focus, identical to Target's "search" affordance.
                  Both controls toggle the same loader so the section behaves
                  uniformly with Target/Mutation. */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowLoader(!showLoader)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-cyan-500/60 bg-cyan-900/30 text-cyan-200 font-mono text-[11px] uppercase tracking-wider hover:bg-cyan-900/50 min-w-[80px]"
                  title={currentSmiles ? `Current SMILES: ${currentSmiles}` : "Load reference, library, or paste SMILES"}
                >
                  <span className={`text-[8px] transition-transform ${showLoader ? "rotate-90" : ""}`}>▸</span>
                  <span className="truncate max-w-[80px]">
                    {currentSmiles
                      ? (currentSmiles.length > 10 ? currentSmiles.slice(0, 10) + "…" : currentSmiles)
                      : "—"}
                  </span>
                </button>
                <input
                  type="text"
                  readOnly
                  onFocus={() => setShowLoader(true)}
                  onClick={() => setShowLoader(true)}
                  placeholder="search · paste SMILES · pubchem"
                  className="flex-1 px-2 py-1 text-[10px] font-mono rounded border border-slate-700/60 text-slate-200 placeholder:text-slate-600 bg-[#070b15] focus:outline-none focus:border-cyan-500/60 cursor-pointer"
                />
              </div>
            </div>

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
              {/* (v0.46) Quick Dock + Full Job rendered as equal-weight
                  peers in a 2-column grid. Same height, same type
                  scale; the only difference is the accent color (cyan
                  for the fast GPU path, emerald for the persistent
                  CPU job path). User picks per run without one
                  feeling primary or secondary. */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={runQuickDock}
                  disabled={docking || submittingFull || (!!fullJobKey && fullJobStatus !== "completed" && fullJobStatus !== "failed" && fullJobStatus !== "cancelled") || !ketcherReady || !currentSmiles || !selectedTarget}
                  className={`px-3 py-2.5 rounded border font-mono text-[11px] uppercase tracking-[0.15em] transition-all ${
                    docking
                      ? "border-cyan-500/50 bg-cyan-950/40 text-cyan-300 cursor-wait animate-pulse"
                      : !ketcherReady || !currentSmiles || !selectedTarget
                      ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                      : "border-cyan-600/60 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 hover:border-cyan-500"
                  }`}
                  title="Quick Dock — GPU pipeline. ~30 s, results inline in the score panel. Flexibility/MW cap; large scaffolds may be rejected."
                >
                  {docking ? (
                    <span>▶ docking…</span>
                  ) : (
                    <>
                      <div>⏵ Quick Dock</div>
                      <div className="text-[8px] tracking-[0.2em] text-cyan-400/70 normal-case mt-0.5">gpu · ~30s · inline</div>
                    </>
                  )}
                </button>
                <button
                  onClick={runFullJob}
                  disabled={docking || submittingFull || (!!fullJobKey && fullJobStatus !== "completed" && fullJobStatus !== "failed" && fullJobStatus !== "cancelled") || !ketcherReady || !currentSmiles || !selectedTarget}
                  className={`px-3 py-2.5 rounded border font-mono text-[11px] uppercase tracking-[0.15em] transition-all ${
                    submittingFull
                      ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300 cursor-wait animate-pulse"
                      : !ketcherReady || !currentSmiles || !selectedTarget
                      ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                      : "border-emerald-600/60 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 hover:border-emerald-500"
                  }`}
                  title="Full Job — submits to /jobs queue and opens the persistent results page. ~3 min, no scaffold cap, full exhaustiveness, GNINA & Boltz-2 available."
                >
                  {submittingFull ? (
                    <span>▶ submitting…</span>
                  ) : (
                    <>
                      <div>⇢ Full Job</div>
                      <div className="text-[8px] tracking-[0.2em] text-emerald-400/70 normal-case mt-0.5">cpu · ~3 min · no caps</div>
                    </>
                  )}
                </button>
              </div>
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
              onPick={(smiles, name) => {
                // (v0.33) When a NAMED compound is loaded (library /
                // reference / PubChem), record the identity so the
                // first edit triggers fork-on-edit instead of silently
                // overwriting via autosave. Paste-SMILES picks pass
                // undefined → no fork lock, plain new draft.
                if (name) {
                  setLoadedCompound({ name, smiles });
                  // Start a fresh autosave id; otherwise the autosave
                  // would update whatever draft was active before.
                  setActiveDraft(null);
                } else {
                  setLoadedCompound(null);
                }
                loadIntoCanvas(smiles);
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
              setPromoteToast(`✓ "${savedName}" saved · "${promoteDialog.originalName}" preserved`);
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
            onUseVariant={(variant) => {
              // (v0.41) Treat AI variants as a deliberate fork of
              // whatever's currently loaded. If the parent had a
              // name (loadedCompound), we KEEP it set so the
              // "Modified from <name>" pill appears the moment the
              // new SMILES lands — user gets the explicit Save
              // changes / Save as new prompt for the variant.
              // If the parent was unnamed, mark loadedCompound from
              // the active draft so the user still gets the pill
              // and the autosave creates a new fork-draft instead
              // of mutating the parent draft.
              const parentName = loadedCompound?.name || activeDraft?.name;
              const parentSmiles = loadedCompound?.smiles || activeDraft?.smiles || currentSmiles;
              if (parentName && parentSmiles) {
                setLoadedCompound({ name: parentName, smiles: parentSmiles });
              }
              setActiveDraft(null);  // start a fresh autosave id for the variant
              loadIntoCanvas(variant.new_smiles);
              setShowAi(false);
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
  availableMutations, mutationQuery, selectedMutation, includeWt,
  setIncludeWt, setSelectedMutation, setMutationQuery, setOpen, targetId,
}: {
  availableMutations: { code: string; label: string; significance: string }[];
  mutationQuery: string;
  selectedMutation: string;
  includeWt: boolean;
  setIncludeWt: (v: boolean) => void;
  setSelectedMutation: (v: string) => void;
  setMutationQuery: (v: string) => void;
  setOpen: (v: boolean) => void;
  targetId?: string;
}) {
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
          const active = selectedMutation === m.code;
          return (
            <button
              key={m.code}
              onClick={() => {
                // Single-select; click again to deselect. (v0.40)
                // Does NOT auto-close — user can pick / change /
                // toggle WT freely until they hit Done or click out.
                if (selectedMutation === m.code) setSelectedMutation("");
                else { setSelectedMutation(m.code); setMutationQuery(""); }
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
          their pick before closing. Click-outside also still works. */}
      <div className="px-3 py-1.5 border-t border-slate-800/70 flex items-center justify-between text-[10px] font-mono shrink-0">
        <span className="text-slate-600">
          {selectedMutation
            ? <>selected <span className="text-amber-300">{selectedMutation}</span>{includeWt && <span className="text-slate-500"> + WT</span>}</>
            : includeWt ? <span className="text-slate-400">WT only</span>
            : <span className="text-rose-400">none — pick at least one</span>}
        </span>
        <button
          onClick={() => setOpen(false)}
          className="px-2 py-0.5 rounded border border-cyan-600/60 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 hover:border-cyan-500/60 uppercase tracking-wider"
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
}: {
  dockResult: QuickDockResult | null;
  currentSmiles: string;
  targetPdb?: string;
  mutation?: string;
  onUseVariant: (v: AiVariant) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<AiVariant[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
          {variants.map((v, i) => (
            <div key={i} className="px-3 py-2 text-[11px] font-mono hover:bg-slate-800/30">
              <div className="flex items-center gap-3 mb-1">
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
                <button
                  type="button"
                  onClick={() => onUseVariant(v)}
                  className="ml-auto px-2 py-0.5 rounded border border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 hover:border-emerald-500/60 text-[10px] uppercase tracking-wider"
                  title="Load this variant into Studio. Becomes a new draft (the original parent is preserved)."
                >
                  ⤴ use
                </button>
              </div>
              {/* (v0.45) SMILES + rationale render in full now. Both
                  used to be truncated client-side (60 chars / 140 chars
                  respectively) with a hover-tooltip carrying the rest,
                  which made the rationales unreadable — they're often
                  multi-sentence explanations of the design choice and
                  the user genuinely wants to read them. break-all keeps
                  long SMILES from blowing out the row width; the
                  rationale wraps normally. */}
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
          ))}
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
  targetMeta, myCompounds, onPick, onClose,
}: {
  targetMeta: any;
  myCompounds: any[];
  // (v0.33) Optional name passed alongside SMILES. When present, the
  // caller treats the result as a "loaded named compound" — if the user
  // then edits, fork-on-edit kicks in (Save changes vs Save as new)
  // instead of silently overwriting. Paste-SMILES picks pass undefined
  // so they remain ordinary fresh drafts.
  onPick: (smiles: string, name?: string) => void;
  onClose: () => void;
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
    <div className="bg-[#0d1422] flex-1 overflow-auto">
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
            {pubchemSuggestions.map((name) => (
              <button
                key={name}
                onClick={() => loadFromPubChem(name)}
                disabled={resolvingName !== null}
                className={`px-2 py-1 font-mono text-[11px] rounded border transition-colors ${
                  resolvingName === name
                    ? "border-cyan-500/60 bg-cyan-900/40 text-cyan-200 animate-pulse"
                    : "border-cyan-700/40 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 hover:border-cyan-500/60 disabled:opacity-50 disabled:cursor-wait"
                }`}
                title={`Resolve "${name}" via PubChem and load the SMILES into Ketcher`}
              >
                {resolvingName === name ? `▮ ${name}` : name}
              </button>
            ))}
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
            {filteredRef.length > 0 ? filteredRef.map((c) => (
              <button
                key={c.name}
                onClick={() => onPick(c.smiles, c.name)}
                className="w-full text-left px-2 py-1.5 rounded border border-slate-800 hover:border-cyan-700/50 hover:bg-cyan-950/20 transition-colors group"
              >
                <div className="font-mono text-xs text-slate-200 group-hover:text-cyan-200">{c.name}</div>
                {c.mechanism && (
                  <div className="font-mono text-[10px] text-slate-500 truncate" title={c.mechanism}>
                    {c.mechanism}
                  </div>
                )}
              </button>
            )) : (
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
            {filteredLib.length > 0 ? filteredLib.slice(0, 30).map((c) => (
              <button
                key={c.id}
                onClick={() => onPick(c.smiles, c.name)}
                className="w-full text-left px-2 py-1.5 rounded border border-slate-800 hover:border-cyan-700/50 hover:bg-cyan-950/20 transition-colors group"
              >
                <div className="font-mono text-xs text-slate-200 group-hover:text-cyan-200 truncate">{c.name}</div>
                <div className="font-mono text-[10px] text-slate-500 truncate" title={c.smiles}>
                  {c.smiles}
                </div>
              </button>
            )) : (
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
  const [receptorPdb, setReceptorPdb] = useState<string | null>(null);
  // (v0.50) Second receptor slot — used in "both" mode to load the
  // OTHER variant alongside the primary. When viewVariant === "both"
  // the primary receptor is mutant (cyan-ish) and the alt is WT
  // (slate, semi-transparent). When primary is WT, alt is mutant.
  const [receptorPdbAlt, setReceptorPdbAlt] = useState<string | null>(null);
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

  // (v0.43) Pick which dock result drives the scene based on viewVariant.
  // Falls back gracefully when one of the two slots is empty (single-
  // variant runs default to whichever slot has a result).
  const activeDockResult = viewVariant === "wt"
    ? (dockResultWt || dockResult)
    : (dockResult || dockResultWt);
  const primary = activeDockResult;
  const pdbId = primary?.pdb_id || targetMeta?.pdb_id || "";
  const chain = primary?.chain || targetMeta?.chain || "A";
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

  // Fetch the receptor PDB when a dock result arrives.
  useEffect(() => {
    if (!hasDock || !pdbId || !chain) return;
    let cancelled = false;
    setReceptorErr(null);
    api
      .structure(pdbId, chain, variant)
      .then((text) => {
        if (cancelled) return;
        if (!text || text.length < 100) {
          setReceptorErr(`Receptor ${pdbId}/${chain}/${variant} returned empty`);
          return;
        }
        setReceptorPdb(text);
      })
      .catch((e: Error) => {
        if (!cancelled) setReceptorErr(`Receptor fetch failed: ${e.message}`);
      });
    return () => { cancelled = true; };
  }, [hasDock, pdbId, chain, variant]);

  // (v0.50) When viewVariant is "both", fetch the OTHER variant's
  // receptor in parallel so we can overlay it. Skipped otherwise to
  // avoid wasting bandwidth when the user only cares about one side.
  useEffect(() => {
    if (viewVariant !== "both") { setReceptorPdbAlt(null); return; }
    if (!hasDock || !pdbId || !chain || !mutation || !dockResult || !dockResultWt) return;
    // Primary variant is whichever activeDockResult resolved to.
    // Alt is the other one. mutation is e.g. "Q61H".
    const altVariant = variant === "WT" ? mutation : "WT";
    let cancelled = false;
    api
      .structure(pdbId, chain, altVariant)
      .then((text) => {
        if (cancelled) return;
        if (text && text.length >= 100) setReceptorPdbAlt(text);
      })
      .catch(() => { /* alt is best-effort; primary still renders */ });
    return () => { cancelled = true; };
  }, [viewVariant, hasDock, pdbId, chain, variant, mutation, dockResult, dockResultWt]);

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
        const recColor = "#94a3b8";
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
        if (mutation) {
          const m = String(mutation).match(/(\d+)/);
          if (m) {
            const rn = Number(m[1]);
            const sel = { model: 0, resi: rn };
            try { viewer.addStyle(sel, { stick: { color: "#10b981", radius: 0.32 } }); } catch { /* */ }
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
        const altPoseIdx = altPosePdbqt ? 3 : -1;
        const altRecColor = "#64748b";  // slate-500 — distinct from primary's #94a3b8
        viewer.setStyle({ model: altRecIdx }, {});
        viewer.setStyle({ model: altRecIdx }, { cartoon: { color: altRecColor, opacity: 0.45 } });
        if (altPoseIdx >= 0) {
          viewer.setStyle({ model: altPoseIdx }, {});
          // Alt pose color: emerald if alt is WT (variant === "WT" means
          // primary is mutant, so alt is WT); cyan if alt is mutant.
          const altPoseColor = variant === "WT" ? "#06b6d4" : "#10b981";  // primary WT → alt is mutant cyan; primary mutant → alt is WT emerald
          if (poseStyle === "stick") {
            viewer.setStyle({ model: altPoseIdx }, { stick: { radius: 0.22, color: altPoseColor, opacity: 0.85 } });
          } else if (poseStyle === "ball") {
            viewer.setStyle({ model: altPoseIdx }, { stick: { radius: 0.16, color: altPoseColor, opacity: 0.85 }, sphere: { scale: 0.30, color: altPoseColor, opacity: 0.85 } });
          } else if (poseStyle === "line") {
            viewer.setStyle({ model: altPoseIdx }, { line: { color: altPoseColor } });
          } else if (poseStyle === "sphere") {
            viewer.setStyle({ model: altPoseIdx }, { sphere: { color: altPoseColor, opacity: 0.85 } });
          }
        }
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
    // (v0.51) Detect "variant-only" rebuilds — i.e. user clicked
    // wt/both/mut but the underlying receptor/pose for THIS render
    // is the same as before. In that case we preserve the camera so
    // the scene doesn't jump on every toggle. We compare the build-
    // key WITHOUT the variant slot; if the rest is identical we know
    // the rebuild is purely a variant flip.
    const prevKey = lastBuildKeyRef.current;
    const stripVariant = (k: string) => k.split("|").filter((p) => !p.startsWith("v") && !p.startsWith("a") && !p.startsWith("q")).join("|");
    const variantOnlyChange = !!prevKey && stripVariant(prevKey) === stripVariant(buildKey);
    let savedView: any = null;
    if (variantOnlyChange && viewerRef.current && typeof viewerRef.current.getView === "function") {
      try { savedView = viewerRef.current.getView(); } catch { /* no-op */ }
    }
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
          if (viewVariant === "both" && receptorPdbAlt) {
            viewer.addModel(receptorPdbAlt, "pdb");
            if (altPosePdbqt) {
              viewer.addModel(altPosePdbqt, "pdb");
            }
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
