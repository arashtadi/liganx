// Shared pure helpers for Resistance Radar scoring + display, used by both
// the Studio launcher modal and the /resistance/:id results page.

export const RESISTANCE_CLIFF = 2.0; // ΔΔ (kcal/mol) ≥ this = resistance
export const RESISTANCE_AT_RISK = 0.75; // ΔΔ ≥ this = at-risk
export const DDG_BAR_MAX = 4; // kcal — the resistance bar saturates here

export const fmt = (v: number | null | undefined, dp = 2) =>
  v == null || Number.isNaN(v) ? "—" : v.toFixed(dp);

export const fmtSigned = (v: number | null | undefined, dp = 2) =>
  v == null || Number.isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dp)}`;

export function fmtWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Parse a point-mutation code like "G12C" → {wt:"G", pos:12, mut:"C"}.
 *  Returns null for non-standard codes (indels, "exon19del", etc.) that the
 *  ESM2/point-mutation model can't score. */
export function parseMutationCode(code: string): { wt: string; pos: number; mut: string } | null {
  const m = /^([A-Za-z])(\d+)([A-Za-z])$/.exec(code.trim());
  if (!m) return null;
  return { wt: m[1].toUpperCase(), pos: parseInt(m[2], 10), mut: m[3].toUpperCase() };
}

export const fmtPct = (p: number | null | undefined) =>
  p == null || Number.isNaN(p) ? "—" : `${Math.round(p * 100)}%`;

export type ProbTier = { label: string; text: string; chip: string };

/** Tier a calibrated resistance probability (0–1) into a badge. Thresholds
 *  match the backend verdicts (≥0.7 high, ≥0.45 borderline). */
export function probTier(p: number | null | undefined): ProbTier {
  if (p == null || Number.isNaN(p))
    return { label: "—", text: "text-slate-500", chip: "bg-slate-800 text-slate-500" };
  if (p >= 0.7)
    return { label: "likely", text: "text-rose-300", chip: "bg-rose-900/60 text-rose-200 border border-rose-700/50" };
  if (p >= 0.45)
    return { label: "borderline", text: "text-amber-300", chip: "bg-amber-900/50 text-amber-200 border border-amber-700/50" };
  return { label: "unlikely", text: "text-emerald-300", chip: "bg-emerald-900/50 text-emerald-200 border border-emerald-700/50" };
}

export type DdgTier = { label: string; text: string; bar: string; ring: string };

/** Tier a ΔΔ (kcal/mol) into a resistance verdict + colour system. Positive
 *  ΔΔ = weaker mutant binding = resistance. Conservative thresholds for a
 *  docking-only signal (phase 2 adds calibration). */
export function ddgTier(ddg: number | null): DdgTier {
  if (ddg == null)
    return { label: "—", text: "text-slate-500", bar: "bg-slate-600", ring: "border-slate-700" };
  if (ddg >= RESISTANCE_CLIFF)
    return { label: "resistance", text: "text-rose-300", bar: "bg-rose-500", ring: "border-rose-600/60" };
  if (ddg >= RESISTANCE_AT_RISK)
    return { label: "at risk", text: "text-amber-300", bar: "bg-amber-500", ring: "border-amber-600/60" };
  return { label: "retained", text: "text-emerald-300", bar: "bg-emerald-500", ring: "border-emerald-600/60" };
}
