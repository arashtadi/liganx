// ResistanceRadar — LIVE, in-Studio resistance forecast for a user's own
// compound (feature/resistance-radar, v0.2).
//
// The public /atlas forecasts resistance for approved drugs from a
// precomputed, offline-generated model. This brings the same idea to the
// molecule the user just drew: dock their compound across the target's
// known resistance panel and draw a liability map — which mutations weaken
// binding, and by how much.
//
// PHASE 1 (this file): the Δ-docking axis only. It reuses the EXISTING dock
// endpoint (api.createJob / api.getJob) — no backend change, nothing in the
// existing flow is touched. Each batch job co-docks WT + its mutations, so
// every job is self-contained and each mutation's ΔΔ = score(mut) −
// score(WT) uses a WT docked under identical conditions. Positive ΔΔ = the
// mutant binds the compound more weakly = a resistance liability.
//
// Scans are saved locally (lib/resistanceHistory) so past maps reopen
// without re-docking. Each job is titled/tagged so it's identifiable in the
// user's History page.
//
// PHASE 2 (later, needs a small backend endpoint): fold in the ESM2
// fold-stability axis + the Atlas's calibrated joint-probability model so a
// live compound gets the same forecast quality as an Atlas drug page.

import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import {
  listResistanceScans,
  saveResistanceScan,
  deleteResistanceScan,
  type SavedResistanceScan,
} from "../lib/resistanceHistory";

type Mut = { code: string; label: string; significance: string };

type RowStatus = "pending" | "running" | "done" | "failed";
type Row = {
  code: string;
  label: string;
  significance: string;
  status: RowStatus;
  mutScore: number | null;
  wtScore: number | null; // WT co-docked in the same job as this mutant
  error?: string | null;
};

type Phase = "confirm" | "running" | "done" | "error";

const MAX_PANEL = 6; // cost cap — never scan more than this many mutations
const BATCH = 2; // backend caps mutations-per-job at 2

// Rough wall-time estimate for the "~N min" copy. Docks run concurrently
// (RunPod serverless), so wall time ≈ one wave, not the sum.
const EST_MIN = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A mutation is a resistance liability if its clinical context says so. */
function isResistance(m: Mut): boolean {
  return /resist|escape|refractor|relapse|gatekeeper|solvent[- ]front/i.test(
    `${m.label} ${m.significance}`
  );
}

/** Build the scan panel: prefer curated resistance mutations; fall back to
 *  the full curated list when none are explicitly tagged. De-duped, capped. */
function pickPanel(muts: Mut[]): Mut[] {
  const res = muts.filter(isResistance);
  const base = res.length > 0 ? res : muts;
  const seen = new Set<string>();
  const out: Mut[] = [];
  for (const m of base) {
    const key = m.code.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(m);
    }
  }
  return out.slice(0, MAX_PANEL);
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const fmt = (v: number | null | undefined, dp = 2) =>
  v == null || Number.isNaN(v) ? "—" : v.toFixed(dp);

const fmtSigned = (v: number | null | undefined, dp = 2) =>
  v == null || Number.isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dp)}`;

function fmtWhen(iso: string): string {
  // Compact local date+time without pulling in a date lib.
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

/** Tier a ΔΔ (kcal/mol) into a resistance verdict + colour system. Positive
 *  ΔΔ = weaker mutant binding = resistance. Thresholds are deliberately
 *  conservative for a docking-only signal (phase 2 adds calibration). */
function ddgTier(ddg: number | null) {
  if (ddg == null)
    return { label: "—", text: "text-slate-500", bar: "bg-slate-600", ring: "border-slate-700" };
  if (ddg >= 2.0)
    return { label: "resistance", text: "text-rose-300", bar: "bg-rose-500", ring: "border-rose-600/60" };
  if (ddg >= 0.75)
    return { label: "at risk", text: "text-amber-300", bar: "bg-amber-500", ring: "border-amber-600/60" };
  return { label: "retained", text: "text-emerald-300", bar: "bg-emerald-500", ring: "border-emerald-600/60" };
}

export interface ResistanceRadarProps {
  open: boolean;
  onClose: () => void;
  smiles: string;
  compoundName?: string | null;
  targetId: string;
  targetLabel: string;
  pdbId: string;
  chain: string;
  uniprotId?: string | null;
  mutations: Mut[];
}

export default function ResistanceRadar({
  open,
  onClose,
  smiles,
  compoundName,
  targetId,
  targetLabel,
  pdbId,
  chain,
  uniprotId,
  mutations,
}: ResistanceRadarProps) {
  const panel = useMemo(() => pickPanel(mutations), [mutations]);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedScans, setSavedScans] = useState<SavedResistanceScan[]>(() => listResistanceScans());
  // Non-null while the "done" view is showing a reopened historical scan
  // rather than a fresh run.
  const [viewingSaved, setViewingSaved] = useState<{ name: string; at: string } | null>(null);
  const cancelled = useRef(false);

  if (!open) return null;

  const nBatches = Math.max(1, Math.ceil(panel.length / BATCH));
  const nDocks = panel.length + nBatches; // one WT per batch

  // ── Derived: ΔΔ per row (each mutant vs its own co-docked WT) ──
  const scored = rows.map((r) => ({
    ...r,
    ddg: r.mutScore != null && r.wtScore != null ? r.mutScore - r.wtScore : null,
  }));
  const ranked = [...scored].sort((a, b) => (b.ddg ?? -Infinity) - (a.ddg ?? -Infinity));
  const resolved = scored.filter((r) => r.ddg != null);
  const worst = resolved.reduce<null | (typeof scored)[number]>(
    (acc, r) => (acc == null || (r.ddg ?? -Infinity) > (acc.ddg ?? -Infinity) ? r : acc),
    null
  );
  const nRetained = resolved.filter((r) => (r.ddg ?? 0) < 0.75).length;
  const nCliff = resolved.filter((r) => (r.ddg ?? 0) >= 2.0).length;
  const allDone = rows.length > 0 && rows.every((r) => r.status === "done" || r.status === "failed");

  // Representative WT baseline for the banner — mean of the co-docked WTs.
  const wtScores = scored.map((r) => r.wtScore).filter((v): v is number => v != null);
  const wtShown = wtScores.length ? wtScores.reduce((a, b) => a + b, 0) / wtScores.length : null;

  // ── Orchestration ──
  async function run() {
    cancelled.current = false;
    setError(null);
    setViewingSaved(null);
    setPhase("running");
    setRows(
      panel.map((m) => ({
        code: m.code,
        label: m.label,
        significance: m.significance,
        status: "running",
        mutScore: null,
        wtScore: null,
      }))
    );

    const compound = [{ name: compoundName || "Studio compound", smiles }];
    const batches = chunk(panel, BATCH);
    // Local accumulator so the saved snapshot doesn't race React state.
    const collected: Record<string, { mut: number | null; wt: number | null }> = {};

    try {
      const jobs: { key: string; codes: string[] }[] = [];
      for (const batch of batches) {
        if (cancelled.current) return;
        const codes = batch.map((m) => m.code);
        const job = await api.createJob({
          pdb_id: pdbId,
          chain: chain || "A",
          uniprot_id: uniprotId || undefined,
          mutations: codes,
          compounds: compound,
          include_wt: true, // co-dock WT in every job so ΔΔ is same-conditions
          engine: "quickvina2_gpu",
          title: `Resistance Radar · ${targetLabel.toUpperCase()} · ${codes.join("+")}`,
          tags: ["resistance-radar"],
        });
        const key = (job as any).share_id ?? String((job as any).id ?? "");
        if (!key) throw new Error("Dock submitted but no job id came back.");
        jobs.push({ key, codes });
      }

      await Promise.all(
        jobs.map(async (j) => {
          try {
            const done = await pollJob(j.key);
            const results = (done.results || []) as { variant: string; best_score: number | null }[];
            const wt = results.find((r) => r.variant.toUpperCase() === "WT")?.best_score ?? null;
            for (const code of j.codes) {
              const hit = results.find((r) => r.variant.toUpperCase() === code.toUpperCase());
              collected[code] = { mut: done.status === "failed" ? null : hit?.best_score ?? null, wt };
            }
            setRows((prev) =>
              prev.map((row) => {
                if (!j.codes.includes(row.code)) return row;
                const hit = results.find((r) => r.variant.toUpperCase() === row.code.toUpperCase());
                const failed = done.status === "failed";
                const mutScore = failed ? null : hit?.best_score ?? null;
                return {
                  ...row,
                  status: mutScore != null ? "done" : "failed",
                  mutScore,
                  wtScore: wt,
                  error: mutScore == null ? (failed ? done.error_message || "dock failed" : "no pose") : null,
                };
              })
            );
          } catch (e: any) {
            for (const code of j.codes) collected[code] = { mut: null, wt: null };
            setRows((prev) =>
              prev.map((row) =>
                j.codes.includes(row.code)
                  ? { ...row, status: "failed", error: e?.message || "poll failed" }
                  : row
              )
            );
          }
        })
      );

      if (cancelled.current) return;

      // Persist the finished scan locally so its map can be reopened.
      const savedRows = panel.map((m) => ({
        code: m.code,
        label: m.label,
        significance: m.significance,
        mutScore: collected[m.code]?.mut ?? null,
        wtScore: collected[m.code]?.wt ?? null,
      }));
      const wts = savedRows.map((r) => r.wtScore).filter((v): v is number => v != null);
      saveResistanceScan({
        targetId,
        targetLabel,
        compoundName: compoundName || "Studio compound",
        smiles,
        wtScore: wts.length ? wts.reduce((a, b) => a + b, 0) / wts.length : null,
        rows: savedRows,
      });
      setSavedScans(listResistanceScans());
      setPhase("done");
    } catch (e: any) {
      if (cancelled.current) return;
      setError(e?.message || "Resistance scan failed to start.");
      setPhase("error");
    }
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

  function loadScan(s: SavedResistanceScan) {
    setViewingSaved({ name: s.compoundName, at: s.savedAt });
    setRows(
      s.rows.map((r) => ({
        code: r.code,
        label: r.label,
        significance: r.significance,
        status: r.mutScore != null ? "done" : "failed",
        mutScore: r.mutScore,
        wtScore: r.wtScore,
        error: r.mutScore == null ? r.error ?? "no result" : null,
      }))
    );
    setPhase("done");
  }

  function removeScan(id: string) {
    deleteResistanceScan(id);
    setSavedScans(listResistanceScans());
  }

  function close() {
    cancelled.current = true;
    onClose();
  }

  // ── Render ──
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col rounded-lg border border-slate-700/70 bg-[#0b1120] shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px]">🎯</span>
              <h2 className="font-mono text-sm uppercase tracking-[0.15em] text-slate-100">
                Resistance Radar
              </h2>
              <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40">
                beta
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400 leading-snug truncate">
              Will <span className="text-slate-200">{compoundName || "this compound"}</span> hold
              up as <span className="text-cyan-300">{targetLabel.toUpperCase()}</span> mutates?
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="shrink-0 text-slate-500 hover:text-slate-200 text-lg leading-none px-1"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {phase === "confirm" && (
            <div className="space-y-4">
              {panel.length === 0 ? (
                <div className="text-[12px] text-amber-300 font-mono">
                  No curated mutations for {targetLabel.toUpperCase()} yet — nothing to scan.
                  Pick a target with a known variant panel (e.g. KRAS, EGFR).
                </div>
              ) : (
                <>
                  <p className="text-[12px] text-slate-300 leading-relaxed">
                    This docks your compound against{" "}
                    <span className="text-slate-100 font-semibold">{targetLabel.toUpperCase()}</span>
                    's known resistance panel and maps where binding holds — and where it breaks.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {panel.map((m) => (
                      <span
                        key={m.code}
                        className="px-2 py-0.5 rounded border border-slate-700/70 bg-slate-900/50 text-[11px] font-mono text-slate-300"
                        title={m.significance}
                      >
                        {m.code}
                      </span>
                    ))}
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] font-mono text-slate-400 space-y-1">
                    <div className="flex items-center justify-between">
                      <span>docks to run</span>
                      <span className="text-slate-200">
                        {nDocks}{" "}
                        <span className="text-slate-500">
                          ({panel.length} mutants + {nBatches} WT)
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>approx. time</span>
                      <span className="text-slate-200">~{EST_MIN} min (run concurrently)</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>run credits used</span>
                      <span className="text-slate-200">{nDocks}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={run}
                      className="px-4 py-1.5 rounded border border-cyan-600/60 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/50 hover:border-cyan-500 font-mono text-[12px] uppercase tracking-wider"
                    >
                      ⇢ Run resistance scan
                    </button>
                    <button
                      type="button"
                      onClick={close}
                      className="px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 font-mono text-[11px] uppercase tracking-wider"
                    >
                      Cancel
                    </button>
                  </div>

                  {/* Recent scans — reopen a past map without re-docking. */}
                  {savedScans.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/70">
                      <div className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-1.5">
                        recent scans
                      </div>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {savedScans.map((s) => (
                          <div
                            key={s.id}
                            className="group flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1 hover:border-slate-700 hover:bg-slate-800/40"
                          >
                            <button
                              type="button"
                              onClick={() => loadScan(s)}
                              className="flex-1 min-w-0 text-left"
                              title="Reopen this scan's map"
                            >
                              <span className="font-mono text-[11px] text-slate-200 truncate">
                                {s.compoundName}
                              </span>
                              <span className="text-slate-600 mx-1">·</span>
                              <span className="font-mono text-[11px] text-cyan-300">
                                {s.targetLabel.toUpperCase()}
                              </span>
                              <span className="text-slate-600 mx-1">·</span>
                              <span className="text-[10px] text-slate-500">{fmtWhen(s.savedAt)}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => removeScan(s.id)}
                              className="shrink-0 text-slate-600 hover:text-rose-300 text-[12px] opacity-0 group-hover:opacity-100"
                              title="Delete this saved scan"
                              aria-label="Delete saved scan"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {(phase === "running" || phase === "done") && (
            <div className="space-y-4">
              {viewingSaved && (
                <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800/70 text-slate-400">saved</span>
                  {viewingSaved.name} · {fmtWhen(viewingSaved.at)}
                </div>
              )}

              {/* Verdict banner */}
              <div
                className={`rounded-lg border px-3 py-2.5 ${
                  !allDone
                    ? "border-slate-700/60 bg-slate-900/40"
                    : nCliff > 0
                    ? "border-rose-700/50 bg-rose-950/30"
                    : "border-emerald-700/50 bg-emerald-950/25"
                }`}
              >
                {!allDone ? (
                  <div className="flex items-center gap-2 text-[12px] font-mono text-cyan-200">
                    <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    Docking {rows.filter((r) => r.status === "done" || r.status === "failed").length}/
                    {rows.length} variants (each with its own WT)…
                  </div>
                ) : nCliff > 0 && worst ? (
                  <div className="text-[12px] text-rose-100 leading-snug">
                    <span className="font-semibold">⚠ Resistance predicted.</span> Binding falls off
                    hardest at <span className="font-mono text-rose-300">{worst.code}</span> (
                    {fmtSigned(worst.ddg)} kcal/mol vs WT).{" "}
                    <span className="text-rose-200/80">
                      {nRetained}/{resolved.length} variants still hold binding.
                    </span>
                  </div>
                ) : resolved.length > 0 ? (
                  <div className="text-[12px] text-emerald-100 leading-snug">
                    <span className="font-semibold">✓ No major resistance predicted.</span> Binding is
                    retained across all {resolved.length} scanned variants
                    {worst && worst.ddg != null ? ` (worst shift ${fmtSigned(worst.ddg)} kcal/mol).` : "."}
                  </div>
                ) : (
                  <div className="text-[12px] text-amber-100 leading-snug">
                    No variant produced a usable score — every dock failed or returned no pose.
                  </div>
                )}
                {wtShown != null && (
                  <div className="mt-1 text-[10px] font-mono text-slate-500">
                    WT baseline: {fmt(wtShown)} kcal/mol{wtScores.length > 1 ? " (mean)" : ""}
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
                  const pct = r.ddg == null ? 0 : (Math.max(0, Math.min(4, r.ddg)) / 4) * 100;
                  const retained = r.ddg != null && r.ddg < 0.75;
                  return (
                    <div key={r.code} className={`rounded border ${t.ring} bg-slate-900/40 px-2.5 py-1.5`}>
                      <div className="flex items-center gap-2">
                        <span
                          className="font-mono text-[12px] text-slate-200 w-16 shrink-0"
                          title={r.significance}
                        >
                          {r.code}
                        </span>
                        <div className="flex-1 h-3 rounded bg-slate-800/70 relative overflow-hidden">
                          {r.status === "running" ? (
                            <div className="absolute inset-0 flex items-center pl-2 text-[9px] font-mono text-cyan-300/80 animate-pulse">
                              docking…
                            </div>
                          ) : r.status === "failed" ? (
                            <div className="absolute inset-0 flex items-center pl-2 text-[9px] font-mono text-slate-500">
                              {r.error || "no result"}
                            </div>
                          ) : retained ? (
                            <div className="absolute inset-y-0 left-0 w-1.5 bg-emerald-500" />
                          ) : (
                            <div
                              className={`absolute inset-y-0 left-0 ${t.bar}`}
                              style={{ width: `${Math.max(4, pct)}%` }}
                            />
                          )}
                        </div>
                        <span
                          className={`font-mono text-[11px] tabular-nums w-14 text-right shrink-0 ${t.text}`}
                        >
                          {r.status === "done" ? fmtSigned(r.ddg) : ""}
                        </span>
                        <span
                          className={`text-[8px] font-mono uppercase tracking-wider w-16 text-right shrink-0 ${t.text}`}
                        >
                          {r.status === "done" ? t.label : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-[10px] text-slate-500 leading-relaxed pt-1">
                Phase 1 signal: Δ-docking only (score shift vs a WT co-docked in the same job). A
                positive ΔΔ means the mutant binds your compound more weakly — a resistance
                liability. The full Atlas-grade forecast (ESM2 fold-stability + calibrated
                probability) comes next.
              </p>

              {allDone && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setViewingSaved(null);
                      setPhase("confirm");
                    }}
                    className="px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800/50 font-mono text-[11px] uppercase tracking-wider"
                  >
                    ↺ new scan
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 font-mono text-[11px] uppercase tracking-wider"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-3">
              <div className="rounded border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[12px] font-mono text-rose-200">
                ✗ {error}
              </div>
              <button
                type="button"
                onClick={() => setPhase("confirm")}
                className="px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800/50 font-mono text-[11px] uppercase tracking-wider"
              >
                ← back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
