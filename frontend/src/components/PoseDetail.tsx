import { useQuery } from "@tanstack/react-query";
import { api, type Compound } from "../api";
import { Close, Sparkles } from "./Icons";
import MutationOverlayViewer from "./MutationOverlayViewer";
import ConfidenceRibbon from "./ConfidenceRibbon";
import InteractionDiagram from "./InteractionDiagram";
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
export default function PoseDetail({ pick, pdbId, chain, pocketCenter, jobId, onClose }: Props) {
  const { compound, variant, score, deltaWt, extra } = pick;
  const stronger = deltaWt != null && deltaWt < -0.3;
  const weaker = deltaWt != null && deltaWt > 0.3;
  const mutationResidue = residueOf(variant);
  const ext = parseExtra(extra);

  // Fetch the WT and mutant PDBs from the backend so the overlay viewer can
  // render the actual FoldX-built mutant geometry next to the WT side chain.
  const wtQuery = useQuery({
    queryKey: ["structure", pdbId, chain, "WT"],
    queryFn: () => api.structure(pdbId, chain, "WT"),
    staleTime: 5 * 60 * 1000,
  });
  const mutQuery = useQuery({
    queryKey: ["structure", pdbId, chain, variant],
    queryFn: () => api.structure(pdbId, chain, variant),
    staleTime: 5 * 60 * 1000,
    enabled: variant !== "WT",
    retry: 0, // missing mutant cache → just gracefully show WT
  });
  // Pull the docked ligand pose so the viewer can show the actual binding pose
  const poseQuery = useQuery({
    queryKey: ["pose", jobId, compound.id, variant],
    queryFn: () => api.pose(jobId!, compound.id, variant),
    staleTime: 5 * 60 * 1000,
    enabled: jobId != null,
    retry: 0, // /tmp poses get cleaned between sessions; just skip silently
  });

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
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Vina score" value={`${score.toFixed(2)} kcal/mol`} />
          <Metric
            label="Δ vs WT"
            value={deltaWt == null ? "—" : `${deltaWt > 0 ? "+" : ""}${deltaWt.toFixed(2)}`}
            tone={stronger ? "good" : weaker ? "bad" : undefined}
          />
        </div>

        {/* Plain-English interpretation — prefers the real ProLIF-grounded
            sentence from the backend; falls back to a score-only heuristic */}
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

        {/* 2D interaction diagram — radial spoke view of the ProLIF contacts */}
        {ext.contacts && ext.contacts.length > 0 && (
          <div>
            <div className="label">2D interaction map</div>
            <InteractionDiagram
              ligandLabel={compound.name ?? "Ligand"}
              contacts={ext.contacts}
            />
          </div>
        )}

        {/* 3D viewer — overlays the FoldX-mutated side chain on the WT structure */}
        <div>
          <div className="label flex items-center justify-between">
            <span>WT vs mutant overlay</span>
            {mutationResidue != null && (
              <span className="text-[10px] text-delta-600 font-mono">
                residue {mutationResidue}
              </span>
            )}
          </div>
          <MutationOverlayViewer
            wtPdb={wtQuery.data ?? null}
            mutantPdb={mutQuery.data ?? null}
            posePdbqt={poseQuery.data ?? null}
            contacts={ext.contacts}
            chain={chain}
            mutationResidue={mutationResidue ?? undefined}
            pocketCenter={pocketCenter}
            variantLabel={variant}
            className="min-h-[280px]"
            contextLabel={`${compound.name ?? "Compound"} × ${variant}`}
            contextSubtitle={[
              `${pdbId} chain ${chain}`,
              // Show "Job #N" for legacy integer IDs, or skip for share_id
              // tokens — random base64 strings look terrible in headers.
              typeof jobId === "number" ? `Job #${jobId}` : null,
              `${score.toFixed(2)} kcal/mol`,
              deltaWt != null ? `Δ vs WT ${deltaWt > 0 ? "+" : ""}${deltaWt.toFixed(2)}` : null,
            ].filter(Boolean).join(" · ")}
          />
          {/* Provenance note — exactly what the viewer is showing, so the user
              never has to wonder which receptor the pose was docked against. */}
          <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed dark:text-slate-400">
            <span className="font-semibold text-slate-600 dark:text-slate-300">Ligand pose</span>{" "}
            was docked against the{" "}
            <span className="font-mono text-delta-700 dark:text-delta-400">{variant}</span> receptor
            {variant !== "WT" && " (FoldX-built mutant)"}.{" "}
            <span className="font-semibold text-slate-600 dark:text-slate-300">Backbone</span> shown
            is wild-type{variant !== "WT" && " — identical to mutant except at the substituted residue"}.{" "}
            {variant !== "WT" && (
              <>
                <span className="font-semibold text-slate-600 dark:text-slate-300">Side chain</span> at
                residue {mutationResidue ?? "?"} is swappable WT (green) ↔ mutant (blue) via the slider.
              </>
            )}
            {ext.contacts && ext.contacts.length > 0 && (
              <>
                {" "}
                <span className="font-semibold text-slate-600 dark:text-slate-300">Contact residues</span> are
                colored by ProLIF interaction type from the docked complex.
              </>
            )}
            {mutQuery.isError && " Mutant structure not cached — showing WT only."}
          </p>
        </div>

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

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const toneCls =
    tone === "good" ? "text-emerald-700 bg-emerald-50 ring-emerald-200 dark:text-emerald-300 dark:bg-emerald-900/20 dark:ring-emerald-800/40"
    : tone === "bad" ? "text-rose-700 bg-rose-50 ring-rose-200 dark:text-rose-300 dark:bg-rose-900/20 dark:ring-rose-800/40"
    : "text-ink bg-white ring-slate-200 dark:text-slate-100 dark:bg-slate-800/40 dark:ring-slate-700";
  return (
    <div className={`rounded-lg ring-1 ring-inset px-3 py-2 ${toneCls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70 dark:opacity-60">{label}</div>
      <div className="text-lg font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

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
    return `${name} shows a modest preference for ${variant} (${Math.abs(delta).toFixed(2)} kcal/mol better than WT). Preference is small enough to be within docking noise.`;
  }
  if (delta > 0.5) {
    return `${name} loses ${delta.toFixed(2)} kcal/mol of binding affinity at ${variant} — consistent with a resistance mutation against this scaffold.`;
  }
  if (delta > 0.2) {
    return `${name} binds ${variant} slightly worse than WT (Δ = +${delta.toFixed(2)}). Likely within docking noise — verify with rescoring.`;
  }
  return `${name} binds ${variant} comparably to WT (Δ = ${delta.toFixed(2)} kcal/mol). The mutation is unlikely to affect this compound's binding.`;
}
