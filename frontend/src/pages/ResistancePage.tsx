// ResistancePage — full results page for a Resistance Radar scan.
//
// Route: /resistance/:id. Reads the local scan record (lib/resistanceHistory)
// and renders the liability map full-size. If the scan is still "running"
// (docks in flight), it RESUMES by polling the same job ids the launcher
// saved — so closing the window mid-scan and reopening this URL just picks up
// where it left off. Finished scans render instantly with no re-docking.
//
// Phase 1 is browser-local: this page reads the record from THIS browser.
// Phase 2's durable backend record is what will make the URL shareable to
// other people.

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import {
  getResistanceScan,
  upsertResistanceScan,
  type SavedResistanceScan,
} from "../lib/resistanceHistory";
import { usePageMeta } from "../lib/usePageMeta";
import {
  ddgTier,
  fmt,
  fmtSigned,
  fmtWhen,
  DDG_BAR_MAX,
  RESISTANCE_AT_RISK,
} from "../lib/resistanceScoring";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function ResistancePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // undefined = still loading; null = not found in this browser.
  const [scan, setScan] = useState<SavedResistanceScan | null | undefined>(undefined);
  const cancelled = useRef(false);
  const scanRef = useRef<SavedResistanceScan | null>(null);

  usePageMeta({
    title: scan ? `Resistance Radar · ${scan.targetLabel.toUpperCase()}` : "Resistance Radar",
    description: "Live resistance forecast for a compound across a target's variant panel.",
  });

  useEffect(() => {
    cancelled.current = false;
    const s = id ? getResistanceScan(id) : null;
    if (!s) {
      setScan(null);
      return;
    }
    scanRef.current = s;
    setScan(s);
    if (s.status === "running") resume();
    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function update(mut: (s: SavedResistanceScan) => SavedResistanceScan) {
    const cur = scanRef.current;
    if (!cur) return;
    const next = mut(cur);
    scanRef.current = next;
    setScan(next);
    upsertResistanceScan(next);
  }

  async function pollJob(key: string) {
    // ~10 min ceiling (150 × 4s) so a stuck runner can't spin forever.
    for (let i = 0; i < 150; i++) {
      if (cancelled.current) throw new Error("cancelled");
      const j = await api.getJob(key);
      if (j.status === "completed" || j.status === "failed" || j.status === "cancelled") return j;
      await sleep(4000);
    }
    throw new Error("timed out waiting for docks");
  }

  async function resume() {
    const s = scanRef.current;
    if (!s) return;
    // Pending = rows with a job id but no score yet, grouped by job.
    const byJob: Record<string, string[]> = {};
    for (const r of s.rows) {
      if (r.mutScore == null && !r.error && r.jobKey) (byJob[r.jobKey] ||= []).push(r.code);
    }
    const keys = Object.keys(byJob);
    if (keys.length === 0) {
      update((sc) => ({ ...sc, status: "done", updatedAt: new Date().toISOString() }));
      return;
    }
    await Promise.all(
      keys.map(async (key) => {
        try {
          const done = await pollJob(key);
          const results = (done.results || []) as { variant: string; best_score: number | null }[];
          const wt = results.find((r) => r.variant.toUpperCase() === "WT")?.best_score ?? null;
          update((sc) => ({
            ...sc,
            updatedAt: new Date().toISOString(),
            rows: sc.rows.map((row) => {
              if (row.jobKey !== key) return row;
              const hit = results.find((r) => r.variant.toUpperCase() === row.code.toUpperCase());
              const failed = done.status === "failed";
              const mutScore = failed ? null : hit?.best_score ?? null;
              return {
                ...row,
                mutScore,
                wtScore: wt,
                error:
                  mutScore == null
                    ? failed
                      ? done.error_message || "dock failed"
                      : "no pose"
                    : null,
              };
            }),
          }));
        } catch (e: any) {
          if (cancelled.current) return;
          update((sc) => ({
            ...sc,
            updatedAt: new Date().toISOString(),
            rows: sc.rows.map((row) =>
              row.jobKey === key ? { ...row, error: row.error ?? (e?.message || "poll failed") } : row
            ),
          }));
        }
      })
    );
    if (cancelled.current) return;
    update((sc) => ({ ...sc, status: "done", updatedAt: new Date().toISOString() }));
  }

  // ── Loading / not-found ──
  if (scan === undefined) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-slate-500 font-mono text-sm">
        <span className="animate-pulse">▮ loading scan…</span>
      </div>
    );
  }
  if (scan === null) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <h1 className="font-mono text-lg text-slate-200">Scan not found</h1>
        <p className="text-slate-400 text-sm leading-relaxed">
          This resistance scan isn't saved in this browser. Scans are stored locally for now, so a
          scan run on another device or browser won't appear here.
        </p>
        <Link
          to="/studio"
          className="inline-block px-4 py-1.5 rounded border border-cyan-600/60 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/50 font-mono text-xs uppercase tracking-wider"
        >
          ← Back to Studio
        </Link>
      </div>
    );
  }

  // ── Derived ──
  const scored = scan.rows.map((r) => ({
    ...r,
    ddg: r.mutScore != null && r.wtScore != null ? r.mutScore - r.wtScore : null,
  }));
  const ranked = [...scored].sort((a, b) => (b.ddg ?? -Infinity) - (a.ddg ?? -Infinity));
  const resolved = scored.filter((r) => r.ddg != null);
  const worst = resolved.reduce<null | (typeof scored)[number]>(
    (acc, r) => (acc == null || (r.ddg ?? -Infinity) > (acc.ddg ?? -Infinity) ? r : acc),
    null
  );
  const nRetained = resolved.filter((r) => (r.ddg ?? 0) < RESISTANCE_AT_RISK).length;
  const nCliff = resolved.filter((r) => (r.ddg ?? 0) >= 2.0).length;
  const pending = scan.rows.filter((r) => r.mutScore == null && !r.error).length;
  const running = scan.status === "running" && pending > 0;
  const doneCount = scan.rows.length - pending;
  const wtScores = scored.map((r) => r.wtScore).filter((v): v is number => v != null);
  const wtShown = wtScores.length ? wtScores.reduce((a, b) => a + b, 0) / wtScores.length : null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => navigate("/studio")}
          className="text-[11px] font-mono text-slate-500 hover:text-slate-300 mb-3"
        >
          ← Back to Studio
        </button>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg">🎯</span>
              <h1 className="font-mono text-base uppercase tracking-[0.12em] text-slate-100">
                Resistance Radar
              </h1>
              <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40">
                beta
              </span>
            </div>
            <p className="mt-1.5 text-[13px] text-slate-300">
              Will <span className="text-slate-100 font-semibold">{scan.compoundName}</span> hold up
              as <span className="text-cyan-300">{scan.targetLabel.toUpperCase()}</span> mutates?
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {running ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-cyan-700/50 bg-cyan-950/30 text-cyan-300 font-mono text-[10px] uppercase tracking-wider">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Docking {doneCount}/{scan.rows.length}
              </span>
            ) : (
              <span className="px-2 py-1 rounded border border-emerald-700/50 bg-emerald-950/30 text-emerald-300 font-mono text-[10px] uppercase tracking-wider">
                ● Completed
              </span>
            )}
            <span className="text-[10px] font-mono text-slate-500">{fmtWhen(scan.savedAt)}</span>
          </div>
        </div>
      </div>

      {/* Verdict */}
      <div
        className={`rounded-lg border px-4 py-3 ${
          running
            ? "border-slate-700/60 bg-slate-900/40"
            : nCliff > 0
            ? "border-rose-700/50 bg-rose-950/30"
            : resolved.length > 0
            ? "border-emerald-700/50 bg-emerald-950/25"
            : "border-amber-700/50 bg-amber-950/25"
        }`}
      >
        {running ? (
          <div className="flex items-center gap-2 text-[13px] font-mono text-cyan-200">
            <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            Docking {doneCount}/{scan.rows.length} variants (each with its own WT)…
          </div>
        ) : nCliff > 0 && worst ? (
          <div className="text-[13px] text-rose-100 leading-snug">
            <span className="font-semibold">⚠ Resistance predicted.</span> Binding falls off hardest
            at <span className="font-mono text-rose-300">{worst.code}</span> ({fmtSigned(worst.ddg)}{" "}
            kcal/mol vs WT).{" "}
            <span className="text-rose-200/80">
              {nRetained}/{resolved.length} variants still hold binding.
            </span>
          </div>
        ) : resolved.length > 0 ? (
          <div className="text-[13px] text-emerald-100 leading-snug">
            <span className="font-semibold">✓ No major resistance predicted.</span> Binding is
            retained across all {resolved.length} scanned variants
            {worst && worst.ddg != null ? ` (worst shift ${fmtSigned(worst.ddg)} kcal/mol).` : "."}
          </div>
        ) : (
          <div className="text-[13px] text-amber-100 leading-snug">
            No variant produced a usable score — every dock failed or returned no pose.
          </div>
        )}
        {wtShown != null && (
          <div className="mt-1.5 text-[11px] font-mono text-slate-500">
            WT baseline: {fmt(wtShown)} kcal/mol{wtScores.length > 1 ? " (mean of co-docked WTs)" : ""}
          </div>
        )}
      </div>

      {/* Liability map */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-slate-500 px-1">
          <span>mutation</span>
          <span>ΔΔ binding vs WT →</span>
        </div>
        {ranked.map((r) => {
          const t = ddgTier(r.ddg);
          const pct = r.ddg == null ? 0 : (Math.max(0, Math.min(DDG_BAR_MAX, r.ddg)) / DDG_BAR_MAX) * 100;
          const retained = r.ddg != null && r.ddg < RESISTANCE_AT_RISK;
          const isDocking = r.mutScore == null && !r.error;
          return (
            <div key={r.code} className={`rounded border ${t.ring} bg-slate-900/40 px-3 py-2`}>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[13px] text-slate-200 w-20 shrink-0" title={r.significance}>
                  {r.code}
                </span>
                <div className="flex-1 h-4 rounded bg-slate-800/70 relative overflow-hidden">
                  {isDocking ? (
                    <div className="absolute inset-0 flex items-center pl-2 text-[10px] font-mono text-cyan-300/80 animate-pulse">
                      docking…
                    </div>
                  ) : r.error ? (
                    <div className="absolute inset-0 flex items-center pl-2 text-[10px] font-mono text-slate-500">
                      {r.error}
                    </div>
                  ) : retained ? (
                    <div className="absolute inset-y-0 left-0 w-2 bg-emerald-500" />
                  ) : (
                    <div className={`absolute inset-y-0 left-0 ${t.bar}`} style={{ width: `${Math.max(4, pct)}%` }} />
                  )}
                </div>
                <span className={`font-mono text-[12px] tabular-nums w-16 text-right shrink-0 ${t.text}`}>
                  {r.mutScore != null ? fmtSigned(r.ddg) : ""}
                </span>
                <span className={`text-[9px] font-mono uppercase tracking-wider w-16 text-right shrink-0 ${t.text}`}>
                  {r.mutScore != null ? t.label : ""}
                </span>
                {r.jobKey ? (
                  <a
                    href={`/jobs/${r.jobKey}?from=resistance`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-[11px] text-slate-500 hover:text-cyan-300 w-6 text-center"
                    title="Open the docked pose for this variant"
                  >
                    ↗
                  </a>
                ) : (
                  <span className="w-6 shrink-0" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Phase 1 signal: Δ-docking only (score shift vs a WT co-docked in the same job). A positive ΔΔ
        means the mutant binds your compound more weakly — a resistance liability. Click ↗ on any row
        to open that variant's docked pose. The full Atlas-grade forecast (ESM2 fold-stability +
        calibrated probability) comes next.
      </p>

      <div className="flex items-center gap-2 pt-1">
        <Link
          to="/studio"
          className="px-4 py-1.5 rounded border border-cyan-600/60 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/50 font-mono text-[12px] uppercase tracking-wider"
        >
          ↺ New scan in Studio
        </Link>
      </div>
    </div>
  );
}
