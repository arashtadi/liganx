import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Compound } from "../api";
import { Download } from "./Icons";
import { parseExtra } from "../lib/parseExtra";
import { buildMatrixSvg, downloadMatrixPng } from "../lib/matrixFigure";

/**
 * CSV export with column picker. Two output shapes:
 *
 *   Wide format → one row per compound, one column per variant (good for
 *   side-by-side score comparison). Per-cell metadata (confidence, contacts,
 *   ΔΔG_fold, summary) is collapsed to "best Δ row" only.
 *
 *   Long format → one row per (compound × variant) pair (good for spreadsheets,
 *   pivot tables, or downstream scripts that need to filter by variant). Per-
 *   cell metadata flows naturally as additional columns.
 *
 * The picker auto-suggests Long when the user toggles on a per-cell column, so
 * they don't accidentally export a half-empty wide CSV.
 */

export interface MatrixRow {
  compound: Compound;
  scores: Record<string, number | undefined>;
  extras: Record<string, string | null | undefined>;
  wt: number | null;
}

interface Props {
  rows: MatrixRow[];
  variants: string[];   // ["WT", "T790M", ...]
  mutations: string[];  // ["T790M", ...]  (variants minus WT)
  /** Optional heading/subheading for the PNG figure export (e.g. the target
   *  name). Falls back to a generic "Selectivity matrix" heading. */
  figureTitle?: string;
  figureSubtitle?: string;
}

type Format = "wide" | "long";

interface ColumnState {
  name: boolean;
  smiles: boolean;
  scores: boolean;
  delta: boolean;
  confidence: boolean;
  contacts: boolean;
  foldxDDG: boolean;
  posebusters: boolean;
  summary: boolean;
}

const DEFAULT_COLUMNS: ColumnState = {
  name: true,
  smiles: true,
  scores: true,
  delta: true,
  confidence: false,
  contacts: false,
  foldxDDG: false,
  posebusters: false,
  summary: false,
};

/** Per-cell columns — only meaningful in long format. Used to decide whether
 *  to nudge the user toward switching format. */
const PER_CELL_KEYS: (keyof ColumnState)[] = [
  "confidence", "contacts", "foldxDDG", "posebusters", "summary",
];

export default function CsvExportButton({ rows, variants, mutations, figureTitle, figureSubtitle }: Props) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>("wide");
  const [cols, setCols] = useState<ColumnState>(DEFAULT_COLUMNS);
  // Two refs: the wrapper around the trigger button (for click-outside check),
  // and the popover itself (rendered via portal — see below).
  const triggerWrapRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Computed position for the portalled popover. Recomputed on open + on resize/scroll.
  const [popPos, setPopPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  // Click-outside / Esc to close. The popover lives in a portal under <body>,
  // so the click-outside check has to consider BOTH the trigger and the popover
  // to avoid closing when the user clicks inside the menu.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerWrapRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Compute popover position relative to the trigger button. Uses position:
  // fixed (so any ancestor's overflow:hidden can't clip it) and auto-flips
  // upward when there's not enough room below the trigger.
  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const trigger = triggerWrapRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const POP_W = 320;
      const MARGIN = 8;          // breathing room from viewport edges
      const PREFERRED_H = 480;   // typical popover height when content is fully visible

      const vpW = window.innerWidth;
      const vpH = window.innerHeight;

      // Horizontal: right-align to the trigger by default, but clamp into
      // the viewport so the menu never disappears off-screen on narrow windows.
      let left = rect.right - POP_W;
      if (left < MARGIN) left = MARGIN;
      if (left + POP_W > vpW - MARGIN) left = vpW - POP_W - MARGIN;

      // Vertical: prefer below the trigger; flip above if the room below is
      // too cramped AND there's more room above.
      const spaceBelow = vpH - rect.bottom - MARGIN;
      const spaceAbove = rect.top - MARGIN;
      let top: number;
      let maxHeight: number;
      if (spaceBelow >= PREFERRED_H || spaceBelow >= spaceAbove) {
        // Open downward
        top = rect.bottom + MARGIN;
        maxHeight = Math.max(200, spaceBelow);
      } else {
        // Open upward — anchor the BOTTOM edge of the popover above the trigger
        maxHeight = Math.max(200, spaceAbove);
        top = rect.top - MARGIN - Math.min(PREFERRED_H, maxHeight);
        if (top < MARGIN) top = MARGIN;
      }
      setPopPos({ top, left, maxHeight });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);  // capture scrolls in any ancestor
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  // Auto-bump to long format if user enables a per-cell column while in wide.
  // Doesn't go the other way — we trust them to switch back themselves.
  function toggle(key: keyof ColumnState) {
    setCols((c) => {
      const next = { ...c, [key]: !c[key] };
      if (format === "wide" && PER_CELL_KEYS.includes(key) && next[key]) {
        setFormat("long");
      }
      return next;
    });
  }

  function exportCsv() {
    const csv = format === "wide"
      ? buildWide(rows, variants, mutations, cols)
      : buildLong(rows, variants, cols);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `liganx-results-${format}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  // Clean, shareable PNG of the selectivity matrix — the "figure" version of
  // the export for slides/papers/Slack. Best-effort; never breaks the panel.
  async function exportFigure() {
    try {
      const fig = buildMatrixSvg(rows, variants, mutations, {
        title: figureTitle,
        subtitle: figureSubtitle,
      });
      await downloadMatrixPng(fig, "liganx-selectivity-matrix.png", 2);
    } catch {
      /* swallow — a failed figure export must not take down the results panel */
    }
    setOpen(false);
  }

  // Popover content extracted so we can portal it into <body> and escape any
  // ancestor's overflow-hidden / clip context (the matrix panel has both).
  // Layout: header • format radios • scrollable column list (takes remaining
  // height) • footer pinned to the bottom. The whole thing is capped at the
  // available viewport height so it never flows off-screen.
  const popoverNode = open && popPos ? (
    <div
      ref={popoverRef}
      style={{
        position: "fixed",
        top: popPos.top,
        left: popPos.left,
        width: 320,
        maxHeight: popPos.maxHeight,
        zIndex: 200,
      }}
      className="bg-white border border-slate-200 rounded-lg shadow-xl text-sm flex flex-col overflow-hidden dark:bg-slate-800 dark:border-slate-700"
    >
      <div className="px-4 py-3 border-b border-slate-100 shrink-0 dark:border-slate-700">
        <div className="font-semibold text-ink text-xs uppercase tracking-wider dark:text-slate-100">
          Export options
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
          A <b>CSV</b> data table, or a clean <b>PNG</b> figure — pick below.
        </div>
      </div>

      {/* Format radio */}
      <div className="px-4 py-3 border-b border-slate-100 space-y-1.5 shrink-0 dark:border-slate-700">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1 dark:text-slate-400">
          Layout
        </div>
        <FormatRadio
          checked={format === "wide"}
          onChange={() => setFormat("wide")}
          label="Wide"
          hint="One row per compound, one column per variant"
        />
        <FormatRadio
          checked={format === "long"}
          onChange={() => setFormat("long")}
          label="Long"
          hint="One row per compound × variant — better for per-cell metadata"
        />
      </div>

      {/* Column checkboxes — flex-1 + min-h-0 so this section scrolls if the
          popover is height-constrained, while header/footer stay pinned. */}
      <div className="px-4 py-3 flex-1 min-h-0 overflow-y-auto">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2 dark:text-slate-400">
          Columns
        </div>
        <Check label="Compound name"            on={cols.name}        onChange={() => toggle("name")} />
        <Check label="SMILES"                   on={cols.smiles}      onChange={() => toggle("smiles")} />
        <Check label="Variant scores"           on={cols.scores}      onChange={() => toggle("scores")} />
        <Check label="Δ vs WT"                  on={cols.delta}       onChange={() => toggle("delta")} />
        <Check label="Confidence (PoseBusters)" on={cols.confidence}  onChange={() => toggle("confidence")} perCell format={format} />
        <Check label="Interaction contacts"     on={cols.contacts}    onChange={() => toggle("contacts")} perCell format={format} />
        <Check label="ΔΔG fold (FoldX)"         on={cols.foldxDDG}    onChange={() => toggle("foldxDDG")} perCell format={format} />
        <Check label="PoseBusters detail"       on={cols.posebusters} onChange={() => toggle("posebusters")} perCell format={format} />
        <Check label="Pose summary"             on={cols.summary}     onChange={() => toggle("summary")} perCell format={format} />
      </div>

      {/* Footer: export */}
      <div className="px-4 py-3 border-t border-slate-100 shrink-0 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/40 space-y-2">
        <div className="text-[10px] text-slate-400 dark:text-slate-500">
          {rows.length} compound{rows.length === 1 ? "" : "s"} ·
          {format === "wide" ? ` ${variants.length} variants` : ` ${rows.length * variants.length} rows`}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportFigure}
            className="btn-secondary btn-sm flex-1 justify-center"
            title="Download a clean, shareable PNG figure of the selectivity matrix — drops straight into slides or a paper"
          >
            <Download size={12} /> Figure (PNG)
          </button>
          <button onClick={exportCsv} className="btn-primary btn-sm flex-1 justify-center">
            <Download size={12} /> CSV
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="relative" ref={triggerWrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-secondary btn-sm"
        title="Export — CSV data table or a clean PNG figure"
      >
        <Download size={14} /> Export
        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">CSV · PNG</span>
        <svg width="10" height="10" viewBox="0 0 12 12" className="opacity-60">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Render popover into document.body so ancestor overflow-hidden can't
          clip it. SSR-safe: only portal when document is available. */}
      {popoverNode && typeof document !== "undefined" && createPortal(popoverNode, document.body)}
    </div>
  );
}

/* ─────── helpers ─────── */

function FormatRadio({
  checked, onChange, label, hint,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer hover:bg-slate-50 -mx-1 px-1 py-1 rounded dark:hover:bg-slate-700">
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5 accent-delta-500" />
      <div>
        <div className="text-[13px] text-ink leading-tight dark:text-slate-100">{label}</div>
        <div className="text-[10px] text-slate-500 leading-tight dark:text-slate-400">{hint}</div>
      </div>
    </label>
  );
}

function Check({
  label, on, onChange, perCell, format,
}: {
  label: string;
  on: boolean;
  onChange: () => void;
  perCell?: boolean;
  format?: Format;
}) {
  // Per-cell columns can technically be exported in wide format too — they
  // become "best variant value" — but it's lossy. Hint that long is better.
  const lossy = perCell && format === "wide" && on;
  return (
    <label className="flex items-center gap-2 cursor-pointer py-1 hover:bg-slate-50 -mx-1 px-1 rounded dark:hover:bg-slate-700">
      <input type="checkbox" checked={on} onChange={onChange} className="accent-delta-500" />
      <span className="text-[13px] text-ink flex-1 dark:text-slate-100">{label}</span>
      {lossy && (
        <span className="text-[9px] text-amber-600 font-semibold uppercase tracking-wider dark:text-amber-400" title="Per-cell data — switch to Long for full detail">
          long-format
        </span>
      )}
    </label>
  );
}

/* ─────── CSV builders ─────── */

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildWide(
  rows: MatrixRow[],
  variants: string[],
  mutations: string[],
  cols: ColumnState,
): string {
  const header: string[] = [];
  if (cols.name) header.push("compound");
  if (cols.smiles) header.push("smiles");
  if (cols.scores) for (const v of variants) header.push(`score_${v}`);
  if (cols.delta) for (const m of mutations) header.push(`delta_${m}`);
  // Per-cell columns in wide: collapse to the BEST mutant cell (smallest Δ vs WT)
  if (cols.confidence)  header.push("best_confidence");
  if (cols.contacts)    header.push("best_contacts");
  if (cols.foldxDDG)    header.push("best_foldx_ddg");
  if (cols.posebusters) header.push("best_posebusters");
  if (cols.summary)     header.push("best_summary");

  const lines = [header.join(",")];

  for (const r of rows) {
    const cells: string[] = [];
    if (cols.name) cells.push(csvEscape(r.compound.name ?? ""));
    if (cols.smiles) cells.push(csvEscape(r.compound.smiles));
    if (cols.scores) for (const v of variants) cells.push(formatScore(r.scores[v]));
    if (cols.delta) {
      for (const m of mutations) {
        const s = r.scores[m];
        cells.push(s != null && r.wt != null ? (s - r.wt).toFixed(2) : "");
      }
    }

    // Best mutant cell for per-cell metadata in wide format
    if (cols.confidence || cols.contacts || cols.foldxDDG || cols.posebusters || cols.summary) {
      let bestVariant: string | null = null;
      let bestDelta = Infinity;
      for (const m of mutations) {
        const s = r.scores[m];
        if (s == null || r.wt == null) continue;
        const d = s - r.wt;
        if (d < bestDelta) { bestDelta = d; bestVariant = m; }
      }
      const ext = bestVariant ? parseExtra(r.extras[bestVariant]) : null;
      if (cols.confidence)  cells.push(csvEscape(ext?.confidence ?? ""));
      if (cols.contacts)    cells.push(csvEscape(formatContacts(ext?.contacts)));
      if (cols.foldxDDG)    cells.push(ext?.foldxDDG != null ? ext.foldxDDG.toFixed(2) : "");
      if (cols.posebusters) cells.push(csvEscape(ext?.poseBusters ?? ""));
      if (cols.summary)     cells.push(csvEscape(ext?.summary ?? ""));
    }

    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

function buildLong(
  rows: MatrixRow[],
  variants: string[],
  cols: ColumnState,
): string {
  const header: string[] = [];
  if (cols.name) header.push("compound");
  if (cols.smiles) header.push("smiles");
  header.push("variant");
  if (cols.scores) header.push("score_kcal_per_mol");
  if (cols.delta) header.push("delta_vs_wt");
  if (cols.confidence)  header.push("confidence");
  if (cols.contacts)    header.push("contacts");
  if (cols.foldxDDG)    header.push("foldx_ddg");
  if (cols.posebusters) header.push("posebusters");
  if (cols.summary)     header.push("summary");

  const lines = [header.join(",")];
  for (const r of rows) {
    for (const v of variants) {
      const s = r.scores[v];
      const ext = parseExtra(r.extras[v]);
      const cells: string[] = [];
      if (cols.name) cells.push(csvEscape(r.compound.name ?? ""));
      if (cols.smiles) cells.push(csvEscape(r.compound.smiles));
      cells.push(v);
      if (cols.scores) cells.push(formatScore(s));
      if (cols.delta) {
        cells.push(v === "WT" ? "" : (s != null && r.wt != null ? (s - r.wt).toFixed(2) : ""));
      }
      if (cols.confidence)  cells.push(csvEscape(ext.confidence ?? ""));
      if (cols.contacts)    cells.push(csvEscape(formatContacts(ext.contacts)));
      if (cols.foldxDDG)    cells.push(ext.foldxDDG != null ? ext.foldxDDG.toFixed(2) : "");
      if (cols.posebusters) cells.push(csvEscape(ext.poseBusters ?? ""));
      if (cols.summary)     cells.push(csvEscape(ext.summary ?? ""));
      lines.push(cells.join(","));
    }
  }
  return lines.join("\n");
}

function formatScore(s: number | undefined): string {
  return s == null ? "" : s.toFixed(2);
}

function formatContacts(contacts: { residue: string; type: string }[] | undefined): string {
  if (!contacts || contacts.length === 0) return "";
  return contacts.map((c) => `${c.residue}:${c.type}`).join(";");
}
