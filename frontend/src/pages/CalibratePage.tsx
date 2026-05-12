// /atlas/calibrate — "Use my own data" Pro feature, free-tier slice.
//
// User pastes/uploads (gene, position, wt, mutant, drug_smiles?,
// expected_direction?) rows; backend scores each row with the
// calibrated 2-signal joint model and returns per-row joint
// probability + summary AUC if the user supplied labels.
//
// Free tier:
//   - 10 rows per request
//   - ESM2 lookup for positions in our 49-event cache + BLOSUM62
//     substitution-matrix proxy for novel positions
//   - Δ-from-docking defaults to 0 (Pro tier wires the real pipeline)
//
// Pro tier (button stubbed): unlimited rows, real-time GPU docking,
// per-user calibration history. Email-capture for early access — Stripe
// wires up once we have ≥10 signups.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePageMeta } from "../lib/usePageMeta";

const API = import.meta.env.VITE_API_URL || "/api";

type ScoredRow = {
  gene: string;
  position: number;
  wt_residue: string;
  mutant: string;
  mutation_code: string;
  drug_name: string | null;
  expected_direction: string | null;
  fitness: number;
  score_source: "cached_esm2" | "blosum_proxy";
  delta_kcal_input: number | null;
  joint_logit: number;
  joint_probability: number;
  verdict: string;
  label_for_auc: number | null;
};

type ScoreResponse = {
  schema_version: number;
  n_rows: number;
  n_cached_esm2: number;
  n_blosum_proxy: number;
  rows: ScoredRow[];
  user_auc: number | null;
  user_auc_caveat: string | null;
  liganx_published_auc_oof: number;
  liganx_published_auc_95pct_ci: [number, number];
  model: string;
  free_tier_notes: string;
  pro_upgrade_url: string;
};

const SAMPLE_CSV = `gene,position,wt_residue,mutant,drug_name,expected_direction
ABL1,315,T,I,Imatinib,resistance
EGFR,790,T,M,Gefitinib,resistance
EGFR,797,C,S,Osimertinib,resistance
BTK,481,C,S,Ibrutinib,resistance
KIT,816,D,V,Imatinib,resistance
ABL1,315,T,I,Ponatinib,retained
BTK,481,C,S,Pirtobrutinib,retained
KRAS,12,G,C,Sotorasib,selectivity
KIT,816,D,V,Avapritinib,selectivity
EGFR,858,L,R,Gefitinib,selectivity`;

export default function CalibratePage() {
  usePageMeta({
    title: "Calibrate your data — Liganx Resistance Atlas",
    description:
      "Upload your own (drug, mutation) cases and score them against Liganx's calibrated 2-signal resistance forecast model. Free tier: 10 rows, instant ESM2-based scoring. Pro tier: unlimited rows + real-time GPU docking.",
  });

  const [csv, setCsv] = useState<string>(SAMPLE_CSV);
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<ScoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedPreview = useMemo(() => parseCsv(csv), [csv]);

  async function onScore() {
    setError(null);
    setBusy(true);
    setResponse(null);
    try {
      const rows = parseCsv(csv).rows;
      if (rows.length === 0) {
        throw new Error("No valid rows parsed from your input.");
      }
      if (rows.length > 10) {
        throw new Error(
          `Free tier capped at 10 rows; you submitted ${rows.length}. Trim to 10 or join the Pro early-access list.`,
        );
      }
      const r = await fetch(`${API}/calibrate/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!r.ok) {
        const t = await r.text();
        try {
          const j = JSON.parse(t);
          throw new Error(j?.detail?.message || j?.detail || `HTTP ${r.status}: ${t.slice(0, 200)}`);
        } catch {
          throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
        }
      }
      setResponse(await r.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <header>
        <Link
          to="/atlas"
          className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
        >
          ← Resistance Atlas
        </Link>
        <div className="mt-1 flex items-baseline gap-2">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink dark:text-white">
            Calibrate your data
          </h1>
          <span className="inline-flex items-center rounded-full bg-violet-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            BETA
          </span>
        </div>
        <p className="mt-3 text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
          Bring your own (drug, mutation) cases. Score each against Liganx's
          calibrated 2-signal resistance forecast model. If you supply
          <code className="font-mono text-sm bg-slate-100 dark:bg-slate-800 px-1 mx-1 rounded">expected_direction</code>
          labels, we'll also compute your AUC against our published
          5-fold cross-validated AUC ({(0.812).toFixed(2)}, 95% CI [0.62, 0.96]).
        </p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 max-w-3xl">
          Free tier: 10 rows / request. ESM2 fitness for known positions
          (from our 49-event cache), BLOSUM62 substitution-matrix proxy
          for novel positions. Δ-from-docking defaults to 0 (full GPU
          docking lives in Pro).
        </p>
      </header>

      {/* ── Input ────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
          <h2 className="text-lg font-semibold text-ink dark:text-slate-100">
            Your data (CSV)
          </h2>
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => setCsv(SAMPLE_CSV)}
              className="text-violet-700 dark:text-violet-300 hover:underline font-semibold"
            >
              Load sample (10 calibration events)
            </button>
            <button
              type="button"
              onClick={() => setCsv("gene,position,wt_residue,mutant,drug_name,expected_direction\n")}
              className="text-slate-500 dark:text-slate-400 hover:underline"
            >
              Clear
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          Header row required. Columns: <code className="font-mono">gene</code>,{" "}
          <code className="font-mono">position</code>,{" "}
          <code className="font-mono">wt_residue</code>,{" "}
          <code className="font-mono">mutant</code>,{" "}
          <code className="font-mono">drug_name</code> (optional),{" "}
          <code className="font-mono">expected_direction</code> (optional —
          one of <code className="font-mono">resistance</code>,{" "}
          <code className="font-mono">retained</code>,{" "}
          <code className="font-mono">selectivity</code>).
        </p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          spellCheck={false}
          rows={12}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
        />
        <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {parsedPreview.rows.length} valid row{parsedPreview.rows.length === 1 ? "" : "s"}
            {parsedPreview.errors.length > 0 && (
              <span className="text-rose-600 dark:text-rose-400">
                {" · "}{parsedPreview.errors.length} parse error{parsedPreview.errors.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onScore}
            disabled={busy || parsedPreview.rows.length === 0}
            className="rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:text-slate-500 dark:disabled:text-slate-400"
          >
            {busy ? "Scoring…" : `Score ${parsedPreview.rows.length} row${parsedPreview.rows.length === 1 ? "" : "s"}`}
          </button>
        </div>
        {parsedPreview.errors.length > 0 && (
          <ul className="mt-2 text-[11px] text-rose-700 dark:text-rose-300 space-y-0.5">
            {parsedPreview.errors.slice(0, 5).map((e, i) => (
              <li key={i}>• line {e.line}: {e.message}</li>
            ))}
            {parsedPreview.errors.length > 5 && (
              <li>• ({parsedPreview.errors.length - 5} more)</li>
            )}
          </ul>
        )}
      </section>

      {/* ── Error ────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/30 p-4 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────── */}
      {response && (
        <section className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Rows scored" value={`${response.n_rows}`} />
            <Stat label="ESM2 cached" value={`${response.n_cached_esm2}`} sub="full-fidelity" />
            <Stat label="BLOSUM proxy" value={`${response.n_blosum_proxy}`} sub="free-tier fallback" />
            <Stat
              label="Your AUC"
              value={response.user_auc !== null ? response.user_auc.toFixed(3) : "—"}
              sub={response.user_auc !== null ? `vs Liganx published OOF ${response.liganx_published_auc_oof.toFixed(2)}` : "needs labels"}
            />
          </div>

          {response.user_auc_caveat && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {response.user_auc_caveat}
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Drug</th>
                  <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Mutation</th>
                  <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300 text-right">Fitness</th>
                  <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300 text-right">P(resist)</th>
                  <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Verdict</th>
                  <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Source</th>
                  <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Label</th>
                </tr>
              </thead>
              <tbody>
                {response.rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{r.drug_name || "—"}</td>
                    <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-100">
                      {r.gene} · {r.mutation_code}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700 dark:text-slate-300">
                      {r.fitness >= 0 ? "+" : ""}{r.fitness.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-ink dark:text-slate-100">
                      {r.joint_probability.toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      <VerdictBadge v={r.verdict} />
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                      {r.score_source === "cached_esm2" ? "ESM2 ✓" : "BLOSUM proxy"}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                      {r.expected_direction || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {response.free_tier_notes}
          </p>
        </section>
      )}

      {/* ── Pro upgrade ──────────────────────────────────────────── */}
      <section className="rounded-xl border border-violet-300 dark:border-violet-700/60 bg-violet-50/70 dark:bg-violet-900/30 p-5">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-lg font-bold text-ink dark:text-white">
            Pro — unlimited rows, real GPU docking
          </h2>
          <span className="inline-flex items-center rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            early access
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-200 leading-relaxed max-w-3xl">
          Pro removes the 10-row cap, runs real-time Vina docking on
          the production GPU pod for every (drug, mutation) pair, runs
          full ESM2 inference for any UniProt position (not just our
          cache), and persists your calibration history per-user. Ideal
          for medicinal-chemistry teams validating a pipeline of
          200–2000 (drug, mutation) cases.
        </p>
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
          Pricing TBA after the first 10 sign-ups. Email{" "}
          <a
            href="mailto:hello@liganx.com?subject=Liganx%20Pro%20early%20access"
            className="text-violet-700 dark:text-violet-300 font-semibold hover:underline"
          >
            hello@liganx.com
          </a>{" "}
          with "Pro early access" + a one-liner about your use case to
          join the list.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-ink dark:text-slate-100 font-mono">
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          {sub}
        </div>
      )}
    </div>
  );
}

function VerdictBadge({ v }: { v: string }) {
  const colour =
    v === "high_confidence_resistance"
      ? "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-700/40"
      : v === "borderline_resistance"
        ? "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-700/40"
        : "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-700/40";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${colour}`}>
      {v.replace(/_/g, " ")}
    </span>
  );
}

/* ─── CSV parsing ─────────────────────────────────────────────────── */

type ParseError = { line: number; message: string };
type Parsed = { rows: Array<Record<string, unknown>>; errors: ParseError[] };

function parseCsv(text: string): Parsed {
  const errors: ParseError[] = [];
  const rows: Array<Record<string, unknown>> = [];
  const lines = text.split(/\r?\n/).map((L) => L.trim()).filter((L) => L.length > 0);
  if (lines.length < 2) return { rows, errors };

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const required = ["gene", "position", "wt_residue", "mutant"];
  for (const k of required) {
    if (!header.includes(k)) {
      errors.push({ line: 1, message: `header missing required column "${k}"` });
    }
  }
  if (errors.length > 0) return { rows, errors };

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    if (cells.length !== header.length) {
      errors.push({
        line: i + 1,
        message: `expected ${header.length} cells, got ${cells.length}`,
      });
      continue;
    }
    const obj: Record<string, unknown> = {};
    header.forEach((k, j) => {
      obj[k] = cells[j];
    });
    // Type coercion
    const pos = parseInt(obj.position as string, 10);
    if (!Number.isFinite(pos) || pos < 1) {
      errors.push({ line: i + 1, message: `position is not a positive integer` });
      continue;
    }
    obj.position = pos;
    if (typeof obj.wt_residue === "string") obj.wt_residue = obj.wt_residue.toUpperCase();
    if (typeof obj.mutant === "string") obj.mutant = obj.mutant.toUpperCase();
    if ((obj.wt_residue as string).length !== 1 || (obj.mutant as string).length !== 1) {
      errors.push({ line: i + 1, message: `wt_residue and mutant must be single letters` });
      continue;
    }
    // Drop empty optional columns
    for (const k of ["drug_name", "drug_smiles", "expected_direction"]) {
      if (obj[k] === "") delete obj[k];
    }
    if (obj.delta_kcal) {
      const d = parseFloat(obj.delta_kcal as string);
      if (Number.isFinite(d)) obj.delta_kcal = d;
      else delete obj.delta_kcal;
    }
    rows.push(obj);
  }
  return { rows, errors };
}
