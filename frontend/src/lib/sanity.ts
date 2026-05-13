/**
 * Centralised sanity-check helpers for every number displayed to a user.
 *
 * The fear: a backend bug or a corrupt result silently shows a number
 * outside its physical range — a Vina Δ of +40 kcal/mol, a probability
 * of 2.3, an ESM-2 fitness of −∞ — and the user trusts it. By the time
 * we notice, trust is gone.
 *
 * The fix: every display surface calls one of these helpers and either
 * gets a clean number back or an explicit `anomaly` object that the
 * component renders as a red badge instead of as if everything were
 * fine. Anomalies also fire the global `__liganx_capture_error__` hook
 * so we get Sentry alerts the moment they happen — instead of waiting
 * for a user to report a weird-looking number.
 *
 * The bounds below are deliberately generous — they're "this number is
 * physically impossible" guards, not "this number is unusual" guards.
 * Components that want tighter heuristics (e.g. "within Vina noise
 * floor") should layer their own check on top of these.
 */

export type SanityResult<T = number> =
  | { ok: true; value: T }
  | { ok: false; reason: string; raw: unknown };

/** Vina-family docking score (kcal/mol). Real values land in roughly
 *  [-15, -2]; [-20, +5] is the physically defensible band. Anything
 *  outside is a data anomaly. */
export function sanityCheckScore(raw: unknown): SanityResult<number> {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: "score is missing", raw };
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: "score is not a finite number", raw };
  }
  if (n < -25 || n > 10) {
    return { ok: false, reason: `score ${n.toFixed(2)} outside physical range [-25, +10] kcal/mol`, raw };
  }
  return { ok: true, value: n };
}

/** Δ-score (mutant − WT, kcal/mol). Physically defensible band is
 *  roughly [-10, +10]; Vina noise floor is ~±1, so anything outside
 *  ±15 is essentially a data anomaly. */
export function sanityCheckDelta(raw: unknown): SanityResult<number> {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: "Δ is missing", raw };
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: "Δ is not a finite number", raw };
  }
  if (n < -20 || n > 20) {
    return { ok: false, reason: `Δ ${n.toFixed(2)} outside physical range ±20 kcal/mol`, raw };
  }
  return { ok: true, value: n };
}

/** Probability or proportion. Must be in [0, 1]. */
export function sanityCheckProb(raw: unknown): SanityResult<number> {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: "probability is missing", raw };
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: "probability is not a finite number", raw };
  }
  // Allow a tiny epsilon for floating-point precision (probabilities
  // computed via sigmoid can drift slightly outside [0, 1]).
  if (n < -0.001 || n > 1.001) {
    return { ok: false, reason: `probability ${n.toFixed(4)} outside [0, 1]`, raw };
  }
  // Clamp the tiny overshoot to the valid range — caller doesn't need
  // to see 1.0001.
  return { ok: true, value: Math.max(0, Math.min(1, n)) };
}

/** ESM-2 masked-LM fitness: log P(mut | context) − log P(wt | context).
 *  Token log-probs in ESM-2 land in roughly [-25, 0]; the difference
 *  rarely exceeds ±15. Wider band is generous. */
export function sanityCheckFitness(raw: unknown): SanityResult<number> {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: "fitness is missing", raw };
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: "fitness is not a finite number", raw };
  }
  if (n < -25 || n > 25) {
    return { ok: false, reason: `fitness ${n.toFixed(2)} outside expected [-25, +25]`, raw };
  }
  return { ok: true, value: n };
}

/** Quick visible-only check: returns the number as a string if sane,
 *  otherwise a clearly-marked anomaly string the caller can render
 *  inside a red badge. Also reports the anomaly to Sentry (via the
 *  global hook) so we hear about it without waiting for a bug report. */
export function safeDisplayNumber(
  raw: unknown,
  check: (raw: unknown) => SanityResult<number>,
  format: (n: number) => string = (n) => n.toFixed(2),
): { display: string; isAnomaly: boolean; tooltip?: string } {
  const r = check(raw);
  if (r.ok) {
    return { display: format(r.value), isAnomaly: false };
  }
  // Report once per session per reason to avoid flooding Sentry.
  reportAnomalyOnce(r.reason, raw);
  return {
    display: "?",
    isAnomaly: true,
    tooltip: `Data anomaly — ${r.reason}. Please report.`,
  };
}

const _reportedAnomalies = new Set<string>();
function reportAnomalyOnce(reason: string, raw: unknown): void {
  if (_reportedAnomalies.has(reason)) return;
  _reportedAnomalies.add(reason);
  try {
    if (typeof window !== "undefined" && window.__liganx_capture_error__) {
      window.__liganx_capture_error__(
        new Error(`Sanity-check anomaly: ${reason} (raw=${JSON.stringify(raw)})`),
        { componentStack: "" } as any,
        "sanity-check",
      );
    }
    // eslint-disable-next-line no-console
    console.warn("[sanity]", reason, "raw=", raw);
  } catch {
    /* monitoring must not cascade */
  }
}

/* ─── Pre-flight input validators ─────────────────────────────────────
 *
 * These run BEFORE the user submits — refusing junk inputs at the door
 * instead of 20s later at the GPU with a cryptic 500. Returns
 * `{ ok: true }` or `{ ok: false, reason: "...user-readable..." }`.
 */

/** Cheap client-side SMILES sanity. Doesn't try to parse — leaves that
 *  to backend RDKit — but rejects obvious nonsense: empty, way too long,
 *  characters that can't appear in SMILES. */
export function preflightSmiles(raw: string): { ok: true } | { ok: false; reason: string } {
  const s = (raw || "").trim();
  if (!s) return { ok: false, reason: "SMILES is empty" };
  if (s.length > 1000) {
    return { ok: false, reason: `SMILES is unusually long (${s.length} chars). Likely malformed input.` };
  }
  // Whitelist of SMILES-legal characters. Anything else (control chars,
  // unicode, etc.) is a copy-paste mishap, not chemistry.
  if (!/^[A-Za-z0-9@+\-\[\]\(\)=#$%/\\.:*\s]+$/.test(s)) {
    return { ok: false, reason: "SMILES contains characters that don't appear in SMILES syntax (control chars / unicode?)." };
  }
  // Common copy-paste artifacts:
  if (s.includes("..")) {
    return { ok: false, reason: "SMILES has '..' (double dot) — likely a copy-paste error." };
  }
  return { ok: true };
}

/** Mutation code like T315I, V600E, G12C, p.Cys481Ser. Accepts both
 *  one-letter (T315I) and three-letter (p.Cys481Ser) forms. */
export function preflightMutationCode(raw: string): { ok: true } | { ok: false; reason: string } {
  const s = (raw || "").trim();
  if (!s) return { ok: false, reason: "Mutation code is empty" };
  // One-letter form: WT-letter, digits, mutant-letter (e.g. T315I).
  if (/^[A-Z]\d{1,4}[A-Z*]$/.test(s)) return { ok: true };
  // Three-letter HGVS form: p.Cys481Ser, p.Thr790Met, etc.
  if (/^p\.[A-Z][a-z]{2}\d{1,4}[A-Z][a-z]{2}$/.test(s)) return { ok: true };
  return {
    ok: false,
    reason: `"${s}" doesn't look like a standard mutation code (expected e.g. T315I, V600E, p.Cys481Ser).`,
  };
}

/** PDB ID — 4 alphanumeric characters, first is a digit. */
export function preflightPdbId(raw: string): { ok: true } | { ok: false; reason: string } {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return { ok: false, reason: "PDB ID is empty" };
  if (!/^[0-9][a-z0-9]{3}$/.test(s)) {
    return { ok: false, reason: `"${raw}" is not a valid PDB ID (4 chars, first is a digit, e.g. "4mne", "1m17").` };
  }
  return { ok: true };
}
