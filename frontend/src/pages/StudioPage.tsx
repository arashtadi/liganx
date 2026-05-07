// Build verification tag — surfaces the deploy tag in the bundled JS so a
// `curl liganx.com/assets/index-*.js | grep LIGANX_BUILD_TAG` confirms which
// version is live. Cheap, ~50 bytes; replace each release.
const LIGANX_BUILD_TAG = "v0.25-2026-05-06-compound-section-parity";
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
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useSmilesValidity, useSmilesSaScore, type SmilesValidity } from "../components/MoleculePreview";

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
  const [ketcherReady, setKetcherReady] = useState(false);
  const [currentSmiles, setCurrentSmiles] = useState("");

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

  const [showProps, setShowProps] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  // Dropdown open/closed state for target & mutation pickers. Closed
  // by default — current selection shows as a chip with a chevron;
  // clicking expands to show full filtered list. The search input on
  // the right stays visible always (typing into it auto-opens the
  // dropdown so users don't have to click twice).
  const [targetDropdownOpen, setTargetDropdownOpen] = useState(false);
  const [mutationDropdownOpen, setMutationDropdownOpen] = useState(false);
  // 2D editor theme — Ketcher's bundled build doesn't honor ?theme=dark,
  // so we fake dark mode with the "dark reader" CSS filter trick:
  // invert(1) hue-rotate(180deg) flips the background to black while
  // re-rotating hues so red atoms still look red. This works on any
  // 2D molecular editor (or any web content) without needing the iframe
  // to cooperate. Imperfect on raster images and gradients but Ketcher
  // is line art so the result is clean. 2026-05-05 user fallback.
  const [editorTheme, setEditorTheme] = useState<"light" | "dark">("light");
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
  const availableMutations = (targetMeta?.mutations ?? []) as { code: string; label: string }[];

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
              {/* 2D theme toggle — bumps iframe key so Ketcher reloads
                  with ?theme=dark or default. Current SMILES is preserved
                  by re-applying it after the iframe re-inits. */}
              <button
                onClick={() => setEditorTheme(editorTheme === "light" ? "dark" : "light")}
                className="px-2 py-0.5 rounded border font-mono text-[10px] uppercase tracking-wider transition-colors border-slate-700/60 text-slate-400 hover:text-cyan-300 hover:border-cyan-700/50"
                title={`Switch 2D editor to ${editorTheme === "light" ? "dark" : "light"} mode`}
              >
                {editorTheme === "light" ? "☼ light" : "☾ dark"}
              </button>
              <span className="font-mono text-slate-500">{currentSmiles ? `${currentSmiles.length} chars` : "—"}</span>
            </div>
          </div>
          {showLoader && (
            <CompoundLoader
              targetMeta={targetMeta}
              myCompounds={myCompounds || []}
              onPick={loadIntoCanvas}
              onClose={() => setShowLoader(false)}
            />
          )}
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
            <div className="px-3 py-1.5 border-b border-slate-800/70 flex items-center justify-between text-[10px]">
              <span className={TOK.label}>Telemetry</span>
              <span className="font-mono text-slate-500">
                {docking ? <span className="text-cyan-300 animate-pulse">▶ docking…</span>
                  : dockResult ? `attempt ${dockResult.dock_attempts || 1}`
                  : "ready"}
              </span>
            </div>

            {/* Score + Pose row — biggest type on the page */}
            <div className="px-4 pt-3 pb-2 grid grid-cols-2 gap-2 border-b border-slate-800/70">
              <div>
                <div className={TOK.label}>Score</div>
                {/* Show 2-column WT vs mutation panel whenever the user
                    has BOTH selected — regardless of which results have
                    come back. Each slot can show a score, "loading", or
                    "—" so the user always sees what's happening. */}
                {(includeWt && selectedMutation) ? (
                  // Always-2-column WT vs mutation panel. Each slot
                  // shows the score, "loading…" while the dock is in
                  // flight, or "—" if the dock returned without a
                  // valid score. User always sees both slots so the
                  // structure of "WT vs mutation comparison" is
                  // visible whether or not the data has all arrived.
                  <>
                    <div className="flex items-baseline gap-3">
                      {/* Mutant slot (LEFT, primary — this is the new biology).
                          Score color = scoreTier(): emerald (strong) → cyan
                          (moderate) → amber (weak). Kd line below gives a
                          chemistry-familiar number (nM/µM) since Vina ΔG
                          isn't intuitive for non-computational chemists. */}
                      <div className="flex flex-col">
                        <span className={`font-mono text-lg tabular-nums ${
                          dockResult?.score != null ? scoreTier(dockResult.score)
                          : docking ? "text-cyan-300/40 animate-pulse"
                          : "text-slate-600"
                        }`} title={dockResult?.score != null ? `${fmtScore(dockResult.score)} kcal/mol · estimated Kd ≈ ${fmtScoreKd(dockResult.score)}` : undefined}>
                          {dockResult?.score != null ? fmtScore(dockResult.score)
                            : docking ? "▮" : "—.——"}
                        </span>
                        <span className="text-[8px] font-mono uppercase tracking-wider text-amber-300">
                          {selectedMutation} {dockResult?.score != null && <span className="text-slate-500 normal-case">· ~{fmtScoreKd(dockResult.score)}</span>}
                        </span>
                      </div>
                      {/* WT slot */}
                      <div className="flex flex-col">
                        <span className={`font-mono text-lg tabular-nums ${
                          dockResultWt?.score != null ? scoreTier(dockResultWt.score)
                          : docking ? "text-slate-400/40 animate-pulse"
                          : "text-slate-600"
                        }`} title={dockResultWt?.score != null ? `${fmtScore(dockResultWt.score)} kcal/mol · estimated Kd ≈ ${fmtScoreKd(dockResultWt.score)}` : undefined}>
                          {dockResultWt?.score != null ? fmtScore(dockResultWt.score)
                            : docking ? "▮" : "—.——"}
                        </span>
                        <span className="text-[8px] font-mono uppercase tracking-wider text-slate-500">
                          WT {dockResultWt?.score != null && <span>· ~{fmtScoreKd(dockResultWt.score)}</span>}
                        </span>
                      </div>
                      {/* Δ slot — only when BOTH scores are present */}
                      {dockResult?.score != null && dockResultWt?.score != null && (
                        <div className="flex flex-col">
                          {(() => {
                            const delta = dockResult.score - dockResultWt.score;
                            const tighter = delta < 0;
                            return (
                              <>
                                <span className={`font-mono text-lg tabular-nums ${
                                  Math.abs(delta) < 0.3 ? "text-slate-500"
                                  : tighter ? "text-emerald-300"
                                  : "text-rose-300"
                                }`} title="Δ = mutant − WT. Negative = mutant binds tighter (selectivity gain). Positive = mutant binds weaker (resistance).">
                                  {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
                                </span>
                                <span className="text-[8px] font-mono uppercase tracking-wider text-slate-500">
                                  Δ
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      )}
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
              {/* Trigger row: current mutation chip on the LEFT (or "WT" if
                  none selected), search input on the RIGHT. Pressing Enter
                  on a non-matching query commits it as a custom mutation. */}
              <div className="flex items-center gap-2 mb-2">
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
              {(mutationDropdownOpen || mutationQuery) && (
                <div className="flex flex-wrap items-center gap-1.5 max-h-32 overflow-auto pt-1 border-t border-slate-800/70">
                  {/* WT chip — multi-select with the mutation row.
                      Click toggles independently. Doesn't auto-close
                      the dropdown so the user can also pick a mutation
                      in the same gesture. */}
                  <button
                    onClick={() => setIncludeWt(!includeWt)}
                    className={`px-2 py-0.5 text-[10px] font-mono rounded border ${
                      includeWt
                        ? "border-slate-400 bg-slate-700/60 text-slate-100"
                        : "border-slate-700/60 text-slate-500 hover:text-slate-300"
                    }`}
                    title={includeWt ? "WT selected — click to deselect" : "Click to include WT in the dock"}
                  >
                    {includeWt ? "✓ WT" : "WT"}
                  </button>
                  {availableMutations
                    .filter(m =>
                      !mutationQuery ||
                      m.code.toLowerCase().includes(mutationQuery.toLowerCase()) ||
                      (m.label || "").toLowerCase().includes(mutationQuery.toLowerCase())
                    )
                    .map((m) => (
                      <button
                        key={m.code}
                        onClick={() => {
                          // Single-select among mutations — clicking a
                          // different one replaces the previous. WT
                          // selection is independent and stays as-is.
                          if (selectedMutation === m.code) {
                            setSelectedMutation("");  // toggle off
                          } else {
                            setSelectedMutation(m.code);
                            setMutationQuery("");
                          }
                        }}
                        className={`px-2 py-0.5 text-[10px] font-mono rounded border ${
                          selectedMutation === m.code
                            ? "border-amber-500/60 bg-amber-900/30 text-amber-200"
                            : "border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600"
                        }`}
                        title={m.label}
                      >
                        {selectedMutation === m.code ? `✓ ${m.code}` : m.code}
                      </button>
                    ))}
                  {mutationQuery && availableMutations.filter(m =>
                    m.code.toLowerCase().includes(mutationQuery.toLowerCase()) ||
                    (m.label || "").toLowerCase().includes(mutationQuery.toLowerCase())
                  ).length === 0 && (
                    <span className="text-[10px] font-mono text-amber-400/80 italic">
                      no curated match — press Enter to use as custom
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ─── COMPOUND (trigger-chip + search row, mirrors Target/Mutation) ─── */}
            <div className="px-4 py-3 border-b border-slate-800/70">
              <div className="flex items-center justify-between mb-2">
                <span className={TOK.label}>Compound</span>
                <span className="font-mono text-[9px] text-slate-600">
                  {currentSmiles ? `${currentSmiles.length} chars` : "empty"}
                </span>
              </div>
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

            {/* Action area */}
            <div className="px-4 py-3 mt-auto">
              {dockError && (
                <div className="mb-2 px-2 py-1.5 rounded bg-rose-950/40 border border-rose-900/60 text-[11px] text-rose-200 font-mono">
                  ✗ {dockError}
                </div>
              )}
              {dockResult?.mutation_caveat && (
                <div className="mb-2 px-2 py-1.5 rounded bg-amber-950/40 border border-amber-900/60 text-[10px] text-amber-200 font-mono">
                  ⚠ {dockResult.mutation_caveat}
                </div>
              )}
              <button
                onClick={runQuickDock}
                disabled={docking || !ketcherReady || !currentSmiles || !selectedTarget}
                className={`w-full px-4 py-2.5 rounded border font-mono text-xs uppercase tracking-[0.18em] transition-all ${
                  docking
                    ? "border-cyan-500/50 bg-cyan-950/40 text-cyan-300 cursor-wait animate-pulse"
                    : !ketcherReady || !currentSmiles
                    ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                    : "border-cyan-600/60 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 hover:border-cyan-500"
                }`}
              >
                {docking ? "▶ docking…" : "⏵ Run Dock"}
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* ═══ COLLAPSIBLE BOTTOM STRIP ═══ */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0d1422] border-t border-slate-800/70 flex text-[10px] z-20">
        <CollapsibleTab label="Properties" open={showProps} onToggle={() => setShowProps(!showProps)}>
          <PropertiesPanel smiles={currentSmiles} />
        </CollapsibleTab>
        <CollapsibleTab label="AI Variants" open={showAi} onToggle={() => setShowAi(!showAi)}>
          <div className="text-slate-500 font-mono text-[11px] p-3">AI variant generation · v0.2 (deferred)</div>
        </CollapsibleTab>
        <CollapsibleTab label="History" open={showHistory} onToggle={() => setShowHistory(!showHistory)}>
          <div className="text-slate-500 font-mono text-[11px] p-3">Session dock history · v0.2 (deferred)</div>
        </CollapsibleTab>
      </div>
    </div>
  );
}

/** Collapsible bottom-strip tab. Closed = just a ▸ Label header.
 *  Open = expands upward as a 240px-tall panel above the strip. */
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
  onPick: (smiles: string) => void;
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
        onPick(res.smiles);
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
    <div className="absolute top-[34px] left-0 right-0 z-20 bg-[#0d1422] border-b border-slate-800/70 max-h-[70%] overflow-auto">
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
                onClick={() => onPick(c.smiles)}
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
                onClick={() => onPick(c.smiles)}
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

  const primary = dockResult || dockResultWt;
  const pdbId = primary?.pdb_id || targetMeta?.pdb_id || "";
  const chain = primary?.chain || targetMeta?.chain || "A";
  const variant = dockResult ? mutation || "WT" : "WT";
  const hasDock = !!primary;
  // Vina returns multiple binding modes in one PDBQT (MODEL 1 ... ENDMDL ·
  // MODEL 2 ... etc — up to 9 by default). 3Dmol's addModel concatenates
  // all of them into a single model with 9× the atoms scattered across
  // space, which broke camera framing — zoomTo({model:1}) fit the bbox
  // of all 9 modes, leaving each individual mode tiny in the viewport.
  // Strip everything after the first ENDMDL so only the top-ranked pose
  // (mode 1, the one matching the score) is rendered.
  const posePdbqtFull = dockResult?.pose_pdbqt_b64 ? atob(dockResult.pose_pdbqt_b64) : "";
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
  // Live-preview gate: true when the user has edited the 2D structure
  // since the dock that produced the current pose. While true, the 3D
  // view shows a live conformer of the edited SMILES (positioned at
  // the docked pose's centroid) instead of the now-stale docked pose.
  // Reset by a successful re-dock (which writes the new SMILES into
  // dockedSmilesRef).
  const smilesEdited = hasDock && !!smiles && !!dockedSmilesRef.current && smiles !== dockedSmilesRef.current;

  // Hits = pocket-contact residues from the dock result. Used to highlight
  // side chains and to decide whether to enable the Contacts toggle.
  const contactResnums = useMemo<number[]>(() => {
    const hits = (dockResult?.hits || []) as string[];
    const out = new Set<number>();
    for (const h of hits) {
      const m = String(h).match(/(\d+)/);
      if (m) out.add(Number(m[1]));
    }
    return Array.from(out);
  }, [dockResult?.hits]);

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
  }, [hasDock, posePdbqt, smiles]);

  // Fetch the live conformer in two cases:
  //   1. No dock yet — preview whatever the user is sketching.
  //   2. Dock done but the user has since edited the 2D structure —
  //      preview the new compound in the pocket so they can see how
  //      their edit fits before re-docking.
  useEffect(() => {
    if (!smiles) return;
    if (hasDock && !smilesEdited) return;  // docked pose is still current
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
  }, [smiles, hasDock, smilesEdited]);

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

  // Apply visual styles based on toolbar state. This is the single place
  // styles are written to the 3Dmol viewer — both the data-load effect
  // (below) and the toolbar buttons trigger it via dependency.
  function applyStyles(viewer: any) {
    if (!viewer) return;
    try {
      // Receptor model — index 0. Conformer-only mode skips this branch.
      if (hasDock && receptorPdb) {
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
      // at model:1 so the same selector covers it.
      const poseIdx = hasDock && receptorPdb ? 1 : 0;
      const ligandPresent = (hasDock && (hasPose || (smilesEdited && editedConformerSdf))) || (!hasDock && conformerSdf);
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
      hasDock ? "D" : "_",
      receptorPdb ? `r${receptorPdb.length}` : "_",
      posePdbqt ? `p${posePdbqt.length}` : "_",
      conformerSdf ? `c${conformerSdf.length}` : "_",
      smilesEdited && editedConformerSdf ? `e${editedConformerSdf.length}` : "_",
    ].join("|");
    if (buildKey === lastBuildKeyRef.current && viewerRef.current) {
      // Same data, viewer already exists — leave it alone.
      return;
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

        if (hasDock && receptorPdb) {
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
          if (ligandIdx >= 0) {
            viewer.zoomTo({ model: ligandIdx });
            viewer.zoom(0.6, 0);
          } else {
            viewer.zoomTo();
          }
        } else if (conformerSdf) {
          viewer.addModel(conformerSdf, "sdf");
          viewer.zoomTo();
        }
        applyStyles(viewer);
      } catch (e) {
        if (!cancelled) setConformerErr(`Render failed: ${(e as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDock, receptorPdb, posePdbqt, conformerSdf, editedConformerSdf, smilesEdited]);

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
