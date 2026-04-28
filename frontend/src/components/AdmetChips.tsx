import type { Admet } from "../api";

/**
 * Compact ADMET / drug-likeness chip strip.
 *
 * Two layouts:
 *   - `compact`: single row of small chips, suited for the matrix's
 *                compound column under the SMILES.
 *   - `card`:    a roomier grid with section headers, used in PoseDetail.
 *
 * The chips use color sparingly — green for "passes a filter", rose for
 * "fails a filter / has a flag", neutral slate for raw descriptors.
 * We deliberately avoid a "score" gestalt because ADMET descriptors are
 * informational, not pass/fail by themselves; users decide what matters
 * for their project.
 */
export default function AdmetChips({
  admet,
  layout = "compact",
}: {
  admet: Admet | null | undefined;
  layout?: "compact" | "card";
}) {
  if (!admet) {
    return (
      <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">
        ADMET — descriptors unavailable
      </span>
    );
  }

  if (layout === "compact") {
    return (
      <div className="mt-1 flex flex-wrap gap-1 items-center text-[10px]">
        <Chip label="MW" value={admet.mw.toFixed(0)} unit="Da" />
        <Chip label="LogP" value={admet.logp.toFixed(1)} />
        <Chip label="QED" value={admet.qed != null ? admet.qed.toFixed(2) : "—"} />
        <RuleChip pass={admet.lipinski_pass} label="Ro5" violations={admet.lipinski_violations} />
        {admet.pains_count > 0 && (
          <span
            title={`PAINS substructure(s): ${admet.pains.join(", ")}`}
            className="rounded px-1.5 py-0.5 font-semibold bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:ring-rose-700/50"
          >
            PAINS · {admet.pains_count}
          </span>
        )}
      </div>
    );
  }

  // card layout — for PoseDetail
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="MW" value={admet.mw.toFixed(1)} unit="Da" />
        <Stat label="LogP" value={admet.logp.toFixed(2)} />
        <Stat label="QED" value={admet.qed != null ? admet.qed.toFixed(2) : "—"} />
        <Stat label="HBD / HBA" value={`${admet.hbd} / ${admet.hba}`} />
        <Stat label="TPSA" value={admet.tpsa.toFixed(0)} unit="Å²" />
        <Stat label="Rot bonds" value={String(admet.rot_bonds)} />
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <RuleChip pass={admet.lipinski_pass} label="Lipinski Ro5" violations={admet.lipinski_violations} />
        <RuleChip pass={admet.veber_pass} label="Veber" violations={admet.veber_violations} />
        {admet.pains_count > 0 ? (
          <span
            title={admet.pains.join("\n")}
            className="rounded-md px-2 py-1 font-semibold bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:ring-rose-700/50"
          >
            ⚠ PAINS · {admet.pains_count} flag{admet.pains_count === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="rounded-md px-2 py-1 font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/40">
            PAINS clean
          </span>
        )}
      </div>
    </div>
  );
}

function Chip({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <span
      title={`${label}${unit ? ` (${unit})` : ""}`}
      className="rounded px-1.5 py-0.5 bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
    >
      <span className="text-slate-500 dark:text-slate-400 font-normal">{label}</span>{" "}
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function RuleChip({ pass, label, violations }: { pass: boolean; label: string; violations: number }) {
  return (
    <span
      title={
        pass
          ? `${label}: passes all criteria`
          : `${label}: ${violations} violation${violations === 1 ? "" : "s"}`
      }
      className={`rounded px-1.5 py-0.5 font-semibold ring-1 ring-inset ${
        pass
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/40"
          : "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-700/40"
      }`}
    >
      {label} {pass ? "✓" : `${violations}!`}
    </span>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-md bg-slate-50 dark:bg-slate-800/50 px-2 py-1.5 ring-1 ring-inset ring-slate-200 dark:ring-slate-700">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
        {label}
      </div>
      <div className="font-semibold text-ink dark:text-slate-100 tabular-nums">
        {value}
        {unit && <span className="text-slate-400 dark:text-slate-500 font-normal text-[10px] ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}
