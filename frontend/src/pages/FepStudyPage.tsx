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
import { usePageMeta } from "../lib/usePageMeta";

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
      .finally(() => setCancelling(false));
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
        return `Edge ${edgeCounts.ok + 1}/${edgeCounts.total} — ${stageLabel}${pctSuffix} · ${edgeCounts.ok} done · ${edgeCounts.pending} queued`;
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

  // (J13) Elapsed wall time + a coarse "estimated remaining" so the
  // user has something better than "is it stuck?" while waiting.
  //
  // The estimate is intentionally simple: each edge costs roughly
  //   (n_windows × ns_per_window × 2 legs × ~60 sec/ns of sampling)
  //   + ~12 min fixed setup (PDBFixer + 2× antechamber + force field
  //     assignment + solvation + equilibration)
  // The "60 sec/ns" comes from ~300 ns/day on a 4090. Setup cost
  // dominates for the short-protocol tests we do at 4×50ps.
  //
  // J12 (async polling) will replace this with a real sub-stage
  // progress bar driven by openmm reporters.
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
  const createdAtMs = graph.created_at ? Date.parse(graph.created_at) : null;
  const elapsedSec = createdAtMs ? Math.max(0, (now - createdAtMs) / 1000) : null;
  const nWin = graph.n_lambda_windows ?? 12;
  const nsWin = graph.ns_per_window ?? 7.0;
  const perEdgeSetupSec = 12 * 60;
  const perEdgeSamplingSec = nWin * nsWin * 2 * 60;
  const perEdgeBaselineSec = perEdgeSetupSec + perEdgeSamplingSec;
  const edgesRemaining = edgeCounts.pending + edgeCounts.running;
  // For the running edge we have started_at — use it to subtract
  // already-elapsed time from the baseline so the ETA shrinks as
  // the edge progresses.
  const runningEdge = graph.edges.find((e) => e.status === "running");
  const runningEdgeStartedMs =
    runningEdge?.started_at ? Date.parse(runningEdge.started_at) : null;
  const runningEdgeElapsedSec =
    runningEdgeStartedMs ? Math.max(0, (now - runningEdgeStartedMs) / 1000) : 0;
  const estRemainingSec =
    edgesRemaining > 0
      ? Math.max(
          0,
          edgesRemaining * perEdgeBaselineSec - runningEdgeElapsedSec,
        )
      : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {/* Status banner. */}
      <div className="card flex items-start justify-between flex-wrap gap-3">
        <div className="flex-1 min-w-[300px]">
          <h1 className="text-2xl font-bold text-ink dark:text-slate-100 flex items-center gap-2">
            FEP+ study
            <span className={`badge text-[10px] uppercase tracking-wider font-bold ${
              graph.status === "completed" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
              : graph.status === "failed" ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
              : graph.status === "cancelled" ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
              : "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
            }`}>
              {graph.status}
            </span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
            {graph.share_id}
            {graph.stage && <> · {graph.stage}</>}
          </p>
          {/* Progress line — plain-English summary of where the
              study is. Replaces a bare 'PENDING' badge with a
              readable account of what the runner is doing right
              now and how many edges remain. */}
          <p className="text-sm text-slate-700 dark:text-slate-200 mt-2">
            {friendlyStatusLine}
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
                  <div
                    className="h-full bg-violet-500 dark:bg-violet-400 animate-pulse"
                    style={{ width: `${(100 * edgeCounts.running) / edgeCounts.total}%` }}
                    title={`${edgeCounts.running} running`}
                  />
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
              {edgesRemaining > 0 && estRemainingSec > 0 && (
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
                    coarse estimate — mostly setup time per edge
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
        {isRunning && (
          <button
            type="button"
            onClick={doCancel}
            disabled={cancelling}
            className="btn-secondary"
          >
            {cancelling ? "Cancelling…" : "Cancel study"}
          </button>
        )}
      </div>

      {/* Hit row. */}
      {hit && (
        <div className="card bg-slate-50/60 dark:bg-slate-800/40 ring-1 ring-slate-200 dark:ring-slate-700">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
            Hit (graph centre)
          </div>
          <div className="font-bold text-base mt-1">{hit.name || "(unnamed)"}</div>
          <div className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate">{hit.smiles}</div>
        </div>
      )}

      {/* Ranked analog table. */}
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
              <th className="py-2 pr-4">Compound</th>
              <th className="py-2 pr-4 text-right">ΔΔG to hit</th>
              <th className="py-2 pr-4 text-right">95% CI</th>
              <th className="py-2 pr-4">Convergence</th>
            </tr>
          </thead>
          <tbody>
            {sortedAnalogs.map((n, i) => (
              <tr key={i} className="border-b border-slate-100 dark:border-slate-800 align-top">
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

      {/* Perturbation edges — expandable. */}
      <details className="card group">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center justify-between">
          <span>Perturbation graph ({graph.edges.length} edges)</span>
          <span className="text-slate-400 group-open:hidden">▾ expand</span>
          <span className="text-slate-400 hidden group-open:inline">▴ collapse</span>
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pr-3">From</th>
                <th className="py-2 pr-3">To</th>
                <th className="py-2 pr-3 text-right">LOMAP</th>
                <th className="py-2 pr-3 text-right">ΔΔG_bind</th>
                <th className="py-2 pr-3 text-right">CI</th>
                <th className="py-2 pr-3 text-right">Hysteresis</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {graph.edges.map((e, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-3 font-mono">#{e.from_compound_id ?? "?"}</td>
                  <td className="py-2 pr-3 font-mono">#{e.to_compound_id ?? "?"}</td>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
