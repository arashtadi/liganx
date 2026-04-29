import { useRef } from "react";
import { type Compound } from "../api";
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
export default function PoseDetail({ pick, onClose }: Props) {
  const { compound, variant, score, deltaWt, extra } = pick;
  const mutationResidue = residueOf(variant);
  const ext = parseExtra(extra);

  // Diagram ref is still used for the 2D contact map's own anchor; we no
  // longer scroll-target a 3D viewer because the 3D viewer is now in the
  // HeroBanner at the top of the page (single canonical 3D pane per page).
  const diagramRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="panel sticky top-20 animate-fade-in">
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
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-ink p-1 rounded-md hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-100 dark:hover:bg-slate-700">
          <Close size={18} />
        </button>
      </header>

      <div className="p-5 space-y-4">
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
    return `${name} is predicted to bind ${variant} ${Math.abs(delta).toFixed(2)} kcal/mol better than wild-type — a candidate for mutant-selective activity. Worth flagging for follow-up.`;
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
