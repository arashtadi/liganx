import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type CatalogTarget, type PrecomputedSummary } from "../api";
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

  // v1.23 P1.4: precomputed library screenings. The list endpoint is
  // cheap (lean summary shape) and public. Returns [] gracefully when
  // P1.5 hasn't run the matrix yet, so we don't need a separate error
  // state — the section just hides itself in that case.
  const { data: precomputed } = useQuery({
    queryKey: ["library", "precomputed"],
    queryFn: api.listPrecomputed,
    staleTime: 60_000,
  });

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

      {/* v1.23 P1.4: precomputed library screenings hero section.
          Above the validation panel and the catalog grid because the
          immediate-result UX ("click and see hits, no setup") is the
          strongest hook for a new visitor. Hidden when no snapshots
          have shipped yet so the page doesn't render an empty section. */}
      {precomputed && precomputed.length > 0 && (
        <PrecomputedSection rows={precomputed} />
      )}

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

// v1.23 P1.4: pre-computed screenings landing-section. Renders a grid
// of cards, one per snapshot file in backend/data/precomputed_screenings/.
// Each card links to /library/precomputed/<slug> which reuses
// ScreeningPage in read-only mode for the actual ranked-hit-list view.
//
// The pitch we want a first-time visitor to see: "These screenings are
// already done. Click and see the top hits — no setup, no GPU wait."
function PrecomputedSection({ rows }: { rows: PrecomputedSummary[] }) {
  return (
    <section className="rounded-xl border border-violet-200 dark:border-violet-800/60 bg-violet-50/60 dark:bg-violet-950/30 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="eyebrow text-violet-700 dark:text-violet-300">
            Ready to explore · pre-computed
          </div>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-ink dark:text-white">
            Curated library screened — top hits in one click.
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
            We already ran 30 FDA-launched kinase inhibitors against every
            resistance mutation in our catalog. Pick a mutation and see
            ranked selectivity hits — no setup, no GPU wait.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((r) => (
          <PrecomputedCard key={r.slug} r={r} />
        ))}
      </div>
    </section>
  );
}

function PrecomputedCard({ r }: { r: PrecomputedSummary }) {
  const mutLabel =
    r.mutations.length > 0 ? r.mutations.join(" + ") : "WT only";
  return (
    <Link
      to={`/library/precomputed/${r.slug}`}
      className="block rounded-lg bg-white/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 hover:border-violet-400 dark:hover:border-violet-600 transition px-4 py-3"
    >
      <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {r.pdb_id} · chain {r.chain}
      </div>
      <div className="mt-1 text-base font-bold text-ink dark:text-slate-100 leading-tight">
        {mutLabel}
      </div>
      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
        {/* v1.23.1: show how many compounds actually docked vs the
            library size. n_total = 2 cells per compound (WT + mutant),
            so screened = n_total / 2. Honest reporting — earlier
            iterations said "30 cmpds" when only 10 had real Vina
            scores, which misled at-a-glance. */}
        vs {r.library_name} ({Math.floor(r.n_total / 2)} / {r.library_compound_count} screened)
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2">
          <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
            {r.n_completed}/{r.n_total} cells
          </span>
          {r.n_failed > 0 && (
            <span className="font-mono tabular-nums text-rose-500">
              · {r.n_failed} failed
            </span>
          )}
        </div>
        {r.n_hits > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            {r.n_hits} hit{r.n_hits === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-slate-400 dark:text-slate-600 text-[10px]">
            no selectivity hits
          </span>
        )}
      </div>
      {r.top_hit_name && r.top_hit_selectivity != null && (
        <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
          <span className="text-slate-500 dark:text-slate-400">Top hit</span>
          <span className="font-mono text-slate-700 dark:text-slate-200 truncate ml-2">
            {r.top_hit_name}{" "}
            <span className="text-violet-600 dark:text-violet-400 font-semibold">
              sel {r.top_hit_selectivity.toFixed(2)}
            </span>
          </span>
        </div>
      )}
    </Link>
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
          to={`/studio?target=${target.id}`}
          className="btn-secondary btn-sm shrink-0"
          title="Open Studio with this target pre-filled"
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
