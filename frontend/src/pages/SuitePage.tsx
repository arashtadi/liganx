import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { api, type Job, type CatalogTarget } from "../api";
import { Close, Spinner, Target } from "../components/Icons";
import SelectivityMatrix from "../components/SelectivityMatrix";
import HeroBanner from "../components/HeroBanner";
import PoseDetail from "../components/PoseDetail";
import { Insights } from "./JobPage";
import { jobPollingInterval } from "../lib/jobPolling";

/** Active pose for the in-page modal. We track the cell COORDINATES
 *  (jobIdx + compoundId + variant) rather than a frozen snapshot of the
 *  pick, so that when validation completes after the modal opens —
 *  ProLIF contacts and the 2D interaction map land 5–30 s after Vina —
 *  the modal automatically updates with the new data instead of showing
 *  stale pre-validation state. The fresh pick is derived from the live
 *  job.results on every render. */
interface ActivePose {
  jobIdx: number;
  compoundId: number;
  variant: string;
}

/**
 * Suite page — shown after submitting a multi-target "selectivity mode" job
 * from the New Job page. The route is `/suite?ids=A,B,C` where each ID is a
 * job share_id.
 *
 * Design: instead of a single condensed scoreboard that hides per-mutation
 * detail behind clicks, we render the FULL SelectivityMatrix for each
 * kinase stacked on one page. The user sees:
 *
 *   [kinase A header]
 *   [compound × WT/mutation matrix for kinase A]
 *
 *   [kinase B header]
 *   [compound × WT/mutation matrix for kinase B]
 *
 *   ...
 *
 * Why stacked instead of merged:
 *   - Each kinase has its own pocket box, ProLIF contacts, and (potentially)
 *     a different mutation set. Trying to merge into one wide matrix makes
 *     comparing wt-vs-mutant-within-a-kinase visually impossible.
 *   - The single-job SelectivityMatrix already handles cell drilldown,
 *     CSV export, sorting, "outside pocket" badging, etc. Reusing it gives
 *     us all that for free per kinase.
 *   - Compound IDs differ across child jobs (each job re-creates Compound
 *     rows in the DB even when SMILES is identical). Rendering per-job
 *     matrices means each matrix uses its own compound_id space — no
 *     cross-job ID confusion.
 */
export default function SuitePage() {
  const [params] = useSearchParams();
  const idsParam = params.get("ids") ?? "";

  // Active cell driving the sticky detail rail. Replaces the earlier
  // modal-popup design: clicking a cell now updates the right-side panel
  // in place instead of opening a fullscreen overlay. Cell coords (not
  // a frozen pick snapshot) so when ProLIF/PoseBusters validation lands
  // 5–30s after Vina, the rail picks up the new data automatically on
  // the next poll. Null = no cell selected → rail shows an empty state.
  const [activePose, setActivePose] = useState<ActivePose | null>(null);
  const ids = useMemo(
    () => idsParam.split(",").map((s) => s.trim()).filter(Boolean),
    [idsParam],
  );

  // Parallel polling — react-query handles refetch + caching per job.
  // We refetch every 4 s while ANY job is still running, then stop.
  // react-query v5 passes the Query object (not the data) to refetchInterval.
  // Polling continues past status=completed until per-cell validation
  // (ProLIF 2D map / PoseBusters / strain) has populated `result.extra`,
  // because the backend flips to COMPLETED *before* validation lands.
  // See lib/jobPolling for the full policy.
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["job", id],
      queryFn: () => api.getJob(id),
      refetchInterval: (q: { state: { data?: Job } }) =>
        jobPollingInterval(q.state.data, 4000),
    })),
  });

  // Catalog so we can show real kinase names + mutation metadata in the
  // per-matrix headers (instead of just PDB codes).
  const { data: catalog } = useQueries({
    queries: [{ queryKey: ["catalog"], queryFn: api.catalog }],
    combine: (results) => ({ data: results[0]?.data as CatalogTarget[] | undefined }),
  });

  const jobs: (Job | null)[] = queries.map((q) => (q.data as Job | undefined) ?? null);
  const anyLoading = queries.some((q) => q.isPending);
  const anyRunning = jobs.some((j) => j && (j.status === "running" || j.status === "pending"));
  const allDone = jobs.every((j) => j && (j.status === "completed" || j.status === "failed"));

  // Empty-IDs landing — handles direct navigation without a query string.
  if (ids.length === 0) {
    return (
      <div className="card max-w-xl mx-auto text-center">
        <div className="text-5xl mb-3">⚡</div>
        <h1 className="text-2xl font-bold text-ink dark:text-white">No selectivity suite specified</h1>
        <p className="muted mt-2">
          Suite URLs look like <code className="font-mono text-xs">/suite?ids=A,B,C</code>.
          Run a multi-target job from{" "}
          <Link to="/new" className="text-delta-700 dark:text-delta-400 underline">New job</Link>{" "}
          to land here automatically.
        </p>
      </div>
    );
  }

  const completedCount = jobs.filter((j) => j && j.status === "completed").length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Suite header — at-a-glance status across all child jobs */}
      <div className="panel p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-delta-600 dark:text-delta-400 flex items-center gap-1.5">
              <Target size={12} /> Selectivity suite
            </div>
            <h1 className="text-2xl font-bold text-ink dark:text-white mt-1">
              {ids.length} target{ids.length === 1 ? "" : "s"}
              {jobs[0]?.compounds && jobs[0].compounds.length > 0 && (
                <span className="text-slate-400 dark:text-slate-500 font-normal">
                  {" "}× {jobs[0].compounds.length} compound{jobs[0].compounds.length === 1 ? "" : "s"}
                </span>
              )}
            </h1>
            <p className="muted mt-1 text-sm">
              Each compound docked against every selected target. Click any cell — the
              detail rail on the right updates in place without leaving the page.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {anyRunning ? (
              <span className="badge bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800/40">
                <Spinner size={11} /> Running ({completedCount}/{ids.length} done)
              </span>
            ) : allDone ? (
              <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800/40">
                ● Completed
              </span>
            ) : anyLoading ? (
              <span className="badge bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600">
                <Spinner size={11} /> Loading
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Two-column working area:
            • Left: matrices stack normally and scroll with the page.
            • Right: a sticky rail that shows the active cell's full
              detail (3D viewer + PoseDetail + Insights). Updates in
              place when the user clicks a different cell — no popup.
          Below the lg breakpoint the rail stacks BELOW the matrices
          (no sticky), since two columns would crush both on mobile. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
      {jobs.map((j, i) => {
        const sid = ids[i];
        const catalogEntry = catalog?.find(
          (t) => j != null && t.pdb_id.toUpperCase() === j.pdb_id.toUpperCase(),
        );
        const mutationInfo = catalogEntry
          ? Object.fromEntries(catalogEntry.mutations.map((m) => [m.code, m]))
          : undefined;

        return (
          <div key={sid} className="panel overflow-hidden">
            {/* Per-kinase header — title + status pill + link to the
                standalone job page (so users CAN navigate there for the
                3D pose viewer if they want, but don't have to to see the
                cells). */}
            <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 flex-wrap border-b border-slate-100 dark:border-slate-800">
              <div>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-lg font-semibold text-ink dark:text-slate-100 font-mono">
                    {j?.pdb_id ?? "…"}
                  </h2>
                  {j && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-normal">
                      chain {j.chain}
                    </span>
                  )}
                  {catalogEntry && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      · {catalogEntry.name}
                    </span>
                  )}
                </div>
                {j?.uniprot_id && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                    {j.uniprot_id}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!j ? (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    <Spinner size={11} className="inline mr-1" />Loading
                  </span>
                ) : j.status === "completed" ? (
                  <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800/40 text-[10px]">
                    ● Completed
                  </span>
                ) : j.status === "failed" ? (
                  <span className="badge bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-800/40 text-[10px]">
                    Failed
                  </span>
                ) : (
                  <span className="badge bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800/40 text-[10px]">
                    <Spinner size={10} /> {j.status}
                  </span>
                )}
                <Link
                  to={`/jobs/${sid}`}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-delta-600 dark:hover:text-delta-400 underline"
                  title="Open the standalone job page (3D viewer, pose download, etc.)"
                >
                  Open
                </Link>
              </div>
            </div>

            {/* Failure case — show error message */}
            {j && j.status === "failed" && (
              <div className="p-5 text-sm text-rose-700 dark:text-rose-400">
                {j.error_message || "Job failed without an error message."}
              </div>
            )}

            {/* Loading or no-results-yet — show a skeleton */}
            {(!j || (j.status !== "completed" && j.status !== "failed" && (j.results?.length ?? 0) === 0)) && (
              <div className="p-12 text-center text-slate-400 dark:text-slate-500 text-sm">
                <Spinner size={16} className="inline mr-2" />
                Waiting for first cell to dock…
              </div>
            )}

            {/* Real matrix — same component as the single-job page. Cells
                stream in as results arrive (isStreaming when not yet done).
                onPick now opens the in-page pose modal (instead of
                navigating away) so the user keeps all the other matrices
                in view. The 'Open' link in the panel header is still
                available if they want the standalone job page. */}
            {j && (j.status === "running" || j.status === "completed") && (j.results?.length ?? 0) > 0 && (
              <SelectivityMatrix
                compounds={j.compounds}
                mutations={(j.mutations ?? []) as string[]}
                results={j.results}
                isStreaming={j.status === "running"}
                mutationInfo={mutationInfo}
                currentPickKey={
                  activePose && activePose.jobIdx === i
                    ? `${activePose.compoundId}.${activePose.variant}`
                    : null
                }
                onPick={(pick) => setActivePose({
                  jobIdx: i,
                  compoundId: pick.compound.id,
                  variant: pick.variant,
                })}
              />
            )}
          </div>
        );
      })}

        </div>

        {/* Sticky detail rail. Above the lg breakpoint it pins to the
            top of the viewport and updates whenever the user clicks a
            cell anywhere in the matrix list. Below lg it just stacks
            under the matrix column (no sticky — too cramped on mobile). */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <DetailRail
            activePose={activePose}
            jobs={jobs}
            ids={ids}
            catalog={catalog}
            onClear={() => setActivePose(null)}
          />
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Detail rail — replaces the old cell-click modal                            */
/* -------------------------------------------------------------------------- */

interface DetailRailProps {
  activePose: ActivePose | null;
  jobs: (Job | null)[];
  ids: string[];
  catalog: CatalogTarget[] | undefined;
  onClear: () => void;
}

/** Right-rail detail panel for the suite. When a cell is selected,
 *  renders the same 3D viewer + PoseDetail + Insights you'd see on a
 *  standalone JobPage. When nothing is selected, renders a friendly
 *  empty state pointing the user at the matrix.
 *
 *  The rail derives its content from `activePose` (cell coords) on
 *  every render, looking up the *live* result row from `jobs[i].results`.
 *  This is essential because per-cell validation (ProLIF, PoseBusters)
 *  lands 5–30s after Vina — using a frozen pick snapshot would freeze
 *  the rail with `extra: null` and the 2D map would never appear. The
 *  jobPolling helper drives the refetches so this lookup will become
 *  populated automatically without any user action. */
function DetailRail({ activePose, jobs, ids, catalog, onClear }: DetailRailProps) {
  // Inner-scroll cap: rail content can be tall (3D viewer + long PoseDetail
  // + Insights). Without a cap the rail would overflow the viewport, sticky
  // would still pin the TOP, and the bottom would be unreachable. With this
  // cap the rail itself scrolls when its content exceeds the viewport.
  const innerStyle = { maxHeight: "calc(100vh - 6rem)" } as const;

  if (!activePose) {
    return (
      <div
        className="panel p-6 flex flex-col items-center justify-center text-center overflow-y-auto"
        style={innerStyle}
      >
        <div className="w-12 h-12 rounded-full bg-delta-50 dark:bg-delta-900/30 flex items-center justify-center text-delta-600 dark:text-delta-300 text-xl mb-3">
          ←
        </div>
        <h3 className="text-base font-semibold text-ink dark:text-slate-100">
          Click any cell
        </h3>
        <p className="muted text-sm mt-2 max-w-xs">
          The 3D pose, ProLIF contacts, 2D interaction map, and drug-likeness
          for the selected compound × variant land here.
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-3">
          The rail follows you as you scroll.
        </p>
      </div>
    );
  }

  const j = jobs[activePose.jobIdx];
  if (!j) {
    return (
      <div className="panel p-6" style={innerStyle}>
        <p className="muted text-sm">Loading job…</p>
      </div>
    );
  }
  const sid = ids[activePose.jobIdx];
  const target = catalog?.find(
    (t) => t.pdb_id.toUpperCase() === j.pdb_id.toUpperCase(),
  );

  // Live pick lookup — see the comment block above. ProLIF validation lands
  // asynchronously, so we re-derive the pick from current results on every
  // render rather than caching it at click time.
  const liveCompound = j.compounds.find((c) => c.id === activePose.compoundId);
  const liveResult = j.results.find(
    (r) => r.compound_id === activePose.compoundId && r.variant === activePose.variant,
  );
  const wtResult = j.results.find(
    (r) => r.compound_id === activePose.compoundId && r.variant === "WT",
  );
  if (!liveCompound || !liveResult) {
    return (
      <div className="panel p-6" style={innerStyle}>
        <p className="muted text-sm">
          Waiting for this cell's result…
        </p>
      </div>
    );
  }
  const livePick = {
    compound: liveCompound,
    variant: activePose.variant,
    score: liveResult.best_score,
    deltaWt:
      activePose.variant === "WT" || !wtResult
        ? null
        : liveResult.best_score - wtResult.best_score,
    extra: liveResult.extra ?? null,
  };
  const compoundLabel = liveCompound.name ?? `Compound #${liveCompound.id}`;

  return (
    <div
      className="panel flex flex-col overflow-hidden"
      style={innerStyle}
    >
      {/* Rail header — compact summary of which cell is showing, plus
          'Open standalone' (new window) and a × button to clear back
          to the empty state without losing scroll position. */}
      <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="font-semibold text-ink dark:text-slate-100 truncate">
              {compoundLabel}
            </span>
            <span className="text-slate-400 dark:text-slate-500">×</span>
            <span className="font-mono text-sm font-semibold text-delta-700 dark:text-delta-300">
              {livePick.variant}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {j.pdb_id} chain {j.chain}{target ? ` · ${target.name}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Open the same cell in a popup window — useful when the
              user wants the wider standalone JobPage layout (with the
              full-width matrix + sticky 3D banner) without losing the
              suite they're working from. popup + width/height forces a
              real window in Chromium browsers (vs. a tab). */}
          <button
            type="button"
            onClick={() => {
              const url = `/jobs/${sid}?cells=${encodeURIComponent(`${livePick.compound.id}.${livePick.variant}`)}`;
              window.open(
                url,
                "_blank",
                "noopener,noreferrer,popup=yes,width=1400,height=900",
              );
            }}
            className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-delta-600 dark:hover:text-delta-400 underline whitespace-nowrap"
            title="Open this cell in a new window"
          >
            Open ↗
          </button>
          <button
            onClick={onClear}
            className="text-slate-400 hover:text-ink dark:hover:text-slate-100 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label="Clear selection"
            title="Clear selection"
          >
            <Close size={14} />
          </button>
        </div>
      </header>

      {/* Scrollable rail body. The 3D viewer goes first so it stays
          near the top — the most important visual when scanning poses.
          PoseDetail + Insights flow underneath. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4 space-y-4">
        <HeroBanner
          pick={livePick}
          pdbId={j.pdb_id}
          chain={j.chain}
          pocketCenter={target?.pocket.center}
          jobId={j.share_id || j.id}
        />
        <PoseDetail
          pick={livePick}
          pdbId={j.pdb_id}
          chain={j.chain}
          pocketCenter={target?.pocket.center}
          jobId={j.share_id || j.id}
          onClose={onClear}
        />
        {j.status === "completed" && (
          <Insights job={j} pick={livePick} />
        )}
      </div>
    </div>
  );
}
