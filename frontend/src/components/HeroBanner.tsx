/**
 * Full-width 3D viewer banner that lives above the selectivity matrix.
 *
 * Renders a large molecular viewer on the left with a tight metrics
 * sidebar on the right (Vina score, Δ vs WT, Vinardo, drug-likeness
 * chips, validation summary). When the user clicks a different cell in
 * the matrix below, this banner updates in place — no scroll required.
 *
 * Auto-loading: JobPage picks a sensible default cell on page open
 * (best mutant Δ excluding outside-pocket cells; falls back to the best
 * raw score) and passes it as `pick`. The banner fetches the WT + mutant
 * PDBs and the docked pose, identical to the per-cell drill-down. While
 * those queries are in flight the canvas shows a skeleton instead of an
 * empty black rectangle.
 *
 * The deeper drill-down (interpretation copy, ProLIF contacts list, 2D
 * interaction map, mutation-outside-pocket explainer) still lives in
 * PoseDetail — just rendered BELOW the matrix instead of beside it. This
 * banner is the at-a-glance summary; PoseDetail is the deep dive.
 */

import { useQuery } from "@tanstack/react-query";
import { api, type Compound } from "../api";
import { parseExtra } from "../lib/parseExtra";
import MutationOverlayViewer from "./MutationOverlayViewer";
import AdmetChips from "./AdmetChips";

interface Pick {
  compound: Compound;
  variant: string;
  score: number;
  deltaWt: number | null;
  extra?: string | null;
}

interface Props {
  pick: Pick | null;
  pdbId: string;
  chain: string;
  pocketCenter?: [number, number, number];
  jobId?: string | number;
  /** Why this cell is the default selection — surfaced as a small badge
   *  next to the compound name so the user knows whether they're looking
   *  at the auto-picked best Δ or a cell they explicitly clicked. */
  selectionReason?: "auto" | "user";
}

/** Parse "T790M" → 790; "T790M+C797S" → 790. */
function residueOf(code: string): number | null {
  const first = code.split("+")[0];
  const m = first.match(/^[A-Z](\d+)[A-Z]$/i);
  return m ? Number(m[1]) : null;
}

export default function HeroBanner({
  pick,
  pdbId,
  chain,
  pocketCenter,
  jobId,
  selectionReason,
}: Props) {
  // Fetch WT + mutant PDB text and the docked pose. Same queries PoseDetail
  // uses, so React Query dedupes when both components render simultaneously.
  const wtQuery = useQuery({
    queryKey: ["structure", pdbId, chain, "WT"],
    queryFn: () => api.structure(pdbId, chain, "WT"),
    staleTime: 5 * 60 * 1000,
    enabled: pick != null,
  });
  const mutQuery = useQuery({
    queryKey: ["structure", pdbId, chain, pick?.variant ?? ""],
    queryFn: () => api.structure(pdbId, chain, pick!.variant),
    staleTime: 5 * 60 * 1000,
    enabled: pick != null && pick.variant !== "WT",
    retry: 0,
  });
  const poseQuery = useQuery({
    queryKey: ["pose", jobId, pick?.compound.id ?? 0, pick?.variant ?? ""],
    queryFn: () => api.pose(jobId!, pick!.compound.id, pick!.variant),
    staleTime: 5 * 60 * 1000,
    enabled: jobId != null && pick != null,
    retry: 0,
  });

  // Empty state: no completed cells yet (job still running with all cells
  // failed-or-pending). We render a thin placeholder so the page layout
  // doesn't jump when the first cell finishes and pick becomes non-null.
  if (!pick) {
    return (
      <section className="card relative overflow-hidden">
        <div className="flex items-center justify-center py-12 text-sm text-slate-500 dark:text-slate-400">
          Waiting for the first docking to finish — the 3D pose will appear here.
        </div>
      </section>
    );
  }

  const { compound, variant, score, deltaWt, extra } = pick;
  const ext = parseExtra(extra);
  const stronger = deltaWt != null && deltaWt < -0.3;
  const weaker = deltaWt != null && deltaWt > 0.3;
  const outsidePocket = variant !== "WT" && ext.outsidePocketA != null;
  const mutationResidue = residueOf(variant);

  // Loading flag for the canvas skeleton. We don't block on the mutant query
  // alone — for WT-only jobs there's nothing to fetch there.
  const loadingPdb =
    wtQuery.isLoading ||
    (variant !== "WT" && mutQuery.isLoading);

  return (
    <section className="card relative overflow-hidden p-0">
      {/* Selection breadcrumb across the top — keeps the page header light
          and gives the banner its own "you are looking at" context. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 border-b border-slate-200 dark:border-slate-700">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Showing
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-ink dark:text-slate-100">
            {compound.name ?? `Compound #${compound.id}`}
          </span>
          <span className="text-slate-400 dark:text-slate-500">×</span>
          <span className="font-mono text-base font-semibold text-delta-700 dark:text-delta-300">
            {variant}
          </span>
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          — click any matrix cell below to swap pose
        </span>
        {selectionReason === "auto" && variant !== "WT" && deltaWt != null && (
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200 px-2 py-0.5 text-[10px] font-semibold dark:bg-purple-900/30 dark:text-purple-300 dark:ring-purple-700/40"
            title="Auto-selected on page load — the cell with the strongest mutant Δ that's not outside the docking pocket"
          >
            best mutant Δ in matrix
          </span>
        )}
      </div>

      {/* Banner body: 3D canvas on the left, metrics column on the right.
          `items-stretch` (default on grid) + `h-full` on the canvas wrapper
          make the 3D pane grow to match the sidebar's full height. Without
          this, the canvas was stuck at 320px and the sidebar's six stacked
          cards left ~300px of empty space below the molecule. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_240px] gap-4 p-4">
        {/* 3D canvas. While the WT/mutant PDBs are fetching, show a skeleton
            instead of an empty black rectangle — that's the worst part of
            the current Pod-cold-start experience. */}
        <div className="relative min-h-[320px] h-full">
          {loadingPdb ? (
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 flex flex-col items-center justify-center text-sm text-slate-500 dark:text-slate-400 animate-pulse">
              <div className="w-12 h-12 rounded-full bg-white/60 dark:bg-slate-700/60 mb-3" />
              Loading the 3D pose…
            </div>
          ) : (
            <MutationOverlayViewer
              wtPdb={wtQuery.data ?? null}
              mutantPdb={mutQuery.data ?? null}
              posePdbqt={poseQuery.data ?? null}
              contacts={ext.contacts}
              chain={chain}
              mutationResidue={mutationResidue ?? undefined}
              pocketCenter={pocketCenter}
              variantLabel={variant}
              contextLabel={`${compound.name ?? `Compound #${compound.id}`} × ${variant}`}
              contextSubtitle={`${pdbId} chain ${chain}`}
              className="rounded-lg overflow-hidden h-full min-h-[320px]"
            />
          )}
        </div>

        {/* Metrics column. Keep this tight — the user reads ~3 numbers and
            then drops into the matrix or the deeper PoseDetail below. */}
        <div className="flex flex-col gap-2.5">
          {/* Vina score */}
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Vina score
            </div>
            <div className="font-mono text-2xl font-semibold text-ink dark:text-slate-100 mt-0.5">
              {score.toFixed(2)}
              <span className="text-xs text-slate-500 dark:text-slate-400 font-sans font-normal ml-1.5">kcal/mol</span>
            </div>
          </div>

          {/* Vinardo refined — its own card now (was previously a subtitle
              under Vina score). Promoted because the drill-down section
              below the matrix used to duplicate it. Single source of truth
              for the second-pass smina rescore. */}
          {ext.vinardo != null && (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Vinardo refined
              </div>
              <div className="font-mono text-2xl font-semibold text-ink dark:text-slate-100 mt-0.5">
                {ext.vinardo.toFixed(2)}
                <span className="text-xs text-slate-500 dark:text-slate-400 font-sans font-normal ml-1.5">kcal/mol</span>
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                Smina re-score · sharper for close-analog ranking
              </div>
            </div>
          )}

          {/* Δ vs WT — outside-pocket cells get the muted "noise" treatment
              consistent with the matrix cell rendering. */}
          {variant !== "WT" && deltaWt != null && (
            outsidePocket ? (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/15 px-3 py-2.5 border border-amber-200/70 dark:border-amber-700/30">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-200">
                  Δ vs WT (noise)
                </div>
                <div className="font-mono text-xl font-semibold text-amber-900 dark:text-amber-100 mt-0.5">
                  ({deltaWt > 0 ? "+" : ""}{deltaWt.toFixed(2)})
                </div>
                <div className="text-[11px] text-amber-800 dark:text-amber-200 mt-0.5 leading-snug">
                  Residue {mutationResidue ?? "?"} is {ext.outsidePocketA?.toFixed(1)} Å from the box — outside Vina's reach.
                </div>
              </div>
            ) : (
              <div className={`rounded-lg px-3 py-2.5 ${
                stronger
                  ? "bg-emerald-50 dark:bg-emerald-900/20"
                  : weaker
                    ? "bg-rose-50 dark:bg-rose-900/20"
                    : "bg-slate-50 dark:bg-slate-800/60"
              }`}>
                <div className={`text-[10px] font-semibold uppercase tracking-wider ${
                  stronger
                    ? "text-emerald-800 dark:text-emerald-200"
                    : weaker
                      ? "text-rose-800 dark:text-rose-200"
                      : "text-slate-500 dark:text-slate-400"
                }`}>
                  Δ vs WT
                </div>
                <div className={`font-mono text-2xl font-semibold mt-0.5 ${
                  stronger
                    ? "text-emerald-700 dark:text-emerald-300"
                    : weaker
                      ? "text-rose-700 dark:text-rose-300"
                      : "text-ink dark:text-slate-100"
                }`}>
                  {deltaWt > 0 ? "+" : ""}{deltaWt.toFixed(2)}
                </div>
              </div>
            )
          )}

          {/* Pose strain — RDKit MMFF strain analysis on the docked
              geometry. Tone tracks the verdict (ok/mild/high) so the user
              can spot a Vina junk pose at a glance. Lives here (not in
              the drill-down) so the score, Δ, Vinardo, and strain are all
              in one column next to the 3D viewer. */}
          {ext.strain && (
            <div className={`rounded-lg px-3 py-2.5 ${
              ext.strain.verdict === "ok"
                ? "bg-emerald-50 dark:bg-emerald-900/20"
                : ext.strain.verdict === "high"
                  ? "bg-rose-50 dark:bg-rose-900/20"
                  : "bg-slate-50 dark:bg-slate-800/60"
            }`}>
              <div className={`text-[10px] font-semibold uppercase tracking-wider ${
                ext.strain.verdict === "ok"
                  ? "text-emerald-800 dark:text-emerald-200"
                  : ext.strain.verdict === "high"
                    ? "text-rose-800 dark:text-rose-200"
                    : "text-slate-500 dark:text-slate-400"
              }`}>
                Pose strain
              </div>
              <div className={`font-mono text-2xl font-semibold mt-0.5 ${
                ext.strain.verdict === "ok"
                  ? "text-emerald-700 dark:text-emerald-300"
                  : ext.strain.verdict === "high"
                    ? "text-rose-700 dark:text-rose-300"
                    : "text-ink dark:text-slate-100"
              }`}>
                {ext.strain.kcal.toFixed(2)}
                <span className="text-xs text-slate-500 dark:text-slate-400 font-sans font-normal ml-1.5">Å</span>
              </div>
              <div className={`text-[10px] mt-0.5 leading-snug ${
                ext.strain.verdict === "ok"
                  ? "text-emerald-700 dark:text-emerald-200/80"
                  : ext.strain.verdict === "high"
                    ? "text-rose-700 dark:text-rose-200/80"
                    : "text-slate-500 dark:text-slate-400"
              }`}>
                {ext.strain.verdict === "ok"
                  ? "Matches a relaxed conformer · pose geometry is plausible"
                  : ext.strain.verdict === "mild"
                    ? "Mild strain · differs from any relaxed conformer"
                    : "High strain · likely a Vina junk pose"}
              </div>
            </div>
          )}

          {/* Drug-likeness — the existing chip layout but in compact mode so
              we don't wrap onto five lines in a 240px column. */}
          {compound.admet && (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Drug-likeness
              </div>
              <AdmetChips admet={compound.admet} layout="card" />
            </div>
          )}

          {/* Validation status — confidence + contact count. Falls back to
              "validation pending" while the deferred-validation thread is
              still draining (DEFER_VALIDATION=1 path). */}
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Validation
            </div>
            <div className="text-xs text-slate-700 dark:text-slate-300 mt-1 leading-relaxed">
              {ext.confidence && ext.confidence !== "unknown" ? (
                <>Confidence <span className="font-semibold">{ext.confidence}</span></>
              ) : (
                <span className="text-slate-400 dark:text-slate-500">Validation pending…</span>
              )}
              {ext.contacts && ext.contacts.length > 0 && (
                <span className="ml-1 text-slate-500 dark:text-slate-400">
                  · {ext.contacts.length} contact{ext.contacts.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
