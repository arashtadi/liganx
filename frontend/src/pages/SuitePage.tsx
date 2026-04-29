import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { api, type Job, type CatalogTarget } from "../api";
import { Close, Spinner, Target } from "../components/Icons";
import SelectivityMatrix from "../components/SelectivityMatrix";
import HeroBanner from "../components/HeroBanner";
import PoseDetail from "../components/PoseDetail";
import { Insights } from "./JobPage";

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

  // Active pose for the in-page modal. Replaces the previous behavior of
  // navigating away to /jobs/{shareId}?cells=... — that yanked the user
  // off the suite page and lost the multi-target context. Now clicking a
  // cell opens an overlay with the same pose-detail content (3D viewer
  // + drug-likeness + interpretation) without leaving the page.
  const [activePose, setActivePose] = useState<ActivePose | null>(null);
  useEffect(() => {
    if (!activePose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActivePose(null); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [activePose]);
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

      {/* In-page pose modal. Composes the same HeroBanner (3D viewer +
          score metrics) and PoseDetail (drug-likeness, ProLIF contacts,
          interpretation, 2D map) used on the standalone JobPage, just
          inside an overlay so the multi-target matrices stay visible
          underneath. Backdrop click / Esc / X all dismiss back to the
          suite. Rendered via portal so the overlay escapes any parent
          stacking context (the per-kinase panels create their own). */}
      {activePose && (() => {
        const j = jobs[activePose.jobIdx];
        if (!j) return null;
        const sid = ids[activePose.jobIdx];
        const target = catalog?.find(
          (t) => t.pdb_id.toUpperCase() === j.pdb_id.toUpperCase(),
        );
        // Derive a LIVE pick from current job results — not a frozen
        // snapshot from click time. ProLIF validation finishes ASYNC so
        // contacts + 2D map data lands in the result row 5–30 s after
        // Vina; without this lookup the modal kept showing the pre-
        // validation row and the 2D map / contacts never appeared.
        const liveCompound = j.compounds.find((c) => c.id === activePose.compoundId);
        const liveResult = j.results.find(
          (r) => r.compound_id === activePose.compoundId && r.variant === activePose.variant,
        );
        const wtResult = j.results.find(
          (r) => r.compound_id === activePose.compoundId && r.variant === "WT",
        );
        if (!liveCompound || !liveResult) return null;
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
        return createPortal(
          // Outer overlay — flex-center, NO scroll. Earlier the overlay
          // had its own overflow-y-auto which competed with the inner
          // body's scroll, so wheel events sometimes hit the wrong
          // container and "scrolling broke". Single-scrollable design:
          // overlay = backdrop + click-to-dismiss, inner body = the
          // only scrollable region.
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-6 bg-ink/80 backdrop-blur-sm"
            onClick={() => setActivePose(null)}
          >
            <div
              className="bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 rounded-2xl shadow-2xl w-full max-w-7xl flex flex-col overflow-hidden"
              style={{ maxHeight: "min(96vh, 1200px)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0 bg-white dark:bg-slate-900">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-base sm:text-lg font-semibold text-ink dark:text-slate-100 truncate">
                      {compoundLabel}
                    </span>
                    <span className="text-slate-400 dark:text-slate-500">×</span>
                    <span className="font-mono text-base sm:text-lg font-semibold text-delta-700 dark:text-delta-300">
                      {livePick.variant}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {j.pdb_id} chain {j.chain}{target ? ` · ${target.name}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Open in a NEW WINDOW (not just a new tab) so the
                      suite page with its other target matrices stays
                      visible alongside the standalone view. We use an
                      explicit window.open with the `popup` feature
                      string and width/height — this is the only way to
                      force most modern browsers to open a window
                      instead of a tab. The user can drag the new
                      window to a second monitor or arrange side-by-
                      side with the suite. */}
                  <button
                    type="button"
                    onClick={() => {
                      const url = `/jobs/${sid}?cells=${encodeURIComponent(`${livePick.compound.id}.${livePick.variant}`)}`;
                      // popup + width/height forces a real window; without
                      // these, target="_blank" tends to open a tab in
                      // Chromium-family browsers.
                      window.open(
                        url,
                        "_blank",
                        "noopener,noreferrer,popup=yes,width=1400,height=900",
                      );
                    }}
                    className="text-xs text-slate-500 dark:text-slate-400 hover:text-delta-600 dark:hover:text-delta-400 underline whitespace-nowrap"
                    title="Open this cell in a new window (your suite page stays in this one)"
                  >
                    Open standalone ↗
                  </button>
                  <button
                    onClick={() => setActivePose(null)}
                    className="text-slate-400 hover:text-ink dark:hover:text-slate-100 p-1.5 -m-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    aria-label="Close (Esc)"
                    title="Close (Esc)"
                  >
                    <Close size={18} />
                  </button>
                </div>
              </header>
              {/* Single scrollable body. flex-1 + min-h-0 lets it take
                  whatever vertical space remains after the header (a flex
                  child needs min-h-0 to allow its overflow:auto to work
                  inside a flex column — without it the child grows to fit
                  content and never scrolls). */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">
                {/* Two-column layout for the pose detail + 3D viewer.
                    Earlier the right column was lg:sticky so the 3D
                    viewer stayed visible while reading the long left
                    content — but the user reported that felt like only
                    part of the modal was scrolling: the 3D / scores
                    panel appeared frozen while everything else moved.
                    Dropped the sticky so both columns scroll together
                    as one unit; on a scroll-down, the entire modal
                    contents move uniformly which matches how every
                    other dialog on the site behaves. */}
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
                  <div className="space-y-6 min-w-0">
                    <PoseDetail
                      pick={livePick}
                      pdbId={j.pdb_id}
                      chain={j.chain}
                      pocketCenter={target?.pocket.center}
                      jobId={j.share_id || j.id}
                      onClose={() => setActivePose(null)}
                    />
                  </div>
                  <div>
                    <HeroBanner
                      pick={livePick}
                      pdbId={j.pdb_id}
                      chain={j.chain}
                      pocketCenter={target?.pocket.center}
                      jobId={j.share_id || j.id}
                    />
                  </div>
                </div>

                {/* Insights cards — full-width row BELOW the 2-col grid so
                    the 3 cards (binding, resistance hint, rank) get to
                    spread into a proper 3-up layout instead of being
                    squished into the narrow left column where they
                    rendered as a vertical stack at the bottom of the
                    scroll and felt cut off. Same component used on the
                    standalone JobPage — scopes to the active pick. */}
                {j.status === "completed" && (
                  <div className="mt-6">
                    <Insights job={j} pick={livePick} />
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
