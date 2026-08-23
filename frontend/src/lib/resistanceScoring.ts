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
