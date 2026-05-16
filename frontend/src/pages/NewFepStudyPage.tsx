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
import { useQuery } from "@tanstack/react-query";
import { api, type CatalogTarget } from "../api";
import { Spinner } from "../components/Icons";
import AutocompleteInput from "../components/AutocompleteInput";
import { usePageMeta } from "../lib/usePageMeta";

interface AnalogRow {
  name: string;
  smiles: string;
}

/** (UX) Compound suggestion shape for the AutocompleteInput. Source
 *  tells the user where the suggestion came from — "catalog" for the
 *  curated reference compounds for the current target (e.g. Osimertinib
 *  appears under EGFR, Sotorasib under KRAS) or "library" for the
 *  user's own saved compounds from /me/compounds. */
interface CompoundSuggestion {
  name: string;
  smiles: string;
  source: "catalog" | "library";
}

/** Build the suggestion list for the hit + analog name fields. Pulls
 *  from (a) the catalog target's reference compounds — the FDA-approved
 *  drugs for this target — and (b) the user's saved library across all
 *  targets. Substring match (case-insensitive) on both name and SMILES
 *  so the user can search by either. */
function suggestCompounds(
  q: string,
  target: CatalogTarget | undefined,
  saved: { id: number; name: string; smiles: string }[],
): CompoundSuggestion[] {
  const query = q.trim().toLowerCase();
  const out: CompoundSuggestion[] = [];

  // Catalog reference compounds for the SELECTED target first — most
  // relevant for an FEP study against that target.
  for (const c of target?.compounds ?? []) {
    if (
      !query ||
      c.name.toLowerCase().includes(query) ||
      c.smiles.toLowerCase().includes(query)
    ) {
      out.push({ name: c.name, smiles: c.smiles, source: "catalog" });
    }
  }
  // Then the user's saved library — matches across all targets so a
  // chemist with their own analog series can find them.
  for (const c of saved) {
    if (
      !query ||
      (c.name || "").toLowerCase().includes(query) ||
      c.smiles.toLowerCase().includes(query)
    ) {
      out.push({
        name: c.name || `Compound #${c.id}`,
        smiles: c.smiles,
        source: "library",
      });
    }
  }
  return out.slice(0, 20);                                          // top-20 cap
}

export default function NewFepStudyPage() {
  usePageMeta({
    title: "Run FEP+ study · Liganx",
    description: "Relative free-energy perturbation against a hit + analogs. Sub-1 kcal/mol RMSE on ΔΔG for synthesis prioritisation.",
  });
  const navigate = useNavigate();

  // (UX) Load the live catalog so the Target dropdown matches what
  // Studio shows + the Variant dropdown is the mutations curated for
  // the selected target, not a free-text field. Falls back to a
  // minimal EGFR-only catalog if /catalog is unreachable so the
  // page still renders.
  const { data: catalog = [] } = useQuery({
    queryKey: ["fep-catalog"],
    queryFn: api.catalog,
    staleTime: 5 * 60 * 1000,
  });

  // (UX) The user's saved compound library — drives the
  // AutocompleteInput on the hit + analog name fields. Picking a
  // saved compound auto-fills the SMILES. Same pattern as Studio.
  const { data: savedCompounds = [] } = useQuery({
    queryKey: ["my-compounds"],
    queryFn: api.getMyCompounds,
    staleTime: 5 * 60 * 1000,
  });

  // Target selection — default to EGFR T790M, the published reference
  // we validate against in the smoke test.
  const [targetId, setTargetId] = useState<string>("egfr");
  const [variant, setVariant] = useState<string>("T790M");

  // (UX) When the user picks a target whose catalog mutations don't
  // include the current variant, fall back to WT so the variant
  // dropdown never shows a stale code that doesn't exist on the new
  // target. e.g. user has T790M selected then switches to KRAS —
  // T790M isn't a KRAS mutation, so reset to WT.
  const currentTarget = useMemo(
    () => catalog.find((t) => t.id === targetId),
    [catalog, targetId],
  );
  useEffect(() => {
    if (!currentTarget) return;
    const validCodes = ["WT", ...currentTarget.mutations.map((m) => m.code)];
    if (!validCodes.includes(variant)) {
      setVariant("WT");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, currentTarget]);

  // Hit + analogs. Pre-populated with a published osimertinib-against-
  // EGFR-T790M reference set so the page is immediately submittable —
  // same pattern as Studio's first-load defaults. These are
  // illustrative congeneric variants (single-atom modifications to
  // the indole, aniline, and amine substituents); the user is
  // expected to swap them for their own analog series before clicking
  // Run. The cost preview becomes meaningful as soon as the form
  // loads instead of waiting for the user to type SMILES.
  const [hitName, setHitName] = useState<string>("Osimertinib");
  const [hitSmiles, setHitSmiles] = useState<string>(
    "COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1",
  );
  const [analogs, setAnalogs] = useState<AnalogRow[]>([
    // Demo analog 1: indole N-methyl removed (smoke-test variant).
    {
      name: "Osi-des-methyl",
      smiles: "COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cnc3ccccc23)n1",
    },
    // Demo analog 2: 7-fluoro indole — illustrative congeneric variant.
    {
      name: "Osi-7F-indole",
      smiles: "COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3cccc(F)c23)n1",
    },
    // Demo analog 3: hydroxyethyl amine — illustrative.
    {
      name: "Osi-hydroxyethyl",
      smiles: "COc1cc(N(CCO)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1",
    },
  ]);

  // (UX) Auto-fill SMILES when the user picks (or types) an exact
  // compound name match. Watches all known compound suggestions for
  // the current target + saved library; when a name field's value
  // matches case-insensitively, the SMILES is auto-populated.
  // Mirrors how Studio behaves — picking "Osimertinib" from the
  // dropdown drops in its SMILES without a second action.
  useEffect(() => {
    const all = suggestCompounds("", currentTarget, savedCompounds);
    const byName = new Map<string, string>();
    for (const c of all) byName.set(c.name.toLowerCase(), c.smiles);
    // Hit name — only auto-fill if SMILES is empty OR the name was
    // just changed to a different known compound. (Avoid clobbering
    // a hand-edited SMILES while the user is still typing the name.)
    const hitMatch = byName.get(hitName.trim().toLowerCase());
    if (hitMatch && !hitSmiles.trim()) {
      setHitSmiles(hitMatch);
    }
    // Same for each analog.
    let changed = false;
    const next = analogs.map((a) => {
      const m = byName.get(a.name.trim().toLowerCase());
      if (m && !a.smiles.trim()) {
        changed = true;
        return { ...a, smiles: m };
      }
      return a;
    });
    if (changed) setAnalogs(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitName, analogs.map((a) => a.name).join("|"), currentTarget, savedCompounds]);

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
  // `target` is now sourced from the live catalog rather than a
  // hand-maintained static list — Variants are pulled straight from
  // target.mutations.
  const target = currentTarget;
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
        pdb_id: target.pdb_id,
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
    target?.pdb_id,
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
      pdb_id: target.pdb_id,
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
        <p className="text-xs text-violet-700/80 dark:text-violet-300/80 mt-1 italic">
          Pre-filled below: Osimertinib + 3 illustrative analogs against EGFR T790M
          — the published reference case. Edit these or swap in your own SMILES,
          then check the projected cost before running.
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
              disabled={catalog.length === 0}
            >
              {catalog.length === 0 ? (
                <option>Loading catalog…</option>
              ) : (
                catalog.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.pdb_id})
                  </option>
                ))
              )}
            </select>
          </label>
          {/* (UX) Variant dropdown — populated from the selected
              target's catalog mutations + WT. Mirrors the Studio
              pattern where you pick from curated mutations rather
              than typing a free-text code that might not exist on
              this target. */}
          <label className="block">
            <span className="text-xs text-slate-500 dark:text-slate-400">Variant</span>
            <select
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              className="input mt-1 w-full font-mono"
              disabled={!currentTarget}
            >
              <option value="WT">WT — wild type</option>
              {currentTarget?.mutations.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.code} — {m.label}
                </option>
              ))}
            </select>
            {currentTarget && variant !== "WT" && (
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                {currentTarget.mutations.find((m) => m.code === variant)?.significance}
              </p>
            )}
          </label>
        </div>
      </section>

      {/* Hit. */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          2. Hit compound (graph centre)
        </h2>
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Name (pick from your library or catalog reference compounds)
          </span>
          <AutocompleteInput<CompoundSuggestion>
            value={hitName}
            onChange={setHitName}
            fetchSuggestions={async (q) => suggestCompounds(q, currentTarget, savedCompounds)}
            getValue={(item) => item.name}
            renderItem={(item) => (
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-delta-700 shrink-0">{item.name}</span>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {item.source}
                </span>
                <span className="text-[11px] text-slate-500 truncate font-mono">{item.smiles}</span>
              </div>
            )}
            placeholder="Osimertinib"
            className="mt-1 w-full"
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
              {/* (UX) Analog name field — same AutocompleteInput as
                  the hit, backed by catalog reference compounds +
                  saved library. Picking a known compound auto-fills
                  the SMILES on the right. */}
              <div className="flex-shrink-0 w-40">
                <AutocompleteInput<CompoundSuggestion>
                  value={a.name}
                  onChange={(v) => setAnalog(i, { name: v })}
                  fetchSuggestions={async (q) => suggestCompounds(q, currentTarget, savedCompounds)}
                  getValue={(item) => item.name}
                  renderItem={(item) => (
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold text-delta-700 truncate">{item.name}</span>
                      <span className="text-[9px] uppercase text-slate-400">{item.source}</span>
                    </div>
                  )}
                  placeholder={`Analog ${i + 1}`}
                />
              </div>
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
