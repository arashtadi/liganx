import { useMemo, useState } from "react";
import type { CatalogMutation, Compound, DockingResult } from "../api";
import { Spinner } from "./Icons";
import ConfidenceRibbon from "./ConfidenceRibbon";
import CsvExportButton from "./CsvExportButton";
import AdmetChips from "./AdmetChips";
import { parseExtra } from "../lib/parseExtra";

interface Props {
  compounds: Compound[];
  mutations: string[];
  results: DockingResult[];
  /** When true, empty cells render a "queued" spinner instead of an em-dash so
   *  the user can see results streaming in live. */
  isStreaming?: boolean;
  /** Optional metadata for known mutations (code → label/significance). When
   *  provided, the column header shows a clinical name under the mutation code
   *  (e.g. "T790M" with "Gatekeeper · 1st-gen TKI resistance" beneath). */
  mutationInfo?: Record<string, CatalogMutation>;
  onPick?: (pick: {
    compound: Compound;
    variant: string;
    score: number;
    deltaWt: number | null;
    extra?: string | null;
  }) => void;
  /** Subset selection — when these props are present the matrix renders a
   *  checkbox in every cell so the user can curate a subset for sharing.
   *  `selected` holds keys of the form `${compound_id}.${variant}`. Pass
   *  undefined for both to disable selection UI entirely. */
  selected?: Set<string>;
  onToggleSelect?: (key: string) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
}

type SortKey = "best-delta" | "best-mutant" | "wt" | "name";

/**
 * Premium selectivity matrix.
 *
 * - Cells use a smooth color gradient based on Δ vs WT
 * - Hover highlights the column + row crosshair
 * - Click any mutant cell to drill into the pose detail (via onPick)
 * - Pinned WT column for stable comparison
 * - Sticky compound column on horizontal scroll
 */
export default function SelectivityMatrix({
  compounds, mutations, results, isStreaming = false, mutationInfo, onPick,
  selected, onToggleSelect, onSelectAll, onClearSelection,
}: Props) {
  const variants = useMemo(() => ["WT", ...mutations], [mutations]);
  const [sortKey, setSortKey] = useState<SortKey>("best-delta");
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  // Selection UI is engaged when a parent passes both `selected` AND a
  // toggle handler. If either is missing the matrix renders without
  // checkboxes (used for share-link landing pages where the URL pre-pins
  // a curated subset and offering selection again would be confusing).
  const selectable = !!selected && !!onToggleSelect;
  const selectedCount = selected?.size ?? 0;

  // scoreOf is the lookup the cell renderer + row aggregations use. We
  // explicitly skip rows whose `extra` is a failure marker — their best_score
  // is 0.0 as a placeholder, NOT a real docking, and treating it as a valid
  // score would corrupt the row's "best Δ" / "best mutant" stats and pollute
  // the color scale.
  const scoreOf = useMemo(() => {
    const m: Record<number, Record<string, number>> = {};
    for (const r of results) {
      const failed = r.extra && /^(ligand_prep_failed|docking_failed):/.test(r.extra);
      if (failed) continue;
      m[r.compound_id] ??= {};
      m[r.compound_id][r.variant] = r.best_score;
    }
    return m;
  }, [results]);

  const extraOf = useMemo(() => {
    const m: Record<number, Record<string, string | null | undefined>> = {};
    for (const r of results) {
      m[r.compound_id] ??= {};
      m[r.compound_id][r.variant] = r.extra;
    }
    return m;
  }, [results]);

  const enriched = useMemo(() => compounds.map((c) => {
    const scores = scoreOf[c.id] ?? {};
    const wt = scores["WT"] ?? null;
    const mScores = mutations.map((m) => scores[m]).filter((v): v is number => v != null);
    const bestMutant = mScores.length ? Math.min(...mScores) : null;
    const bestDelta = wt != null && bestMutant != null ? bestMutant - wt : null;
    return { compound: c, scores, wt, bestMutant, bestDelta };
  }), [compounds, mutations, scoreOf]);

  const rows = useMemo(() => {
    const sorted = [...enriched];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "name": return (a.compound.name ?? a.compound.smiles).localeCompare(b.compound.name ?? b.compound.smiles);
        case "wt": return (a.wt ?? 0) - (b.wt ?? 0);
        case "best-mutant": return (a.bestMutant ?? 0) - (b.bestMutant ?? 0);
        case "best-delta":
        default: return (a.bestDelta ?? 0) - (b.bestDelta ?? 0);
      }
    });
    return sorted;
  }, [enriched, sortKey]);

  // Color scaling: find the largest |delta| in the matrix to normalize
  const maxAbsDelta = useMemo(() => {
    let max = 0;
    for (const r of enriched) {
      if (r.wt == null) continue;
      for (const v of mutations) {
        const s = r.scores[v];
        if (s != null) max = Math.max(max, Math.abs(s - r.wt));
      }
    }
    return Math.max(0.5, max);
  }, [enriched, mutations]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-b from-slate-50/60 to-transparent dark:from-slate-800/40">
        <div>
          <h2 className="text-base font-semibold text-ink dark:text-slate-100 flex items-center gap-2">
            Selectivity matrix
            <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {rows.length} × {variants.length}
            </span>
            {selectable && selectedCount > 0 && (
              <span className="badge bg-delta-100 text-delta-700 ring-1 ring-inset ring-delta-200 dark:bg-delta-900/40 dark:text-delta-300 dark:ring-delta-700/40">
                {selectedCount} selected
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Vina score (kcal/mol) · lower = stronger · cells colored by Δ vs WT
            {selectable && (
              <span className="ml-1 text-slate-400 dark:text-slate-500">
                · check cells to share a curated subset
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectable && (
            <div className="flex items-center gap-1 text-xs">
              <button
                type="button"
                onClick={onSelectAll}
                className="rounded-md px-2 py-1 font-semibold text-slate-600 hover:text-delta-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-delta-300 dark:hover:bg-slate-800"
              >
                Select all
              </button>
              {selectedCount > 0 && (
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="rounded-md px-2 py-1 font-semibold text-slate-600 hover:text-rose-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-rose-400 dark:hover:bg-slate-800"
                >
                  Clear
                </button>
              )}
            </div>
          )}
          <select
            className="input !w-auto !py-1.5 text-xs"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="best-delta">Sort: best mutant Δ</option>
            <option value="best-mutant">Sort: best mutant score</option>
            <option value="wt">Sort: WT score</option>
            <option value="name">Sort: name</option>
          </select>
          <CsvExportButton
            rows={rows.map((r) => ({
              compound: r.compound,
              scores: r.scores,
              extras: extraOf[r.compound.id] ?? {},
              wt: r.wt,
            }))}
            variants={variants}
            mutations={mutations}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300 sticky left-0 bg-white dark:bg-slate-900 z-10 min-w-[220px]">
                Compound
              </th>
              {variants.map((v) => {
                // For known mutations, derive a short descriptor from the
                // catalog. We prefer `label` (e.g. "T790M — gatekeeper") and
                // strip the code prefix so we don't repeat it visually.
                // Falls back to `significance` if the label is just the code.
                const info = v !== "WT" ? mutationInfo?.[v] : undefined;
                let subtitle: string | null = null;
                if (info) {
                  const labelMinusCode = info.label
                    .replace(new RegExp(`^${v}\\s*[—–-]?\\s*`, "i"), "")
                    .trim();
                  subtitle = labelMinusCode || info.significance || null;
                }
                return (
                  <th
                    key={v}
                    className={`text-right py-2.5 px-4 font-semibold min-w-[110px] transition-colors align-top ${
                      hoverCol === v
                        ? "bg-delta-50/60 text-delta-700 dark:bg-delta-900/30 dark:text-delta-300"
                        : "text-slate-600 dark:text-slate-300"
                    } ${v === "WT" ? "border-r border-slate-200 dark:border-slate-800" : ""}`}
                    onMouseEnter={() => setHoverCol(v)}
                    onMouseLeave={() => setHoverCol(null)}
                    title={info ? `${info.label}\n${info.significance}` : undefined}
                  >
                    <div className="flex flex-col items-end gap-0.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {v === "WT" && (
                          <span className="badge bg-slate-100 text-slate-500 text-[9px] dark:bg-slate-800 dark:text-slate-400">REF</span>
                        )}
                        <span className={v === "WT" ? "" : "font-mono"}>{v}</span>
                      </div>
                      {subtitle && (
                        <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400 normal-case truncate max-w-[160px]">
                          {subtitle}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ compound, scores, wt, bestDelta }, rowIdx) => (
              <tr
                key={compound.id}
                className={`border-b border-slate-100 dark:border-slate-800 transition-colors ${
                  hoverRow === rowIdx ? "bg-slate-50/60 dark:bg-slate-800/40" : ""
                }`}
                onMouseEnter={() => setHoverRow(rowIdx)}
                onMouseLeave={() => setHoverRow(null)}
              >
                <td className="py-2.5 px-4 sticky left-0 bg-white dark:bg-slate-900 z-[5]">
                  <div className="font-medium text-ink dark:text-slate-100 truncate max-w-[260px]">
                    {compound.name ?? <span className="text-slate-400 dark:text-slate-500 italic">unnamed</span>}
                  </div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-[260px]">
                    {compound.smiles}
                  </div>
                  {bestDelta != null && (
                    <div className={`mt-0.5 text-[10px] font-semibold ${
                      bestDelta < -0.3 ? "text-emerald-600 dark:text-emerald-400"
                      : bestDelta > 0.3 ? "text-rose-600 dark:text-rose-400"
                      : "text-slate-400 dark:text-slate-500"
                    }`}>
                      best Δ = {bestDelta > 0 ? "+" : ""}{bestDelta.toFixed(2)}
                    </div>
                  )}
                  {/* Drug-likeness chips — compact strip directly under the SMILES.
                      Lets users triage compounds by chemistry quality (QED, Ro5)
                      without leaving the matrix. */}
                  <AdmetChips admet={compound.admet} layout="compact" />
                </td>
                {variants.map((v) => {
                  const cellId = `${compound.id}.${v}`;
                  const isSelected = selected?.has(cellId) ?? false;
                  return (
                    <ScoreCell
                      key={v}
                      value={scores[v]}
                      extra={extraOf[compound.id]?.[v] ?? null}
                      delta={v === "WT" ? null : (scores[v] != null && wt != null ? scores[v] - wt : null)}
                      isWT={v === "WT"}
                      isStreaming={isStreaming}
                      maxAbsDelta={maxAbsDelta}
                      highlighted={hoverCol === v || hoverRow === rowIdx}
                      selectable={selectable}
                      isSelected={isSelected}
                      onToggleSelect={selectable ? () => onToggleSelect?.(cellId) : undefined}
                      onClick={() => {
                        if (v === "WT" || scores[v] == null) return;
                        onPick?.({
                          compound,
                          variant: v,
                          score: scores[v],
                          deltaWt: wt != null ? scores[v] - wt : null,
                          extra: extraOf[compound.id]?.[v] ?? null,
                        });
                      }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between px-5 py-3 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
        <div className="flex items-center gap-2">
          <span>Δ vs WT</span>
          <Gradient />
          <span className="flex items-center gap-3">
            <span><span className="text-emerald-600 dark:text-emerald-400 font-semibold">−</span> tighter (selectivity / resistance gain)</span>
            <span><span className="text-rose-600 dark:text-rose-400 font-semibold">+</span> weaker (escape)</span>
          </span>
        </div>
        <span className="text-slate-400 dark:text-slate-500">Click any mutant cell to inspect the pose →</span>
      </div>
    </div>
  );
}

function ScoreCell({
  value, extra, delta, isWT, isStreaming, maxAbsDelta, highlighted, onClick,
  selectable = false, isSelected = false, onToggleSelect,
}: {
  value: number | undefined;
  extra: string | null;
  delta: number | null;
  isWT: boolean;
  isStreaming: boolean;
  maxAbsDelta: number;
  highlighted: boolean;
  onClick: () => void;
  /** True when the parent matrix is in selection mode — render a small
   *  checkbox in the cell and dim its score when not selected. */
  selectable?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  // The checkbox sits in the top-left of every cell. We stop click propagation
  // so checking a box doesn't also trigger the cell's `onClick` (which opens
  // the pose detail panel) — different actions, shouldn't share a hit target.
  const Checkbox = selectable ? (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      title={isSelected ? "Remove from share" : "Include in share"}
      onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
      className={`absolute top-1 left-1 w-4 h-4 rounded-[4px] flex items-center justify-center text-[10px] font-bold transition-colors ${
        isSelected
          ? "bg-delta-600 text-white ring-1 ring-delta-700 dark:bg-delta-500 dark:ring-delta-400"
          : "bg-white/70 text-transparent ring-1 ring-slate-300 hover:ring-delta-400 hover:text-slate-400 dark:bg-slate-900/60 dark:ring-slate-600 dark:hover:ring-delta-500"
      }`}
    >
      ✓
    </button>
  ) : null;
  // Selection ring — cells in the working selection get a soft outer ring so
  // the user can scan the matrix and see what they've curated at a glance.
  const selectionRing = selectable && isSelected
    ? "ring-2 ring-inset ring-delta-400/70 dark:ring-delta-400/70"
    : "";
  // Parse `extra` first because failure markers determine the cell shape
  // regardless of whether `value` is present (we deliberately drop failed
  // rows from `scoreOf` so they have no value, but `extra` still carries the
  // failure reason).
  const ext = parseExtra(extra);

  if (ext.failure) {
    // Failure cell: the runner couldn't produce a real score (SMILES parse
    // died, Vina crashed, etc.). The DB stores best_score=0.0 as a placeholder,
    // but we refuse to render that as if it were a real docking — show
    // "Failed" + the reason on hover so the user can act on it (fix the
    // SMILES, retry, etc.).
    const kindLabel = ext.failure.kind === "ligand_prep"
      ? "Ligand prep failed"
      : ext.failure.kind === "docking"
        ? "Docking failed"
        : "Failed";
    return (
      <td
        className={`relative text-right py-2.5 ${selectable ? "pl-6 pr-4" : "px-4"} align-top ${isWT ? "border-r border-slate-200 dark:border-slate-800" : ""} ${selectionRing}`}
        title={`${kindLabel}: ${ext.failure.reason}`}
      >
        {Checkbox}
        <div className="inline-flex items-center justify-end gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-800/50">
            <span aria-hidden>⚠</span> Failed
          </span>
        </div>
        <div className="text-[10px] text-rose-700 dark:text-rose-300/80 mt-1 max-w-[160px] truncate">
          {ext.failure.kind === "ligand_prep" ? "ligand prep" : ext.failure.kind === "docking" ? "docking" : "error"}
        </div>
      </td>
    );
  }

  if (value == null) {
    // Pending cell: show a soft pulsing skeleton while the job streams in,
    // or a plain em-dash once the job is done (means: docking failed for this
    // pair without setting an explicit failure marker — rare). Selection
    // checkbox is omitted for empty cells — there's nothing to share yet.
    return (
      <td
        className={`relative text-right py-2.5 px-4
          ${isWT ? "border-r border-slate-200 dark:border-slate-800" : ""}
          ${highlighted ? "bg-slate-50/60 dark:bg-slate-800/40" : ""}`}
      >
        {isStreaming ? (
          <div className="flex items-center justify-end gap-1.5 text-slate-400 dark:text-slate-500">
            <Spinner size={11} />
            <span className="text-[10px] uppercase tracking-wider">queued</span>
          </div>
        ) : (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        )}
      </td>
    );
  }

  // Cell tint based on Δ vs WT — same hue in light + dark, just different
  // alpha so it remains visible against the dark slate background.
  let bg = "";
  if (!isWT && delta != null) {
    const t = Math.min(1, Math.abs(delta) / maxAbsDelta);
    if (delta < -0.3)      bg = `rgba(16, 185, 129, ${0.08 + 0.40 * t})`;
    else if (delta > 0.3)  bg = `rgba(239, 68, 68, ${0.08 + 0.40 * t})`;
  }

  const interactive = !isWT;

  // The WT column gets a subtle "reference" stripe rather than pure white —
  // pure white inside a dark table is the source of the unreadable highlight
  // the user reported.
  const wtSurface = isWT ? "bg-slate-50/40 dark:bg-slate-800/30" : "";

  return (
    <td
      className={`relative text-right py-2.5 ${selectable ? "pl-6 pr-4" : "px-4"} font-mono tabular-nums transition-all align-top
        ${isWT ? `border-r border-slate-200 dark:border-slate-800 ${wtSurface}` : ""}
        ${highlighted && !isWT && !isSelected ? "ring-1 ring-inset ring-slate-200/60 dark:ring-slate-700/60" : ""}
        ${selectionRing}
        ${interactive && !isSelected ? "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-delta-400 dark:hover:ring-delta-500" : ""}
        ${interactive && isSelected ? "cursor-pointer" : ""}`}
      style={{ background: bg || undefined }}
      onClick={onClick}
    >
      {Checkbox}
      <div className="text-ink dark:text-slate-100 font-semibold">{value.toFixed(2)}</div>
      {delta != null && (
        <div className={`text-[10px] font-medium ${
          delta < 0 ? "text-emerald-700 dark:text-emerald-300"
          : delta > 0 ? "text-rose-700 dark:text-rose-300"
          : "text-slate-400 dark:text-slate-500"
        }`}>
          {delta > 0 ? "+" : ""}{delta.toFixed(2)}
        </div>
      )}
      {ext.confidence && ext.confidence !== "unknown" && (
        <div className="mt-1 flex justify-end">
          {/* Suppress the rich popover in the matrix — it appears in every cell
              and turns into visual noise at scale. Native title attr still
              gives an at-a-glance hover hint, and the full breakdown shows up
              in the Pose detail panel when the user clicks a row. */}
          <ConfidenceRibbon
            confidence={ext.confidence}
            detail={ext.poseBusters}
            size="sm"
            tooltip={false}
          />
        </div>
      )}
    </td>
  );
}

function Gradient() {
  return (
    <div className="h-2 w-32 rounded-full" style={{
      background: "linear-gradient(to right, rgba(16,185,129,0.5) 0%, rgba(255,255,255,0) 50%, rgba(239,68,68,0.5) 100%)",
    }} />
  );
}
