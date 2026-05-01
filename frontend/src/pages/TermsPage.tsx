import { Link } from "react-router-dom";
import { usePageMeta } from "../lib/usePageMeta";

/**
 * Terms of Service — sets expectations for what Liganx is, what it isn't,
 * and what users agree to when they hit the API. Critically: we explicitly
 * call out that docking scores are NOT clinical predictions, because the
 * platform is good enough that biologists may take it more seriously
 * than they should without this disclaimer.
 */
export default function TermsPage() {
  usePageMeta({
    title: "Terms of Service · Liganx",
    description: "Terms of service for Liganx — research-preview free molecular docking. What we offer, what we don't promise, and how docking scores should be interpreted.",
  });
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10 prose prose-slate dark:prose-invert">
      <h1 className="text-3xl font-bold text-ink dark:text-white mb-1">Terms of Service</h1>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-8">
        Last updated: April 28, 2026 · Liganx Beta
      </p>

      <h2 className="text-lg font-semibold text-ink dark:text-white mt-6 mb-2">What Liganx is</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Liganx is a research-preview tool that runs computational molecular
        docking (AutoDock Vina + Vinardo rescoring) against wild-type and
        mutant protein structures, with mutation models built by FoldX or
        PDBFixer and contact analysis by ProLIF + PoseBusters. It exists to
        help you triage compounds and mutations quickly, not to replace
        wet-lab validation or clinical decision-making.
      </p>

      <h2 className="text-lg font-semibold text-ink dark:text-white mt-6 mb-2">What Liganx isn't</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Docking scores are <strong>not</strong> binding affinity measurements.
        They're a numerical heuristic for ranking poses and (with care)
        comparing close analogs. Vina scores at exhaustiveness 8 have
        typical noise of ±1 kcal/mol; deltas under that are unreliable.
        Single-conformation docking can't capture allosteric effects,
        induced fit, or the consequences of mutations that change protein
        conformation rather than pocket geometry. Cells with a "outside
        pocket" badge mean exactly that — the method can't see those
        mutations and is honestly telling you so.
      </p>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Liganx output is <strong>not medical advice</strong> and not a
        substitute for clinical, regulatory, or experimental validation.
        Don't make patient-care decisions from a Liganx matrix.
      </p>

      <h2 className="text-lg font-semibold text-ink dark:text-white mt-6 mb-2">Acceptable use</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        You may use Liganx for academic research, drug-discovery exploration,
        teaching, and personal learning. Don't submit structures or compounds
        you don't have rights to share, don't try to use the API as a
        public file host, and don't scrape the public job pages (the share
        IDs are random per job, but mass-enumeration is still abuse).
        Reasonable rate limits apply on a per-IP basis to keep the GPU
        backend responsive for everyone.
      </p>

      <h2 className="text-lg font-semibold text-ink dark:text-white mt-6 mb-2">Service & accuracy</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Liganx is provided as-is during the beta period without warranty.
        We try to keep the API up but don't guarantee uptime. Catalog data
        (PDB structures, mutation libraries, reference compounds) is curated
        from public sources and may contain errors — see the matrix
        provenance tags (foldx_precached / pdbfixer_mutated /
        mutant_verify_failed / mutation_outside_pocket) for the per-cell
        confidence story. If you spot an error, please tell us.
      </p>

      <h2 className="text-lg font-semibold text-ink dark:text-white mt-6 mb-2">Liability</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        To the extent permitted by law, Liganx and its operators are not
        liable for any direct, indirect, incidental, or consequential
        damages arising from use of the platform, including but not limited
        to lost research time, missed lab opportunities, or decisions made
        on the basis of computational predictions.
      </p>

      <h2 className="text-lg font-semibold text-ink dark:text-white mt-6 mb-2">Changes</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        We update these terms occasionally. Material changes will be flagged
        on the homepage with a banner for at least a week before they take
        effect. See also our{" "}
        <Link to="/privacy" className="text-delta-700 dark:text-delta-400 underline">Privacy Policy</Link>.
      </p>
    </div>
  );
}
