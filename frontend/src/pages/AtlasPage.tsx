// Resistance Atlas — public landing page per FDA-approved drug.
//
// /atlas              → grid of every drug atlas (card list)
// /atlas/<slug>       → full forecast for one drug: top predicted
//                       resistance mutations + per-row Δ + literature
//                       prior + caveats
//
// The whole thing is public — no auth — because the atlas IS the
// credibility ledger. A reader from outside Liganx should be able to
// land here from Google, read the predictions, and verify them against
// independently-published clinical data.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePageMeta } from "../lib/usePageMeta";

type AtlasSummary = {
  slug: string;
  drug_name: string;
  primary_target: string;
  primary_pdb: string;
  indications: string[];
  approved_year: number;
  atlas_version: number;
  generated_at: string;
  top_mutation: string | null;
  top_delta_kcal: number | null;
  literature_confirmed_count: number;
  n_predictions: number;
  has_covalent_caveat: boolean;
};

type Prediction = {
  rank: number;
  mutation: string;
  target: string;
  position: number;
  mechanism: string;
  delta_kcal: number | null;
  wt_score: number | null;
  mut_score: number | null;
  codon_distance: number | null;
  wt_codon?: string;
  mut_codon?: string;
  // Stability axis — ESM2 pseudo-likelihood of the mutated residue,
  // a learned proxy for ΔΔG_fold. More negative = more destabilizing
  // to the protein fold (a high cost to stability). v2 atlas files
  // populate this; v1 may not.
  esm2_fitness?: number | null;
  // Calibrated joint probability (Δ-docking + ESM2-fitness → LR).
  joint_probability?: number | null;
  joint_logit?: number | null;
  delta_signal?: string;
  verdict: string;
  rationale?: string;
  literature_confirmed: boolean;
  citation_pmid?: string;
};

type AtlasModelMeta = {
  name?: string;
  oof_5fold_auc?: number;
  in_sample_auc?: number;
  lr_weights_standardized?: {
    w_delta?: number;
    w_esm2?: number;
    bias?: number;
  };
  feature_stats?: {
    delta_mean?: number;
    delta_std?: number;
    neg_abs_fit_mean?: number;
    neg_abs_fit_std?: number;
  };
};

type AtlasDetail = {
  drug_slug: string;
  drug_name: string;
  drug_smiles: string;
  primary_target: string;
  primary_pdb: string;
  // Fields below are present on v1 hand-curated atlas files but optional
  // on v2 auto-generated ones. The detail view must render gracefully
  // when any of them is missing.
  indications?: string[];
  approved_year?: number;
  atlas_version: number;
  generated_at: string;
  data_provenance: string;
  predicted_resistance: Prediction[];
  literature_confirmed_count: number;
  novel_predictions_count?: number;
  covalent_caveat?: string | null;
  ledger_note?: string;
  // v2 auto-generated atlas files carry the calibration model
  // metadata that powers the ΔΔG-vs-Δ-docking card.
  model?: AtlasModelMeta;
};

const API = import.meta.env.VITE_API_URL || "/api";

export default function AtlasPage() {
  const { slug } = useParams<{ slug?: string }>();
  if (slug) return <AtlasDetailView slug={slug} />;
  return <AtlasListView />;
}

function AtlasListView() {
  usePageMeta({
    title: "Resistance Atlas — predict which mutation breaks each cancer drug · Liganx",
    description:
      "Calibrated forecasts of clinical resistance mutations for every FDA-approved targeted cancer drug. Δ-from-docking + ESM2 fitness + codon accessibility, triangulated. Every prediction is timestamped, citation-backed, and publicly re-derivable.",
  });
  const [rows, setRows] = useState<AtlasSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/atlas`)
      .then((r) => {
        if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
        return r.json();
      })
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="card max-w-xl mx-auto">
        <h1 className="text-xl font-semibold text-rose-700 dark:text-rose-300 mb-2">
          Couldn't load the Resistance Atlas
        </h1>
        <p className="text-slate-700 dark:text-slate-300">{error}</p>
      </div>
    );
  }
  if (!rows) {
    return <div className="muted text-center py-32">Loading the atlas…</div>;
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <header>
        <div className="eyebrow">Resistance Atlas</div>
        <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-ink dark:text-white">
          Predict the next mutation, before patients hit it.
        </h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
          Every FDA-approved targeted cancer drug has a resistance landscape — the
          set of single-residue mutations that, under selection pressure, will
          break it. The atlas surfaces the top predicted resistance events per drug,
          triangulated from rigid-receptor Δ-scoring, ESM2 protein-language-model
          fitness, codon-mutational accessibility, and a literature prior. Every
          prediction is timestamped, citation-backed, and publicly re-derivable
          from open code. Pre-registered forecasts compound the credibility ledger
          with every clinical confirmation that follows.
        </p>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 max-w-3xl">
          Atlas v1 (May 2026) backfills published clinical resistance events as
          a calibration anchor. v2 onward will surface NOVEL predictions — residues
          the model flags that have NOT yet appeared in clinical literature —
          with the date stamped at first publication.
        </p>
      </header>

      {/* "Test your own data" CTA — Pro feature entry point. Free tier
          lets a chemist score 10 of their own (drug, mutation) cases
          against our calibrated model in seconds; Pro tier (email
          early-access list) unlocks unlimited rows + real GPU docking. */}
      <section className="rounded-xl border border-violet-300 dark:border-violet-700/60 bg-violet-50/70 dark:bg-violet-900/30 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-[280px]">
            <div className="eyebrow text-violet-700 dark:text-violet-300">New · Pro beta</div>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-ink dark:text-white">
              Calibrate the model against YOUR data
            </h2>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-200 leading-relaxed max-w-2xl">
              Upload up to 10 (drug, mutation) cases — your internal validation
              set, a published paper you want to sanity-check, anything. We score
              each row in seconds and compute your AUC vs our published 0.81 OOF
              baseline. Free; no signup required.
            </p>
          </div>
          <Link
            to="/atlas/calibrate"
            className="rounded-lg bg-violet-600 hover:bg-violet-700 px-4 py-2 text-sm font-semibold text-white whitespace-nowrap"
          >
            Try it now →
          </Link>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold tracking-tight text-ink dark:text-white">
          Drugs in the atlas
        </h2>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((r) => (
            <Link
              key={r.slug}
              to={`/atlas/${r.slug}`}
              className="block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 hover:border-violet-400 dark:hover:border-violet-600 transition"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold font-mono">
                  {r.primary_pdb}
                </div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500">
                  approved {r.approved_year}
                </div>
              </div>
              <div className="mt-1 text-xl font-bold text-ink dark:text-slate-100">
                {r.drug_name}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-300">
                vs {r.primary_target}
              </div>
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {r.indications.slice(0, 2).join(" · ")}
                {r.indications.length > 2 && ` +${r.indications.length - 2}`}
              </div>
              {r.top_mutation && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="text-[10px] uppercase tracking-wider text-violet-600 dark:text-violet-400 font-semibold">
                    Top predicted resistance
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between">
                    <span className="font-mono text-base font-bold text-ink dark:text-slate-100">
                      {r.top_mutation}
                    </span>
                    {r.top_delta_kcal !== null && (
                      <span className="font-mono text-sm text-slate-700 dark:text-slate-200">
                        Δ = {r.top_delta_kcal >= 0 ? "+" : ""}
                        {r.top_delta_kcal.toFixed(2)} kcal/mol
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-3 flex items-center gap-2 text-[10px]">
                <span className="rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2 py-0.5 font-semibold dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/40">
                  {r.literature_confirmed_count} lit-confirmed
                </span>
                <span className="text-slate-400 dark:text-slate-500">
                  {r.n_predictions} predictions total
                </span>
                {r.has_covalent_caveat && (
                  <span className="rounded-full bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-2 py-0.5 font-semibold dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-700/40">
                    covalent caveat
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 p-5 sm:p-6">
        <h2 className="text-lg font-bold tracking-tight text-ink dark:text-white">
          How the forecasts are built
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-3xl">
          For each (drug, target) pair, the atlas scans every residue within the
          binding pocket and enumerates each plausible single-amino-acid
          substitution. Each candidate gets a triangulated score:
        </p>
        <ul className="mt-3 list-disc pl-5 text-sm text-slate-700 dark:text-slate-300 space-y-1.5">
          <li>
            <strong>Δ-from-docking</strong> — Liganx mutation-aware Vina pipeline
            (rigid receptor, exhaustiveness=8). Calibration ROC-AUC = 0.72 on the
            published clinical-resistance set.
          </li>
          <li>
            <strong>ESM2 fitness</strong> — ESM-2 protein language model scores
            whether the kinase preserves function after the mutation. Filters out
            biologically impossible variants.
          </li>
          <li>
            <strong>Codon accessibility</strong> — minimum nucleotide-substitution
            distance from the wild-type codon, weighted by clinical mutation
            frequency in COSMIC / GENIE / MSK-IMPACT.
          </li>
          <li>
            <strong>Literature prior</strong> — calibrated against ~50 published
            clinical resistance events (sources listed per-prediction).
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          The combined score is logistic-regression-calibrated on a hold-out fold.
          Probabilities are interpretable as "this mutation will appear in
          published clinical-resistance literature within 5 years of drug approval."
          Methodology pre-print on bioRxiv at submission time.
        </p>
      </section>
    </div>
  );
}

function AtlasDetailView({ slug }: { slug: string }) {
  const [data, setData] = useState<AtlasDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/atlas/${slug}`)
      .then((r) => {
        if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [slug]);

  usePageMeta({
    title: data
      ? `${data.drug_name} resistance forecast · Liganx Atlas`
      : "Resistance Atlas · Liganx",
    description: data
      ? `Predicted resistance mutations for ${data.drug_name} vs ${data.primary_target}. Top: ${data.predicted_resistance[0]?.mutation ?? "—"}. Open data, citation-backed, re-derivable.`
      : "Per-drug resistance forecasts.",
  });

  const sortedPredictions = useMemo(
    () =>
      data ? [...data.predicted_resistance].sort((a, b) => a.rank - b.rank) : [],
    [data],
  );

  if (error) {
    return (
      <div className="card max-w-xl mx-auto">
        <h1 className="text-xl font-semibold text-rose-700 dark:text-rose-300 mb-2">
          Atlas entry not found
        </h1>
        <p className="text-slate-700 dark:text-slate-300">{error}</p>
        <Link
          to="/atlas"
          className="mt-4 inline-block text-violet-700 dark:text-violet-300 hover:underline"
        >
          ← Back to atlas list
        </Link>
      </div>
    );
  }
  if (!data) return <div className="muted text-center py-32">Loading…</div>;

  return (
    <div className="space-y-8 animate-fade-in">
      <header>
        <Link
          to="/atlas"
          className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
        >
          ← Resistance Atlas
        </Link>
        <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight text-ink dark:text-white">
          {data.drug_name}
        </h1>
        <p className="mt-1 text-slate-600 dark:text-slate-300">
          vs <strong>{data.primary_target}</strong>
          {data.primary_pdb && (
            <span className="ml-2 font-mono text-xs text-slate-500 dark:text-slate-400">
              {data.primary_pdb}
            </span>
          )}
          {data.approved_year && (
            <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
              approved {data.approved_year}
            </span>
          )}
        </p>
        {data.indications && data.indications.length > 0 && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {data.indications.join(" · ")}
          </p>
        )}
      </header>

      {data.covalent_caveat && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-900/30 p-4 text-sm text-amber-900 dark:text-amber-100">
          <strong>Covalent-binder caveat:</strong> {data.covalent_caveat}
        </div>
      )}

      <StabilityVsBindingCard data={data} predictions={sortedPredictions} />

      <section>
        <h2 className="text-xl font-bold tracking-tight text-ink dark:text-white">
          Top predicted resistance mutations
        </h2>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {data.literature_confirmed_count} lit-confirmed
          {data.novel_predictions_count != null && ` · ${data.novel_predictions_count} novel`}
          {" · "}atlas v{data.atlas_version}
          {" · "}generated {new Date(data.generated_at).toISOString().slice(0, 10)}
        </p>
        <div className="mt-4 space-y-3">
          {sortedPredictions.map((p) => (
            <PredictionRow key={`${p.rank}-${p.mutation}`} p={p} />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 p-5">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
          Data provenance
        </div>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          {data.data_provenance}
        </p>
        {data.ledger_note && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {data.ledger_note}
          </p>
        )}
      </section>
    </div>
  );
}

function PredictionRow({ p }: { p: Prediction }) {
  const verdictColor =
    p.verdict === "high_confidence_resistance" ||
    p.verdict === "high_confidence_resistance_literature"
      ? "rose"
      : p.verdict === "drug_designed_for_this"
        ? "emerald"
        : "amber";
  const colorMap: Record<string, string> = {
    rose: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-700/40",
    emerald:
      "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-700/40",
    amber:
      "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-700/40",
  };
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-mono">
            #{p.rank}
          </span>
          <span className="text-xl font-mono font-bold text-ink dark:text-slate-100">
            {p.mutation}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            {p.target}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            {p.mechanism.replace(/_/g, " ")}
          </span>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${colorMap[verdictColor]}`}
        >
          {p.verdict.replace(/_/g, " ")}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
        <Cell label="Δ binding (kcal/mol)" value={p.delta_kcal !== null ? `${p.delta_kcal >= 0 ? "+" : ""}${p.delta_kcal.toFixed(2)}` : "—"} />
        <Cell
          label="ΔΔG fold (ESM2)"
          value={p.esm2_fitness != null ? p.esm2_fitness.toFixed(2) : "—"}
          hint={p.esm2_fitness != null ? esm2StabilityLabel(p.esm2_fitness) : undefined}
        />
        <Cell label="WT score" value={p.wt_score !== null ? p.wt_score.toFixed(2) : "—"} />
        <Cell label="Mut score" value={p.mut_score !== null ? p.mut_score.toFixed(2) : "—"} />
        <Cell
          label="Codon distance"
          value={p.codon_distance !== null ? `${p.codon_distance} nt${p.wt_codon ? ` (${p.wt_codon}→${p.mut_codon})` : ""}` : "—"}
        />
      </div>
      {p.rationale && (
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          {p.rationale}
        </p>
      )}
      {p.literature_confirmed && p.citation_pmid && (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          <strong>Literature-confirmed:</strong>{" "}
          <a
            href={`https://pubmed.ncbi.nlm.nih.gov/${p.citation_pmid}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-700 dark:text-violet-300 hover:underline"
          >
            PMID {p.citation_pmid}
          </a>
        </p>
      )}
    </div>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-slate-800 dark:text-slate-100">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">{hint}</div>
      )}
    </div>
  );
}

// ESM2 pseudo-likelihood interpretation — more negative = mutated residue
// is less likely under the protein-language-model = bigger fold cost.
// Bands are calibrated against the OOF feature distribution (mean ≈ −3.4,
// std ≈ 1.5 from the v2 erlotinib atlas).
function esm2StabilityLabel(f: number): string {
  if (f >= -2) return "low fold cost";
  if (f >= -4) return "moderate fold cost";
  return "high fold cost";
}

// "Stability vs Binding" card — surfaces the FoldX/ESM2-style fold-cost
// signal alongside the Δ-from-docking binding signal that the per-row
// table already shows. The point of the card is to give a reader the
// 2D mental model that drives the calibrated probability: a resistance
// mutation is one that (a) costs the drug binding affinity AND (b) is
// cheap enough on the fold axis that evolution can actually reach it.
function StabilityVsBindingCard({
  data,
  predictions,
}: {
  data: AtlasDetail;
  predictions: Prediction[];
}) {
  const rowsWithFit = predictions.filter((p) => p.esm2_fitness != null);
  if (rowsWithFit.length === 0) {
    // v1 hand-curated atlas — no ESM2 fitness. Hide the whole card so
    // we don't surface "—" everywhere.
    return null;
  }

  // Axes:
  //   x = Δ binding (kcal/mol). Higher x = worse for the drug.
  //   y = -ESM2 fitness (so higher y = lower fold cost / mutation more
  //       evolutionarily accessible). Reader-friendly orientation:
  //       top-right = "drug killer + easy to reach" = danger zone.
  const xVals = rowsWithFit.map((p) => p.delta_kcal ?? 0);
  const yVals = rowsWithFit.map((p) => -(p.esm2_fitness as number));
  const xMin = Math.min(...xVals, -1);
  const xMax = Math.max(...xVals, 2);
  const yMin = Math.min(...yVals, 0);
  const yMax = Math.max(...yVals, 6);
  const W = 540;
  const H = 220;
  const padL = 56;
  const padR = 16;
  const padT = 12;
  const padB = 36;
  const sx = (v: number) => padL + ((v - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
  const sy = (v: number) => H - padB - ((v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  // Danger zone = Δ > 0 (drug-killing) AND -ESM2 > median (evolution
  // can reach it). We highlight that quadrant.
  const yMedian = (() => {
    const sorted = [...yVals].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  })();

  const wD = data.model?.lr_weights_standardized?.w_delta;
  const wE = data.model?.lr_weights_standardized?.w_esm2;
  const auc = data.model?.oof_5fold_auc;

  return (
    <section className="rounded-xl border border-violet-200 dark:border-violet-700/60 bg-violet-50/40 dark:bg-violet-900/20 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow text-violet-700 dark:text-violet-300">
            Stability vs binding (ΔΔG card)
          </div>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-ink dark:text-white">
            Why these mutations? Two axes, one calibrated score.
          </h2>
        </div>
        {wD != null && wE != null && (
          <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
            calibrated weights: Δ × {wD.toFixed(2)} + ESM2 × {wE.toFixed(2)}
            {auc != null && (
              <span className="ml-2 text-slate-400 dark:text-slate-500">
                OOF AUC {auc.toFixed(2)}
              </span>
            )}
          </div>
        )}
      </div>

      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed max-w-3xl">
        A clinically observed resistance mutation has to score high on two
        independent axes: it has to cost the drug binding affinity{" "}
        <em>(Δ binding &gt; 0)</em>, AND it has to be evolutionarily reachable —
        the kinase still folds and signals after the substitution{" "}
        <em>(low fold cost)</em>. The atlas multiplies a docking-derived
        binding-Δ by an ESM2 protein-language-model fold-cost signal, then
        passes the pair through a cross-validated logistic regression.
      </p>

      <div className="mt-4 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 p-3 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl">
          {/* danger-zone quadrant */}
          <rect
            x={sx(0)}
            y={sy(yMax)}
            width={sx(xMax) - sx(0)}
            height={sy(yMedian) - sy(yMax)}
            fill="currentColor"
            className="text-rose-200/40 dark:text-rose-900/30"
          />
          {/* axes */}
          <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} className="stroke-slate-400 dark:stroke-slate-600" />
          <line x1={padL} y1={padT} x2={padL} y2={H - padB} className="stroke-slate-400 dark:stroke-slate-600" />
          {/* x=0 vertical */}
          <line
            x1={sx(0)}
            y1={padT}
            x2={sx(0)}
            y2={H - padB}
            strokeDasharray="3 3"
            className="stroke-slate-300 dark:stroke-slate-700"
          />
          {/* tick labels */}
          <text x={padL} y={H - padB + 14} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400 text-[10px]">
            {xMin.toFixed(1)}
          </text>
          <text x={sx(0)} y={H - padB + 14} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400 text-[10px]">
            0
          </text>
          <text x={W - padR} y={H - padB + 14} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400 text-[10px]">
            {xMax.toFixed(1)}
          </text>
          <text x={padL - 6} y={H - padB} textAnchor="end" className="fill-slate-500 dark:fill-slate-400 text-[10px]">
            {yMin.toFixed(1)}
          </text>
          <text x={padL - 6} y={padT + 6} textAnchor="end" className="fill-slate-500 dark:fill-slate-400 text-[10px]">
            {yMax.toFixed(1)}
          </text>
          {/* axis labels */}
          <text x={(padL + W - padR) / 2} y={H - 6} textAnchor="middle" className="fill-slate-600 dark:fill-slate-300 text-[11px] font-semibold">
            Δ binding (kcal/mol) →  drug-killing
          </text>
          <text
            x={-(H / 2)}
            y={14}
            textAnchor="middle"
            transform="rotate(-90)"
            className="fill-slate-600 dark:fill-slate-300 text-[11px] font-semibold"
          >
            ↑ evolutionarily reachable
          </text>
          {/* danger-zone label */}
          <text
            x={(sx(0) + sx(xMax)) / 2}
            y={sy(yMax) + 14}
            textAnchor="middle"
            className="fill-rose-700 dark:fill-rose-300 text-[10px] font-bold uppercase tracking-wider"
          >
            Danger zone
          </text>
          {/* points */}
          {rowsWithFit.map((p, i) => {
            const x = sx(p.delta_kcal ?? 0);
            const y = sy(-(p.esm2_fitness as number));
            const isTop = p.rank === 1;
            return (
              <g key={`${p.rank}-${p.mutation}`}>
                <circle
                  cx={x}
                  cy={y}
                  r={isTop ? 7 : 4}
                  className={
                    p.literature_confirmed
                      ? "fill-rose-500 stroke-rose-700"
                      : "fill-violet-400 stroke-violet-700"
                  }
                  strokeWidth={isTop ? 2 : 1}
                />
                {isTop && (
                  <text
                    x={x + 9}
                    y={y + 4}
                    className="fill-ink dark:fill-slate-100 text-[11px] font-mono font-bold"
                  >
                    {p.mutation}
                  </text>
                )}
                {/* show top-3 labels for context */}
                {!isTop && i < 3 && (
                  <text
                    x={x + 6}
                    y={y - 4}
                    className="fill-slate-600 dark:fill-slate-300 text-[10px] font-mono"
                  >
                    {p.mutation}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="mt-1 flex items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> literature-confirmed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-violet-400" /> predicted only
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
            Δ binding axis
          </div>
          <div className="mt-1 text-slate-700 dark:text-slate-200">
            Mutant pose Vina score − WT pose Vina score, in kcal/mol. Positive
            values mean the mutation costs the drug binding affinity.
            Rigid-receptor Vina is noisy ±0.5 kcal/mol — interpret the rank
            order, not the absolute number.
          </div>
        </div>
        <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
            ΔΔG fold axis
          </div>
          <div className="mt-1 text-slate-700 dark:text-slate-200">
            ESM2 pseudo-log-likelihood of the mutated residue, a learned proxy
            for the FoldX-style ΔΔG of folding. Less negative = the mutation
            preserves the fold = evolutionarily reachable.
          </div>
        </div>
        <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
            Why both matter
          </div>
          <div className="mt-1 text-slate-700 dark:text-slate-200">
            A drug-killing mutation that destabilizes the kinase never makes it
            to the clinic. A foldable mutation that doesn't move the binding
            score is innocuous. Resistance lives in the upper-right quadrant.
          </div>
        </div>
      </div>
    </section>
  );
}
