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
  /** The cell currently driving the right-rail 3D viewer. Format
   *  `${compound_id}.${variant}` — same key shape as `selected`. The matrix
   *  rings this cell with a thick brand-colored border so users can see at a
   *  glance which docking the 3D image corresponds to. Without this, the
   *  visual link between the matrix and the viewer was invisible. */
  currentPickKey?: string | null;
  /** "Edit & re-dock" button on each compound row — opens the parent's
   *  KetcherModal pre-loaded with the compound's SMILES, then navigates
   *  to /new with a reseed payload that swaps in the modified structure.
   *  Closes the iterate-after-results loop without making the user retype
   *  the target/mutations/engine. Optional — when omitted the button is
   *  hidden (e.g. for shared subset views where the viewer doesn't own
   *  a sketcher). */
  onEditCompound?: (compound: Compound) => void;
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
  selected, onToggleSelect, onSelectAll, onClearSelection, currentPickKey,
  onEditCompound,
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

  // Detect the engine that produced these results so the column header can
  // label the score units correctly. Vina/GNINA → kcal/mol; Boltz-2 →
  // log10(IC50 μM). All cells in one job share the same engine because
  // job.engine is a single field, so we read the first non-failure row's
  // engine tag and trust that for the whole matrix. Defaults to undefined
  // when there are no successful results yet (still streaming).
  const detectedEngine = useMemo(() => {
    for (const r of results) {
      const ext = parseExtra(r.extra);
      if (ext.engine) return ext.engine;
    }
    return undefined;
  }, [results]);
  const isBoltz2 = !!detectedEngine && detectedEngine.startsWith("boltz2");

  // scoreOf is the lookup the cell renderer + row aggregations use. We
  // explicitly skip rows whose `extra` is a failure marker — their best_score
  // is 0.0 as a placeholder, NOT a real docking, and treating it as a valid
  // score would corrupt the row's "best Δ" / "best mutant" stats and pollute
  // the color scale.
  const scoreOf = useMemo(() => {
    const m: Record<number, Record<string, number>> = {};
    for (const r of results) {
      const failed = r.extra && /^(ligand_prep_failed|docking_failed|mutant_build_failed):/.test(r.extra);
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
            {isBoltz2
              ? <>Predicted log<sub>10</sub> IC<sub>50</sub> (μM) · lower = stronger · cells colored by Δ vs WT</>
              : <>Vina score (kcal/mol) · lower = stronger · cells colored by Δ vs WT</>}
            {selectable && (
              <span className="ml-1 text-slate-400 dark:text-slate-500">
                · check cells to share a curated subset
              </span>
            )}
          </p>
          {/* Pose-validation legend — three small inline pills with one-line
              explanations. Without this, users see "Passed"/"Caution"/"Skipped"
              badges in cells with no clue what produced them. The detailed
              tooltip (hover any badge) goes deeper; this is the at-a-glance
              read so people understand the column without having to hover. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-600 dark:text-slate-300">
              Pose validation:
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <strong className="font-semibold">Passed</strong> — all PoseBusters checks clean
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
              <strong className="font-semibold">Caution</strong> — 1–2 quirks (often format only)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500" />
              <strong className="font-semibold">Suspect</strong> — 3+ physics checks failed
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400" />
              <strong className="font-semibold">Skipped</strong> — sanity check ran out of time; the score still ships
            </span>
            <span className="text-slate-400 dark:text-slate-500 italic">
              hover any badge for the per-cell breakdown
            </span>
          </div>
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
                  {/* Edit & re-dock — closes the iterate-after-results
                      loop. Promoted to a prominent solid primary button
                      because it's THE headline iterate-after-results
                      action: the previous outline-chip treatment looked
                      like a tertiary detail and chemists missed it.
                      Brand-colored fill + pencil icon + arrow makes the
                      "edit then go" workflow visually unambiguous. The
                      button only renders when the parent provided
                      onEditCompound (omitted on shared subset views
                      that don't own a sketcher). */}
                  {onEditCompound && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditCompound(compound);
                      }}
                      className="mt-2 group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-delta-600 hover:bg-delta-700 text-white shadow-sm hover:shadow-md transition-all w-full justify-center"
                      title="Open the structure editor with this SMILES. Your edit submits a fresh job against the same target + mutations — engine, exhaustiveness, and WT setting are preserved."
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      Edit &amp; re-dock
                      <span className="opacity-70 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" aria-hidden="true">→</span>
                    </button>
                  )}
                </td>
                {variants.map((v) => {
                  const cellId = `${compound.id}.${v}`;
                  const isSelected = selected?.has(cellId) ?? false;
                  const isCurrentPick = currentPickKey === cellId;
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
                      isCurrentPick={isCurrentPick}
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
  selectable = false, isSelected = false, isCurrentPick = false, onToggleSelect,
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
  /** True when this cell is the one currently driving the right-rail 3D
   *  viewer. Renders a thick brand-colored ring + arrow indicator so the
   *  user can see at a glance which docking the 3D image corresponds to. */
  isCurrentPick?: boolean;
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
    // mutant_build is amber (a structural-biology fact — the residue isn't
    // modeled in this PDB, the wildtype letter doesn't match, or some other
    // input/structure mismatch) rather than red (a system error). Different
    // cause, different remedy: the user needs a different PDB or to fix the
    // mutation code, NOT to retry.
    const isAmber = ext.failure.kind === "mutant_build";
    // For mutant_build, deliberately avoid words like "Build failed" which
    // sound like our software broke. The reason here is biological: the
    // structure doesn't have what's needed to model this substitution. The
    // pre-flight check at submit time should normally catch this before a
    // job runs, so the matrix only sees these in race conditions or when
    // a custom PDB upload turns out to be missing the residue.
    const kindLabel = ext.failure.kind === "ligand_prep"
      ? "Ligand prep failed"
      : ext.failure.kind === "docking"
        ? "Docking failed"
        : isAmber
          ? "Mutation not buildable on this structure"
          : "Failed";
    const badgeClass = isAmber
      ? "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800/50"
      : "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-800/50";
    const subtitleClass = isAmber
      ? "text-amber-700 dark:text-amber-300/80"
      : "text-rose-700 dark:text-rose-300/80";
    const badgeText = ext.failure.kind === "ligand_prep" || ext.failure.kind === "docking"
      ? "Failed"
      : isAmber
        ? "Residue not in structure"
        : "Failed";
    const subtitle = ext.failure.kind === "ligand_prep"
      ? "ligand prep"
      : ext.failure.kind === "docking"
        ? "docking"
        : isAmber
          ? "see hover for details"
          : "error";
    return (
      <td
        className={`relative text-right py-2.5 ${selectable ? "pl-6 pr-4" : "px-4"} align-top ${isWT ? "border-r border-slate-200 dark:border-slate-800" : ""} ${selectionRing}`}
        title={`${kindLabel}: ${ext.failure.reason}`}
      >
        {Checkbox}
        <div className="inline-flex items-center justify-end gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${badgeClass}`}>
            <span aria-hidden>⚠</span> {badgeText}
          </span>
        </div>
        <div className={`text-[10px] mt-1 max-w-[160px] truncate ${subtitleClass}`}>
          {subtitle}
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
  //
  // Outside-pocket cells get NO tint regardless of Δ. The mutation residue
  // sits beyond Vina's search box, so any Δ here is method noise (PDBFixer
  // local relaxation + QuickVina-GPU stochastic search) — not a real
  // selectivity or resistance signal. Painting these cells green/red would
  // tell the user the opposite of what's actually happening.
  const outsidePocket = !isWT && ext.outsidePocketA != null;
  let bg = "";
  if (!isWT && delta != null && !outsidePocket) {
    const t = Math.min(1, Math.abs(delta) / maxAbsDelta);
    if (delta < -0.3)      bg = `rgba(16, 185, 129, ${0.08 + 0.40 * t})`;
    else if (delta > 0.3)  bg = `rgba(239, 68, 68, ${0.08 + 0.40 * t})`;
  }

  const interactive = !isWT;

  // The WT column gets a subtle "reference" stripe rather than pure white —
  // pure white inside a dark table is the source of the unreadable highlight
  // the user reported.
  const wtSurface = isWT ? "bg-slate-50/40 dark:bg-slate-800/30" : "";

  // Active-pick ring — outranks every other ring class so the user can
  // always see WHICH cell drives the right-rail 3D viewer. We use a
  // 3px violet inset ring for two reasons:
  //   1. Violet doesn't conflict with the green-selectivity / red-
  //      resistance / blue-hover colors already on the matrix, so it
  //      reads cleanly as "this is the active cell" without being
  //      confused for a Δ signal.
  //   2. No extra glow, no corner pill — the user pushed back on the
  //      earlier "VIEWING" pill and on the chevron indicator as visually
  //      noisy. A clean thicker ring is enough.
  const currentPickRing = isCurrentPick
    ? "ring-[3px] ring-inset ring-violet-600 dark:ring-violet-400"
    : "";
  return (
    <td
      className={`relative text-right py-2.5 ${selectable ? "pl-6 pr-4" : "px-4"} font-mono tabular-nums transition-all align-top
        ${isWT ? `border-r border-slate-200 dark:border-slate-800 ${wtSurface}` : ""}
        ${highlighted && !isWT && !isSelected && !isCurrentPick ? "ring-1 ring-inset ring-slate-200/60 dark:ring-slate-700/60" : ""}
        ${selectionRing}
        ${currentPickRing}
        ${interactive && !isSelected && !isCurrentPick ? "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-delta-400 dark:hover:ring-delta-500" : ""}
        ${interactive && (isSelected || isCurrentPick) ? "cursor-pointer" : ""}`}
      style={{ background: bg || undefined }}
      onClick={onClick}
    >
      {Checkbox}
      <div className="text-ink dark:text-slate-100 font-semibold">{value.toFixed(2)}</div>
      {delta != null && (
        // Outside-pocket Δ is method noise, not a real signal — render in
        // muted gray (parenthesized + "noise" label) instead of the green/
        // red selectivity scale. The amber "outside pocket" pill below
        // explains why; this color treatment makes sure a quick scan of
        // the matrix doesn't read these as biology.
        outsidePocket ? (
          <div
            className="text-[10px] font-medium text-slate-400 dark:text-slate-500"
            title="Mutation residue is outside the docking box — this Δ is method noise (PDBFixer local relaxation + QuickVina-GPU stochastic search), not a real selectivity or resistance signal."
          >
            ({delta > 0 ? "+" : ""}{delta.toFixed(2)} noise)
          </div>
        ) : (
          <div className={`text-[10px] font-medium ${
            delta < 0 ? "text-emerald-700 dark:text-emerald-300"
            : delta > 0 ? "text-rose-700 dark:text-rose-300"
            : "text-slate-400 dark:text-slate-500"
          }`}>
            {delta > 0 ? "+" : ""}{delta.toFixed(2)}
          </div>
        )
      )}
      {ext.vinardo != null && (
        <div
          title={`Vinardo refined score: ${ext.vinardo.toFixed(2)} kcal/mol — second-pass scoring (smina) that discriminates close analogs better than raw Vina.`}
          className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mt-0.5"
        >
          <span className="opacity-60">v⁺</span> {ext.vinardo.toFixed(2)}
        </div>
      )}
      {/* "Mutation outside pocket" badge — shown when the mutated residue is
          farther from the docking box center than Vina can see. Without this
          tag, the user would interpret an identical WT/mutant score as "the
          mutation has no effect", when really it's "Vina can't tell because
          the box doesn't reach that far". This is biology limitation, not a
          bug, but the user deserves to know which one they're looking at. */}
      {!isWT && ext.outsidePocketA != null && (
        <div className="mt-1 flex justify-end">
          <span
            title={`Mutation residue is ${ext.outsidePocketA.toFixed(1)} Å from the docking box center. Single-conformation Vina docking can't see geometric effects of mutations more than ~11 Å from the pocket — try molecular dynamics or pick a different reference structure where this residue is closer to the active site.`}
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1 ring-inset bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-900/25 dark:text-amber-200 dark:ring-amber-700/40"
          >
            <span aria-hidden>◌</span> outside pocket
          </span>
        </div>
      )}
      {(ext.confidence && ext.confidence !== "unknown") || ext.strain ? (
        <div className="mt-1 flex justify-end items-center gap-1">
          {/* Strain warning chip — only visible for mild/high to keep the
              matrix quiet; "ok" strain is the common case and would just be
              visual noise. Tooltip shows the kcal so users can drill in. */}
          {ext.strain && ext.strain.verdict !== "ok" && (
            <span
              title={`Pose strain: ${ext.strain.kcal.toFixed(2)} Å RMSD to nearest relaxed conformer (${ext.strain.verdict}). >2 Å often means a Vina junk pose where the ligand is bent into an unphysical shape.`}
              className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[8px] font-bold leading-none ${
                ext.strain.verdict === "high"
                  ? "bg-rose-500 text-white"
                  : "bg-amber-400 text-amber-950"
              }`}
              aria-label={`Strain ${ext.strain.verdict}`}
            >
              !
            </span>
          )}
          {/* PoseBusters verdict ribbon. Show high/medium/low (the real
              outcomes) AND the derived "skipped" state (timeout / couldn't
              start) — the skipped badge exists specifically so an empty
              matrix cell doesn't look like a validation failure when really
              we just didn't finish the check. Hide only "unknown", which
              means PB never ran at all (older jobs, full pipeline crash). */}
          {ext.confidence && ext.confidence !== "unknown" && (
            <ConfidenceRibbon
              confidence={ext.confidence}
              detail={ext.poseBusters}
              size="sm"
              tooltip={true}
            />
          )}
        </div>
      ) : null}
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
