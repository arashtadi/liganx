import { useRef, useState } from "react";
import { api, type Compound } from "../api";
import { Close, Sparkles } from "./Icons";
import ConfidenceRibbon from "./ConfidenceRibbon";
import InteractionDiagram from "./InteractionDiagram";
import AdmetChips from "./AdmetChips";
import { parseExtra } from "../lib/parseExtra";

interface Props {
  pick: {
    compound: Compound;
    variant: string;
    score: number;
    deltaWt: number | null;
    extra?: string | null;
  };
  pdbId: string;
  chain: string;
  pocketCenter?: [number, number, number];
  /** Either share_id (preferred) or legacy integer job id — backend resolves
   *  both. Accepts both so JobPage can pass whichever it has on hand. */
  jobId?: string | number;
  onClose: () => void;
}

/** Parse a mutation code like "T790M" → residue number 790. For combo codes
 *  like "T790M+C797S", returns the first residue. Returns null if unparseable. */
function residueOf(code: string): number | null {
  const first = code.split("+")[0];
  const m = first.match(/^[A-Z](\d+)[A-Z]$/i);
  return m ? Number(m[1]) : null;
}

/**
 * Drill-down side panel shown when the user clicks a mutant cell.
 *
 * Phase 1: shows the compound, score, Δ, a placeholder 3D viewer slot, and an
 * auto-generated plain-English interpretation.
 *
 * Phase 3: real Mol* viewer + ProLIF interaction list.
 */
export default function PoseDetail({ pick, jobId, onClose }: Props) {
  const { compound, variant, score, deltaWt, extra } = pick;
  const mutationResidue = residueOf(variant);
  const ext = parseExtra(extra);

  // (F3) Local state for the MM-GBSA rescore. We keep the result in
  // local state on success so the chip updates immediately without
  // needing the parent to re-fetch the job (the backend has also
  // persisted into DockingResult.extra, so a refetch would show the
  // same value).
  const [mmgbsaInflight, setMmgbsaInflight] = useState(false);
  const [mmgbsaErr, setMmgbsaErr] = useState<string | null>(null);
  const [mmgbsaLocal, setMmgbsaLocal] = useState<{
    dg_bind_kcal_mol: number;
    e_complex_kcal_mol: number;
    e_protein_kcal_mol: number;
    e_ligand_kcal_mol: number;
    method: string;
    wall_seconds: number;
    receptor_rmsd_a: number;
  } | null>(null);
  // Prefer the local-state result (just-rescored) over the parsed
  // extra (a prior rescore that's already on disk). Same shape.
  const mmgbsaDg = mmgbsaLocal?.dg_bind_kcal_mol ?? ext.mmgbsaDg;
  const mmgbsaMethod = mmgbsaLocal?.method ?? ext.mmgbsaMethod;
  const mmgbsaSeconds = mmgbsaLocal?.wall_seconds ?? ext.mmgbsaSeconds;
  const mmgbsaEComplex = mmgbsaLocal?.e_complex_kcal_mol ?? ext.mmgbsaEComplex;
  const mmgbsaEProtein = mmgbsaLocal?.e_protein_kcal_mol ?? ext.mmgbsaEProtein;
  const mmgbsaELigand = mmgbsaLocal?.e_ligand_kcal_mol ?? ext.mmgbsaELigand;
  const mmgbsaRmsd = mmgbsaLocal?.receptor_rmsd_a ?? ext.mmgbsaRmsd;

  function startMmgbsa() {
    if (!jobId || mmgbsaInflight) return;
    setMmgbsaInflight(true);
    setMmgbsaErr(null);
    api.rescoreMmgbsa(String(jobId), compound.id, variant)
      .then((res) => setMmgbsaLocal(res.mmgbsa))
      .catch((err: Error & { status?: number }) => {
        // The backend distinguishes the failure modes by HTTP code —
        // surface a helpful message per kind. 503 = pod missing
        // openff-toolkit (operator action), 422 = parameterisation
        // (compound-specific), 502 = transport.
        const status = err.status ?? 0;
        if (status === 503) {
          setMmgbsaErr("MM-GBSA isn't available on this server yet — the pod needs the openff-toolkit + openmmforcefields packages installed. Ask your admin to deploy the Phase A pod update.");
        } else if (status === 422) {
          setMmgbsaErr(`Couldn't parameterise this compound: ${err.message}`);
        } else if (status === 502) {
          setMmgbsaErr(`Pod transport error — try again in a minute: ${err.message}`);
        } else if (status === 400) {
          setMmgbsaErr("This pose can't be rescored — it appears to be a failed-dock placeholder row.");
        } else {
          setMmgbsaErr(err.message || "MM-GBSA rescoring failed");
        }
      })
      .finally(() => setMmgbsaInflight(false));
  }

  // Diagram ref is still used for the 2D contact map's own anchor; we no
  // longer scroll-target a 3D viewer because the 3D viewer is now in the
  // HeroBanner at the top of the page (single canonical 3D pane per page).
  const diagramRef = useRef<HTMLDivElement | null>(null);

  return (
    // Used to be `sticky top-20` so the card pinned while the right rail
    // scrolled — but now that we've dropped the right rail's own sticky
    // (so both columns scroll together), keeping this sticky here had
    // the inverse effect: the LEFT column appeared frozen and only the
    // right column scrolled. Page-wide rule is now "everything scrolls
    // together," so this card is normal flow too.
    <div className="panel animate-fade-in">
      <header className="flex items-start justify-between p-5 border-b border-slate-200 dark:border-slate-700">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-delta-600 dark:text-delta-400">
            Pose detail
          </div>
          <h3 className="text-lg font-semibold text-ink mt-0.5 dark:text-slate-100">
            {compound.name ?? "Compound"} <span className="text-slate-400 dark:text-slate-500">×</span> <span className="font-mono">{variant}</span>
          </h3>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <ConfidenceRibbon confidence={ext.confidence} detail={ext.poseBusters} />
            {ext.foldxDDG != null && (
              <span
                className="badge bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600"
                title="FoldX-predicted change in protein stability due to the mutation"
              >
                ΔΔG<sub>fold</sub>: {ext.foldxDDG > 0 ? "+" : ""}{ext.foldxDDG.toFixed(2)} kcal/mol
              </span>
            )}
            {/* Engine pill — only shown for non-default cases. Local Vina is
                the implicit norm; flag RunPod cells so users know which
                infrastructure handled the docking. */}
            {ext.engine === "runpod" && (
              <span
                className="badge bg-accent-50 text-accent-600 ring-1 ring-inset ring-accent-400/40 dark:bg-accent-500/15 dark:text-accent-400 dark:ring-accent-400/30"
                title="Docked on RunPod serverless"
              >
                ⚡ RunPod
              </span>
            )}
            {ext.engine === "local_after_runpod_fail" && (
              <span
                className="badge bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-700/40"
                title="RunPod call failed — fell back to local Vina"
              >
                ⚠ Local (RunPod failed)
              </span>
            )}
            {/* GNINA engine pills. The runner emits engine=gnina_<mode>
                for cells docked successfully through GNINA, where mode is
                rescore (fast) / refine (slow) / none. The "after_pod_busy"
                variant is a future-proofing slot in case we wire GNINA into
                the burst-overflow chain. */}
            {ext.engine?.startsWith("gnina_") && (
              <span
                className="badge bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:ring-violet-700/40"
                title={`Docked with GNINA (${ext.engine.replace("gnina_", "")} mode) — Vina pose + CNN rescoring`}
              >
                🧠 GNINA
              </span>
            )}
            {ext.engine === "runpod_after_pod_busy" && (
              <span
                className="badge bg-accent-50 text-accent-600 ring-1 ring-inset ring-accent-400/40 dark:bg-accent-500/15 dark:text-accent-400 dark:ring-accent-400/30"
                title="Pod GPU was busy — overflowed to RunPod serverless"
              >
                ⚡ RunPod (overflow)
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-ink p-1 rounded-md hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-100 dark:hover:bg-slate-700">
          <Close size={18} />
        </button>
      </header>

      <div className="p-5 space-y-4">
        {/* v1.26 — Interface KPIs (BSA + H-bond count). BSA is the
            strongest single signal for "is this a real, druggable
            interface?" — >600 Å² is typical for kinase pockets,
            <300 Å² is usually a glancing pose. H-bond count separates
            hydrophobic-driven binders from polar-driven ones. Source:
            runner's interface_extras post-processor (freesasa + ProLIF). */}
        {(ext.interfaceBsa != null || ext.interfaceHbonds != null || ext.extrasPending) && (
          <div className="flex items-center gap-2 flex-wrap">
            {ext.interfaceBsa != null && (
              <span
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono ring-1 ring-inset ring-slate-200 bg-slate-50 text-slate-700 dark:ring-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
                title="Buried surface area of the protein-ligand interface. SASA(receptor) + SASA(ligand) − SASA(complex). >600 Å² typically signals a real druggable pocket; <300 Å² is often a glancing pose."
              >
                <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider text-[9px]">BSA</span>
                <span className="font-semibold tabular-nums">{Math.round(ext.interfaceBsa)} Å²</span>
              </span>
            )}
            {/* BSA + the Vina-term decomposition run in a deferred background
                pass after the result row is written (runner's
                _drain_pending_interface_extras). Until that drainer strips
                the extras=pending placeholder, show a muted "computing…"
                chip so the user knows the BSA value is on its way rather
                than missing. It resolves on the next 2s poll. */}
            {ext.interfaceBsa == null && ext.extrasPending && (
              <span
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono ring-1 ring-inset ring-slate-200 bg-slate-50 text-slate-400 dark:ring-slate-700 dark:bg-slate-800/40 dark:text-slate-500"
                title="Buried surface area is being computed in the background pass — it'll appear here on the next refresh."
              >
                <span className="uppercase tracking-wider text-[9px]">BSA</span>
                <span className="tabular-nums animate-pulse">computing…</span>
              </span>
            )}
            {ext.interfaceHbonds != null && (
              <span
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono ring-1 ring-inset ring-slate-200 bg-slate-50 text-slate-700 dark:ring-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
                title="Number of H-bonds across the receptor-ligand interface, from ProLIF. H-bond-rich poses (>=3) usually generalise better across analogs than hydrophobic-only contacts."
              >
                <span className="text-slate-400 dark:text-slate-500 uppercase tracking-wider text-[9px]">H-BONDS</span>
                <span className="font-semibold tabular-nums">{ext.interfaceHbonds}</span>
              </span>
            )}
          </div>
        )}

        {/* v1.26 — Vina score decomposition. Collapsed by default
            because the breakdown is power-user info. Source: smina
            --score_only --scoring vina via interface_extras module. */}
        {ext.vinaTerms && (
          <details className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 group">
            <summary className="cursor-pointer list-none p-3 flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
              <span>Score breakdown</span>
              <span className="text-slate-400 group-open:hidden">▾ expand</span>
              <span className="text-slate-400 hidden group-open:inline">▴ collapse</span>
            </summary>
            <div className="px-3 pb-3">
              <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                Gauss/repulsion/hydrophobic/H-bond rows are raw{" "}
                <strong>pre-weighting</strong> contributions from
                <code className="mx-1 font-mono">smina --score_only --scoring vina</code>
                — they do <em>not</em> sum to the Affinity total. The Affinity row
                is the final weighted Vina score in kcal/mol.
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
              {(
                [
                  ["g1", "Gauss 1", "Short-range attractive (pre-weighting)"],
                  ["g2", "Gauss 2", "Long-range attractive (pre-weighting)"],
                  ["rep", "Repulsion", "Steric clash penalty (pre-weighting)"],
                  ["hyd", "Hydrophobic", "Non-polar contact bonus (pre-weighting)"],
                  ["hb", "H-bond", "Donor-acceptor pair bonus (pre-weighting)"],
                  ["total", "Affinity (kcal/mol)", "Final weighted Vina score"],
                ] as const
              ).map(([k, label, tip]) => {
                const v = ext.vinaTerms?.[k as keyof typeof ext.vinaTerms];
                if (v === undefined) return null;
                return (
                  <div key={k} className="flex items-center justify-between" title={tip}>
                    <span className="text-slate-500 dark:text-slate-400">{label}</span>
                    <span className="tabular-nums text-slate-800 dark:text-slate-100">
                      {v > 0 ? "+" : ""}{v.toFixed(2)}
                    </span>
                  </div>
                );
              })}
              </div>
            </div>
          </details>
        )}

        {/* (F3) MM-GBSA rescoring section. Opt-in second-pass:
            single-snapshot one-trajectory ΔG_bind computed by OpenMM
            with Amber14SB + OpenFF Sage 2.2 + OBC2 implicit solvent.
            ~30-90 s per pose. See docs/fep_plus_design.md for context.

            Two states:
              1. Not yet rescored — show a "Rescore with MM-GBSA"
                 button + a one-line caveat about what MM-GBSA is for.
              2. Rescored — show the ΔG chip, the breakdown in a
                 collapsed details expander, and a "Re-run" button. */}
        {mmgbsaDg != null ? (
          <details className="rounded-lg border border-violet-200 dark:border-violet-700/40 bg-violet-50/40 dark:bg-violet-900/10 group" open>
            <summary className="cursor-pointer list-none p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-violet-700 dark:text-violet-300">
                  MM-GBSA · rank-order score
                </span>
                {/* (Audit fix #3) The chip used to render a bold
                    "ΔG: −42.1 kcal/mol" in big font, which chemists
                    read as a Kd-equivalent affinity. Single-snapshot
                    one-trajectory MM-GBSA values are routinely in
                    [−30, −80] kcal/mol — non-physical as an absolute
                    binding free energy. Re-label as "RANK-ORDER ONLY",
                    drop the units from the headline, and put the
                    full kcal/mol number behind the expander. */}
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono ring-1 ring-inset ring-violet-300 bg-white dark:ring-violet-700/60 dark:bg-slate-900/40 text-violet-800 dark:text-violet-200"
                  title="MM-GBSA rank-order score. Use for ranking analogs at the same target — DO NOT read as an absolute binding affinity (the absolute number is biased because entropy is dropped and single-snapshot Born radii are noisy)."
                >
                  <span className="text-violet-500 dark:text-violet-400 uppercase tracking-wider text-[9px]">SCORE</span>
                  <span className="font-bold tabular-nums">
                    {mmgbsaDg > 0 ? "+" : ""}{mmgbsaDg.toFixed(1)}
                  </span>
                </span>
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold ring-1 ring-inset ring-amber-300 bg-amber-100 text-amber-900 dark:ring-amber-700/50 dark:bg-amber-900/30 dark:text-amber-300"
                  title="MM-GBSA absolute ΔG is biased by ~5-15 kcal/mol on kinase-class binders (single-snapshot Born-radius noise + dropped -TΔS). Only the RANK among compounds at the same target is meaningful. See the breakdown for the full decomposition."
                >
                  rank-only
                </span>
                {mmgbsaSeconds != null && (
                  <span className="text-[10px] text-violet-700/70 dark:text-violet-300/70 italic">
                    {mmgbsaSeconds.toFixed(0)} s
                  </span>
                )}
              </div>
              <span className="text-violet-400 group-open:hidden">▾ details</span>
              <span className="text-violet-400 hidden group-open:inline">▴ hide</span>
            </summary>
            <div className="px-3 pb-3 space-y-2">
              <p className="text-[11px] text-amber-900 dark:text-amber-300 leading-snug font-semibold bg-amber-50/50 dark:bg-amber-900/15 ring-1 ring-amber-200 dark:ring-amber-700/40 rounded px-2 py-1.5">
                ⚠ Use this number to RANK analogs at the same target. The absolute value is biased by ~5–15 kcal/mol (entropy is dropped, single-snapshot Born radii are noisy on the protein-only slice). Don't quote it as a Kd-equivalent affinity. For rigorous binding free energies use FEP (Phase B, design at <code>docs/fep_plus_design.md</code>).
              </p>
              <p className="text-[10px] text-violet-700/80 dark:text-violet-300/80 leading-snug">
                Single-snapshot one-trajectory MM-GBSA: ΔG = E_complex − E_protein − E_ligand on the minimised complex (no MD sampling).
                {mmgbsaMethod && (
                  <> Method: <span className="font-mono">{mmgbsaMethod}</span>.</>
                )}
              </p>
              {(mmgbsaEComplex != null || mmgbsaEProtein != null || mmgbsaELigand != null) && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
                  {mmgbsaEComplex != null && (
                    <div className="flex items-center justify-between" title="E_complex on the minimised geometry.">
                      <span className="text-violet-700/70 dark:text-violet-300/70">E_complex</span>
                      <span className="tabular-nums text-slate-800 dark:text-slate-100">
                        {mmgbsaEComplex.toFixed(1)}
                      </span>
                    </div>
                  )}
                  {mmgbsaEProtein != null && (
                    <div className="flex items-center justify-between" title="E_protein on the same coordinates with the ligand deleted (one-trajectory approximation).">
                      <span className="text-violet-700/70 dark:text-violet-300/70">E_protein</span>
                      <span className="tabular-nums text-slate-800 dark:text-slate-100">
                        {mmgbsaEProtein.toFixed(1)}
                      </span>
                    </div>
                  )}
                  {mmgbsaELigand != null && (
                    <div className="flex items-center justify-between" title="E_ligand on the same coordinates with the protein deleted.">
                      <span className="text-violet-700/70 dark:text-violet-300/70">E_ligand</span>
                      <span className="tabular-nums text-slate-800 dark:text-slate-100">
                        {mmgbsaELigand.toFixed(1)}
                      </span>
                    </div>
                  )}
                  <div className="col-span-2 flex items-center justify-between pt-1 mt-1 border-t border-violet-200/60 dark:border-violet-700/40" title="ΔG_bind = E_complex − E_protein − E_ligand. All in kcal/mol.">
                    <span className="text-violet-700 dark:text-violet-300 font-semibold">ΔG_bind</span>
                    <span className="tabular-nums font-bold text-violet-800 dark:text-violet-200">
                      {mmgbsaDg > 0 ? "+" : ""}{mmgbsaDg.toFixed(2)} kcal/mol
                    </span>
                  </div>
                </div>
              )}
              {/* (Audit fix #12 / Final-verify M3) Receptor RMSD —
                  trust signal that the minimisation kept the protein
                  close to the docked pose. Healthy = green, slight
                  drift = amber, worrying = rose. */}
              {mmgbsaRmsd != null && mmgbsaRmsd >= 0 && (
                <div className="flex items-center gap-2 text-[11px]" title="RMSD of the receptor heavy atoms vs the input docked pose. ~0.1-0.5 Å is healthy (the restraint kept the protein in place); >1.0 Å means significant drift — interpret ΔG with caution.">
                  <span className="text-violet-700/70 dark:text-violet-300/70 uppercase tracking-wider text-[9px] font-semibold">Receptor RMSD</span>
                  <span className={`tabular-nums font-mono ${
                    mmgbsaRmsd <= 0.5 ? "text-emerald-700 dark:text-emerald-400"
                    : mmgbsaRmsd <= 1.0 ? "text-amber-700 dark:text-amber-400"
                    : "text-rose-700 dark:text-rose-400"
                  }`}>
                    {mmgbsaRmsd.toFixed(2)} Å
                  </span>
                  {mmgbsaRmsd > 1.0 && (
                    <span className="text-[10px] text-rose-600 dark:text-rose-400 italic">
                      protein drifted — interpret with caution
                    </span>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={startMmgbsa}
                disabled={mmgbsaInflight || !jobId}
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold ring-1 ring-violet-300 dark:ring-violet-700/50 bg-white dark:bg-slate-900/40 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50 transition-colors"
                title="Re-run MM-GBSA. Useful if the underlying force-field stack changed; otherwise the result will be the same up to numerical noise (mixed-precision OpenMM is reproducible to ~0.1 kcal/mol)."
              >
                {mmgbsaInflight ? "Re-running…" : "Re-run MM-GBSA"}
              </button>
              {mmgbsaErr && (
                <div className="text-[11px] text-rose-700 dark:text-rose-400 mt-1">{mmgbsaErr}</div>
              )}
            </div>
          </details>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                  Second-pass rescoring
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-snug">
                  MM-GBSA (OpenMM + Amber14SB + OpenFF Sage 2.2 + OBC2 implicit solvent) reranks this pose with physics-based ΔG_bind. ~30–90 s on the pod. Use for <strong>rank-ordering analogs</strong>; not a substitute for FEP.
                </div>
              </div>
              <button
                type="button"
                onClick={startMmgbsa}
                disabled={mmgbsaInflight || !jobId}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white shadow-sm transition-colors"
                title="Run single-snapshot one-trajectory MM-GBSA on this pose. Persists the ΔG into the cell's extras so the matrix can use it later."
              >
                {mmgbsaInflight ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                      <path d="M12 2 A10 10 0 0 1 22 12" fill="none" stroke="currentColor" strokeWidth="3" />
                    </svg>
                    Running…
                  </>
                ) : (
                  "Rescore with MM-GBSA"
                )}
              </button>
            </div>
            {mmgbsaErr && (
              <div className="text-[11px] text-rose-700 dark:text-rose-400 mt-2">{mmgbsaErr}</div>
            )}
          </div>
        )}

        {/* Score breakdown is still being computed by the background pass.
            Mirror the collapsed accordion's chrome with a muted "computing…"
            label so the section doesn't pop in unexpectedly later. */}
        {!ext.vinaTerms && ext.extrasPending && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-3 flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500">
            <span>Score breakdown</span>
            <span className="normal-case tracking-normal font-normal animate-pulse">computing in background…</span>
          </div>
        )}

        {/* Ensemble docking panel — present only on cells from a job that
            opted into ensemble docking. The Vina score in the HeroBanner is
            already the BEST across the conformer ensemble; this panel
            explains the ensemble behind it: how many MD-relaxed receptor
            conformers were tried, how much the score moved across them
            (spread), and which conformer produced the winning pose. */}
        {ext.ensemble && (
          <div className="rounded-lg border border-sky-200 dark:border-sky-800/40 bg-sky-50/60 dark:bg-sky-900/15 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sky-600 dark:text-sky-400 text-base leading-none" aria-hidden>⧉</span>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-sky-700 dark:text-sky-300">
                Ensemble docking
              </div>
            </div>
            {ext.ensemble.total > 1 ? (
              <>
                <div className="flex items-center gap-6 mb-2">
                  <div>
                    <div className="text-lg font-semibold tabular-nums text-sky-800 dark:text-sky-200">
                      {ext.ensemble.total}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Receptor conformers
                    </div>
                  </div>
                  {ext.ensemble.spread != null && (
                    <div>
                      <div className="text-lg font-semibold tabular-nums text-sky-800 dark:text-sky-200">
                        ±{ext.ensemble.spread.toFixed(2)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Score spread (kcal/mol)
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  This ligand was docked against {ext.ensemble.total} short-MD-relaxed
                  receptor conformers
                  {ext.ensemble.docked < ext.ensemble.total
                    ? ` (${ext.ensemble.docked} produced a usable pose)`
                    : ""}
                  , and the strongest-scoring result is what the matrix and the
                  score banner show.{" "}
                  {ext.ensemble.spread != null &&
                    (ext.ensemble.spread < 0.3
                      ? "The score barely moved across conformers — the pocket was effectively rigid for this ligand, so a single-snapshot dock would have given essentially the same answer."
                      : `Receptor flexibility moved the score by ${ext.ensemble.spread.toFixed(
                          2,
                        )} kcal/mol across conformers — single-conformation docking against one arbitrary crystal snapshot could have landed anywhere in that range.`)}
                  {ext.ensemble.best &&
                    (ext.ensemble.best === "input"
                      ? " The winning pose came from the un-relaxed crystal snapshot — relaxation didn't change the answer for this ligand."
                      : ` The winning pose came from MD-relaxed conformer "${ext.ensemble.best}" — the pocket had to breathe to accommodate this ligand.`)}
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Ensemble docking was requested for this job, but the receptor
                relaxation step produced no extra conformers for this run — so
                this cell is a standard single-conformation dock. The ensemble
                pipeline is fail-soft: it never blocks a job, it just falls
                back to the rigid crystal snapshot.
              </p>
            )}
          </div>
        )}

        {/* Vina / Δ vs WT / Vinardo / Pose strain metrics all moved to the
            HeroBanner sidebar at the top of the page (single source of
            truth). The drill-down here picks up where the banner stops:
            drug-likeness, mutation-outside-pocket explainer, the human-
            readable interpretation, ProLIF contacts, 2D map, SMILES. */}

        {/* Drug-likeness card — RDKit descriptors (MW/LogP/QED, Lipinski/Veber,
            PAINS) so the user can triage compound chemistry without leaving
            the pose drilldown. */}
        {compound.admet && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900/40">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-2">
              Drug-likeness
            </div>
            <AdmetChips admet={compound.admet} layout="card" />
          </div>
        )}

        {/* Mutation-out-of-pocket warning. When the mutated residue's CA is
            >11 Å from the docking box center, single-conformation docking
            literally cannot see geometric effects of the substitution. We
            surface this prominently so users don't waste time wondering why
            their D835V or L858R cell has the same score as WT. */}
        {variant !== "WT" && ext.outsidePocketA != null && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 p-4">
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-md bg-white/80 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0 ring-1 ring-amber-300 dark:ring-amber-700/40 text-base">
                ◌
              </div>
              <div className="text-sm text-amber-900 dark:text-amber-100 leading-relaxed">
                <div className="font-semibold mb-1">Mutation outside the docking pocket</div>
                <p>
                  Residue {variant.match(/\d+/)?.[0] ?? variant} sits about {ext.outsidePocketA.toFixed(1)} Å
                  from the centre of the docking box (Vina searches a 22 Å cube). Single-conformation
                  docking can't see geometric effects of mutations beyond the box edge.
                </p>
                <p className="mt-2">
                  <strong>Any Δ vs WT shown for this cell is method noise, not biology.</strong> It
                  comes from PDBFixer relaxing nearby side chains during the mutant build plus
                  QuickVina-GPU's stochastic search — neither of which represents a real selectivity
                  or resistance signal. Treat WT and mutant as effectively the same score here.
                </p>
                <p className="mt-2">
                  This is a method limitation, not a platform bug. Mutations like FLT3 D835V or
                  EGFR L858R that confer drug resistance via long-range allosteric / DFG-flip
                  effects need molecular dynamics or multi-conformation ensemble docking to capture.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Plain-English interpretation — prefers the real ProLIF-grounded
            sentence from the backend; falls back to a score-only heuristic.
            Note: when the mutation is outside the pocket (handled above),
            we still show this for context but the user has been warned. */}
        <div className="rounded-lg bg-gradient-to-br from-delta-50 to-accent-50/40 border border-delta-100 p-4 dark:from-delta-900/20 dark:to-accent-900/10 dark:border-delta-800/60">
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-md bg-white/80 text-delta-600 flex items-center justify-center shrink-0 ring-1 ring-delta-200 dark:bg-slate-700 dark:text-delta-400 dark:ring-delta-700">
              <Sparkles size={14} />
            </div>
            <div className="text-sm text-slate-800 leading-relaxed dark:text-slate-200">
              <div className="font-semibold text-ink mb-1 dark:text-slate-100">Interpretation</div>
              <p>
                {interpret(compound.name ?? "This compound", variant, score, deltaWt)}
              </p>
              {ext.summary && (
                <p className="mt-2 text-slate-700 border-t border-delta-100/60 pt-2 dark:text-slate-300 dark:border-delta-700/40">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-delta-600 mr-2 dark:text-delta-400">Pose</span>
                  {ext.summary}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Contact chips — every residue ProLIF flagged */}
        {ext.contacts && ext.contacts.length > 0 && (
          <div>
            <div className="label">Interactions ({ext.contacts.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {ext.contacts.map((c, i) => (
                <span
                  key={i}
                  className={`chip ${
                    c.residue.endsWith(String(mutationResidue ?? ""))
                      ? "bg-delta-50 text-delta-700 border-delta-300 dark:bg-delta-900/30 dark:text-delta-300 dark:border-delta-700"
                      : ""
                  }`}
                  title={`${c.type} interaction with ${c.residue}`}
                >
                  <span className="font-mono">{c.residue}</span>
                  <span className="text-slate-500 dark:text-slate-400">{contactLabel(c.type)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* No contacts? Tell the user *why* instead of silently hiding the
            section. Common cases: ProLIF couldn't infer ligand bond orders
            (covalent warheads, exotic chemistry), or the subprocess crashed. */}
        {(!ext.contacts || ext.contacts.length === 0) && ext.prolifStatus && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:border-amber-800/40 dark:text-amber-200">
            <span className="font-semibold">No interaction fingerprint:</span>{" "}
            {ext.prolifStatus === "empty"
              ? "ProLIF ran but found no interactions — usually means RDKit couldn't infer this ligand's bond orders (common with covalent warheads or unusual chemistry)."
              : `ProLIF error (${ext.prolifStatus}). The pose itself is unaffected; only the contact analysis is missing.`}
          </div>
        )}

        {/* 2D interaction diagram — radial spoke view of the ProLIF contacts.
            The 3D viewer that this used to scroll-target lives in the
            HeroBanner at the top of the page now, so we just render the
            diagram on its own without the spatial-link click handler. */}
        {ext.contacts && ext.contacts.length > 0 && (
          <div ref={diagramRef}>
            <div className="label">2D interaction map</div>
            <InteractionDiagram
              ligandLabel={compound.name ?? "Ligand"}
              contacts={ext.contacts}
            />
          </div>
        )}

        {/* Phase 0 water-displacement analysis (#103). Only shown when the
            runner produced counts — older results and PDBs without HOH records
            won't have this. We deliberately surface this with the "Phase 0,
            not WaterMap" caveat copy so users don't over-interpret. */}
        {ext.water && (
          <div>
            <div className="label flex items-center gap-2">
              Water analysis
              <span className="text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                Phase 0
              </span>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-3 text-sm">
              <div className="flex items-baseline gap-3 flex-wrap">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Displaced</div>
                  <div className="text-xl font-bold tabular-nums text-ink dark:text-slate-100">
                    {ext.water.displaced}
                  </div>
                </div>
                <div className="text-slate-400 dark:text-slate-500 text-lg">/</div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Pocket waters</div>
                  <div className="text-xl font-bold tabular-nums text-slate-700 dark:text-slate-300">
                    {ext.water.pocketCount}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                {ext.water.pocketCount === 0 ? (
                  <>
                    No crystallographic waters in the pocket sphere of this PDB.
                    Either the structure was deposited without solvent or the
                    binding site is dehydrated. Phase 1 (3D-RISM) will fill this
                    gap; for now this row carries no water signal.
                  </>
                ) : ext.water.displaced === 0 ? (
                  <>
                    Pose sits in a region with no crystallographic-water overlap.
                    Common for buried hydrophobic binders. Doesn&apos;t mean no
                    waters are displaced — just none from this structure&apos;s
                    deposited set.
                  </>
                ) : (
                  <>
                    This pose displaces {ext.water.displaced} of {ext.water.pocketCount}{" "}
                    crystallographic waters in the binding pocket. Conserved-water
                    displacement typically carries thermodynamic cost; the WT-vs-mutant
                    Δ in displacement is the interesting signal.
                  </>
                )}
              </p>
              <p className="mt-1.5 text-[10px] text-slate-500 dark:text-slate-500 leading-snug italic">
                Phase 0: geometric overlap with PDB-deposited HOH records, not WaterMap.
                B-factors, conservation across structures, and de novo waters in mutant
                pockets are not modelled in this Phase 0.
              </p>
              {/* Inline disclosure replaces the previous GitHub link to
                  water_displacement_plan.md (which (a) was broken for users
                  without repo access and (b) shouldn't expose internal docs).
                  Same content, kept in-app, collapsed by default so it
                  doesn't crowd the panel. */}
              <details className="mt-1.5 group">
                <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-delta-700 dark:text-delta-300 hover:underline list-none flex items-center gap-1">
                  <span className="inline-block transition-transform group-open:rotate-90">▸</span>
                  What's planned beyond Phase 0
                </summary>
                <div className="mt-1.5 pl-3 border-l-2 border-delta-200 dark:border-delta-700/40 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed space-y-1.5">
                  <p>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Phase 1 — 3D-RISM:</span>{" "}
                    statistical-mechanics solvent treatment that weights waters by
                    their predicted free energy, not just their crystallographic
                    presence. Adds B-factor handling and scores "this water is
                    favourable to displace" vs "this water is locked in".
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Phase 2 — GIST:</span>{" "}
                    grid inhomogeneous solvation theory. Per-voxel enthalpy/entropy
                    map of the pocket — quantifies the thermodynamic cost of every
                    displaced water and detects de novo waters that appear only in
                    the mutant pocket.
                  </p>
                  <p className="text-slate-500 dark:text-slate-500">
                    Both phases are on the roadmap. Phase 0 ships displacement
                    counts so the WT-vs-mutant Δ is already a useful directional
                    signal today.
                  </p>
                </div>
              </details>
            </div>
          </div>
        )}

        <div>
          <div className="label">SMILES</div>
          <code className="block bg-slate-50 border border-slate-200 rounded-md p-2 text-[11px] font-mono text-slate-700 break-all dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-300">
            {compound.smiles}
          </code>
        </div>
      </div>
    </div>
  );
}

/* Metric helper removed — Vina/Δ/Vinardo/strain all live in the HeroBanner
   sidebar now. The drill-down section here doesn't render bare metric
   tiles anymore. */

/** Compact interaction-type names for chips. Maps the ProLIF short codes
 *  (Hydr, HBAc, VdWC, …) to readable abbreviations. */
function contactLabel(t: string): string {
  const map: Record<string, string> = {
    Hydr: "hydrophobic",
    HBAc: "H-bond",
    HBDo: "H-bond",
    PiSt: "π-stack",
    PiCa: "π-cation",
    Cati: "salt bridge",
    Anio: "salt bridge",
    VdWC: "vdW",
    XBAc: "halogen",
    XBDo: "halogen",
  };
  return map[t] ?? t.toLowerCase();
}

function interpret(name: string, variant: string, score: number, delta: number | null): string {
  if (delta == null) {
    return `${name} docks to ${variant} with a Vina score of ${score.toFixed(2)} kcal/mol. WT comparison unavailable.`;
  }
  if (delta < -0.5) {
    return `${name}'s score shifts ${Math.abs(delta).toFixed(2)} kcal/mol toward ${variant} vs wild-type — a hypothesis worth testing for mutant-selective activity.`;
  }
  if (delta < -0.2) {
    return `${name} shows a modest preference for ${variant} (${Math.abs(delta).toFixed(2)} kcal/mol better than WT). Preference is small enough to be within docking noise — confirm with the Vinardo column above before drawing conclusions.`;
  }
  if (delta > 0.5) {
    return `${name} loses ${delta.toFixed(2)} kcal/mol of binding affinity at ${variant} — consistent with a resistance mutation against this scaffold.`;
  }
  if (delta > 0.2) {
    return `${name} binds ${variant} slightly worse than WT (Δ = +${delta.toFixed(2)}). Likely within docking noise — re-run with Thorough exhaustiveness if the trend matters.`;
  }
  // Δ between -0.2 and +0.2 — close enough to call "no detectable effect".
  // Past versions of this copy said "the mutation is unlikely to affect
  // binding" which is wrong for activation-loop mutations whose effect
  // simply isn't visible to single-conformation docking. Be honest about
  // the three things that could be true:
  return (
    `${name} binds ${variant} comparably to WT (Δ = ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} kcal/mol). ` +
    `Three possibilities for an effectively-zero Δ: (1) the mutation genuinely doesn't affect this compound's binding, ` +
    `(2) the residue is outside the ~22 Å docking box (check for the "outside pocket" badge above), or ` +
    `(3) the effect is below Vina's ~1 kcal/mol noise floor at this exhaustiveness — try Thorough mode to discriminate. ` +
    `Compare the Vinardo refined score for a tighter signal.`
  );
}
