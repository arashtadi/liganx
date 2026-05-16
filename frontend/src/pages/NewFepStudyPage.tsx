/**
 * New FEP+ study form. (G8)
 *
 * The user pastes a hit SMILES + up to 10 analog SMILES, picks the
 * target+variant, and gets a live cost preview from /fep/studies/estimate.
 * Submit calls /fep/studies and redirects to the results page.
 *
 * Gating: the estimate endpoint is open to everyone (so a user can
 * see what FEP WOULD cost), but the submit button is disabled when
 * fep_access_granted is false. We render a "Request access" prompt
 * in that case instead of a Run button.
 *
 * Cost discipline: the form shows the projected GPU-hours + dollars
 * BEFORE submission, with a confirmation checkbox the user must
 * tick if cost > $50. No accidental five-figure clicks.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Spinner } from "../components/Icons";
import { usePageMeta } from "../lib/usePageMeta";

interface AnalogRow {
  name: string;
  smiles: string;
}

const TARGETS = [
  { id: "egfr", pdb: "2ITY", name: "EGFR kinase domain" },
  { id: "kras", pdb: "4OBE", name: "KRAS GTPase" },
  { id: "braf", pdb: "4WO5", name: "BRAF kinase" },
  { id: "abl",  pdb: "2HYY", name: "ABL1 kinase" },
  { id: "alk",  pdb: "2XP2", name: "ALK kinase" },
  { id: "met",  pdb: "2WGJ", name: "MET kinase" },
  { id: "btk",  pdb: "5P9J", name: "Bruton's tyrosine kinase" },
  { id: "kit",  pdb: "1T46", name: "KIT (CD117) kinase" },
];

export default function NewFepStudyPage() {
  usePageMeta({
    title: "Run FEP+ study · Liganx",
    description: "Relative free-energy perturbation against a hit + analogs. Sub-1 kcal/mol RMSE on ΔΔG for synthesis prioritisation.",
  });
  const navigate = useNavigate();

  // Target selection — default to EGFR T790M, the published reference
  // we validate against in the smoke test.
  const [targetId, setTargetId] = useState<string>("egfr");
  const [variant, setVariant] = useState<string>("T790M");

  // Hit + analogs.
  const [hitName, setHitName] = useState<string>("Osimertinib");
  const [hitSmiles, setHitSmiles] = useState<string>(
    "COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1",
  );
  const [analogs, setAnalogs] = useState<AnalogRow[]>([
    { name: "", smiles: "" },
  ]);

  // Protocol knobs — sane defaults, hidden behind an expander.
  const [nLambdaWindows, setNLambdaWindows] = useState<number>(12);
  const [nsPerWindow, setNsPerWindow] = useState<number>(7.0);
  const [networkTopology, setNetworkTopology] = useState<string>("radial_plus_mst");

  // Cost confirmation.
  const [costConfirmed, setCostConfirmed] = useState<boolean>(false);

  // Form state.
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // ─── Live cost estimate. Debounced 600ms on changes. ─────────────
  const target = useMemo(() => TARGETS.find((t) => t.id === targetId), [targetId]);
  const validAnalogs = useMemo(() => analogs.filter((a) => a.smiles.trim().length > 0), [analogs]);

  const [estimate, setEstimate] = useState<{
    n_analogs: number;
    n_edges_estimated: number;
    gpu_hours_estimated: number;
    usd_cost_estimated: number;
    eta_hours_wall_clock: number;
    notes: string[];
    fep_access_granted: boolean;
  } | null>(null);
  const [estimateInflight, setEstimateInflight] = useState<boolean>(false);

  useEffect(() => {
    if (!target || !hitSmiles.trim() || validAnalogs.length === 0) {
      setEstimate(null);
      return;
    }
    setEstimateInflight(true);
    const t = setTimeout(() => {
      api.fepEstimate({
        pdb_id: target.pdb,
        chain: "A",
        variant: variant || "WT",
        hit_smiles: hitSmiles,
        analog_smiles: validAnalogs.map((a) => ({
          name: a.name || undefined,
          smiles: a.smiles,
        })),
        n_lambda_windows: nLambdaWindows,
        ns_per_window: nsPerWindow,
        network_topology: networkTopology,
      })
        .then((res) => setEstimate(res))
        .catch(() => setEstimate(null))
        .finally(() => setEstimateInflight(false));
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    target?.pdb,
    variant,
    hitSmiles,
    validAnalogs.map((a) => a.smiles).join("|"),
    nLambdaWindows,
    nsPerWindow,
    networkTopology,
  ]);

  function addAnalog() {
    if (analogs.length >= 10) return;
    setAnalogs([...analogs, { name: "", smiles: "" }]);
  }
  function removeAnalog(i: number) {
    setAnalogs(analogs.filter((_, idx) => idx !== i));
  }
  function setAnalog(i: number, patch: Partial<AnalogRow>) {
    setAnalogs(analogs.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  // ─── Submit. ─────────────────────────────────────────────────────
  function submit() {
    if (!target) return;
    setSubmitting(true);
    setSubmitErr(null);
    api.fepCreate({
      pdb_id: target.pdb,
      chain: "A",
      variant: variant || "WT",
      hit_smiles: hitSmiles,
      hit_name: hitName || undefined,
      analog_smiles: validAnalogs.map((a) => ({
        name: a.name || undefined,
        smiles: a.smiles,
      })),
      n_lambda_windows: nLambdaWindows,
      ns_per_window: nsPerWindow,
      network_topology: networkTopology,
    })
      .then((res) => navigate(`/fep/${res.share_id}`))
      .catch((err: Error & { status?: number }) => {
        const status = err.status ?? 0;
        if (status === 403) {
          setSubmitErr(
            "FEP+ is locked for your account. Contact your administrator to request access.",
          );
        } else if (status === 400) {
          setSubmitErr(err.message);
        } else {
          setSubmitErr(`Submit failed: ${err.message}`);
        }
      })
      .finally(() => setSubmitting(false));
  }

  const granted = estimate?.fep_access_granted ?? false;
  const costOver50 = estimate ? estimate.usd_cost_estimated > 50 : false;
  const canSubmit =
    granted &&
    hitSmiles.trim().length > 0 &&
    validAnalogs.length > 0 &&
    (!costOver50 || costConfirmed) &&
    !submitting;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-ink dark:text-slate-100 flex items-center gap-2">
          New FEP+ study
          <span className="badge bg-violet-100 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:ring-violet-700/40">
            Beta · Pro
          </span>
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Relative free-energy perturbation against a hit + up to 10 analogs.
          ΔΔG predictions at sub-1 kcal/mol RMSE — the same calibration teams pay
          Schrödinger six figures for. Cost: ~$100 per study, gated per-user.
        </p>
      </div>

      {/* Target selection. */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          1. Target
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-slate-500 dark:text-slate-400">Catalog target</span>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="input mt-1 w-full"
            >
              {TARGETS.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.pdb})</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-500 dark:text-slate-400">Variant</span>
            <input
              type="text"
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              placeholder="WT or e.g. T790M"
              className="input mt-1 w-full font-mono"
            />
          </label>
        </div>
      </section>

      {/* Hit. */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          2. Hit compound (graph centre)
        </h2>
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400">Name (optional)</span>
          <input
            type="text"
            value={hitName}
            onChange={(e) => setHitName(e.target.value)}
            placeholder="Osimertinib"
            className="input mt-1 w-full"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400">SMILES</span>
          <textarea
            value={hitSmiles}
            onChange={(e) => setHitSmiles(e.target.value)}
            rows={2}
            className="input mt-1 w-full font-mono text-xs"
          />
        </label>
      </section>

      {/* Analogs. */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            3. Analogs ({validAnalogs.length}/10)
          </h2>
          <button
            type="button"
            onClick={addAnalog}
            disabled={analogs.length >= 10}
            className="text-xs text-violet-700 dark:text-violet-300 hover:underline disabled:opacity-50"
          >
            + Add analog
          </button>
        </div>
        <div className="space-y-2">
          {analogs.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={a.name}
                onChange={(e) => setAnalog(i, { name: e.target.value })}
                placeholder={`Analog ${i + 1}`}
                className="input flex-shrink-0 w-32"
              />
              <input
                type="text"
                value={a.smiles}
                onChange={(e) => setAnalog(i, { smiles: e.target.value })}
                placeholder="SMILES"
                className="input flex-1 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => removeAnalog(i)}
                className="text-rose-700 hover:text-rose-800 text-sm px-2"
                disabled={analogs.length <= 1}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Protocol — collapsed by default. */}
      <details className="card group">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center justify-between">
          <span>4. Protocol (advanced)</span>
          <span className="text-slate-400 group-open:hidden">▾ expand</span>
          <span className="text-slate-400 hidden group-open:inline">▴ collapse</span>
        </summary>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-slate-500 dark:text-slate-400">λ windows</span>
            <input
              type="number" min={4} max={24}
              value={nLambdaWindows}
              onChange={(e) => setNLambdaWindows(Number(e.target.value))}
              className="input mt-1 w-full"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500 dark:text-slate-400">ns per window</span>
            <input
              type="number" step={0.5} min={1} max={20}
              value={nsPerWindow}
              onChange={(e) => setNsPerWindow(Number(e.target.value))}
              className="input mt-1 w-full"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500 dark:text-slate-400">Topology</span>
            <select
              value={networkTopology}
              onChange={(e) => setNetworkTopology(e.target.value)}
              className="input mt-1 w-full"
            >
              <option value="radial">radial (cheap)</option>
              <option value="radial_plus_mst">radial + MST (recommended)</option>
            </select>
          </label>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-snug">
          Defaults: 12 lambda windows × 7 ns/window (2 ns equilibration + 5 ns production),
          radial+MST. Amber14SB + OpenFF Sage 2.2 + TIP3P + 0.15 M NaCl, HMR 3 amu,
          4 fs timestep, HREX. Convergence thresholds: hysteresis ≤ 0.5 kcal/mol,
          MBAR CI ≤ 0.4 kcal/mol (Mey et al. 2020).
        </p>
      </details>

      {/* Cost estimate. */}
      <section className="card space-y-3 bg-violet-50/40 dark:bg-violet-900/10 ring-1 ring-violet-200 dark:ring-violet-700/30">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-2">
          5. Projected cost
          {estimateInflight && <Spinner size={12} className="text-violet-500" />}
        </h2>
        {estimate ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-violet-500">Analogs</div>
                <div className="text-lg font-bold tabular-nums">{estimate.n_analogs}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-violet-500">Edges</div>
                <div className="text-lg font-bold tabular-nums">{estimate.n_edges_estimated}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-violet-500">GPU-hours</div>
                <div className="text-lg font-bold tabular-nums">{estimate.gpu_hours_estimated.toFixed(0)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-violet-500">Cost (USD)</div>
                <div className="text-lg font-bold tabular-nums">${estimate.usd_cost_estimated.toFixed(2)}</div>
              </div>
            </div>
            <div className="text-xs text-violet-700/80 dark:text-violet-300/80">
              ETA: ~{estimate.eta_hours_wall_clock.toFixed(0)} hours wall-clock (sequential).
            </div>
            <ul className="text-xs text-violet-800 dark:text-violet-200 space-y-1">
              {estimate.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            {costOver50 && granted && (
              <label className="flex items-start gap-2 text-sm mt-3">
                <input
                  type="checkbox"
                  checked={costConfirmed}
                  onChange={(e) => setCostConfirmed(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  I understand this study will cost ~${estimate.usd_cost_estimated.toFixed(2)} of pod GPU time and
                  cannot be partially refunded once edges have run.
                </span>
              </label>
            )}
          </>
        ) : (
          <p className="text-xs text-violet-600/70 dark:text-violet-400/70">
            Fill in the hit + at least one analog above to see the cost estimate.
          </p>
        )}
      </section>

      {/* Submit. */}
      <section className="card flex items-center justify-between flex-wrap gap-3">
        {!granted && estimate && (
          <div className="text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-200 dark:ring-amber-700/30 rounded-md px-3 py-2 flex-1 min-w-[280px]">
            🔒 FEP+ is locked for your account. Contact your administrator to request access. They can grant it from the admin panel.
          </div>
        )}
        <div className="flex items-center gap-3 ml-auto">
          {submitErr && (
            <div className="text-xs text-rose-700 dark:text-rose-400">{submitErr}</div>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="btn-primary btn-lg px-6 disabled:opacity-50"
          >
            {submitting ? (
              <><Spinner size={14} /> Submitting…</>
            ) : granted ? (
              `Run FEP study →`
            ) : (
              `🔒 Access required`
            )}
          </button>
        </div>
      </section>
    </div>
  );
}
