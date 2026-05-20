/**
 * FEP+ study results page. (G8)
 *
 * Polls /fep/studies/{share_id} every 30s (the study runs for ~days,
 * so polling fast is wasteful) and renders:
 *
 *   1. Top banner: status + stage + cycle-closure RMSD
 *   2. Ranked analog table (the headline view per design doc §9):
 *      name, SMILES preview, ΔΔG to hit (color-coded), 95% CI,
 *      convergence chip (green/amber/red)
 *   3. Perturbation graph edges (collapsible): each edge with its
 *      LOMAP score, ΔΔG_binding, hysteresis, status
 *   4. Cancel button (for RUNNING studies)
 *
 * Honest presentation: the convergence chips DRIVE the readability —
 * "not_converged" nodes show ΔΔG as `—` not "0.0"; high-uncertainty
 * nodes show the error bar prominently. No bolded number a chemist
 * could misread as a Kd-equivalent.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type FepStudyGraph } from "../api";
import { Spinner } from "../components/Icons";
import MoleculePreview from "../components/MoleculePreview";
import { FepHoloLoader } from "../components/FepHoloLoader";
import { usePageMeta } from "../lib/usePageMeta";

// (O13) Translate a mutation code (e.g. "Q61H", "T790M") into a
// plain-language description: which amino acid changes to which,
// known structural context if catalog has one. Falls back to the
// raw code for novel / unparsable inputs.
//
// Sources for the structural-context annotations:
//   • KRAS Q61H / G12C / G12D / G12V / G13D — published switch-II /
//     P-loop literature (Lito et al., 2015; Khan et al., 2020).
//   • EGFR L858R / T790M / C797S — Yun 2007, Kobayashi 2005,
//     Thress 2015 (osimertinib resistance).
//   • BRAF V600E — Davies 2002.
//   • ABL T315I — Shah 2002 (imatinib gatekeeper resistance).
// Use the title attribute for the long version (tooltip on hover);
// the inline display gets the compact text.
const _AA_3LETTER: Record<string, string> = {
  A: "Alanine", R: "Arginine", N: "Asparagine", D: "Aspartate", C: "Cysteine",
  E: "Glutamate", Q: "Glutamine", G: "Glycine", H: "Histidine", I: "Isoleucine",
  L: "Leucine", K: "Lysine", M: "Methionine", F: "Phenylalanine", P: "Proline",
  S: "Serine", T: "Threonine", W: "Tryptophan", Y: "Tyrosine", V: "Valine",
};
const _MUTATION_CONTEXT: Record<string, string> = {
  "G12C": "P-loop, covalent-handle for KRAS G12C inhibitors",
  "G12D": "P-loop, most common KRAS oncogenic mutation",
  "G12V": "P-loop, common in pancreatic + colorectal cancer",
  "G13D": "P-loop, frequent in colorectal cancer",
  "Q61H": "switch-II region, resistance-associated",
  "L858R": "activation loop, sensitises EGFR to TKIs",
  "T790M": "gatekeeper, primary EGFR-TKI resistance mutation",
  "C797S": "covalent-binding cysteine, osimertinib resistance",
  "V600E": "activation loop, drives constitutive BRAF kinase activity",
  "T315I": "gatekeeper, pan-TKI ABL resistance",
};
function describeMutation(variant: string): string {
  if (!variant || variant === "WT") return "Wild-type protein sequence";
  // Match WT-letter + position + mut-letter, e.g. "Q61H", "T790M".
  const m = variant.match(/^([A-Z])(\d+)([A-Z])$/);
  if (!m) return `Mutation ${variant} applied to the receptor`;
  const [_full, wtOne, posStr, mutOne] = m;
  const wtFull = _AA_3LETTER[wtOne] || wtOne;
  const mutFull = _AA_3LETTER[mutOne] || mutOne;
  const ctx = _MUTATION_CONTEXT[variant.toUpperCase()];
  const base = `${wtFull} ${posStr} → ${mutFull}`;
  return ctx ? `${base} · ${ctx}` : base;
}

// (J12) Map raw stage names emitted by fep_pod into friendly,
// non-jargon labels for the running-edge status line. Keep the
// stage taxonomy in sync with fep_pod.run_edge + fep_runner's
// _STAGE_PCT mapping. Unknown stages fall back to the raw label
// (no "Unknown" string — better to show real openfe names than
// hide novel stages behind a generic word).
function humaniseFepStage(stage: string): string {
  switch (stage) {
    case "queued":                  return "queued on pod";
    case "parsing_ligand_sdfs":     return "parsing ligand SDFs";
    case "lomap_mapping":           return "atom-mapping ligands (LOMAP)";
    case "preparing_receptor":      return "preparing receptor (adding hydrogens)";
    case "building_complex_dag":    return "parameterising ligands (antechamber)";
    case "running_complex_leg":     return "sampling complex leg on GPU";
    case "building_solvent_dag":    return "building solvent system";
    case "running_solvent_leg":     return "sampling solvent leg on GPU";
    case "analysing_legs":          return "analysing MBAR + hysteresis";
    case "done":                    return "done";
    case "failed":                  return "failed";
    case "crashed":                 return "crashed";
    case "mock_running":            return "mock simulation (no real physics)";
    default:                        return stage.replace(/_/g, " ");
  }
}

// (O8) Strip the "edge_X_of_Y_" prefix off a study-level stage so the
// trailing per-edge stage can be humanised. Multi-edge studies emit
// stages like "edge_2_of_3_running_complex_leg" — chemists read it as
// gibberish. The runner already separates the two concerns
// (job.stage = full label, edge.stage = bare per-edge stage); we
// reconcile by parsing the prefix off the study label.
function extractEdgeStage(stage: string | null | undefined): string | null {
  if (!stage) return null;
  const m = stage.match(/^edge_(\d+)_of_(\d+)_(.+)$/);
  return m ? m[3] : stage;
}

// (O8) Pretty stage stepper. Renders the canonical per-edge stages
// as a horizontal pipeline with the current one highlighted. Tracks
// scientific accuracy by mirroring the actual run order in
// fep_pod.run_edge — chemist can see at a glance that the run is on
// step 4 of 6 without parsing a snake_case string.
//
// Stage order:
//   1. parameterise   — ligand atom-mapping + antechamber
//   2. equilibrate    — receptor prep + solvation
//   3. complex leg    — λ-window MD with the ligand in the pocket
//   4. solvent leg    — λ-window MD with the ligand free in water
//   5. analyse        — MBAR + hysteresis convergence checks
const STAGE_STEPS: ReadonlyArray<{ key: string; label: string; matches: string[] }> = [
  {
    key: "parameterise",
    label: "Parameterise",
    matches: [
      "parsing_ligand_sdfs",
      "lomap_mapping",
      "building_complex_dag",
    ],
  },
  {
    key: "equilibrate",
    label: "Equilibrate",
    matches: ["preparing_receptor", "building_solvent_dag"],
  },
  {
    key: "complex",
    label: "Complex leg",
    matches: ["running_complex_leg"],
  },
  {
    key: "solvent",
    label: "Solvent leg",
    matches: ["running_solvent_leg"],
  },
  {
    key: "analyse",
    label: "Analyse",
    matches: ["analysing_legs"],
  },
];

function stageStepIndex(rawStage: string | null | undefined): number {
  const s = extractEdgeStage(rawStage);
  if (!s) return -1;
  for (let i = 0; i < STAGE_STEPS.length; i++) {
    if (STAGE_STEPS[i].matches.includes(s)) return i;
  }
  return -1;
}

function StageStepper({ stage }: { stage: string | null | undefined }) {
  const activeIdx = stageStepIndex(stage);
  if (activeIdx < 0) return null;
  return (
    <div
      className="mt-3 flex items-center gap-1 flex-wrap text-[10px] font-medium"
      role="list"
      aria-label="FEP edge progress stages"
    >
      {STAGE_STEPS.map((step, i) => {
        const state =
          i < activeIdx ? "done"
          : i === activeIdx ? "active"
          : "pending";
        const dotClass =
          state === "done"   ? "bg-emerald-500"
          : state === "active" ? "bg-violet-500 ring-2 ring-violet-200 dark:ring-violet-800/60 animate-pulse"
          : "bg-slate-300 dark:bg-slate-600";
        const textClass =
          state === "done"   ? "text-emerald-700 dark:text-emerald-300"
          : state === "active" ? "text-violet-700 dark:text-violet-300 font-semibold"
          : "text-slate-400 dark:text-slate-500";
        return (
          <div key={step.key} className="flex items-center gap-1" role="listitem">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`}
              aria-hidden="true"
            />
            <span className={textClass}>{step.label}</span>
            {i < STAGE_STEPS.length - 1 && (
              <span className="text-slate-300 dark:text-slate-600 px-0.5" aria-hidden="true">
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function FepStudyPage() {
  const { shareId } = useParams<{ shareId: string }>();
  const navigate = useNavigate();
  usePageMeta({
    title: "FEP+ study · Liganx",
    description: "Relative binding free-energy results — ranked analog table with convergence diagnostics.",
  });

  const [graph, setGraph] = useState<FepStudyGraph | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<boolean>(false);

  // (J13) Live "now" ticker — re-renders every second so the elapsed
  // counter ('Running for 12 min 14 s') updates without waiting for
  // the next 30s poll. Only ticks while the study is running, to
  // avoid pointless re-renders on completed/failed pages.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!graph) return;
    if (!["pending", "preparing", "running"].includes(graph.status)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [graph?.status]);

  // ─── Poll loop. 30s — these studies run for days. ────────────────
  useEffect(() => {
    if (!shareId) return;
    let cancelled = false;
    function load() {
      if (!shareId) return;
      api.fepGet(shareId)
        .then((g) => {
          if (!cancelled) setGraph(g);
        })
        .catch((e: Error & { status?: number }) => {
          if (cancelled) return;
          if (e.status === 403) {
            setErr("FEP+ is locked for your account. Contact your administrator.");
          } else if (e.status === 404) {
            setErr("Study not found (or doesn't belong to you).");
          } else {
            setErr(`Failed to load: ${e.message}`);
          }
        });
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [shareId]);

  // (U10) Two-step cancel: clicking "Cancel study" first flips
  // `confirmingCancel` true, which swaps the button for an explicit
  // "Confirm cancel" + "Keep running" pair. Matches the docking
  // JobPage pattern and prevents accidental cancels of FEP runs that
  // already cost real GPU time.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  function doCancel() {
    if (!shareId) return;
    setCancelling(true);
    api.fepCancel(shareId)
      .then(() => {
        // Refresh — the cancel takes effect at the next edge boundary
        // so status may still be "running" briefly.
        return api.fepGet(shareId);
      })
      .then((g) => setGraph(g))
      .finally(() => {
        setCancelling(false);
        setConfirmingCancel(false);
      });
  }

  if (err) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <h1 className="text-xl font-bold text-rose-700 dark:text-rose-400">{err}</h1>
        <button
          type="button"
          onClick={() => navigate("/fep/new")}
          className="mt-4 btn-primary"
        >
          Start a new FEP study
        </button>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <Spinner size={20} />
        <p className="text-sm text-slate-500 mt-2">Loading…</p>
      </div>
    );
  }

  const hit = graph.nodes.find((n) => n.is_hit);
  const analogs = graph.nodes.filter((n) => !n.is_hit);
  const sortedAnalogs = [...analogs].sort((a, b) => {
    // Sort: converged first (by ΔΔG, more negative = better),
    // then high_uncertainty, then not_converged.
    const flagRank = (f: string | null) =>
      f === "ok" ? 0 : f === "high_uncertainty" ? 1 : 2;
    const aRank = flagRank(a.convergence_flag);
    const bRank = flagRank(b.convergence_flag);
    if (aRank !== bRank) return aRank - bRank;
    const aDg = a.ddg_to_hit_kcal_mol ?? 0;
    const bDg = b.ddg_to_hit_kcal_mol ?? 0;
    return aDg - bDg;
  });

  const isRunning = ["pending", "preparing", "running"].includes(graph.status);

  // (Progress display) Aggregate edge statuses so the user gets a real
  // sense of progress instead of a bare 'PENDING' chip. Counts edges in
  // each terminal/transient state and builds a readable status line.
  const edgeCounts = {
    ok: graph.edges.filter((e) => e.status === "ok").length,
    running: graph.edges.filter((e) => e.status === "running").length,
    failed: graph.edges.filter((e) => e.status === "failed").length,
    pending: graph.edges.filter((e) => e.status === "pending").length,
    total: graph.edges.length,
  };
  const pctComplete = edgeCounts.total > 0
    ? Math.round(100 * (edgeCounts.ok + edgeCounts.failed) / edgeCounts.total)
    : 0;
  const friendlyStatusLine = (() => {
    if (graph.status === "pending") {
      return edgeCounts.total > 0
        ? `Queued — ${edgeCounts.total} edges waiting for the FEP runner`
        : "Queued — runner hasn't picked up the study yet";
    }
    if (graph.status === "preparing") {
      return graph.stage === "building_perturbation_graph"
        ? "Building the LOMAP atom map + perturbation graph…"
        : "Preparing — parameterising ligands + receptor…";
    }
    if (graph.status === "running") {
      if (edgeCounts.running > 0) {
        // (J12) Pull the running edge's sub-stage label so the user
        // sees "running_complex_leg" rather than just "running".
        // Falls back to the old format if the pod hasn't reported
        // a stage yet (mock mode, transient first-poll gap).
        const liveEdge = graph.edges.find((e) => e.status === "running");
        const stageLabel = liveEdge?.stage
          ? humaniseFepStage(liveEdge.stage)
          : "running";
        const pct = liveEdge?.progress_pct;
        const pctSuffix = typeof pct === "number" ? ` (${pct}%)` : "";
        // (O3) For a single-edge study, "0 done · 0 queued" reads like
        // three zeros and confuses chemists. Drop the suffix when the
        // study is just one edge — they can already see we're on the
        // only one.
        const baseLine = `Edge ${edgeCounts.ok + 1}/${edgeCounts.total} — ${stageLabel}${pctSuffix}`;
        if (edgeCounts.total === 1) {
          return baseLine;
        }
        return `${baseLine} · ${edgeCounts.ok} done · ${edgeCounts.pending} queued`;
      }
      if (edgeCounts.total === 1) {
        return `${edgeCounts.ok}/${edgeCounts.total} edge done`;
      }
      return `${edgeCounts.ok}/${edgeCounts.total} edges done · ${edgeCounts.pending} queued`;
    }
    if (graph.status === "completed") {
      return edgeCounts.failed > 0
        ? `Completed (partial) — ${edgeCounts.ok}/${edgeCounts.total} edges converged, ${edgeCounts.failed} failed`
        : `Completed — all ${edgeCounts.total} edges converged`;
    }
    if (graph.status === "failed") {
      return "Failed — see error message below";
    }
    if (graph.status === "cancelled") {
      return `Cancelled at ${edgeCounts.ok}/${edgeCounts.total} edges`;
    }
    return graph.status;
  })();

  // (J13 + J15) Elapsed wall time + estimated remaining.
  //
  // J15 fix: the original ETA used a fixed 12-min setup baseline,
  // which is much too short for antechamber on Osi-sized ligands
  // (10-30 min for AM1-BCC). Once real elapsed exceeded the
  // baseline, ETA bottomed out at 0 and stayed there — looked
  // broken. New approach: when the pod reports a `progress_pct`
  // (J12), extrapolate from actual elapsed instead of a fixed
  // baseline. If 10 min got us to 15%, we honestly project another
  // ~57 min. Only fall back to the static baseline before the first
  // stage update lands.
  function fmtDuration(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return "—";
    if (seconds < 60) return `${Math.round(seconds)} s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    if (m < 60) return s > 0 ? `${m} min ${s} s` : `${m} min`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h} h ${mm} min`;
  }
  function fmtAbsoluteEta(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return "";
    const eta = new Date(now + seconds * 1000);
    const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
    return eta.toLocaleTimeString(undefined, opts);
  }
  // (O10) Prefer created_at for total study elapsed; if it isn't on
  // the response (legacy rows pre-J13) fall back to the running
  // edge's started_at so the counter doesn't sit at "0 s" forever.
  // Without this, the UI showed "Running for 0 s" even when the pod
  // had been working for an hour.
  const createdAtMs = graph.created_at ? Date.parse(graph.created_at) : null;
  const runningEdgeForElapsed = graph.edges.find((e) => e.status === "running");
  const runningStartFallbackMs = runningEdgeForElapsed?.started_at
    ? Date.parse(runningEdgeForElapsed.started_at)
    : null;
  const elapsedAnchorMs = createdAtMs ?? runningStartFallbackMs;
  const elapsedSec = elapsedAnchorMs
    ? Math.max(0, (now - elapsedAnchorMs) / 1000)
    : null;
  const nWin = graph.n_lambda_windows ?? 12;
  const nsWin = graph.ns_per_window ?? 7.0;
  // Static fallback baseline used only when there's no stage info yet
  // (before the first poll from the pod comes back). Setup cost is
  // ~20 min for Osi-sized antechamber on the 4090; sampling adds
  // 2×60s/ns × windows × ns.
  const perEdgeSetupSec = 20 * 60;
  const perEdgeSamplingSec = nWin * nsWin * 2 * 60;
  const perEdgeBaselineSec = perEdgeSetupSec + perEdgeSamplingSec;
  const edgesRemaining = edgeCounts.pending + edgeCounts.running;

  // For the running edge, prefer progress-extrapolated ETA over the
  // static baseline. The pod reports progress_pct at each stage; we
  // measure elapsed-since-edge-started and project remaining as
  // (elapsed / pct) × (100 - pct). This adapts to the actual machine
  // speed instead of assuming a hardcoded budget.
  const runningEdge = graph.edges.find((e) => e.status === "running");
  const runningEdgeStartedMs =
    runningEdge?.started_at ? Date.parse(runningEdge.started_at) : null;
  const runningEdgeElapsedSec =
    runningEdgeStartedMs ? Math.max(0, (now - runningEdgeStartedMs) / 1000) : 0;
  const runningPct = runningEdge?.progress_pct ?? null;

  let runningEdgeRemainingSec: number;
  if (runningEdge && runningPct != null && runningPct >= 5 && runningPct < 100
      && runningEdgeElapsedSec > 10) {
    // Extrapolate from progress. Cap at 12 hours to keep the display
    // sane on pathological cases (1% after 1 hour would project 99h).
    runningEdgeRemainingSec = Math.min(
      12 * 3600,
      (runningEdgeElapsedSec / runningPct) * (100 - runningPct),
    );
  } else if (runningEdge) {
    // Running but no useful pct yet — fall back to baseline minus
    // elapsed. Never goes below zero, never increases.
    runningEdgeRemainingSec = Math.max(0, perEdgeBaselineSec - runningEdgeElapsedSec);
  } else {
    // No running edge yet (preparing) — full baseline.
    runningEdgeRemainingSec = perEdgeBaselineSec;
  }
  const pendingEdgesRemainingSec = edgeCounts.pending * perEdgeBaselineSec;
  const estRemainingSec =
    edgesRemaining > 0 ? runningEdgeRemainingSec + pendingEdgesRemainingSec : 0;
  // Honest framing in the UI when extrapolating from a still-low pct:
  // a 5% reading at 30s gives a wildly noisy estimate, so we tag it.
  const etaIsNoisy =
    runningEdge != null
    && (runningPct == null || runningPct < 20)
    && estRemainingSec > 0;

  // (L1) Detect "opaque MD stage" — running_complex_leg and
  // running_solvent_leg are the two pure-MD stages where the pod has
  // zero sub-stage reporting (no openmm step-count hook yet). In
  // these stages `progress_pct` stays flat at the stage-entry value
  // for HOURS while elapsed climbs, so the J15 extrapolation
  // formula `(elapsed/pct) × (100-pct)` produces a "remaining" that
  // grows linearly with elapsed — the user sees the ETA push back
  // every hour and assumes something's stuck.
  //
  // Honest fix: when we're on one of these stages, don't show a
  // precise-looking ETA at all. Show the typical wall-time range and
  // make clear that fine-grained progress isn't available. Once the
  // stage transitions (to building_solvent_dag or analysing_legs),
  // the formula starts working again because pct advances.
  //
  // Long-term fix (L2): heartbeat thread on the pod surfaces
  // stage_elapsed_seconds so we can at least show "running MD for
  // 4h 12min" instead of just a generic message.
  const _OPAQUE_MD_STAGES = new Set([
    "running_complex_leg",
    "running_solvent_leg",
  ]);
  const runningEdgeOnOpaqueMdStage =
    runningEdge != null
    && runningEdge.stage != null
    && _OPAQUE_MD_STAGES.has(runningEdge.stage);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {/* (J16) Shimmer keyframes for the running-edge progress bar.
          Injected inline rather than via tailwind.config.js so this
          page is self-contained. The translate range needs to start
          off-screen left and end off-screen right of the bar's own
          width; 100% is the bar's width, so -100%→100% draws a full
          sweep. */}
      <style>{`
        @keyframes feb_shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
      {/* Status banner. */}
      <div className="card flex items-start justify-between flex-wrap gap-3">
        <div className="flex-1 min-w-[300px]">
          <h1 className="text-2xl font-bold text-ink dark:text-slate-100 flex items-center gap-2">
            {/* (J14) Show per-user FEP # if available — same UX as
                docking jobs. Falls back to plain 'FEP+ study' for
                legacy rows that predate migration 021. */}
            {graph.seq_number ? (
              <>FEP <span className="tabular-nums">#{graph.seq_number}</span></>
            ) : (
              <>FEP+ study</>
            )}
            <span className={`badge text-[10px] uppercase tracking-wider font-bold ${
              graph.status === "completed" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
              : graph.status === "failed" ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
              : graph.status === "cancelled" ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
              : "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
            }`}>
              {graph.status}
            </span>
            {/* (K5) Force-field engine badge. NULL is rendered as
                "Sage" — that's what every pre-K5 study used. Tooltip
                spells out the tier so users know what they're
                looking at. */}
            <span
              className="badge text-[10px] uppercase tracking-wider font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300"
              title={
                graph.force_field_engine === "espaloma"
                  ? "Espaloma 0.3 — graph-neural-network ligand parameterization (Standard tier)"
                  : graph.force_field_engine === "mace"
                  ? "MACE-OFF 23 — ML-MM hybrid (Pro tier)"
                  : "OpenFF Sage 2.2 — rule-based ligand parameterization (Basic tier)"
              }
            >
              {graph.force_field_engine === "espaloma"
                ? "Espaloma"
                : graph.force_field_engine === "mace"
                ? "MACE-OFF"
                : "Sage"}
            </span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
            {graph.share_id}
            {graph.stage && (() => {
              // (O8) Humanise the trailing per-edge stage instead of
              // dumping snake_case. Falls back to the raw label for
              // study-level stages like "aggregating" that don't have
              // an edge prefix.
              const edgeStage = extractEdgeStage(graph.stage);
              const friendly = edgeStage ? humaniseFepStage(edgeStage) : graph.stage;
              return <> · {friendly}</>;
            })()}
          </p>
          {/* (O8) Visual stage stepper — much more chemist-friendly
              than a raw stage string. Only renders when we recognise
              the current stage; for novel / unmapped stages the prose
              label above already covers it. */}
          {isRunning && <StageStepper stage={graph.stage} />}
          {/* (M15) Target + variant — chemists need to know what protein
              this study is against, not just which compounds. Renders
              the PDB ID prominently with the variant as a colored
              badge to make non-WT mutations visually obvious. */}
          {graph.pdb_id && (
            <p className="text-sm mt-2 flex items-center gap-2 flex-wrap">
              <span className="text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                Target
              </span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {graph.pdb_id}
              </span>
              {graph.chain && (
                <span className="text-slate-500 dark:text-slate-400 text-xs">
                  chain {graph.chain}
                </span>
              )}
              {graph.variant && (
                <>
                  <span
                    className={`badge text-[10px] uppercase tracking-wider font-bold ${
                      graph.variant === "WT"
                        ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    }`}
                    title={describeMutation(graph.variant)}
                  >
                    {graph.variant}
                  </span>
                  {/* (O13) Plain-language gloss of the mutation — chemist
                      who sees "Q61H" once knows it; chemist who sees a
                      novel mutation shouldn't have to context-switch to
                      UniProt to learn what amino-acid swap is happening. */}
                  {graph.variant !== "WT" && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                      {describeMutation(graph.variant)}
                    </span>
                  )}
                </>
              )}
            </p>
          )}
          {/* Progress line — plain-English summary of where the
              study is. Replaces a bare 'PENDING' badge with a
              readable account of what the runner is doing right
              now and how many edges remain. */}
          <p className="text-sm text-slate-700 dark:text-slate-200 mt-2 flex items-center gap-2">
            {/* (J16) Spinner whenever the study is in flight so the
                page has a visible heartbeat — without this the
                running-edge label can sit unchanged for minutes
                between stage transitions and the user assumes
                something's stuck. */}
            {isRunning && (
              <Spinner
                size={14}
                className="text-violet-500 dark:text-violet-400 shrink-0"
              />
            )}
            <span>{friendlyStatusLine}</span>
          </p>
          {/* Progress bar — only when the study has edges to track.
              Shows three coloured segments: green (converged),
              violet (running), slate (queued). Failed edges go
              into the green bucket since they're complete. */}
          {edgeCounts.total > 0 && (
            <div className="mt-2 space-y-1">
              <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden flex">
                {edgeCounts.ok > 0 && (
                  <div
                    className="h-full bg-emerald-500 dark:bg-emerald-400"
                    style={{ width: `${(100 * edgeCounts.ok) / edgeCounts.total}%` }}
                    title={`${edgeCounts.ok} converged`}
                  />
                )}
                {edgeCounts.failed > 0 && (
                  <div
                    className="h-full bg-rose-500 dark:bg-rose-400"
                    style={{ width: `${(100 * edgeCounts.failed) / edgeCounts.total}%` }}
                    title={`${edgeCounts.failed} failed`}
                  />
                )}
                {edgeCounts.running > 0 && (
                  // (J16) Shimmer effect — a moving violet gradient
                  // overlays the running segment so the bar reads as
                  // "alive" even when the underlying progress_pct
                  // hasn't changed for a while. Uses Tailwind's
                  // bg-gradient + animate-pulse plus a custom
                  // animate-shimmer applied via inline style so we
                  // don't need a tailwind.config.js change.
                  <div
                    className="h-full bg-violet-500 dark:bg-violet-400 relative overflow-hidden"
                    style={{ width: `${(100 * edgeCounts.running) / edgeCounts.total}%` }}
                    title={`${edgeCounts.running} running`}
                  >
                    <div
                      className="absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%)",
                        animation: "feb_shimmer 1.6s linear infinite",
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-3">
                <span>{pctComplete}% complete</span>
                {edgeCounts.ok > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    {edgeCounts.ok} ok
                  </span>
                )}
                {edgeCounts.running > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-violet-500" />
                    {edgeCounts.running} running
                  </span>
                )}
                {edgeCounts.pending > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-slate-400" />
                    {edgeCounts.pending} queued
                  </span>
                )}
                {edgeCounts.failed > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-rose-500" />
                    {edgeCounts.failed} failed
                  </span>
                )}
              </div>
            </div>
          )}
          {/* (J13) Elapsed wall time + estimated remaining. Only
              renders while the study is in flight — completed/failed
              pages hide it since the numbers stop being meaningful.
              The ETA is a coarse baseline (~12 min setup + sampling
              per edge); J12 will replace this with sub-stage progress
              from a polled pod endpoint. */}
          {isRunning && elapsedSec != null && (
            <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-3 flex-wrap">
              <span>
                Running for{" "}
                <span className="font-medium text-slate-700 dark:text-slate-200 tabular-nums">
                  {fmtDuration(elapsedSec)}
                </span>
              </span>
              {/* (L1) When the running edge is in an opaque MD stage,
                  the pct-based ETA grows misleadingly. Suppress the
                  precise number and show the typical wall-time range
                  + a note that fine-grained progress is missing. */}
              {edgesRemaining > 0 && runningEdgeOnOpaqueMdStage && (
                <>
                  <span>·</span>
                  <span>
                    MD sampling in progress —{" "}
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      typical 6–10&nbsp;h per leg
                    </span>{" "}
                    on this GPU
                  </span>
                </>
              )}
              {edgesRemaining > 0
                && !runningEdgeOnOpaqueMdStage
                && estRemainingSec > 0 && (
                <>
                  <span>·</span>
                  <span>
                    Est. remaining{" "}
                    <span className="font-medium text-slate-700 dark:text-slate-200 tabular-nums">
                      ~{fmtDuration(estRemainingSec)}
                    </span>
                    {fmtAbsoluteEta(estRemainingSec) && (
                      <>
                        {" "}
                        <span className="text-slate-400">
                          (≈ {fmtAbsoluteEta(estRemainingSec)})
                        </span>
                      </>
                    )}
                  </span>
                  <span>·</span>
                  <span className="italic">
                    {etaIsNoisy
                      ? "noisy — first stages dominate, will settle once sampling starts"
                      : "extrapolated from live stage progress"}
                  </span>
                </>
              )}
            </div>
          )}
          {graph.cycle_closure_rmsd != null && (
            <p className="text-xs mt-1">
              <span className="text-slate-500 dark:text-slate-400">Cycle-closure RMSD:</span>{" "}
              <span className={`font-bold tabular-nums ${
                graph.cycle_closure_rmsd < 0.5 ? "text-emerald-700 dark:text-emerald-400"
                : graph.cycle_closure_rmsd < 1.0 ? "text-amber-700 dark:text-amber-400"
                : "text-rose-700 dark:text-rose-400"
              }`}>
                {graph.cycle_closure_rmsd.toFixed(2)} kcal/mol
              </span>
              {graph.cycle_closure_rmsd >= 1.0 && (
                <span className="text-rose-600 dark:text-rose-400 italic ml-2">
                  Force field may be misbehaving — interpret per-analog ΔΔG with caution.
                </span>
              )}
            </p>
          )}
        </div>
        {isRunning && !confirmingCancel && (
          <button
            type="button"
            onClick={() => setConfirmingCancel(true)}
            disabled={cancelling}
            className="btn-secondary"
            title="Cancel this FEP study. The in-flight edge is signalled to stop at the next stage boundary; queued edges are aborted immediately."
          >
            Cancel study
          </button>
        )}
        {isRunning && confirmingCancel && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Cancel this study?
            </span>
            <button
              type="button"
              onClick={doCancel}
              disabled={cancelling}
              className="text-xs font-semibold px-3 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-60"
            >
              {cancelling ? "Cancelling…" : "Yes, cancel"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingCancel(false)}
              disabled={cancelling}
              className="text-xs px-3 py-1.5 rounded-md text-slate-500 hover:text-ink dark:hover:text-slate-100"
            >
              Keep running
            </button>
          </div>
        )}
      </div>

      {/* (U13) Sample G — alchemical-morph holo loader.
          Mounted for the entire isRunning span (pending / preparing /
          running). Three.js scene continuously animates the λ
          ping-pong, ligand A→B morph, water drift, and replica
          exchange ladder. Stays on screen until the study reaches a
          terminal state — explicitly NOT gated on edge progress, so
          the user sees motion even during the long opaque MD stages.
          Pairs with the StageStepper above (real progress) and the
          Perturbation map below (real structure). */}
      {isRunning && (() => {
        // Build a friendly stage label for the loader's terminal row.
        // Prefer the running edge's sub-stage; fall back to the study
        // stage. Same humaniser as the stepper uses.
        const liveEdge = graph.edges.find((e) => e.status === "running");
        const rawStage = liveEdge?.stage ?? extractEdgeStage(graph.stage);
        const friendly = rawStage ? humaniseFepStage(rawStage) : null;
        return <FepHoloLoader graph={graph} stageLabel={friendly} />;
      })()}

      {/* (N1) Error banner — when the study has failed, show the
          persisted error_message from the runner. Without this, the
          page just says "Failed — see error message below" and the
          chemist has no actual error message to look at. The runner
          (run_study + run_study_safe) writes either a classified M5
          reason or a Python traceback tail (last 600 chars). */}
      {graph.status === "failed" && graph.error_message && (
        <div className="card bg-rose-50/80 dark:bg-rose-950/30 ring-1 ring-rose-300 dark:ring-rose-800">
          <div className="text-[10px] uppercase tracking-wider text-rose-700 dark:text-rose-300 font-semibold">
            Error
          </div>
          <pre className="mt-2 text-xs font-mono text-rose-900 dark:text-rose-200 whitespace-pre-wrap break-words leading-snug">
            {graph.error_message}
          </pre>
        </div>
      )}

      {/* (M13) Hit row with 2D structure preview. The chemist reads
          the molecule visually, not by parsing SMILES — RDKit-rendered
          SVG via /lookup/inspect-smiles. */}
      {hit && (
        <div className="card bg-slate-50/60 dark:bg-slate-800/40 ring-1 ring-slate-200 dark:ring-slate-700">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
            Hit (graph centre)
          </div>
          <div className="flex items-start gap-4 mt-2">
            <div className="shrink-0">
              <MoleculePreview smiles={hit.smiles} width={260} height={170} dark />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-base">{hit.name || "(unnamed)"}</div>
              <div className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate mt-1">{hit.smiles}</div>
            </div>
          </div>
        </div>
      )}

      {/* (M17) 2D perturbation map — the visual node-edge diagram that
          chemists associate with "FEP planning". Renders the hit at
          center with analogs distributed on a circle, edges colored
          by status, ΔΔG labels at each edge midpoint. Built as
          absolutely-positioned HTML nodes so MoleculePreview just
          works inside each node, with an SVG overlay for the edges. */}
      {hit && graph.nodes.length > 1 && (
        <PerturbationMap graph={graph} />
      )}

      {/* (M16) Protocol summary — what was actually simulated. The
          chemist looks here to verify protein force field, water model,
          sampling protocol, GPU cost projection. */}
      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3">
          Protocol
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 text-sm">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Protein FF</div>
            <div className="font-mono mt-0.5">{graph.forcefield_protein || "amber14sb"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Ligand FF</div>
            <div className="font-mono mt-0.5">{graph.forcefield_ligand || "openff-2.2.0"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Water</div>
            <div className="font-mono mt-0.5">{(graph.water_model || "tip3p").toUpperCase()}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Salt</div>
            <div className="font-mono mt-0.5">0.15 M NaCl</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">λ windows</div>
            <div className="font-mono mt-0.5 tabular-nums">{graph.n_lambda_windows ?? 12}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">ns / window</div>
            <div className="font-mono mt-0.5 tabular-nums">{graph.ns_per_window ?? 7}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">HREX</div>
            <div className="font-mono mt-0.5">{graph.hrex === false ? "off" : "on (every 1 ps)"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Topology</div>
            <div className="font-mono mt-0.5">{graph.network_topology || "radial_plus_mst"}</div>
          </div>
          {graph.estimated_usd_cost != null && graph.estimated_usd_cost > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Est. GPU cost</div>
              <div className="font-mono mt-0.5 tabular-nums">
                ${graph.estimated_usd_cost.toFixed(2)}
              </div>
              {/* (O12) Calibration note — the planner's per-edge GPU-hour
                  default (14h × $1.50/h) is the worst-case Schrödinger-spec
                  budget. Reality on this pod is OpenCL × Sage at ~1.3 GPU-h
                  / edge × $0.69/h ≈ $1/edge. The chemist needs both numbers
                  to plan a budget — the published quote AND the realistic
                  one based on smoke #3 data. Cost calibrator will replace
                  this hard-coded ratio once we have ≥10 runs to fit. */}
              <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                typical ~${Math.max(0.5, graph.estimated_usd_cost * 0.06).toFixed(2)}–${Math.max(1, graph.estimated_usd_cost * 0.12).toFixed(2)} actual (Sage / OpenCL)
              </div>
            </div>
          )}
          {graph.cycle_closure_rmsd != null && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Cycle-closure RMSD</div>
              <div className={`font-mono mt-0.5 tabular-nums font-bold ${
                graph.cycle_closure_rmsd < 0.5 ? "text-emerald-700 dark:text-emerald-400"
                : graph.cycle_closure_rmsd < 1.0 ? "text-amber-700 dark:text-amber-400"
                : "text-rose-700 dark:text-rose-400"
              }`}>
                {graph.cycle_closure_rmsd.toFixed(2)} kcal/mol
              </div>
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-snug">
          Free-energy perturbation with Hamiltonian Replica Exchange (HREX). HMR 3 amu, 4 fs timestep, 298.15 K Langevin (1/ps friction), 1.0 nm PME cutoff.
          Convergence thresholds: hysteresis ≤ 0.5 kcal/mol, MBAR 95% CI ≤ 0.4 kcal/mol.
        </p>
      </div>

      {/* (O4) Ranked analog table — only shown once at least one
          analog has a real ΔΔG value AND the study is past the
          preparing stage. Otherwise we'd show a table full of "—"
          placeholders next to "not converged" badges before a single
          edge has even started. Friendlier: hide the table during
          preparation, show a placeholder until results land. */}
      {sortedAnalogs.some((n) => n.ddg_to_hit_kcal_mol != null) ? (
      <div className="card overflow-hidden">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3">
          Analogs ranked by ΔΔG to hit
        </h2>
        <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50/50 dark:bg-amber-900/15 ring-1 ring-amber-200 dark:ring-amber-700/40 rounded px-2 py-1.5 mb-3">
          ⚠ ΔΔG values are PREDICTIONS with statistical error. The convergence flag is the load-bearing signal: only "ok" rows have a defensible ranking. "high_uncertainty" rows are noisy; "not_converged" rows should not be acted on.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              {/* (M13) Structure thumbnail column first — chemists scan
                  by visual molecule shape, not by name or SMILES string. */}
              <th className="py-2 pr-3" style={{ width: 150 }}>Structure</th>
              <th className="py-2 pr-4">Compound</th>
              <th className="py-2 pr-4 text-right">ΔΔG to hit</th>
              <th className="py-2 pr-4 text-right">95% CI</th>
              <th className="py-2 pr-4">Convergence</th>
            </tr>
          </thead>
          <tbody>
            {sortedAnalogs.map((n, i) => (
              <tr key={i} className="border-b border-slate-100 dark:border-slate-800 align-top">
                <td className="py-2 pr-3">
                  <MoleculePreview smiles={n.smiles} width={180} height={120} dark refSmiles={hit?.smiles} />
                </td>
                <td className="py-2 pr-4">
                  <div className="font-semibold">{n.name || `Analog ${i + 1}`}</div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-xs">{n.smiles}</div>
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {n.convergence_flag === "not_converged" || n.ddg_to_hit_kcal_mol == null ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <span className={`font-mono font-bold ${
                      (n.ddg_to_hit_kcal_mol ?? 0) < -0.5 ? "text-emerald-700 dark:text-emerald-400"
                      : (n.ddg_to_hit_kcal_mol ?? 0) > 0.5 ? "text-rose-700 dark:text-rose-400"
                      : "text-slate-600 dark:text-slate-300"
                    }`}>
                      {n.ddg_to_hit_kcal_mol > 0 ? "+" : ""}{n.ddg_to_hit_kcal_mol.toFixed(2)} kcal/mol
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {n.ddg_to_hit_uncertainty != null ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      ± {n.ddg_to_hit_uncertainty.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {n.convergence_flag === "ok" ? (
                    <span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 text-[10px]">✓ ok</span>
                  ) : n.convergence_flag === "high_uncertainty" ? (
                    <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[10px]">⚠ high uncertainty</span>
                  ) : (
                    <span className="badge bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 text-[10px]">✗ not converged</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sortedAnalogs.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">No analogs in this study.</p>
        )}
      </div>
      ) : (
        /* (O4) Pre-results placeholder — shown while the study is in
            preparing/running but no edge has converged yet. Friendlier
            than a table of placeholder dashes. */
        sortedAnalogs.length > 0 && (
          <div className="card text-center py-6">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              ΔΔG rankings will appear once edges converge
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {sortedAnalogs.length} analog{sortedAnalogs.length === 1 ? "" : "s"} queued.
              Each edge runs ~80–120 min on this pod; results table appears as soon as the first one passes the convergence threshold.
            </p>
          </div>
        )
      )}

      {/* Perturbation edges — expandable. */}
      <details className="card group">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center justify-between">
          <span>Edge details ({graph.edges.length} edge{graph.edges.length === 1 ? "" : "s"})</span>
          <span className="text-slate-400 group-open:hidden">▾ expand</span>
          <span className="text-slate-400 hidden group-open:inline">▴ collapse</span>
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pr-3">From → To</th>
                <th className="py-2 pr-3 text-right">LOMAP</th>
                <th className="py-2 pr-3 text-right">ΔΔG_bind</th>
                <th className="py-2 pr-3 text-right">CI</th>
                <th className="py-2 pr-3 text-right">Hysteresis</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {graph.edges.map((e, i) => {
                // (M13) Resolve compound IDs to chemist-readable names
                // via the nodes list (which has name + smiles for each).
                const fromNode = graph.nodes.find(
                  (n) => n.compound_id === e.from_compound_id,
                );
                const toNode = graph.nodes.find(
                  (n) => n.compound_id === e.to_compound_id,
                );
                return (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800 align-top">
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="shrink-0">
                          {fromNode?.smiles ? (
                            <MoleculePreview smiles={fromNode.smiles} width={110} height={70} dark refSmiles={toNode?.smiles} />
                          ) : (
                            <span className="font-mono text-slate-400">#{e.from_compound_id ?? "?"}</span>
                          )}
                        </div>
                        <span className="text-slate-400">→</span>
                        <div className="shrink-0">
                          {toNode?.smiles ? (
                            <MoleculePreview smiles={toNode.smiles} width={110} height={70} dark refSmiles={fromNode?.smiles} />
                          ) : (
                            <span className="font-mono text-slate-400">#{e.to_compound_id ?? "?"}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                        {(fromNode?.name || "?")} → {(toNode?.name || "?")}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{(e.lomap_score ?? 0).toFixed(2)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-mono">
                      {e.ddg_binding_kcal_mol != null ? `${e.ddg_binding_kcal_mol > 0 ? "+" : ""}${e.ddg_binding_kcal_mol.toFixed(2)}` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {e.ddg_uncertainty != null ? `± ${e.ddg_uncertainty.toFixed(2)}` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {e.hysteresis_kcal_mol != null ? e.hysteresis_kcal_mol.toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`badge text-[9px] uppercase ${
                        e.status === "ok" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                        : e.status === "failed" ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
                        : e.status === "running" ? "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
                        : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                      }`}>{e.status}</span>
                      {e.stage && e.status === "running" && (
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {e.stage}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}


/**
 * (M17) PerturbationMap — visual node-edge diagram of the FEP study.
 *
 * Layout: hit at center, analogs distributed on a circle around it.
 * Edges are drawn as SVG lines colored by status (gray pending,
 * violet running, green converged, red failed). Each edge midpoint
 * gets a small ΔΔG / LOMAP label.
 *
 * Built as HTML+SVG hybrid: HTML nodes carry MoleculePreview
 * components (which use React Query for SMILES → SVG); the SVG
 * overlay handles the edge lines + labels. Inset:0 + pointer-events
 * none keeps the edges from blocking clicks on the nodes.
 *
 * Chemists call this the "FEP planning map" — it's the iconic
 * visualization that Schrödinger's tool shows.
 */
function PerturbationMap({ graph }: { graph: FepStudyGraph }) {
  const hit = graph.nodes.find((n) => n.is_hit);
  const analogs = graph.nodes.filter((n) => !n.is_hit);
  if (!hit || analogs.length === 0) return null;

  // Layout constants. 600x420 viewport is wide enough for ~6 analogs
  // before they start crowding. Node tile is 130x110. Hit sits at the
  // center; analogs distributed on a circle of radius R.
  const W = 600;
  const H = 420;
  const cx = W / 2;
  const cy = H / 2;
  const R = analogs.length === 1 ? 110 : 140;
  const NW = 130;
  const NH = 110;

  // Compute node positions. Hit at center; analogs equally spaced
  // starting from the top (angle = -π/2).
  //
  // (O7) Special case for 1 analog: a single node placed at -π/2 lands
  // straight above the hit — vertical layout with masses of empty space
  // left + right. For n=1 we want a horizontal layout (hit on the left,
  // analog on the right). Start angle 0 instead of -π/2 does exactly
  // that. For n≥2 the ring layout starting at -π/2 (top) still works.
  const positions: Record<string, { x: number; y: number }> = {};
  positions[`${hit.compound_id ?? "hit"}`] = { x: cx, y: cy };
  const startAngle = analogs.length === 1 ? 0 : (-Math.PI / 2);
  analogs.forEach((n, i) => {
    const theta = startAngle + (2 * Math.PI * i) / Math.max(1, analogs.length);
    positions[`${n.compound_id ?? `analog${i}`}`] = {
      x: cx + R * Math.cos(theta),
      y: cy + R * Math.sin(theta),
    };
  });

  // Edge color by status — same vocabulary as the table.
  function edgeColor(status: string): string {
    if (status === "ok") return "#10b981";       // emerald-500
    if (status === "failed") return "#ef4444";   // red-500
    if (status === "running") return "#8b5cf6";  // violet-500
    return "#94a3b8";                            // slate-400 (pending/skipped)
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3">
        Perturbation map ({graph.edges.length} edge{graph.edges.length === 1 ? "" : "s"})
      </h2>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 leading-snug">
        Hit at centre, analogs on the ring. Each edge is one alchemical perturbation; colour shows status, label shows ΔΔG_binding or LOMAP score. Closed cycles let us cross-check internal consistency via cycle-closure RMSD.
      </p>
      <div
        className="relative mx-auto"
        style={{ width: W, maxWidth: "100%", aspectRatio: `${W} / ${H}` }}
      >
        {/* SVG layer: edge lines + labels. inset-0 + pointer-events
            none so the lines visually overlay the nodes without
            intercepting clicks. */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: "none" }}
        >
          {graph.edges.map((e, i) => {
            const from = positions[`${e.from_compound_id ?? ""}`];
            const to = positions[`${e.to_compound_id ?? ""}`];
            if (!from || !to) return null;
            const color = edgeColor(e.status);
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2;
            const label =
              e.ddg_binding_kcal_mol != null
                ? `${e.ddg_binding_kcal_mol > 0 ? "+" : ""}${e.ddg_binding_kcal_mol.toFixed(2)}`
                : e.lomap_score != null
                ? `LOMAP ${e.lomap_score.toFixed(2)}`
                : "—";
            return (
              <g key={i}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={color}
                  strokeWidth={e.status === "ok" ? 3 : 2}
                  strokeDasharray={e.status === "pending" ? "6 4" : undefined}
                />
                <rect
                  x={mx - 28}
                  y={my - 9}
                  width={56}
                  height={18}
                  rx={9}
                  fill="rgba(15, 23, 42, 0.85)"
                  stroke={color}
                  strokeWidth={1}
                />
                <text
                  x={mx}
                  y={my + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fill="#e2e8f0"
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* HTML node layer. Absolutely positioned tiles with the
            MoleculePreview inside each. Sits on top of the SVG so
            structure thumbnails are clearly readable. */}
        {graph.nodes.map((n, i) => {
          const key = `${n.compound_id ?? (n.is_hit ? "hit" : `analog${i}`)}`;
          const pos = positions[key];
          if (!pos) return null;
          const isHit = n.is_hit;
          const conv = n.convergence_flag;
          const ringClass = isHit
            ? "ring-2 ring-violet-500"
            : conv === "ok"
            ? "ring-2 ring-emerald-500"
            : conv === "high_uncertainty"
            ? "ring-2 ring-amber-500"
            : conv === "not_converged"
            ? "ring-2 ring-rose-500"
            : "ring-1 ring-slate-400 dark:ring-slate-600";
          return (
            <div
              key={key}
              className={`absolute rounded-lg bg-slate-900 ${ringClass} p-1 shadow-md`}
              style={{
                width: NW,
                height: NH,
                left: pos.x - NW / 2,
                top: pos.y - NH / 2,
              }}
              title={`${n.name || "(unnamed)"} — ${n.smiles}`}
            >
              <div className="flex items-center justify-center">
                <MoleculePreview smiles={n.smiles} width={NW - 8} height={NH - 26} dark refSmiles={isHit ? undefined : hit?.smiles} />
              </div>
              <div className="text-[10px] font-bold text-center mt-0.5 truncate px-1">
                {n.name || (isHit ? "Hit" : `Analog ${i}`)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-violet-500 ring-2 ring-violet-300/40" /> Hit
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-emerald-500" /> converged
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-violet-500" /> running
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-slate-400 dashed-line" style={{borderTop: "1px dashed currentColor", background: "transparent"}} /> pending
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-rose-500" /> failed
        </span>
      </div>
    </div>
  );
}
