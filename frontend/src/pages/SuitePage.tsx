import { useMemo } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { api, type Job, type CatalogTarget } from "../api";
import { Spinner, Target } from "../components/Icons";
import SelectivityMatrix from "../components/SelectivityMatrix";

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
  const navigate = useNavigate();
  const idsParam = params.get("ids") ?? "";
  const ids = useMemo(
    () => idsParam.split(",").map((s) => s.trim()).filter(Boolean),
    [idsParam],
  );

  // Parallel polling — react-query handles refetch + caching per job.
  // We refetch every 4 s while ANY job is still running, then stop.
  // react-query v5 passes the Query object (not the data) to refetchInterval.
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["job", id],
      queryFn: () => api.getJob(id),
      refetchInterval: (q: { state: { data?: Job } }) => {
        const d = q.state.data;
        return d && (d.status === "completed" || d.status === "failed") ? false : 4000;
      },
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
              Each compound docked against every selected target. Each kinase shows its full
              WT-vs-mutant matrix below; click any mutant cell to drill into the pose.
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

      {/* Per-kinase matrices — one stacked panel per child job. Each panel
          contains the same SelectivityMatrix component used on the single-
          job page, so users get the same affordances (sort, CSV, cell
          drilldown to PoseDetail, "outside pocket" badging) here. */}
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
                onPick navigates to the per-job pose detail because the suite
                page itself doesn't host the 3D viewer. */}
            {j && (j.status === "running" || j.status === "completed") && (j.results?.length ?? 0) > 0 && (
              <SelectivityMatrix
                compounds={j.compounds}
                mutations={(j.mutations ?? []) as string[]}
                results={j.results}
                isStreaming={j.status === "running"}
                mutationInfo={mutationInfo}
                onPick={(pick) => {
                  // Drill into the standalone job page with the chosen cell
                  // pinned via the existing ?cells= subset-share mechanism,
                  // so the user lands directly on that pose detail.
                  navigate(`/jobs/${sid}?cells=${encodeURIComponent(`${pick.compound.id}.${pick.variant}`)}`);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
