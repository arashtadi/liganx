import { useState } from "react";
import { Shield } from "./Icons";

/**
 * Trust signal for a docking result. Three states map to the PoseBusters outcome:
 *
 *   high   — passed every PoseBusters check
 *   medium — failed 1–2 (typical: inchi_convertible, no_radicals — quirky)
 *   low    — failed 3+ — pose is physically suspect
 *
 * Anything else collapses to "unknown" so we don't pretend.
 *
 * Hover the badge to see WHICH checks failed and what they actually mean —
 * a lot of medium-confidence poses are physically fine but tripped on
 * PDBQT→RDKit roundtrip artifacts (those are flagged as such in the tooltip).
 */

interface Props {
  confidence?: "high" | "medium" | "low" | "unknown";
  detail?: string;
  size?: "sm" | "md";
  /** Show the rich hover popover explaining what failed and why. Defaults to
   *  true (the PoseDetail panel uses it). Pass false in the matrix where the
   *  badge appears in every cell — the popover gets visually noisy at scale,
   *  so the matrix relies on the native `title` attribute fallback instead. */
  tooltip?: boolean;
}

const STYLES = {
  high:    { bg: "bg-emerald-50 dark:bg-emerald-900/20",  text: "text-emerald-800 dark:text-emerald-300", ring: "ring-emerald-200 dark:ring-emerald-800/40", label: "Passed" },
  medium:  { bg: "bg-amber-50 dark:bg-amber-900/20",      text: "text-amber-900 dark:text-amber-300",     ring: "ring-amber-200 dark:ring-amber-800/40",     label: "Caution" },
  low:     { bg: "bg-rose-50 dark:bg-rose-900/20",        text: "text-rose-800 dark:text-rose-300",       ring: "ring-rose-200 dark:ring-rose-800/40",       label: "Suspect" },
  unknown: { bg: "bg-slate-100 dark:bg-slate-700/40",     text: "text-slate-600 dark:text-slate-400",     ring: "ring-slate-200 dark:ring-slate-600",        label: "Unchecked" },
} as const;

const HEADLINE: Record<NonNullable<Props["confidence"]>, string> = {
  high:    "Every physics check passed.",
  medium:  "A couple of checks failed — often format quirks, not real problems.",
  low:     "Multiple physics checks failed. Treat this score with skepticism.",
  unknown: "PoseBusters didn’t run on this pose.",
};

/** Per-check explanations. The two PDBQT-format quirks are flagged as
 *  "tooling artifact" so users don't think every Caution is a real problem. */
const CHECK_INFO: Record<string, { label: string; tooling: boolean }> = {
  inchi_convertible:    { label: "Pose can’t round-trip through InChI — usually a PDBQT format quirk, not a real issue.", tooling: true },
  no_radicals:          { label: "RDKit suspects an unpaired electron — typically a valence-guess artifact from PDBQT.", tooling: true },
  bond_lengths:         { label: "One or more bond lengths fall outside the typical chemistry range.", tooling: false },
  bond_angles:          { label: "One or more bond angles fall outside the typical chemistry range.", tooling: false },
  internal_steric_clash:{ label: "Two atoms in the ligand overlap each other.", tooling: false },
  ligand_protein_clash: { label: "A ligand atom overlaps a protein atom.", tooling: false },
  flatness:             { label: "An aromatic ring isn’t planar in the pose.", tooling: false },
  internal_energy:      { label: "The pose’s internal energy is much higher than its minimum.", tooling: false },
  energy_ratio:         { label: "Pose energy is much higher than the minimum-energy conformer.", tooling: false },
  protonation:          { label: "Protonation state in the pose differs from the input ligand.", tooling: false },
  stereochemistry:      { label: "Stereochemistry in the pose differs from the input ligand.", tooling: false },
  bond_orders:          { label: "Bond orders in the pose differ from the input ligand.", tooling: false },
  geometry:             { label: "Geometry sanity check failed (rings, distances).", tooling: false },
  loaded:               { label: "PoseBusters couldn’t load the pose file at all.", tooling: false },
  passes_valence_checks:{ label: "Valences are inconsistent with normal chemistry.", tooling: false },
  passes_kekulization:  { label: "Aromatic kekulization failed.", tooling: false },
  all_atoms_connected:  { label: "Pose has disconnected fragments.", tooling: false },
  molecular_formula:    { label: "Pose’s atomic formula differs from the input.", tooling: false },
  molecular_bonds:      { label: "Bond count or arrangement differs from the input.", tooling: false },
  tetrahedral_chirality:{ label: "Tetrahedral chirality differs from the input.", tooling: false },
  double_bond_stereochemistry: { label: "Double-bond E/Z assignment differs from the input.", tooling: false },
};

function parseFailed(detail: string | undefined): string[] {
  if (!detail) return [];
  // The backend writes "failed: a,b,c" possibly followed by other pipe-segments
  const m = detail.match(/failed:\s*([^|]+)/);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

export default function ConfidenceRibbon({
  confidence = "unknown", detail, size = "md", tooltip = true,
}: Props) {
  const [hover, setHover] = useState(false);
  const s = STYLES[confidence];
  const failed = parseFailed(detail);
  const padding = size === "sm" ? "px-2 py-0.5" : "px-2.5 py-1";
  const text = size === "sm" ? "text-[10px]" : "text-xs";

  // When tooltip is off (matrix cells), fall back to the browser's native
  // hover title so users can still see *which* checks failed by hovering —
  // just without the styled popover that would clutter a dense table.
  const nativeTitle = !tooltip
    ? `${s.label} — ${HEADLINE[confidence]}${failed.length ? `\nFailed: ${failed.join(", ")}` : ""}`
    : undefined;

  return (
    <span className="relative inline-block">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full ring-1 ring-inset font-semibold ${tooltip ? "cursor-help" : ""} ${padding} ${text} ${s.bg} ${s.text} ${s.ring}`}
        onMouseEnter={tooltip ? () => setHover(true) : undefined}
        onMouseLeave={tooltip ? () => setHover(false) : undefined}
        onFocus={tooltip ? () => setHover(true) : undefined}
        onBlur={tooltip ? () => setHover(false) : undefined}
        tabIndex={tooltip ? 0 : -1}
        title={nativeTitle}
        aria-label={`Confidence ${s.label}: ${HEADLINE[confidence]}`}
      >
        <Shield size={size === "sm" ? 10 : 12} />
        <span>{s.label}</span>
      </span>

      {tooltip && hover && (
        <div
          role="tooltip"
          className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-2 w-80 rounded-lg bg-slate-900 dark:bg-slate-800 text-slate-100 text-xs p-3 shadow-xl ring-1 ring-slate-700 pointer-events-none"
        >
          <div className="font-semibold text-[13px] mb-1.5">{HEADLINE[confidence]}</div>
          <div className="text-slate-300 leading-relaxed mb-2">
            PoseBusters runs ~20 sanity checks on the docked pose (steric clashes,
            bond lengths, ring flatness, internal energy, stereochemistry).
          </div>

          {failed.length > 0 && (
            <>
              <div className="text-slate-400 text-[10px] uppercase tracking-wider mb-1.5 font-semibold">
                Failed checks
              </div>
              <ul className="space-y-2">
                {failed.map((c) => {
                  const info = CHECK_INFO[c];
                  return (
                    <li key={c}>
                      <div className="flex items-center gap-1.5">
                        <code className="text-amber-300 font-mono text-[10.5px]">{c}</code>
                        {info?.tooling && (
                          <span className="text-[9px] uppercase tracking-wider px-1 py-px rounded bg-slate-700 text-slate-300">
                            tooling artifact
                          </span>
                        )}
                      </div>
                      {info && (
                        <div className="text-slate-300 mt-0.5 leading-snug">{info.label}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {confidence === "high" && (
            <div className="text-emerald-300/90">
              Every check this pose was tested against came back clean.
            </div>
          )}

          {confidence === "unknown" && (
            <div className="text-slate-300">
              Either PoseBusters wasn’t available or the validation step crashed
              for this row. The score itself is still real.
            </div>
          )}
        </div>
      )}
    </span>
  );
}
