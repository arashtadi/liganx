// Public scientific-validation page. The point of this page is honesty —
// it's where a sceptical med-chemist or structural biologist can verify
// our claims about the platform without taking marketing copy on faith.
//
// What it shows:
//
//   1. Catalog correctness — every catalog target's pocket centre verified
//      against the chain-A co-crystal ligand on RCSB, every promoted
//      mutation classified as in-pocket vs documented out-of-scope.
//      Backed by backend/scripts/verify_catalog.py which gates every
//      Fly deploy via GitHub Actions.
//
//   2. Positive-control validation — eight literature-anchored
//      (target, mutation, drug) pairs with published cellular IC50
//      shifts, run through the live pipeline, with the Δ score we got
//      compared to the published direction.
//
// The data lives in /validation_results.json — refreshed by re-running
// backend/scripts/validate_positive_controls.py and committing the new
// JSON. This file is intentionally NOT calling the API at render time:
// the validation suite takes ~10 minutes wall-clock to run and we don't
// want every page view to charge that bill on the GPU pod. Stale data is
// signalled by the timestamp at the top of the page so a reviewer can see
// when the snapshot was last refreshed.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "../components/Icons";

type Verdict = "PASS" | "FAIL" | "NOISE" | "SKIP";

type Case = {
  name: string;
  pdb_id: string;
  chain: string;
  uniprot_id: string;
  mutation: string;
  drug_name: string;
  expected_direction: "resistance" | "selectivity" | "retained";
  literature: string;
  caveat: string | null;
  share_id: string | null;
  wt_score: number | null;
  mut_score: number | null;
  delta_kcal: number | null;
  verdict: Verdict;
  verdict_note: string;
};

type ValidationData = {
  timestamp_utc: string;
  api_base: string;
  noise_floor_kcal: number;
  summary: { total: number; pass: number; fail: number; noise: number; skip: number };
  cases: Case[];
};

export default function ValidationPage() {
  const [data, setData] = useState<ValidationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/validation_results.json")
      .then((r) => {
        if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="card max-w-xl mx-auto">
        <h1 className="text-xl font-semibold text-rose-700 dark:text-rose-300 mb-2">
          Couldn't load validation data
        </h1>
        <p className="text-slate-700 dark:text-slate-300">{error}</p>
      </div>
    );
  }
  if (!data) {
    return <div className="muted text-center py-32">Loading validation snapshot…</div>;
  }

  // Format the UTC timestamp into something a person reads. Shows "today",
  // "yesterday", or the full date — anything older than that and the page
  // is meaningfully stale and we want the date to read explicitly.
  const ts = new Date(data.timestamp_utc);
  const ageMs = Date.now() - ts.getTime();
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const ageLabel =
    ageDays === 0 ? "today" : ageDays === 1 ? "yesterday" : `${ageDays} days ago`;

  return (
    <div className="space-y-10 animate-fade-in">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header>
        <div className="eyebrow">Scientific validation</div>
        <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-ink dark:text-white">
          Show your work.
        </h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
          We compete with closed proprietary platforms on transparency. This page
          is where a sceptical reader can verify Liganx's scientific claims
          end-to-end — the docking-pocket coordinates we use, the eight
          literature-anchored mutation/drug pairs we run as positive controls,
          and the open-source scripts that re-derive both. Every number below is
          regenerable from the linked code, and the cases where our pipeline
          can&apos;t resolve a published direction are surfaced explicitly with
          the structural-biology reason — not buried, not omitted.
        </p>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Snapshot refreshed <strong>{ageLabel}</strong> ({ts.toISOString().slice(0, 16).replace("T", " ")} UTC)
          {" "}· Source code on{" "}
          <a
            href="https://github.com/arashtadi/liganx/tree/main/backend/scripts"
            target="_blank" rel="noopener noreferrer"
            className="text-delta-700 dark:text-delta-300 hover:underline"
          >
            GitHub
          </a>
        </p>
      </header>

      {/* ── Catalog audit summary ───────────────────────────────────── */}
      <section>
        <h2 className="text-2xl font-bold tracking-tight text-ink dark:text-white">
          Catalog audit
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
          Every catalog target's pocket centre is independently verified against
          the chain-A co-crystal ligand centroid in the canonical RCSB PDB.
          Every promoted mutation is checked for residue identity and
          reachability inside the docking box. The check runs as a blocking
          gate before every backend deploy — a regression cannot ship.
        </p>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Stat label="Catalog targets" value="13" sub="all centres ≤ 5 Å from canonical ligand" />
          <Stat label="Promoted mutations" value="40" sub="across 13 oncology targets" />
          <Stat label="Reachable in pocket" value="32 / 40" sub="8 documented out-of-scope (allosteric, helical-domain, switch-region)" />
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Verification script:{" "}
          <a
            href="https://github.com/arashtadi/liganx/blob/main/backend/scripts/verify_catalog.py"
            target="_blank" rel="noopener noreferrer"
            className="text-delta-700 dark:text-delta-300 hover:underline"
          >
            backend/scripts/verify_catalog.py
          </a>
          {" "}· runs in{" "}
          <a
            href="https://github.com/arashtadi/liganx/blob/main/.github/workflows/fly-deploy.yml"
            target="_blank" rel="noopener noreferrer"
            className="text-delta-700 dark:text-delta-300 hover:underline"
          >
            CI before every deploy
          </a>
        </p>
      </section>

      {/* ── How to read this page ───────────────────────────────────── */}
      {/* For a chemist scrolling past, the data table below is meaningless
          without knowing which cases the pipeline was designed to resolve and
          which are documented method limits. This block surfaces that up front
          so the per-case data is read in the right context. */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-5 sm:p-6">
        <h2 className="text-2xl font-bold tracking-tight text-ink dark:text-white">
          What this means for your work
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
          The summary above is honest but compressed. Here's the longer version
          a chemist would want before trusting a Δ value from this pipeline on
          their own mutation/drug pair.
        </p>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              When to trust this pipeline
            </div>
            <ul className="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              <li>
                <strong>Gatekeeper-residue resistance.</strong> ABL T315I, EGFR
                T790M — clean PASS at +3.6 and +1.3 kcal/mol. Steric clash from
                a single residue substitution is exactly what rigid-receptor
                Vina was designed to capture.
              </li>
              <li>
                <strong>Activation-loop selectivity, when the receptor is
                right.</strong> BRAF V600E + Vemurafenib — clean PASS at −2.7
                kcal/mol once we identified that post-hoc minimisation was
                relaxing the activation loop into the wrong conformation.
                Documented as a per-target catalog flag.
              </li>
              <li>
                <strong>Active-conformation mutations against an inactive-
                conformation drug.</strong> KIT D816V + Imatinib — clean PASS
                at +2.6 kcal/mol. The opposite of selectivity (Avapritinib,
                see below) and easier for a rigid model.
              </li>
              <li>
                <strong>The non-covalent component of covalent escape.</strong>
                BTK C481S + Ibrutinib — PASS at +1.5 kcal/mol on the residual
                non-covalent ΔΔG. The covalent contribution to Ibrutinib's
                clinical loss is not modelled (Vina is non-covalent), but the
                geometric C→S signal is real.
              </li>
            </ul>
          </div>

          <div>
            <div className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              When to be cautious
            </div>
            <ul className="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              <li>
                <strong>Covalent inhibitors.</strong> Osimertinib (acrylamide
                on C797), Pirtobrutinib (non-covalent retention against C481S
                covalent escape) — Vina is non-covalent and cannot resolve
                covalent vs non-covalent mechanism. These show as NOISE or
                wrong-direction-with-known-cause on the table below.
              </li>
              <li>
                <strong>Active-conformation selectivity drugs.</strong>{" "}
                Avapritinib was designed to bind the D816V-stabilised active
                conformation; our 1T46 receptor is not in that conformation
                and induced-fit relaxation is outside the scope of rigid
                docking. Documented method limit.
              </li>
              <li>
                <strong>Switch-region or allosteric mutations.</strong> Any
                mutation whose binding effect propagates through long-range
                conformational change (αC-helix flips, P-loop dynamics) is
                outside what a rigid receptor can capture. Catalog audit
                marks these as out-of-scope before they hit the docking step.
              </li>
              <li>
                <strong>Absolute affinity prediction.</strong> Vina is
                empirical scoring, not free-energy perturbation. Read Δ values
                as <em>direction at above-noise magnitude</em>, not as ΔΔG of
                binding. For absolute affinity calibration use FEP+ / TI-MD —
                that's not what we do.
              </li>
            </ul>
          </div>
        </div>

        <p className="mt-5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-3xl">
          The validation suite below is the data backing every claim in the
          two columns above. Each row links to a live job you can re-open and
          inspect — pose, contacts, 2D map — and a verdict_note that explains
          the case-specific reasoning. Cases with documented method limits
          carry a <strong>caveat</strong> field that surfaces the structural
          biology behind why a particular Δ does or doesn't match its
          literature direction.
        </p>
      </section>

      {/* ── Positive-control suite ──────────────────────────────────── */}
      <section>
        <h2 className="text-2xl font-bold tracking-tight text-ink dark:text-white">
          Positive-control validation
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
          Eight (target, mutation, drug) pairs whose mutation-driven binding
          shifts are published in the clinical and pharmacology literature. We
          submit each to the live Liganx pipeline at exhaustiveness=16
          (2× the product default — tighter sampling for a tighter noise
          band), capture Δ(mutant − WT), and check whether the direction
          agrees with the published shift. The point is direction, not
          magnitude — Vina scoring isn't free energy and isn't calibrated to
          cellular IC50.
        </p>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryPill label="Pass" n={data.summary.pass} colour="emerald" />
          <SummaryPill label="Noise" n={data.summary.noise} colour="amber" />
          <SummaryPill label="Skip" n={data.summary.skip} colour="slate" />
          <SummaryPill label="Fail" n={data.summary.fail} colour="rose" />
        </div>

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Noise floor: ±{data.noise_floor_kcal} kcal/mol (Vina scoring
          reproducibility at default exhaustiveness).{" "}
          <strong>NOISE</strong> means the Δ direction may be correct but
          magnitude sits below the noise floor — see the per-case rationale.{" "}
          <strong>FAIL</strong> means the Δ direction explicitly disagrees with
          the published literature direction; that's a regression and we
          investigate.
        </p>

        <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left">
              <tr className="text-slate-700 dark:text-slate-300">
                <th className="px-4 py-2.5 font-semibold">Case</th>
                <th className="px-3 py-2.5 font-semibold">Drug</th>
                <th className="px-3 py-2.5 font-semibold text-right">WT</th>
                <th className="px-3 py-2.5 font-semibold text-right">Mut</th>
                <th className="px-3 py-2.5 font-semibold text-right">Δ</th>
                <th className="px-3 py-2.5 font-semibold">Expected</th>
                <th className="px-3 py-2.5 font-semibold">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {data.cases.map((c) => (
                <tr
                  key={c.share_id ?? c.name}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="px-4 py-2.5 font-medium text-ink dark:text-slate-100">
                    {c.share_id ? (
                      <Link
                        to={`/jobs/${c.share_id}`}
                        className="hover:underline text-delta-700 dark:text-delta-300"
                      >
                        {c.name}
                      </Link>
                    ) : (
                      c.name
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">{c.drug_name}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400">
                    {c.wt_score !== null ? c.wt_score.toFixed(2) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400">
                    {c.mut_score !== null ? c.mut_score.toFixed(2) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-ink dark:text-slate-100 font-semibold">
                    {c.delta_kcal !== null
                      ? (c.delta_kcal >= 0 ? "+" : "") + c.delta_kcal.toFixed(2)
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 text-xs">
                    {c.expected_direction}
                  </td>
                  <td className="px-3 py-2.5">
                    <VerdictBadge v={c.verdict} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Validation script:{" "}
          <a
            href="https://github.com/arashtadi/liganx/blob/main/backend/scripts/validate_positive_controls.py"
            target="_blank" rel="noopener noreferrer"
            className="text-delta-700 dark:text-delta-300 hover:underline"
          >
            backend/scripts/validate_positive_controls.py
          </a>
          {" "}· each row's case name links to the live Liganx job result on this
          deployment.
        </p>
      </section>

      {/* ── Per-case detail ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-2xl font-bold tracking-tight text-ink dark:text-white">
          Case-by-case rationale
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
          One paragraph per case explaining the published literature, the
          number Liganx returned, and why a NOISE result (where applicable)
          is a method limitation rather than a bug.
        </p>
        <div className="mt-5 space-y-4">
          {data.cases.map((c) => (
            <CaseDetail key={c.share_id ?? c.name} c={c} />
          ))}
        </div>
      </section>

      {/* ── Method honesty ──────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-5">
        <h2 className="text-lg font-semibold text-ink dark:text-white">
          Why several cases land below the noise floor
        </h2>
        <div className="mt-3 text-sm text-slate-700 dark:text-slate-300 leading-relaxed space-y-2.5">
          <p>
            Six of the eight cases above return a Δ smaller than ±1 kcal/mol —
            below the reproducibility floor of Vina scoring at default
            exhaustiveness. The direction is usually correct but the magnitude
            is sub-noise, so we report them honestly as NOISE rather than
            claiming a confident answer.
          </p>
          <p>
            The dominant cause is that our default mutant-receptor builder
            applies the residue substitution but does <em>not</em> energy-
            minimise the surrounding side chains. WT and mutant receptors
            therefore differ only at one side chain, with no global pocket
            reshape. For mutations whose biological effect is conformational
            (KRAS Q61, KIT D816V, BRAF V600 in the inactive state), the
            rigid-receptor docking simply cannot resolve the shift — even
            though the catalog gets the docking-pocket coordinates exactly
            right and the pipeline runs end-to-end without errors.
          </p>
          <p>
            FoldX BuildModel <em>does</em> minimise the structure and produces
            a measurable Δ for these cases. We ship the FoldX call path in
            the runner; the production image runs PDBFixer-only because
            FoldX's academic-only licence isn't compatible with a public web
            service. Restoring FoldX behind an opt-in for academic users is on
            the roadmap.
          </p>
          <p>
            Two cases with sub-noise Vina scores (BTK / Ibrutinib and EGFR /
            Osimertinib) are <em>known</em> to be covalent-inhibitor cases:
            their WT vs mutant advantage is partly the covalent bond to a
            cysteine, which a non-covalent docking engine cannot model. Vina
            is not the right tool for those Δs — the result is not "Liganx is
            wrong" but "Liganx + Vina is the wrong tool here, use FEP+ or a
            covalent docker like CovDock".
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            We publish these limitations on purpose. A platform that pretends
            to give a confident answer where the underlying method can't is
            worse than one that says "below noise — not interpretable" and
            tells you which kinds of mutations Vina is and isn't the right
            tool for.
          </p>
        </div>
      </section>

      {/* ── CTA back to product ─────────────────────────────────────── */}
      <section className="text-center">
        <Link to="/new" className="btn-primary btn-lg inline-flex">
          Run a docking job <ArrowRight size={16} />
        </Link>
      </section>
    </div>
  );
}

/* ─── Small subcomponents ──────────────────────────────────────────────── */

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold text-ink dark:text-slate-100 font-mono">{value}</div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-snug">{sub}</div>
    </div>
  );
}

function SummaryPill({ label, n, colour }: { label: string; n: number; colour: "emerald" | "amber" | "slate" | "rose" }) {
  const map: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/40",
    amber:   "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-700/40",
    slate:   "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
    rose:    "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-700/40",
  };
  return (
    <div className={`rounded-lg ring-1 ring-inset px-3 py-2 ${map[colour]}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</div>
      <div className="text-2xl font-bold font-mono leading-tight mt-0.5">{n}</div>
    </div>
  );
}

function VerdictBadge({ v }: { v: Verdict }) {
  // Same colour ramp as SummaryPill so the two are visually anchored.
  const map: Record<Verdict, string> = {
    PASS:  "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/40",
    NOISE: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-700/40",
    SKIP:  "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
    FAIL:  "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-700/40",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${map[v]}`}>
      {v}
    </span>
  );
}

function CaseDetail({ c }: { c: Case }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <div className="font-semibold text-ink dark:text-slate-100">
          {c.share_id ? (
            <Link to={`/jobs/${c.share_id}`} className="hover:underline">
              {c.name}
            </Link>
          ) : (
            c.name
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            {c.pdb_id}/{c.chain} · {c.mutation} · {c.drug_name}
          </span>
          <VerdictBadge v={c.verdict} />
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
        <strong>Literature:</strong> {c.literature}
      </p>
      {c.caveat && (
        <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          <strong>Caveat:</strong> {c.caveat}
        </p>
      )}
      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        <strong>Result:</strong> {c.verdict_note}
      </p>
    </div>
  );
}
