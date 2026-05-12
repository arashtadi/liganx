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
  delta_signal: string;
  verdict: string;
  rationale: string;
  literature_confirmed: boolean;
  citation_pmid?: string;
};

type AtlasDetail = {
  drug_slug: string;
  drug_name: string;
  drug_smiles: string;
  primary_target: string;
  primary_pdb: string;
  indications: string[];
  approved_year: number;
  atlas_version: number;
  generated_at: string;
  data_provenance: string;
  predicted_resistance: Prediction[];
  literature_confirmed_count: number;
  novel_predictions_count: number;
  covalent_caveat?: string;
  ledger_note: string;
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
          <span className="ml-2 font-mono text-xs text-slate-500 dark:text-slate-400">
            {data.primary_pdb}
          </span>
          <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
            approved {data.approved_year}
          </span>
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {data.indications.join(" · ")}
        </p>
      </header>

      {data.covalent_caveat && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-900/30 p-4 text-sm text-amber-900 dark:text-amber-100">
          <strong>Covalent-binder caveat:</strong> {data.covalent_caveat}
        </div>
      )}

      <section>
        <h2 className="text-xl font-bold tracking-tight text-ink dark:text-white">
          Top predicted resistance mutations
        </h2>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {data.literature_confirmed_count} lit-confirmed ·{" "}
          {data.novel_predictions_count} novel · atlas v{data.atlas_version}
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
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {data.ledger_note}
        </p>
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
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Cell label="Δ (kcal/mol)" value={p.delta_kcal !== null ? `${p.delta_kcal >= 0 ? "+" : ""}${p.delta_kcal.toFixed(2)}` : "—"} />
        <Cell label="WT score" value={p.wt_score !== null ? p.wt_score.toFixed(2) : "—"} />
        <Cell label="Mut score" value={p.mut_score !== null ? p.mut_score.toFixed(2) : "—"} />
        <Cell
          label="Codon distance"
          value={p.codon_distance !== null ? `${p.codon_distance} nt${p.wt_codon ? ` (${p.wt_codon}→${p.mut_codon})` : ""}` : "—"}
        />
      </div>
      <p className="mt-3 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
        {p.rationale}
      </p>
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

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-slate-800 dark:text-slate-100">
        {value}
      </div>
    </div>
  );
}
