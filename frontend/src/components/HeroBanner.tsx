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
  //
  // Retry policy: during job streaming, the structures/pose endpoints can 404
  // briefly while the cell is mid-flip from "running" to "ok" (cleaned PDBs
  // are written before the row commits but there's a tiny window). Without
  // retries, React Query gave up immediately and HeroBanner tried to render
  // the viewer with null PDB data — which surfaced to the user as a cryptic
  // "Cannot read properties of undefined (reading 'setStyle')" inside 3Dmol.
  // 5 retries with exponential backoff (capped at 5s) covers the streaming
  // race comfortably without hammering the server on a permanent failure.
  const retryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 5000);

  // Detect Boltz-2 cells from the picked row's extra (engine=boltz2).
  // Boltz-2's pose IS the entire predicted protein-ligand complex in its
  // own coordinate frame — the crystal WT/mutant receptor PDBs aren't
  // comparable (different coords) and trying to overlay them produces a
  // disjointed view where the crystal protein and the predicted complex
  // float next to each other. So for Boltz-2 cells we DON'T fetch the
  // crystal structures at all; the pose alone has everything the viewer
  // needs to render.
  // EXCEPTION: when boltz2AlignedRmsd is present (mutant aligned to WT with
  // RMSD < 3.0 Å), fetch the WT pose too so we can overlay both complexes
  // in the 3D viewer with the blend slider.
  const pickExt = pick ? parseExtra(pick.extra) : null;
  const isBoltz2Cell = !!pickExt?.engine && pickExt.engine.startsWith("boltz2");
  const boltz2Aligned = isBoltz2Cell && pickExt?.boltz2AlignedRmsd != null;

  const wtQuery = useQuery({
    queryKey: ["structure", pdbId, chain, "WT"],
    queryFn: () => api.structure(pdbId, chain, "WT"),
    staleTime: 5 * 60 * 1000,
    enabled: pick != null && !isBoltz2Cell,
    retry: 5,
    retryDelay,
  });
  const mutQuery = useQuery({
    queryKey: ["structure", pdbId, chain, pick?.variant ?? ""],
    queryFn: () => api.structure(pdbId, chain, pick!.variant),
    staleTime: 5 * 60 * 1000,
    enabled: pick != null && pick.variant !== "WT" && !isBoltz2Cell,
    retry: 5,
    retryDelay,
  });
  const poseQuery = useQuery({
    queryKey: ["pose", jobId, pick?.compound.id ?? 0, pick?.variant ?? ""],
    queryFn: () => api.pose(jobId!, pick!.compound.id, pick!.variant),
    staleTime: 5 * 60 * 1000,
    enabled: jobId != null && pick != null,
    retry: 5,
    retryDelay,
  });
  // For boltz2Aligned cells, also fetch the WT pose so we can overlay both
  // complexes in the viewer (mutant pose is in poseQuery, WT pose here).
  const wtPoseQuery = useQuery({
    queryKey: ["pose", jobId, pick?.compound.id ?? 0, "WT"],
    queryFn: () => api.pose(jobId!, pick!.compound.id, "WT"),
    staleTime: 5 * 60 * 1000,
    enabled: jobId != null && pick != null && boltz2Aligned,
    retry: 5,
    retryDelay,
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
  //
  // We treat "no data yet" (isLoading OR fetching with retries OR fetched-
  // but-empty) as still loading. Without this, when wtQuery was retrying in
  // the background isLoading was already false and isFetching=true, but
  // wtQuery.data was undefined — and we'd briefly mount the viewer with
  // wtPdb=null, which the viewer's own no-data guard handles safely, but it
  // flashed an error banner on every single auto-pick during streaming.
  //
  // We also block on the pose query: even though the viewer will happily
  // render WT-only without a pose, mounting it before R2 has finished
  // uploading the pose looks broken to the user — the cell has a score but
  // the canvas has no ligand. Better to keep the skeleton up until the
  // pose lands, so what the user sees inside the viewer always matches the
  // values shown in the matrix cell.
  // For Boltz-2 cells the crystal-structure queries (wtQuery/mutQuery) are
  // disabled — the predicted complex pose IS the structure we render. So
  // wtReady must check whatever query actually feeds wtPdb:
  //   - boltz2 + aligned: wtPdb = wtPoseQuery.data       → check wtPoseQuery
  //   - boltz2 + not aligned: wtPdb = poseQuery.data    → check poseQuery
  //   - non-boltz2: wtPdb = wtQuery.data                 → check wtQuery
  // The previous code fell through to !!wtQuery.data for boltz2-aligned
  // cells which is forever undefined → "Preparing 3D pose…" stuck on screen
  // even though the pose endpoint had returned a valid PDB. Caught
  // 2026-04-30 on a Tepotinib×MET 2WGJ Y1230H job.
  const wtReady = isBoltz2Cell
    ? boltz2Aligned
      ? (!!wtPoseQuery.data || wtPoseQuery.isError)
      : (!!poseQuery.data || poseQuery.isError)
    : !!wtQuery.data;
  const mutReady = isBoltz2Cell || variant === "WT" || !!mutQuery.data || mutQuery.isError;
  const poseReady = jobId == null || !!poseQuery.data || poseQuery.isError;
  const wtPoseReady = !boltz2Aligned || !!wtPoseQuery.data || wtPoseQuery.isError;
  const wtFetching = !isBoltz2Cell && (wtQuery.isLoading || wtQuery.isFetching);
  const mutFetching = !isBoltz2Cell && variant !== "WT" && (mutQuery.isLoading || mutQuery.isFetching);
  const poseFetching = jobId != null && (poseQuery.isLoading || poseQuery.isFetching);
  const wtPoseFetching = boltz2Aligned && (wtPoseQuery.isLoading || wtPoseQuery.isFetching);
  // Failed AFTER all retries — show explicit error UX with manual retry.
  // Skipped for Boltz-2 (we never asked for the crystal).
  const wtFailed = !isBoltz2Cell && !wtQuery.data && wtQuery.isError && !wtQuery.isFetching;
  const loadingPdb =
    (!wtReady && wtFetching) ||
    (!mutReady && mutFetching) ||
    (!poseReady && poseFetching) ||
    (!wtPoseReady && wtPoseFetching);

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

      {/* Banner body. Now lives in a sticky right column ~400px wide on
          desktop, so internal layout is always stacked (3D on top, metrics
          below). The previous side-by-side grid was too cramped at column
          width and stretched too tall when the metric stack was longer than
          the canvas. */}
      <div className="flex flex-col gap-3 p-4">
        {/* 3D canvas. While the WT/mutant PDBs are fetching, show a skeleton
            instead of an empty black rectangle — that's the worst part of
            the current Pod-cold-start experience. If the WT fetch failed
            after all retries (rare — usually only happens when the user
            opens the page during a Fly cold-start window), surface a
            friendly retry button rather than rendering the viewer with
            null PDB data (which would crash inside 3Dmol). */}
        {/* Viewer height — was 300px which clipped the Pose toolbar row
            (Stick / Ball / Line / Sphere) below the Backbone row. Bumped
            to 380px so canvas (~280px) + Backbone row + Pose row + the
            optional Surface-color sub-row all fit without scrolling. */}
        <div className="relative h-[380px]">
          {loadingPdb ? (
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 flex flex-col items-center justify-center text-sm text-slate-500 dark:text-slate-400 animate-pulse">
              <div className="w-12 h-12 rounded-full bg-white/60 dark:bg-slate-700/60 mb-3" />
              Loading the 3D pose…
            </div>
          ) : wtFailed ? (
            <div className="absolute inset-0 rounded-lg bg-slate-50 dark:bg-slate-800/60 flex flex-col items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-300 px-6 text-center">
              <div className="font-semibold text-ink dark:text-slate-100">
                Pose still being prepared
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
                The receptor for {pdbId} chain {chain} hasn't finished writing yet — this usually clears within a few seconds.
              </div>
              <button
                type="button"
                onClick={() => {
                  wtQuery.refetch();
                  if (variant !== "WT") mutQuery.refetch();
                  poseQuery.refetch();
                }}
                className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-delta-600 hover:bg-delta-700 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : !wtReady ? (
            // Defensive fallback: not loading, not failed, but no data —
            // shouldn't happen in practice, but guarantees we never mount
            // the viewer with null wtPdb.
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 flex flex-col items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              Preparing 3D pose…
            </div>
          ) : (
            <MutationOverlayViewer
              // For Boltz-2 the pose IS a complete protein-ligand complex
              // in the model's own coordinate frame. Pass it as wtPdb (the
              // single PDB the viewer renders) and set isComplex so the
              // viewer splits backbone style onto the protein chain and
              // pose style onto the ligand chain. The crystal queries are
              // disabled in this mode — overlaying them would put the
              // crystal protein and the predicted complex at totally
              // different coords next to each other (the bug we just hit).
              //
              // EXCEPTION: when boltz2AlignedRmsd is present, the mutant
              // pose has been aligned to the WT pose (RMSD < 3.0 Å). In this
              // case pass both poses so the viewer can overlay them with the
              // blend slider: wtPdb = WT aligned complex, mutantPdb = mutant
              // aligned complex, isComplex=true for both.
              wtPdb={
                isBoltz2Cell
                  ? boltz2Aligned
                    ? (wtPoseQuery.data ?? null)
                    : (poseQuery.data ?? null)
                  : (wtQuery.data ?? null)
              }
              mutantPdb={
                isBoltz2Cell && boltz2Aligned
                  ? (poseQuery.data ?? null)
                  : (isBoltz2Cell ? null : (mutQuery.data ?? null))
              }
              posePdbqt={isBoltz2Cell ? null : (poseQuery.data ?? null)}
              isComplex={isBoltz2Cell}
              contacts={ext.contacts}
              chain={chain}
              mutationResidue={isBoltz2Cell ? undefined : (mutationResidue ?? undefined)}
              pocketCenter={pocketCenter}
              variantLabel={variant}
              contextLabel={`${compound.name ?? `Compound #${compound.id}`} × ${variant}`}
              contextSubtitle={`${pdbId} chain ${chain}`}
              className="rounded-lg overflow-hidden h-full"
            />
          )}
        </div>

        {/* Metrics row. Score / Δ / Vinardo / Strain are 4 small cards in
            a 2-column grid so the banner doesn't get stupidly tall. Drug-
            likeness and validation flow below as full-width cards. */}
        <div className="grid grid-cols-2 gap-2">
          {/* Primary score card — label + units must match the engine that
              produced the score, since they are NOT in the same units:
                - Vina-family / GNINA → kcal/mol (free energy, lower = stronger)
                - Boltz-2             → log10(IC₅₀ μM) (more-negative = stronger)
              Mislabeling Boltz-2 output as "Vina score / kcal/mol" caused
              real confusion: the magnitude looks like a weak Vina score
              (-0.76 kcal/mol = "barely binds") when it actually means
              IC₅₀ ≈ 0.17 μM (a sub-µM affinity). */}
          {(() => {
            const isB2 = isBoltz2Cell;
            const scoreLabel = isB2 ? "Boltz-2 affinity" : "Vina score";
            const scoreUnit  = isB2 ? "log₁₀(IC₅₀ μM)" : "kcal/mol";
            const scoreTitle = isB2
              ? "Boltz-2 affinity head 1 — log10(IC50) in μM. More-negative = stronger predicted binder. NOT comparable to Vina kcal/mol."
              : "AutoDock Vina score in kcal/mol. Lower = stronger predicted binding.";
            return (
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5" title={scoreTitle}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {scoreLabel}
                </div>
                <div className="font-mono text-xl font-semibold text-ink dark:text-slate-100 mt-0.5">
                  {score.toFixed(2)}
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-sans font-normal ml-1.5">{scoreUnit}</span>
                </div>
              </div>
            );
          })()}

          {/* Vinardo refined — its own card now (was previously a subtitle
              under Vina score). Promoted because the drill-down section
              below the matrix used to duplicate it. Single source of truth
              for the second-pass smina rescore. Skipped for Boltz-2 cells
              because Vinardo is a Vina-family rescore — meaningless on a
              Boltz-2 affinity head value. */}
          {!isBoltz2Cell && ext.vinardo != null && (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Vinardo refined
              </div>
              <div className="font-mono text-xl font-semibold text-ink dark:text-slate-100 mt-0.5">
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
                <div className={`font-mono text-xl font-semibold mt-0.5 ${
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
              <div className={`font-mono text-xl font-semibold mt-0.5 ${
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
        </div>

        {/* Drug-likeness — full-width card below the 4-numeric grid. The
            chip layout doesn't fit two-up in this column width without
            ugly wrapping, so it gets its own row. */}
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
            {isBoltz2Cell ? (
              // Boltz-2 doesn't run PoseBusters (the model already encodes
              // its own confidence via aff_prob). Show that signal instead
              // of "Validation pending…", which incorrectly implies the
              // pose is still being checked.
              ext.affProb != null ? (
                <>Boltz-2 confidence <span className="font-semibold">{(ext.affProb * 100).toFixed(0)}%</span></>
              ) : (
                <span className="text-slate-400 dark:text-slate-500">Boltz-2 prediction</span>
              )
            ) : ext.confidence && ext.confidence !== "unknown" ? (
              <>Confidence <span className="font-semibold">{ext.confidence}</span></>
            ) : (
              <span className="text-slate-400 dark:text-slate-500">Validation pending…</span>
            )}
            {ext.contacts && ext.contacts.length > 0 && (
              <span className="ml-1 text-slate-500 dark:text-slate-400">
                · {ext.contacts.length} contact{ext.contacts.length === 1 ? "" : "s"}
              </span>
            )}
            {isBoltz2Cell && ext.contacts && ext.contacts.length > 0 && (
              <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-300/80 leading-snug">
                Note: Boltz-2 contacts use the model's sequential numbering
                (residue 1 = first residue of the extracted kinase domain),
                not the PDB/UniProt numbering shown for the mutation label.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
