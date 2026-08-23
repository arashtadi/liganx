// ResistanceRadar — the Studio LAUNCHER for a resistance scan (v0.3).
//
// This is just the launch/confirm step now: pick the panel, show the cost,
// and on "Run" submit the docks, save the scan record (status "running" with
// each mutation's job id), and navigate to the full results page at
// /resistance/<id>. All progress + results + resume live on that page, so
// closing the window mid-scan and reopening the URL picks up where it left
// off. Past scans are listed here and open the same page.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import {
  newScanId,
  upsertResistanceScan,
  listResistanceScans,
  deleteResistanceScan,
  type SavedResistanceScan,
} from "../lib/resistanceHistory";
import { fmtWhen } from "../lib/resistanceScoring";

type Mut = { code: string; label: string; significance: string };

const MAX_PANEL = 6; // cost cap — never scan more than this many mutations
const BATCH = 2; // backend caps mutations-per-job at 2
const EST_MIN = 3; // docks run concurrently → wall time ≈ one wave

/** A mutation is a resistance liability if its clinical context says so. */
function isResistance(m: Mut): boolean {
  return /resist|escape|refractor|relapse|gatekeeper|solvent[- ]front/i.test(
    `${m.label} ${m.significance}`
  );
}

/** Build the scan panel from the target's FULL curated variant set —
 *  resistance-tagged variants sort first so the most on-point liabilities
 *  lead the map. De-duped, capped. */
function pickPanel(muts: Mut[]): Mut[] {
  const seen = new Set<string>();
  const deduped: Mut[] = [];
  for (const m of muts) {
    const key = m.code.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(m);
    }
  }
  return [...deduped.filter(isResistance), ...deduped.filter((m) => !isResistance(m))].slice(0, MAX_PANEL);
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
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
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedScans, setSavedScans] = useState<SavedResistanceScan[]>(() => listResistanceScans());

  if (!open) return null;

  const nBatches = Math.max(1, Math.ceil(panel.length / BATCH));
  const nDocks = panel.length + nBatches; // one WT per batch

  async function run() {
    setError(null);
    setSubmitting(true);
    try {
      const id = newScanId();
      const nowIso = new Date().toISOString();
      const compound = [{ name: compoundName || "Studio compound", smiles }];
      const batches = chunk(panel, BATCH);
      const jobKeyByCode: Record<string, string> = {};

      for (const batch of batches) {
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
        for (const c of codes) jobKeyByCode[c] = key;
      }

      // Persist the scan as "running" the moment docks are submitted, with
      // each mutation's job id — so the results page can resume it even if
      // the user closes this window before it finishes.
      const scan: SavedResistanceScan = {
        id,
        savedAt: nowIso,
        updatedAt: nowIso,
        status: "running",
        targetId,
        targetLabel,
        compoundName: compoundName || "Studio compound",
        smiles,
        wtScore: null,
        rows: panel.map((m) => ({
          code: m.code,
          label: m.label,
          significance: m.significance,
          mutScore: null,
          wtScore: null,
          jobKey: jobKeyByCode[m.code] ?? null,
          error: null,
        })),
      };
      upsertResistanceScan(scan);
      onClose();
      navigate(`/resistance/${id}`);
    } catch (e: any) {
      setError(e?.message || "Failed to start the resistance scan.");
      setSubmitting(false);
    }
  }

  function openScan(id: string) {
    onClose();
    navigate(`/resistance/${id}`);
  }

  function removeScan(id: string) {
    deleteResistanceScan(id);
    setSavedScans(listResistanceScans());
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col rounded-lg border border-slate-700/70 bg-[#0b1120] shadow-2xl shadow-black/50"
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
              Will <span className="text-slate-200">{compoundName || "this compound"}</span> hold up
              as <span className="text-cyan-300">{targetLabel.toUpperCase()}</span> mutates?
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-slate-500 hover:text-slate-200 text-lg leading-none px-1"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {panel.length === 0 ? (
            <div className="text-[12px] text-amber-300 font-mono">
              No curated mutations for {targetLabel.toUpperCase()} yet — nothing to scan. Pick a
              target with a known variant panel (e.g. KRAS, EGFR).
            </div>
          ) : (
            <>
              <p className="text-[12px] text-slate-300 leading-relaxed">
                This docks your compound against{" "}
                <span className="text-slate-100 font-semibold">{targetLabel.toUpperCase()}</span>'s
                known resistance panel and maps where binding holds — and where it breaks. Results
                open on their own page you can bookmark and come back to.
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

              {error && (
                <div className="rounded border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[11px] font-mono text-rose-200">
                  ✗ {error}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={run}
                  disabled={submitting}
                  className={`px-4 py-1.5 rounded border font-mono text-[12px] uppercase tracking-wider ${
                    submitting
                      ? "border-slate-700 bg-slate-900/40 text-slate-500 cursor-wait"
                      : "border-cyan-600/60 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/50 hover:border-cyan-500"
                  }`}
                >
                  {submitting ? "▶ starting…" : "⇢ Run resistance scan"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 font-mono text-[11px] uppercase tracking-wider"
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {/* Recent scans — open the full results page (no re-docking). */}
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
                      onClick={() => openScan(s.id)}
                      className="flex-1 min-w-0 text-left flex items-center gap-1.5"
                      title="Open this scan's results page"
                    >
                      {s.status === "running" && (
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0"
                          title="Still docking — click to resume"
                        />
                      )}
                      <span className="font-mono text-[11px] text-slate-200 truncate">
                        {s.compoundName}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="font-mono text-[11px] text-cyan-300">
                        {s.targetLabel.toUpperCase()}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-[10px] text-slate-500 shrink-0">{fmtWhen(s.savedAt)}</span>
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
        </div>
      </div>
    </div>
  );
}
