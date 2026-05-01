import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type CatalogTarget } from "../api";
import { ArrowRight, Spinner, Target } from "../components/Icons";
import { usePageMeta } from "../lib/usePageMeta";

// Featured-validation row data shape — a small subset of what the public
// /validation page renders, just enough to surface the eight literature-
// anchored cases as one-click jobs from the library landing page.
type ValidationCase = {
  name: string;
  pdb_id: string;
  mutation: string;
  drug_name: string;
  expected_direction: "resistance" | "selectivity" | "retained";
  share_id: string | null;
  delta_kcal: number | null;
  verdict: "PASS" | "FAIL" | "NOISE" | "SKIP";
};
type ValidationData = {
  timestamp_utc: string;
  summary: { total: number; pass: number; fail: number; noise: number; skip: number };
  cases: ValidationCase[];
};

export default function LibraryPage() {
  // Per-page SEO metadata: target the "kinase mutation library" / "EGFR
  // T790M docking" / "BCR-ABL T315I docking" intent buckets. Description
  // names a few mutation flagships so the snippet matches more queries.
  usePageMeta({
    title: "Mutation library — EGFR, BCR-ABL, BRAF, KRAS · Liganx",
    description:
      "Curated library of clinically actionable kinase mutations (EGFR T790M, BCR-ABL T315I, BRAF V600E, KRAS G12C, ALK G1202R) with one-click molecular docking. Free for academic use.",
  });

  const { data, isLoading } = useQuery({ queryKey: ["catalog"], queryFn: api.catalog });

  // Pull the validation snapshot so we can offer a "see the proof" featured
  // row at the top of the library — anyone browsing for a target sees the
  // live jobs that back our scientific claims. The page is on the same
  // origin so the JSON is served from the static frontend bundle.
  const [validation, setValidation] = useState<ValidationData | null>(null);
  useEffect(() => {
    fetch("/validation_results.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setValidation)
      .catch(() => {
        /* validation snapshot is best-effort — library page still renders without it */
      });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-500">
        <Spinner size={20} className="mr-2" /> Loading library…
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <header>
        <div className="eyebrow">Curated mutation library</div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink dark:text-slate-100">
          Clinically actionable targets, ready to dock.
        </h1>
        <p className="mt-2 muted max-w-2xl dark:text-slate-300">
          Each entry includes a default WT structure with a pre-defined pocket box, the
          mutations that matter clinically, and approved or well-characterized reference
          compounds — so you're docking real chemistry against the right pockets in seconds.
        </p>
      </header>

      {validation && validation.cases.length > 0 && (
        <ValidationFeatureRow data={validation} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {data?.map((t) => (
          <TargetCard key={t.id} target={t} />
        ))}
      </div>
    </div>
  );
}

// Featured row that promotes the public validation suite as a marketing
// surface on the library page. The argument: "you don't have to take our
// numbers on faith — these eight literature-anchored cases ran on the same
// pipeline you're about to use, and the live jobs are linked." Each case
// chip links to its public job page; the row also links to /validation for
// the full per-case methodology, caveats, and source script.
function ValidationFeatureRow({ data }: { data: ValidationData }) {
  return (
    <section className="rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-950/30 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow text-emerald-700 dark:text-emerald-300">
            Backed by literature
          </div>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-ink dark:text-white">
            Eight validated cases — run live, public jobs.
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
            Eight published mutation/drug pairs run on this pipeline. {data.summary.pass} resolve
            cleanly with the literature-direction, {data.summary.noise} sit in documented
            method-limit territory (covalent or active-conformation effects Vina cannot model),
            and {data.summary.fail} we explain candidly rather than hide. Click any case for
            its live job, or open /validation for the full methodology.
          </p>
        </div>
        <Link
          to="/validation"
          className="btn-secondary btn-sm shrink-0"
          title="Public scientific-validation page"
        >
          See full validation <ArrowRight size={12} />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {data.cases.map((c) => (
          <ValidationCaseChip key={c.name} c={c} />
        ))}
      </div>
    </section>
  );
}

function ValidationCaseChip({ c }: { c: ValidationCase }) {
  // Pull a concise [TARGET MUT — DRUG] label from the canonical case name.
  const compact = c.name.split("—").map((s) => s.trim());
  const left = compact[0] || c.name;
  const right = compact[1] || c.drug_name;

  // Verdict pill colour — emerald/amber/rose/slate matches the validation page.
  const verdictClass =
    c.verdict === "PASS"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : c.verdict === "NOISE"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : c.verdict === "FAIL"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";

  const deltaLabel =
    c.delta_kcal === null
      ? "—"
      : `${c.delta_kcal >= 0 ? "+" : ""}${c.delta_kcal.toFixed(2)}`;

  // SKIP cases have no share_id — render as a non-clickable chip.
  const inner = (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 transition hover:border-emerald-400 dark:hover:border-emerald-700">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
          {left}
        </div>
        <div className="text-sm font-semibold text-ink dark:text-slate-100 truncate">
          {right}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300">
          Δ {deltaLabel}
        </span>
        <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${verdictClass}`}>
          {c.verdict}
        </span>
      </div>
    </div>
  );

  return c.share_id ? (
    <Link to={`/jobs/${c.share_id}`} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function TargetCard({ target }: { target: CatalogTarget }) {
  return (
    <article className="card-hover">
      <header className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-delta-500 to-accent-500 text-white flex items-center justify-center shadow-sm">
              <Target size={18} />
            </span>
            <div>
              <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500">{target.uniprot} · PDB {target.pdb_id}</div>
              <h2 className="text-lg font-bold text-ink dark:text-slate-100 leading-tight">{target.name}</h2>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {target.indications.map((ind) => (
              <span key={ind} className="badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">{ind}</span>
            ))}
          </div>
        </div>
        <Link
          to={`/new?target=${target.id}`}
          className="btn-secondary btn-sm shrink-0"
          title="Pre-fill new job with this target"
        >
          Use <ArrowRight size={12} />
        </Link>
      </header>

      <p className="text-sm text-slate-600 leading-relaxed dark:text-slate-400">{target.description}</p>

      <div className="mt-4">
        <div className="label">Mutations ({target.mutations.length})</div>
        <div className="flex flex-wrap gap-1.5">
          {target.mutations.map((m) => (
            <span key={m.code} className="chip" title={m.significance}>
              <span className="font-mono font-semibold">{m.code}</span>
              <span className="hidden md:inline text-slate-500 font-normal">— {m.significance.split(",")[0]}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="label">Reference compounds ({target.compounds.length})</div>
        <ul className="text-xs space-y-1">
          {target.compounds.map((c) => (
            <li key={c.name} className="flex items-baseline gap-2">
              <span className="font-semibold text-ink dark:text-slate-100">{c.name}</span>
              <span className="text-slate-500 dark:text-slate-400">— {c.mechanism}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
