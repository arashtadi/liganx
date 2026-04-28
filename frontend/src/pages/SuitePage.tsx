import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { api, type Job } from "../api";
import { ArrowRight, Spinner, Target } from "../components/Icons";

/**
 * Suite page — shown after submitting a multi-target "selectivity mode" job
 * from the New Job page. The route is `/suite?ids=A,B,C` where each ID is a
 * job share_id. We poll all jobs in parallel and aggregate the WT scores
 * into a compound × kinase matrix.
 *
 * Why a separate page and not a multi-job version of JobPage:
 *   - JobPage is built for a single PDB context (pose viewer, mutation
 *     overlay, etc.) which doesn't generalize cleanly to multiple receptors.
 *   - The selectivity question is "which kinase does this hit hardest?" —
 *     a sparse compound × kinase matrix answers that better than a stack
 *     of single-PDB matrices.
 *   - Each child job is still independently shareable / drillable via its
 *     own URL — clicking a kinase header takes you to the per-kinase view.
 */
export default function SuitePage() {
  const [params] = useSearchParams();
  const idsParam = params.get("ids") ?? "";
  const ids = useMemo(
    () => idsParam.split(",").map((s) => s.trim()).filter(Boolean),
    [idsParam],
  );

  // Parallel polling — react-query handles refetch + caching per job.
  // We refetch every 4 s while ANY job is still running, then stop.
  // react-query v5 passes the Query object (not the data) to refetchInterval,
  // so we read state.data off it.
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["job", id],
      queryFn: () => api.getJob(id),
      // 4s polling matches JobPage's cadence and is fast enough that the
      // user sees results stream in without hammering the API.
      refetchInterval: (q: { state: { data?: Job } }) => {
        const d = q.state.data;
        return d && (d.status === "completed" || d.status === "failed") ? false : 4000;
      },
    })),
  });

  const jobs: (Job | null)[] = queries.map((q) => (q.data as Job | undefined) ?? null);
  const anyLoading = queries.some((q) => q.isPending);
  const anyRunning = jobs.some((j) => j && (j.status === "running" || j.status === "pending"));
  const allDone = jobs.every((j) => j && (j.status === "completed" || j.status === "failed"));

  // Build the compound list from whichever job has loaded first — by
  // construction (selectivity mode) they all share the same compound list.
  const firstLoaded = jobs.find((j) => j != null);
  const compounds = firstLoaded?.compounds ?? [];

  // Failure state — no IDs means the user landed here directly without a query string.
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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header — kinase count + status pill */}
      <div className="panel p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-delta-600 dark:text-delta-400 flex items-center gap-1.5">
              <Target size={12} /> Selectivity suite
            </div>
            <h1 className="text-2xl font-bold text-ink dark:text-white mt-1">
              {ids.length} kinase{ids.length === 1 ? "" : "s"}
              {compounds.length > 0 && (
                <span className="text-slate-400 dark:text-slate-500 font-normal">
                  {" "}× {compounds.length} compound{compounds.length === 1 ? "" : "s"}
                </span>
              )}
            </h1>
            <p className="muted mt-1 text-sm">
              Each compound docked against the wild-type structure of every selected kinase.
              Lower scores = stronger predicted binding.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {anyRunning ? (
              <span className="badge bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800/40">
                <Spinner size={11} /> Running ({jobs.filter((j) => j && j.status === "completed").length}/{ids.length} done)
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

      {/* Selectivity matrix — compounds rows × kinases columns */}
      <div className="panel overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-ink dark:text-slate-100">Cross-kinase scoreboard</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Vina score (kcal/mol) · click any kinase header to see the full per-kinase result.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-y border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
                <th className="text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider px-5 py-2.5 w-1/4">
                  Compound
                </th>
                {jobs.map((j, i) => {
                  const sid = ids[i];
                  return (
                    <th
                      key={sid}
                      className="text-right text-xs font-semibold text-ink dark:text-slate-100 uppercase tracking-wider px-4 py-2.5"
                    >
                      <Link
                        to={`/jobs/${sid}`}
                        className="hover:underline inline-flex items-center gap-1"
                        title={`Open the per-kinase result page for ${j?.pdb_id ?? sid}`}
                      >
                        {j?.pdb_id ?? "…"}
                        <ArrowRight size={10} />
                      </Link>
                      <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400 normal-case mt-0.5">
                        {j?.uniprot_id ?? ""}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {compounds.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-5 py-3 align-top">
                    <div className="font-semibold text-ink dark:text-slate-100">{c.name ?? "—"}</div>
                    <code className="block text-[10px] font-mono text-slate-500 dark:text-slate-500 truncate max-w-[220px] mt-0.5">
                      {c.smiles}
                    </code>
                  </td>
                  {jobs.map((j, i) => {
                    if (!j) {
                      return (
                        <td key={ids[i]} className="px-4 py-3 text-right text-slate-400">
                          <Spinner size={11} />
                        </td>
                      );
                    }
                    if (j.status === "failed") {
                      return (
                        <td key={ids[i]} className="px-4 py-3 text-right text-rose-700 dark:text-rose-400 text-xs">
                          failed
                        </td>
                      );
                    }
                    // Find the WT result for this compound on this kinase
                    const r = j.results?.find((x) => x.compound_id === c.id && x.variant === "WT");
                    if (!r) {
                      return (
                        <td key={ids[i]} className="px-4 py-3 text-right text-slate-400">
                          {j.status === "running" || j.status === "pending" ? <Spinner size={11} /> : "—"}
                        </td>
                      );
                    }
                    return (
                      <td key={ids[i]} className="px-4 py-3 text-right">
                        <div className="font-mono tabular-nums font-semibold text-ink dark:text-slate-100">
                          {r.best_score.toFixed(2)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {compounds.length === 0 && anyLoading && (
                <tr>
                  <td colSpan={ids.length + 1} className="text-center py-12 text-slate-500 dark:text-slate-400">
                    <Spinner size={16} className="mr-2" /> Waiting for the first job to start…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-job links footer — handy when something fails and the user
          wants to check the individual error message */}
      <div className="panel p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          Individual jobs in this suite
        </h3>
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-sm">
          {jobs.map((j, i) => (
            <li key={ids[i]}>
              <Link
                to={`/jobs/${ids[i]}`}
                className="block px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 hover:border-delta-400 dark:hover:border-delta-500 transition-colors"
              >
                <div className="text-xs text-slate-500 dark:text-slate-400">{ids[i].slice(0, 8)}…</div>
                <div className="font-mono font-semibold text-ink dark:text-slate-100 mt-0.5">
                  {j?.pdb_id ?? "…"}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {j?.status ?? "loading"}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
