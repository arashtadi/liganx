// /selective — Mutant-Selective Binder Discovery (standalone).
//
// Find binders that prefer the MUTANT form of a target over wild-type.
// This page is fully self-contained and shares NO state or components with
// Studio. See docs/mutant_selective_pipeline.md for the pipeline design.
//
// Build status: step A (target triage) is live end-to-end. Steps B–E
// (pocket map, ensemble, differential docking, FEP escalation, analog
// expansion) are scaffolded on the backend and surfaced here as a clearly
// labelled roadmap; submitting a run currently completes triage.

import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { usePageMeta } from "../lib/usePageMeta";
import {
  api,
  type SelectivityAnalog,
  type SelectivityCandidate,
  type SelectivityHit,
  type SelectivityJob,
  type SelectivityModality,
  type SelectivityTriage,
  type Localization,
} from "../api";

// Parse a textarea of candidate molecules. Each line is "name, SMILES" or
// just "SMILES" (auto-named). Blank lines ignored.
function parseCandidates(text: string): SelectivityCandidate[] {
  const out: SelectivityCandidate[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const comma = line.indexOf(",");
    if (comma > 0) {
      out.push({ name: line.slice(0, comma).trim(), smiles: line.slice(comma + 1).trim() });
    } else {
      out.push({ name: `cand_${out.length + 1}`, smiles: line });
    }
  }
  return out.filter((c) => c.smiles);
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

const MODALITY_LABEL: Record<SelectivityModality, string> = {
  small_molecule: "Small molecule",
  peptide: "Peptide",
  protein: "Protein / biologic",
};

const LOCALIZATION_COPY: Record<Localization, { label: string; tone: string }> = {
  intracellular: { label: "Intracellular", tone: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  extracellular: { label: "Extracellular", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  membrane: { label: "Membrane", tone: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  unknown: { label: "Unknown", tone: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
};

// The full pipeline, shown as a roadmap so the operator can see what's live.
// Step status: "live" (shipped + usable), "partial" (works internally but no
// standalone deliverable yet), or "soon" (not built).
const PIPELINE_STEPS: { id: string; title: string; status: "live" | "partial" | "soon"; blurb: string }[] = [
  { id: "A", title: "Target triage", status: "live", blurb: "Locate the target (UniProt) → which binder modalities its location even allows." },
  { id: "B", title: "WT-vs-mutant pocket map", status: "partial", blurb: "The mutant structure is built & docked against inside differential docking; a standalone pocket-diff view is still to come." },
  { id: "C", title: "Conformer ensemble", status: "live", blurb: "Set ensemble size > 1 to dock against an MD-relaxed conformer ensemble for both pockets, capturing protein flexibility instead of one rigid snapshot." },
  { id: "D1", title: "Differential docking", status: "live", blurb: "Dock candidates against both pockets; rank by ΔΔG_sel = score_mutant − score_WT." },
  { id: "D2", title: "FEP confirmation (top 5)", status: "soon", blurb: "Rigorous relative free energy on the best 5 hits. Gated off until FEP completes a full cycle." },
  { id: "E", title: "Analog expansion", status: "live", blurb: "Broaden the hit list via RDKit similarity (+ ChEMBL when connected)." },
];

const STEP_BADGE: Record<"live" | "partial" | "soon", { label: string; cls: string }> = {
  live: { label: "Live", cls: "text-emerald-400" },
  partial: { label: "Partial", cls: "text-sky-400" },
  soon: { label: "Soon", cls: "text-slate-500" },
};

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "completed" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
    : status === "failed" ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
    : status === "cancelled" ? "bg-slate-500/15 text-slate-300 border-slate-500/30"
    : "bg-violet-500/15 text-violet-300 border-violet-500/30";
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{status}</span>;
}

function TriageCard({ triage }: { triage: SelectivityTriage }) {
  const loc = LOCALIZATION_COPY[triage.localization];
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${loc.tone}`}>{loc.label}</span>
        {triage.uniprot_id && <span className="text-xs text-slate-400 font-mono">{triage.uniprot_id}</span>}
        <span className="text-[10px] uppercase tracking-wider text-slate-500">via {triage.source}</span>
      </div>
      <p className="mt-2 text-sm text-slate-300">{triage.reasoning}</p>
      {triage.locations.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">Locations: {triage.locations.join(" · ")}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(["small_molecule", "peptide", "protein"] as SelectivityModality[]).map((m) => {
          const allowed = triage.allowed_modalities.includes(m);
          return (
            <span
              key={m}
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                allowed ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/10 bg-white/5 text-slate-500 line-through"
              }`}
            >
              {MODALITY_LABEL[m]}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function SelectivePage() {
  usePageMeta({
    title: "Mutant-Selective Binder Discovery · Liganx",
    description:
      "Find binders that grab the mutant form of a target but not wild-type. Differential molecular docking online, with FEP confirmation.",
  });

  const { shareId } = useParams();
  const navigate = useNavigate();

  // ── Detail view ──────────────────────────────────────────────────
  if (shareId) return <RunDetail shareId={shareId} onBack={() => navigate("/selective")} />;

  // ── List + new-run view ──────────────────────────────────────────
  const [runs, setRuns] = useState<SelectivityJob[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);

  // Triage tool state
  const [triageInput, setTriageInput] = useState("");
  const [triageBy, setTriageBy] = useState<"uniprot" | "gene">("uniprot");
  const [triage, setTriage] = useState<SelectivityTriage | null>(null);
  const [triaging, setTriaging] = useState(false);
  const [triageErr, setTriageErr] = useState<string | null>(null);

  // New-run form state
  const [pdbId, setPdbId] = useState("");
  const [chain, setChain] = useState("A");
  const [mutation, setMutation] = useState("");
  const [modality, setModality] = useState<SelectivityModality>("small_molecule");
  const [structureSource, setStructureSource] = useState<"mutate_relax" | "experimental">("mutate_relax");
  const [ensembleSize, setEnsembleSize] = useState(1);
  const [candidatesText, setCandidatesText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.listSelectivityJobs().then((r) => { if (alive) { setRuns(r); setLoadingRuns(false); } })
      .catch(() => { if (alive) setLoadingRuns(false); });
    return () => { alive = false; };
  }, []);

  const allowedModalities = triage?.allowed_modalities ?? null;

  async function runTriage() {
    setTriageErr(null); setTriaging(true); setTriage(null);
    try {
      const r = await api.selectiveTriage(triageBy === "uniprot" ? { uniprot: triageInput.trim() } : { gene: triageInput.trim() });
      setTriage(r);
      // Snap the form modality to something the target actually allows.
      if (!r.allowed_modalities.includes(modality)) setModality(r.allowed_modalities[0] ?? "small_molecule");
    } catch (e) {
      setTriageErr(e instanceof Error ? e.message : "Triage failed");
    } finally {
      setTriaging(false);
    }
  }

  async function submitRun() {
    setSubmitErr(null); setSubmitting(true);
    try {
      const job = await api.createSelectivityJob({
        pdb_id: pdbId.trim(),
        chain: chain.trim() || "A",
        mutation: mutation.trim(),
        gene: triageBy === "gene" ? triageInput.trim() || null : null,
        uniprot_id: triageBy === "uniprot" ? (triageInput.trim() || null) : (triage?.uniprot_id ?? null),
        modality,
        structure_source: structureSource,
        ensemble_size: ensembleSize,
        candidates: parseCandidates(candidatesText),
      });
      navigate(`/selective/${job.share_id}`);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = pdbId.trim().length >= 4 && /^[A-Za-z][0-9]+[A-Za-z]/.test(mutation.trim());

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-400">Mutant-selective binder discovery</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100">Find binders that prefer the mutant, not wild-type</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Differential molecular docking online: dock candidates against both the wild-type and mutant
          pocket and rank by how strongly they prefer the mutant. Start by checking where your target lives —
          that decides which kinds of binders are even possible.
        </p>
      </header>

      {/* Pipeline roadmap */}
      <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {PIPELINE_STEPS.map((s) => {
          const badge = STEP_BADGE[s.status];
          const cardCls = s.status === "live" ? "border-emerald-500/30 bg-emerald-500/5"
            : s.status === "partial" ? "border-sky-500/20 bg-sky-500/[0.04]"
            : "border-white/10 bg-white/[0.03]";
          return (
            <div key={s.id} className={`rounded-lg border p-3 ${cardCls}`} title={s.blurb}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-slate-500">{s.id}</span>
                <span className={`text-[9px] font-bold uppercase tracking-wider ${badge.cls}`}>{badge.label}</span>
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-200">{s.title}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Step A — triage tool */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Step A · Target triage</h2>
          <p className="mt-1 text-xs text-slate-500">Where does the target live? Intracellular targets can only be hit by membrane-crossing small molecules.</p>
          <div className="mt-3 flex gap-2">
            <select className="rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-sm text-slate-200" value={triageBy} onChange={(e) => setTriageBy(e.target.value as "uniprot" | "gene")}>
              <option value="uniprot">UniProt</option>
              <option value="gene">Gene</option>
            </select>
            <input
              className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
              placeholder={triageBy === "uniprot" ? "e.g. P00533" : "e.g. EGFR"}
              value={triageInput}
              onChange={(e) => setTriageInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && triageInput.trim()) runTriage(); }}
            />
            <button className="btn-primary btn-sm" disabled={!triageInput.trim() || triaging} onClick={runTriage}>
              {triaging ? "…" : "Triage"}
            </button>
          </div>
          {triageErr && <p className="mt-2 text-xs text-rose-400">{triageErr}</p>}
          {triage && <div className="mt-3"><TriageCard triage={triage} /></div>}
        </section>

        {/* New run */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">New selectivity run</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">PDB ID</label>
              <input className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600" placeholder="4HJO" value={pdbId} onChange={(e) => setPdbId(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Chain</label>
              <input className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100" value={chain} onChange={(e) => setChain(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Mutation</label>
              <input className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600" placeholder="T790M" value={mutation} onChange={(e) => setMutation(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Modality</label>
              <select className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-200" value={modality} onChange={(e) => setModality(e.target.value as SelectivityModality)}>
                {(["small_molecule", "peptide", "protein"] as SelectivityModality[]).map((m) => {
                  const allowed = !allowedModalities || allowedModalities.includes(m);
                  return <option key={m} value={m} disabled={!allowed}>{MODALITY_LABEL[m]}{!allowed ? " — not allowed here" : ""}</option>;
                })}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Structure source</label>
              <select className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-200" value={structureSource} onChange={(e) => setStructureSource(e.target.value as "mutate_relax" | "experimental")}>
                <option value="mutate_relax">Mutate WT + relax</option>
                <option value="experimental">Experimental mutant</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Ensemble size</label>
              <input type="number" min={1} max={50} className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100" value={ensembleSize} onChange={(e) => setEnsembleSize(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Candidate molecules <span className="text-slate-600">— one per line, "name, SMILES" or just SMILES (max 50)</span>
            </label>
            <textarea
              className="h-28 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600"
              placeholder={"gefitinib, COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1\nosimertinib, COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1"}
              value={candidatesText}
              onChange={(e) => setCandidatesText(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-slate-500">{parseCandidates(candidatesText).length} molecule(s) parsed.</p>
          </div>
          {allowedModalities && !allowedModalities.includes(modality) && (
            <p className="mt-2 text-xs text-amber-400">That modality isn't allowed for this target's location — pick an allowed one.</p>
          )}
          {submitErr && <p className="mt-2 text-xs text-rose-400">{submitErr}</p>}
          <button className="btn-primary btn-sm mt-4" disabled={!canSubmit || submitting} onClick={submitRun}>
            {submitting ? "Submitting…" : parseCandidates(candidatesText).length > 0 ? "Run differential docking" : "Run triage only"}
          </button>
          <p className="mt-2 text-[11px] text-slate-500">
            With candidates, this docks each against the wild-type and mutant pocket and ranks by selectivity (ΔΔG_sel).
            Without candidates, it runs target triage only.
          </p>
        </section>
      </div>

      {/* Recent runs */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-300">Your runs</h2>
        {loadingRuns ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet. Triage a target above, then start a run.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th><th className="px-3 py-2">Target</th><th className="px-3 py-2">Mutation</th>
                  <th className="px-3 py-2">Location</th><th className="px-3 py-2">Modality</th><th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.share_id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 text-slate-400">{r.seq_number}</td>
                    <td className="px-3 py-2"><Link className="text-violet-300 hover:underline font-mono" to={`/selective/${r.share_id}`}>{r.pdb_id}/{r.chain}</Link></td>
                    <td className="px-3 py-2 font-mono text-slate-300">{r.mutation}</td>
                    <td className="px-3 py-2 text-slate-400">{r.localization ? LOCALIZATION_COPY[r.localization].label : "—"}</td>
                    <td className="px-3 py-2 text-slate-400">{MODALITY_LABEL[r.modality]}</td>
                    <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Detail view ────────────────────────────────────────────────────────
function RunDetail({ shareId, onBack }: { shareId: string; onBack: () => void }) {
  const [run, setRun] = useState<SelectivityJob | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Poll every 4s while the run is still working; stop once terminal.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const r = await api.getSelectivityJob(shareId);
        if (!alive) return;
        setRun(r);
        if (!TERMINAL.has(r.status)) timer = window.setTimeout(tick, 4000);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "Not found");
      }
    };
    tick();
    return () => { alive = false; if (timer) window.clearTimeout(timer); };
  }, [shareId]);

  if (err) return <div className="mx-auto max-w-3xl px-4 py-8"><button className="btn-ghost btn-sm mb-4" onClick={onBack}>← Back</button><p className="text-rose-400">{err}</p></div>;
  if (!run) return <div className="mx-auto max-w-3xl px-4 py-8 text-slate-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <button className="btn-ghost btn-sm mb-4" onClick={onBack}>← All runs</button>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-slate-100">Run #{run.seq_number}</h1>
        <StatusPill status={run.status} />
      </div>
      <p className="mt-1 font-mono text-sm text-slate-400">{run.pdb_id}/{run.chain} · {run.mutation} · {MODALITY_LABEL[run.modality]}</p>
      {run.stage && <p className="mt-1 text-xs text-slate-500">Stage: {run.stage}</p>}
      {run.error_message && <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{run.error_message}</p>}

      {run.triage && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-300">Step A · Triage</h2>
          <TriageCard triage={run.triage} />
        </div>
      )}

      <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Differential results</h2>
          {!TERMINAL.has(run.status) && <span className="text-xs text-violet-300">working… {run.stage ? `(${run.stage})` : ""}</span>}
        </div>
        {run.ranked_hits && run.ranked_hits.length > 0 ? (
          <HitsTable hits={run.ranked_hits} />
        ) : run.candidate_source ? (
          <p className="mt-2 text-sm text-slate-500">
            Docking the candidate set against the wild-type and mutant pocket… results will populate as each finishes.
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            This was a triage-only run (no candidate molecules supplied). Start a new run with candidates to get ranked
            mutant-selective hits.
          </p>
        )}
      </div>
    </div>
  );
}

function HitsTable({ hits }: { hits: SelectivityHit[] }) {
  // Per-row analog expansion state, keyed by row index.
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [analogs, setAnalogs] = useState<Record<number, SelectivityAnalog[] | "loading" | "error">>({});

  async function toggleAnalogs(i: number, smiles: string) {
    if (openRow === i) { setOpenRow(null); return; }
    setOpenRow(i);
    if (analogs[i] && analogs[i] !== "error") return; // cached
    setAnalogs((s) => ({ ...s, [i]: "loading" }));
    try {
      const r = await api.findAnalogs(smiles);
      setAnalogs((s) => ({ ...s, [i]: r.analogs }));
    } catch {
      setAnalogs((s) => ({ ...s, [i]: "error" }));
    }
  }

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-white/5 text-left text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Molecule</th>
            <th className="px-3 py-2 text-right">Score WT</th>
            <th className="px-3 py-2 text-right">Score Mut</th>
            <th className="px-3 py-2 text-right">ΔΔG_sel</th>
            <th className="px-3 py-2">Note</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {hits.map((h, i) => {
            const selective = typeof h.ddg_sel === "number" && h.ddg_sel < 0;
            const a = analogs[i];
            return (
              <Fragment key={`${h.name}-${i}`}>
                <tr className="border-t border-white/5">
                  <td className="px-3 py-2 text-slate-400">{h.rank ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-200">{h.name}</div>
                    <div className="truncate max-w-[220px] font-mono text-[10px] text-slate-500" title={h.smiles}>{h.smiles}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-300">{h.score_wt ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-300">{h.score_mut ?? "—"}</td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold ${selective ? "text-emerald-300" : typeof h.ddg_sel === "number" ? "text-slate-400" : "text-slate-600"}`}>
                    {typeof h.ddg_sel === "number" ? h.ddg_sel.toFixed(2) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {h.error ? <span className="text-rose-400">{h.error}</span>
                      : h.mutation_caveat ? <span className="text-amber-400">{h.mutation_caveat}</span>
                      : selective ? <span className="text-emerald-400">mutant-selective</span>
                      : "—"}
                    {typeof h.n_conformers === "number" && h.n_conformers > 1 && (
                      <span className="ml-1 text-slate-600">· {h.n_conformers}-conf ensemble</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {h.smiles && (
                      <button className="text-[11px] text-violet-300 hover:underline" onClick={() => toggleAnalogs(i, h.smiles)}>
                        {openRow === i ? "hide" : "analogs"}
                      </button>
                    )}
                  </td>
                </tr>
                {openRow === i && (
                  <tr className="bg-white/[0.02]">
                    <td colSpan={7} className="px-4 py-3">
                      {a === "loading" ? <span className="text-xs text-slate-500">Searching analogs…</span>
                        : a === "error" ? <span className="text-xs text-rose-400">Analog search failed.</span>
                        : !a || a.length === 0 ? <span className="text-xs text-slate-500">No similar analogs found.</span>
                        : (
                          <div>
                            <p className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">Analogs of {h.name}</p>
                            <div className="flex flex-wrap gap-2">
                              {a.map((an, j) => (
                                <span key={j} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300" title={an.smiles}>
                                  <span className="font-medium">{an.name}</span>
                                  {typeof an.similarity === "number" && <span className="text-slate-500">{(an.similarity * 100).toFixed(0)}%</span>}
                                  <span className="text-[9px] uppercase text-slate-600">{an.source.startsWith("local") ? "local" : "chembl"}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-white/5 px-3 py-2 text-[11px] text-slate-500">
        ΔΔG_sel = score(mutant) − score(WT), kcal/mol. More negative = binds the mutant more tightly than wild-type.
        Docking scores are a screen; confirm top hits with FEP once that tier is enabled. "analogs" broadens a hit via
        structural similarity (local libraries + ChEMBL).
      </p>
    </div>
  );
}
