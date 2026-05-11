/**
 * ScreeningPage — ranked hit list for a mutation-aware virtual screening run.
 *
 * Route: /screening/:shareId (public — anyone with the share link can view).
 *
 * The acquisition demo lives here: chemist picks a target + mutation panel
 * + N compounds, hits Run, and lands on this page to see the top hits
 * ranked by selectivity_index (|mutant| × sigmoid(−Δ × 4)) — the higher
 * the value the more selective the compound is for the mutant over WT.
 *
 * Page sections (top to bottom):
 *   1. Header strip — target, mutations, engine, status, progress counts.
 *   2. Toolbar — sort selector, variant filter, CSV export, refresh.
 *   3. Ranked table — one row per (compound, variant). Sorted server-side
 *      by selectivity_index DESC NULLS LAST so WT and failed rows float
 *      to the bottom. Each row carries the inline flags the chemist needs
 *      to know whether to trust the number:
 *        • outside-pocket (amber) — Δ is method noise
 *        • within-noise (|Δ| < 1 kcal/mol) — score is borderline
 *        • failed / skipped — explanatory error_message in a tooltip
 *
 * Polling: while status is pending/running we refetch every ~1.5 s, same
 * shape as JobPage's react-query setup. Stops polling on completed/failed
 * /cancelled.
 *
 * Outside-pocket detection: the row has no `extra` field exposed in the
 * Screening schema (it's stored backend-side for the AI panel + ADMET
 * pass but isn't on the wire). Instead we use a softer rule for the UI:
 * `selectivity_index === null` on a non-WT row with a real score
 * indicates either an outside-pocket cell or a missing WT pair. The
 * backend's _materialize_selectivity already encodes that semantics.
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Screening, type ScreeningResultOut } from "../api";
import { Spinner } from "../components/Icons";
import AdmetChips from "../components/AdmetChips";
import { usePageMeta } from "../lib/usePageMeta";

/** Screening-specific polling — simpler than jobPollingInterval because
 *  Screening has no async per-cell validation pass. When status is
 *  terminal (completed/failed/cancelled), polling stops. Otherwise we
 *  poll every `runningMs` ms. Mirrors the Job version's signature so a
 *  future merge into a shared helper is mechanical. */
function screeningPollingInterval(
  data: Screening | undefined,
  runningMs: number,
): number | false {
  if (!data) return runningMs;
  if (data.status === "pending" || data.status === "running") return runningMs;
  return false;
}

type SortKey = "selectivity" | "best-score" | "delta" | "compound";
type VariantFilter = "all" | "mutant" | "wt";

export default function ScreeningPage() {
  const { shareId = "" } = useParams<{ shareId: string }>();
  const [sortKey, setSortKey] = useState<SortKey>("selectivity");
  const [filter, setFilter] = useState<VariantFilter>("all");

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["screening", shareId],
    queryFn: () => api.getScreening(shareId),
    enabled: !!shareId,
    // Same polling shape as JobPage — keeps refetching while
    // pending/running, stops on terminal status. `jobPollingInterval`
    // takes the last data + a base interval and returns
    // `false`/number-of-ms.
    refetchInterval: (q) => screeningPollingInterval(q.state.data, 1500),
    refetchIntervalInBackground: false,
  });

  usePageMeta({
    title: data?.title || (data ? `Screening · ${data.pdb_id}` : "Screening · Liganx"),
    description: data
      ? `Mutation-aware virtual screening of ${data.n_total} compounds against ${data.pdb_id}${
          data.mutations.length ? " (" + data.mutations.join(", ") + ")" : ""
        }.`
      : "Mutation-aware virtual screening on Liganx",
  });

  // Filter + sort happens client-side because the server pre-sorts by
  // selectivity_index DESC but the user may want to re-sort by raw
  // score, Δ, or compound name. Filter ALSO happens client-side so
  // toggling between "all / mutant only / WT only" is instant — these
  // datasets are bounded at <=1000 rows in v1 so the cost is trivial.
  const visible: ScreeningResultOut[] = useMemo(() => {
    if (!data) return [];
    let rows = data.results.slice();
    if (filter === "mutant") rows = rows.filter((r) => r.variant !== "WT");
    if (filter === "wt") rows = rows.filter((r) => r.variant === "WT");

    rows.sort((a, b) => {
      switch (sortKey) {
        case "best-score":
          // Lower (more negative) is stronger — ascending.
          return (a.best_score ?? 999) - (b.best_score ?? 999);
        case "delta":
          // More negative Δ first (mutant tighter than WT).
          return (a.delta_score ?? 999) - (b.delta_score ?? 999);
        case "compound":
          return (a.compound_name || a.compound_smiles).localeCompare(
            b.compound_name || b.compound_smiles,
          );
        case "selectivity":
        default:
          // Higher selectivity first. Nulls (WT, failed) to the bottom.
          return (b.selectivity_index ?? -Infinity) - (a.selectivity_index ?? -Infinity);
      }
    });
    return rows;
  }, [data, sortKey, filter]);

  // ── Error states ─────────────────────────────────────────────
  if (isError) {
    const status = error instanceof ApiError ? error.status : 0;
    const msg = error instanceof ApiError ? error.message : "Could not load this screening";
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-ink dark:text-slate-100">
          {status === 404 ? "Screening not found" : "Error loading screening"}
        </h1>
        <p className="mt-3 text-slate-600 dark:text-slate-400">{msg}</p>
        <Link
          to="/history"
          className="inline-block mt-6 rounded-md bg-delta-600 hover:bg-delta-700 text-white px-4 py-2 text-sm font-semibold"
        >
          Back to history
        </Link>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-20 text-center text-slate-500 dark:text-slate-400">
        <Spinner size={18} />
        <span className="ml-2 text-sm">Loading screening…</span>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Header data={data} isFetching={isFetching} onRefresh={() => refetch()} />
      <ResultsToolbar
        data={data}
        sortKey={sortKey}
        setSortKey={setSortKey}
        filter={filter}
        setFilter={setFilter}
        visible={visible}
      />
      <ResultsTable data={data} rows={visible} />
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────

function Header({
  data,
  isFetching,
  onRefresh,
}: {
  data: Screening;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  const isTerminal = ["completed", "failed", "cancelled"].includes(data.status);
  const statusColor =
    data.status === "completed"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : data.status === "running" || data.status === "pending"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
        : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200";
  const progressPct = data.n_total > 0
    ? Math.min(100, Math.round((data.n_completed / data.n_total) * 100))
    : 0;

  return (
    <div className="panel px-5 py-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="badge bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200 text-[10px]">
              VIRTUAL SCREENING
            </span>
            <span className={`badge text-[10px] uppercase tracking-wider ${statusColor}`}>
              {data.status}
            </span>
            {isFetching && !isTerminal && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <Spinner size={11} /> refreshing
              </span>
            )}
          </div>
          <h1 className="mt-1 text-xl font-bold text-ink dark:text-slate-100">
            {data.title || `${data.pdb_id} screening`}
          </h1>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Target: <span className="font-mono">{data.pdb_id}</span>
              <span className="text-slate-400">/{data.chain}</span>
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span>
              Mutations:{" "}
              {data.mutations.length === 0 ? (
                <span className="text-slate-400">WT only</span>
              ) : (
                data.mutations.map((m) => (
                  <span key={m} className="font-mono inline-block mr-1.5">
                    {m}
                  </span>
                ))
              )}
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span>Engine: <span className="font-mono">{data.engine}</span></span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span>Exhaustiveness: <span className="font-mono">{data.exhaustiveness}</span></span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isFetching}
            className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            title="Refetch"
          >
            ↻ Refresh
          </button>
          <Link
            to="/history"
            className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ← History
          </Link>
        </div>
      </div>

      {/* Progress + counters */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-400">
        <span>
          <span className="font-semibold text-ink dark:text-slate-100">{data.n_completed}</span> /
          {" "}{data.n_total} cells docked
        </span>
        {data.n_failed > 0 && (
          <span className="text-rose-600 dark:text-rose-400">
            {data.n_failed} failed
          </span>
        )}
        <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden min-w-[120px] max-w-[280px]">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="font-mono">{progressPct}%</span>
      </div>

      {/* Error banner when failed */}
      {data.error_message && (
        <div className="mt-3 rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/60 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
          <strong className="font-semibold">Note:</strong> {data.error_message}
        </div>
      )}
    </div>
  );
}

function ResultsToolbar({
  data,
  sortKey,
  setSortKey,
  filter,
  setFilter,
  visible,
}: {
  data: Screening;
  sortKey: SortKey;
  setSortKey: (k: SortKey) => void;
  filter: VariantFilter;
  setFilter: (f: VariantFilter) => void;
  visible: ScreeningResultOut[];
}) {
  function downloadCsv() {
    const headers = [
      "rank", "variant", "compound", "smiles", "best_score_kcal_mol",
      "wt_score_kcal_mol", "delta_kcal_mol", "selectivity_index", "status",
    ];
    const lines = [headers.join(",")];
    visible.forEach((r, i) => {
      const cells = [
        String(i + 1),
        r.variant,
        // CSV-quote names (could contain commas).
        '"' + (r.compound_name || "").replace(/"/g, '""') + '"',
        '"' + r.compound_smiles.replace(/"/g, '""') + '"',
        r.best_score?.toFixed(3) ?? "",
        r.wt_score?.toFixed(3) ?? "",
        r.delta_score?.toFixed(3) ?? "",
        r.selectivity_index?.toFixed(4) ?? "",
        r.status,
      ];
      lines.push(cells.join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `screening-${data.share_id}-ranked.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
          Showing {visible.length} of {data.results.length}
        </span>
        <div className="inline-flex rounded-md bg-slate-100 dark:bg-slate-800 p-0.5">
          {(["all", "mutant", "wt"] as VariantFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                filter === f
                  ? "bg-white dark:bg-slate-900 text-violet-700 dark:text-violet-300 shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
              }`}
            >
              {f === "all" ? "All" : f === "mutant" ? "Mutant only" : "WT only"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <select
          className="input !w-auto !py-1.5 text-xs"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          <option value="selectivity">Sort: selectivity index</option>
          <option value="best-score">Sort: best score (kcal/mol)</option>
          <option value="delta">Sort: Δ vs WT</option>
          <option value="compound">Sort: compound name</option>
        </select>
        <button
          type="button"
          onClick={downloadCsv}
          disabled={visible.length === 0}
          className="rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40"
          title={`Download ${visible.length} rows as CSV`}
        >
          ↓ CSV
        </button>
      </div>
    </div>
  );
}

function ResultsTable({ data, rows }: { data: Screening; rows: ScreeningResultOut[] }) {
  // Empty state: screening is still pending and no rows have docked yet.
  if (rows.length === 0) {
    if (data.status === "pending" || data.status === "running") {
      return (
        <div className="panel px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
          <Spinner size={16} />
          <span className="ml-2">
            Screening is running — results will appear here as compounds finish docking.
          </span>
        </div>
      );
    }
    return (
      <div className="panel px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
        No results to display.
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      {/* Legend strip — same hue palette as the JobPage cell badges so a
          chemist switching between Job (matrix) and Screening (ranked
          list) sees consistent treatments. */}
      <div className="px-5 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span><strong className="font-semibold text-slate-600 dark:text-slate-300">Selectivity index</strong> — higher = more selective for mutant over WT.</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
          tighter on mutant (Δ&lt;0)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500" />
          weaker on mutant (Δ&gt;0)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400" />
          within noise (|Δ|&lt;1)
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <th className="text-left py-2 px-3 w-10">#</th>
              <th className="text-left py-2 px-3">Compound</th>
              <th className="text-right py-2 px-3 w-24">Variant</th>
              <th className="text-right py-2 px-3 w-28">Score</th>
              <th className="text-right py-2 px-3 w-24">WT score</th>
              <th className="text-right py-2 px-3 w-24">Δ vs WT</th>
              <th className="text-right py-2 px-3 w-28">Selectivity</th>
              <th className="text-right py-2 px-3 w-24">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Row key={`${r.compound_id}-${r.variant}`} r={r} rank={i + 1} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ r, rank }: { r: ScreeningResultOut; rank: number }) {
  // Failure path — show the row but mark it inert. The cell-level
  // `error_message` from the backend gets the tooltip treatment.
  const isFailure = r.status === "failed";
  const isSkipped = r.status === "skipped";
  const isPending = r.status === "pending";
  const isWT = r.variant === "WT";

  // Within-noise treatment: |Δ| < 1 kcal/mol is at the edge of single-
  // seed Vina noise. Highlighted in slate-italic so a chemist scanning
  // the list doesn't mistake a borderline number for a confident
  // selectivity gain.
  const withinNoise =
    !isWT && r.delta_score != null && Math.abs(r.delta_score) < 1.0;
  // Selectivity-index missing on a mutant row with a real score means
  // the paired WT hasn't docked yet OR the cell was flagged outside-
  // pocket by the runner. Both cases warrant the "unreliable" treatment.
  const noSelectivity = !isWT && r.selectivity_index == null && r.best_score != null;

  const deltaColor = (() => {
    if (r.delta_score == null) return "text-slate-300 dark:text-slate-600";
    if (withinNoise) return "text-slate-400 dark:text-slate-500 italic";
    if (r.delta_score < -0.3) return "text-emerald-600 dark:text-emerald-400 font-semibold";
    if (r.delta_score > 0.3) return "text-rose-600 dark:text-rose-400 font-semibold";
    return "text-slate-500 dark:text-slate-400";
  })();

  return (
    <tr
      className={`border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors ${
        isFailure ? "opacity-60" : ""
      }`}
    >
      <td className="py-2 px-3 text-slate-400 dark:text-slate-500 font-mono text-xs tabular-nums">
        {rank}
      </td>
      <td className="py-2 px-3">
        <div className="font-medium text-ink dark:text-slate-100 truncate max-w-[220px]">
          {r.compound_name || <span className="text-slate-400 italic">unnamed</span>}
        </div>
        <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-[260px]">
          {r.compound_smiles}
        </div>
        {/* ADMET strip — `compact` layout, only shown when admet present
            (which is only when the runner has predicted it; in synthetic
            dry-run mode admet is null and the strip stays hidden). */}
        {r.admet && <AdmetChips admet={r.admet} layout="compact" />}
      </td>
      <td className="py-2 px-3 text-right">
        {isWT ? (
          <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 text-[10px]">
            WT
          </span>
        ) : (
          <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{r.variant}</span>
        )}
      </td>
      <td className="py-2 px-3 text-right font-mono tabular-nums">
        {r.best_score != null ? (
          <span className="text-ink dark:text-slate-100 font-semibold">
            {r.best_score.toFixed(2)}
          </span>
        ) : (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        )}
      </td>
      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
        {r.wt_score != null ? r.wt_score.toFixed(2) : isWT ? "—" : ""}
      </td>
      <td className={`py-2 px-3 text-right font-mono tabular-nums ${deltaColor}`}>
        {r.delta_score != null
          ? `${r.delta_score > 0 ? "+" : ""}${r.delta_score.toFixed(2)}`
          : isWT
            ? "—"
            : ""}
      </td>
      <td className="py-2 px-3 text-right font-mono tabular-nums">
        {r.selectivity_index != null ? (
          <span className="text-violet-700 dark:text-violet-300 font-semibold">
            {r.selectivity_index.toFixed(2)}
          </span>
        ) : noSelectivity ? (
          <span
            className="text-amber-700 dark:text-amber-300 text-[10px] italic"
            title="Selectivity index unavailable — paired WT not yet docked, or this cell was flagged outside-pocket by the runner. Δ here may be method noise, not a real signal."
          >
            unreliable
          </span>
        ) : (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        )}
      </td>
      <td className="py-2 px-3 text-right">
        {isFailure ? (
          <span
            className="badge bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 text-[10px]"
            title={r.error_message || "Docking failed"}
          >
            failed
          </span>
        ) : isSkipped ? (
          <span
            className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 text-[10px]"
            title={r.error_message || "Skipped"}
          >
            skipped
          </span>
        ) : isPending ? (
          <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 text-[10px]">
            pending
          </span>
        ) : (
          <span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 text-[10px]">
            ok
          </span>
        )}
      </td>
    </tr>
  );
}
