import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type CatalogTarget } from "../api";
import { ArrowRight, Beaker, Bolt, Close, Plus, Sparkles, Spinner, Target } from "../components/Icons";
import AutocompleteInput from "../components/AutocompleteInput";

interface CompoundRow {
  name: string;
  smiles: string;
}

export default function NewJobPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: catalog, isLoading: loadingCatalog } = useQuery({
    queryKey: ["catalog"],
    queryFn: api.catalog,
  });

  // Pre-select the target from ?target=xxx if present (e.g. coming from Library).
  // selectedIds is now an ARRAY — pick multiple to enter "selectivity mode"
  // and dock the same compound list against several kinases in parallel.
  // Single-target use is the special case selectedIds.length === 1; the rest
  // of the form behaves exactly as before in that case.
  const initialTarget = searchParams.get("target")?.toLowerCase() ?? "egfr";
  const [selectedIds, setSelectedIds] = useState<string[]>([initialTarget]);
  const [customMode, setCustomMode] = useState(false);
  const targets: CatalogTarget[] = useMemo(
    () => (catalog ?? []).filter((t) => selectedIds.includes(t.id)),
    [catalog, selectedIds],
  );
  // Single-target mode preserves all the existing form UX (mutations, custom
  // PDB, full per-target tweaking). Multi-target mode is "selectivity mode"
  // — WT only, fan out N parallel jobs, redirect to a suite view.
  const isMultiTarget = targets.length > 1;
  const target: CatalogTarget | undefined = isMultiTarget ? undefined : targets[0];

  const [pdbId, setPdbId] = useState("");
  const [chain, setChain] = useState("A");
  const [uniprot, setUniprot] = useState("");
  const [selectedMutations, setSelectedMutations] = useState<string[]>([]);
  const [customMutations, setCustomMutations] = useState("");
  const [compounds, setCompounds] = useState<CompoundRow[]>([]);
  // Run-time options. Defaults match Vina's defaults + the historical "always
  // include WT" behaviour, so existing users see no change unless they opt in.
  const [exhaustiveness, setExhaustiveness] = useState<8 | 16 | 32>(8);
  const [includeWt, setIncludeWt] = useState(true);

  // First-target-pick guard. Auto-loading the catalog's default compounds +
  // mutations is great on the FIRST target pick (saves typing). After that,
  // we want to preserve user work on target switch — but with one twist:
  //   * compounds + customMutations stay (user-typed, target-agnostic)
  //   * selectedMutations CLEARS on target switch (mutation chips are
  //     target-specific — T790M only shows for EGFR; carrying it forward
  //     makes the "Will dock 6 mutants" summary list mutations the user
  //     can no longer see in the chip row, which is confusing.)
  const autoFilledRef = useRef(false);
  const previousTargetIdRef = useRef<string | null>(null);

  // When the target changes, update the structural fields. Auto-populate the
  // compound + mutation lists on the very first pick only; clear chip-based
  // mutations on every subsequent target change.
  useEffect(() => {
    if (!target) return;
    setPdbId(target.pdb_id);
    setChain(target.chain);
    setUniprot(target.uniprot);
    if (!autoFilledRef.current) {
      // First target pick — load defaults.
      setSelectedMutations(target.mutations.slice(0, 3).map((m) => m.code));
      setCustomMutations("");
      setCompounds(target.compounds.slice(0, 4).map((c) => ({ name: c.name, smiles: c.smiles })));
      autoFilledRef.current = true;
    } else if (previousTargetIdRef.current !== target.id) {
      // Subsequent switch to a different target — clear chip selections so
      // they don't ghost into the dock summary. Custom-typed mutations
      // (user explicitly authored) and compounds are preserved.
      setSelectedMutations([]);
    }
    previousTargetIdRef.current = target.id;
  }, [target]);

  // Strict mutation-code validation. Accepts:
  //   * Standard codes:  T790M, L858R, G12C
  //   * Combos:          T790M+C797S
  //   * Indels:          E746_A750del, V559insT
  // Anything else (lowercase, gibberish, special chars) gets dropped silently
  // so it never reaches the backend. Keeps the bad-input surface small.
  const MUTATION_RE = /^[A-Z][0-9]+[A-Z]([+_][A-Za-z0-9]+)*(del|ins[A-Z]+)?$/;
  const allMutations = useMemo(() => {
    const fromCustom = customMutations
      .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      // Be permissive about case on input but normalize to uppercase
      .map((s) => (s.toUpperCase().replace(/DEL$/, "del").replace(/INS([A-Z]+)$/, "ins$1")))
      .filter((s) => MUTATION_RE.test(s));
    return Array.from(new Set([...selectedMutations, ...fromCustom]));
  }, [selectedMutations, customMutations]);

  // Visible warning for invalid mutation tokens — silently dropping them is
  // worse than telling the user "we ignored XYZ because it doesn't look like
  // a mutation code".
  const invalidMutationTokens = useMemo(() => {
    return customMutations
      .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      .map((s) => s.toUpperCase().replace(/DEL$/, "del").replace(/INS([A-Z]+)$/, "ins$1"))
      .filter((s) => !MUTATION_RE.test(s));
  }, [customMutations]);

  const submit = useMutation({
    mutationFn: api.createJob,
    // New jobs always navigate by share_id — that's what users will copy
    // out of the URL bar to share. Falls back to integer id only for the
    // unlikely case where a backend response somehow lacks share_id.
    onSuccess: (job) => navigate(`/jobs/${job.share_id || job.id}`),
  });

  function toggleMutation(code: string) {
    setSelectedMutations((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }
  function setCompound(i: number, patch: Partial<CompoundRow>) {
    setCompounds((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addCompound()    { setCompounds((cs) => [...cs, { name: "", smiles: "" }]); }
  function removeCompound(i: number) { setCompounds((cs) => cs.filter((_, idx) => idx !== i)); }
  function loadAllCompounds() {
    if (!target) return;
    setCompounds(target.compounds.map((c) => ({ name: c.name, smiles: c.smiles })));
  }

  // PubChem lookup — search box above the compound list, with autocomplete
  // suggestions on partial input and friendly error messages on misses.
  const [lookupQ, setLookupQ] = useState("");
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Debounced autocomplete — fire 250ms after the user stops typing
  useEffect(() => {
    if (lookupQ.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const r = await api.suggestCompound(lookupQ.trim());
        setSuggestions(r.suggestions);
      } catch {
        // autocomplete is best-effort; ignore failures
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [lookupQ]);

  const lookupMut = useMutation({
    mutationFn: api.lookupCompound,
    onSuccess: (r) => {
      setLookupErr(null);
      setLookupQ("");
      setSuggestions([]);
      // Append the resolved compound; replace empty rows first if any
      setCompounds((cs) => {
        const next = [...cs];
        const emptyIdx = next.findIndex((c) => !c.smiles.trim());
        const row = { name: r.name, smiles: r.smiles };
        if (emptyIdx !== -1) next[emptyIdx] = row;
        else next.push(row);
        return next;
      });
    },
    onError: (e) => setLookupErr((e as Error).message),
  });

  function runLookup(name: string) {
    if (!name.trim()) return;
    setLookupErr(null);
    lookupMut.mutate(name.trim());
  }

  // SDF / SMI / CSV file upload — parse server-side via RDKit. By default we
  // REPLACE the existing list (mirrors the file the user just dropped in), but
  // if the user has manually-entered compounds we ask first before nuking them.
  const [dropActive, setDropActive] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const uploadMut = useMutation({
    mutationFn: api.parseCompoundsFile,
    onSuccess: (r) => {
      setUploadErr(null);
      const parsed = r.compounds.map((c) => ({ name: c.name, smiles: c.smiles }));
      const userTyped = compounds.filter((c) => c.smiles.trim()).length;
      const isReplacingUserData = userTyped > 0;
      if (isReplacingUserData) {
        // Friendly confirm — uses native confirm to avoid building a modal for
        // a one-click destructive action. If declined, append instead of replace.
        const ok = window.confirm(
          `Replace your ${userTyped} existing compound${userTyped === 1 ? "" : "s"} ` +
          `with the ${parsed.length} from this file?\n\n` +
          `Cancel to APPEND the new compounds instead.`,
        );
        if (ok) setCompounds(parsed);
        else setCompounds([...compounds.filter((c) => c.smiles.trim()), ...parsed]);
      } else {
        setCompounds(parsed);
      }
    },
    onError: (e) => {
      // Wrap raw backend errors in a friendlier user-facing message.
      const raw = (e as Error).message;
      setUploadErr(`Couldn't parse the file. ${raw.length < 80 ? raw : "Make sure it's a valid SDF, SMILES, or CSV with a SMILES column."}`);
    },
  });
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) uploadMut.mutate(f);
  }
  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) uploadMut.mutate(f);
    e.target.value = ""; // allow re-selecting the same file
  }

  const compoundCount = compounds.filter((c) => c.smiles.trim()).length;
  // Variant count depends on whether WT is included. Skipping WT means we
  // dock fewer cells but lose the Δ baseline.
  const variantCount = (includeWt ? 1 : 0) + allMutations.length;
  const totalDockings = compoundCount * variantCount;
  // Per-cell wall time scales roughly linearly with exhaustiveness (8 → ~3 s,
  // 16 → ~6 s, 32 → ~12 s on the GPU Pod). Rough enough to set expectations.
  const estSeconds = totalDockings * (3 * (exhaustiveness / 8));

  // Submission disabled while in flight — set when fan-out is running so the
  // user can't double-click and submit 2× as many jobs.
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = compounds.filter((c) => c.smiles.trim());
    const compoundPayload = cleaned.map((c) => ({ name: c.name || null, smiles: c.smiles.trim() }));

    if (isMultiTarget) {
      // Selectivity mode — fan out N parallel jobs, one per target, WT only.
      // We deliberately ignore allMutations here because the UI hides the
      // mutation panel in this mode; double-defending against any leak.
      setSubmitting(true);
      setSubmitErr(null);
      Promise.all(
        targets.map((t) =>
          api.createJob({
            pdb_id: t.pdb_id,
            chain: t.chain,
            uniprot_id: t.uniprot,
            mutations: [],
            compounds: compoundPayload,
            exhaustiveness,
            include_wt: true,  // selectivity = WT-only by definition
          }),
        ),
      )
        .then((jobs) => {
          // Encode the share IDs in URL for the suite page to pick up.
          const ids = jobs.map((j) => j.share_id || String(j.id)).join(",");
          navigate(`/suite?ids=${encodeURIComponent(ids)}`);
        })
        .catch((err) => {
          setSubmitErr(`Failed to submit selectivity suite: ${(err as Error).message}`);
        })
        .finally(() => setSubmitting(false));
      return;
    }

    // Single-target mode — unchanged behaviour.
    submit.mutate({
      pdb_id: pdbId.trim().toUpperCase(),
      chain,
      uniprot_id: uniprot.trim() || null,
      mutations: allMutations,
      compounds: compoundPayload,
      exhaustiveness,
      include_wt: includeWt,
    });
  }

  if (loadingCatalog) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-500">
        <Spinner size={20} className="mr-2" /> Loading mutation library…
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 animate-fade-in">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New docking job</h1>
          <p className="muted mt-1">
            Pick a target, pick mutations, drop in your compounds. Selectivity matrix in seconds.
          </p>
        </div>
      </div>

      {/* ── Step 1: Target ─────────────────────────────────────────────── */}
      <Step
        n={1}
        icon={<Target />}
        title="Choose target(s)"
        subtitle="Click one for full mutation analysis · click multiple for kinase-selectivity mode."
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {catalog?.map((t) => {
            const picked = selectedIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  // Toggle this target. Picking a catalog target clears
                  // "Custom PDB" mode since the two paths can't coexist.
                  setCustomMode(false);
                  setSelectedIds((ids) =>
                    ids.includes(t.id) ? ids.filter((x) => x !== t.id) : [...ids, t.id],
                  );
                }}
                className={`relative text-left p-3 rounded-xl border transition-all ${
                  picked
                    ? "border-delta-500 bg-delta-50 shadow-glow dark:bg-delta-900/30 dark:border-delta-400"
                    : "border-slate-200 bg-white hover:border-delta-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-delta-400 dark:hover:bg-slate-700/50"
                }`}
              >
                {/* Picked-state checkmark — small but unmissable, helps users
                    see at a glance which kinases are in the selectivity set */}
                {picked && (
                  <span className="absolute top-1.5 right-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-delta-500 text-white text-[10px] font-bold leading-none">
                    ✓
                  </span>
                )}
                <div className="text-xs text-slate-500 dark:text-slate-400">{t.uniprot}</div>
                <div className="font-semibold text-ink dark:text-slate-100 mt-0.5">{t.id.toUpperCase()}</div>
                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-snug">
                  {t.indications.slice(0, 2).join(" · ")}
                </div>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              // Custom PDB takes over — clear catalog selection so the form
              // is unambiguous about what's being docked.
              setSelectedIds([]);
              setCustomMode(true);
            }}
            className={`text-left p-3 rounded-xl border-2 border-dashed transition-all ${
              customMode
                ? "border-delta-500 bg-delta-50 dark:bg-delta-900/30"
                : "border-slate-200 hover:border-delta-300 text-slate-500 dark:border-slate-700 dark:hover:border-delta-500 dark:text-slate-400"
            }`}
          >
            <div className="text-xs">Custom</div>
            <div className="font-semibold mt-0.5">Other PDB</div>
          </button>
        </div>

        {/* Selectivity-mode banner — only when 2+ catalog targets picked.
            Mutations are skipped in this mode so the matrix stays focused
            on cross-kinase selectivity (the actual question multi-target
            mode answers). */}
        {isMultiTarget && (
          <div className="mt-4 p-4 rounded-lg bg-accent-50 border border-accent-200 dark:bg-accent-900/20 dark:border-accent-800/40">
            <div className="flex items-start gap-2.5">
              <div className="text-accent-700 dark:text-accent-300 text-base shrink-0">⚡</div>
              <div className="text-sm text-accent-900 dark:text-accent-100 leading-relaxed">
                <div className="font-semibold mb-0.5">Selectivity mode · {targets.length} kinases</div>
                <p>
                  Each compound will be docked against the WT structure of every selected
                  kinase. Per-target mutation analysis is skipped — for that, pick a single
                  target. Clicking <strong>Run job</strong> submits {targets.length} parallel
                  jobs and takes you to a combined results page.
                </p>
                <p className="mt-1.5 text-xs">
                  Selected: <span className="font-mono">{targets.map((t) => t.id.toUpperCase()).join(", ")}</span>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Single-target description card — preserves the original UX when
            exactly one catalog target is selected. */}
        {target && !isMultiTarget && (
          <div className="mt-4 p-4 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700 leading-relaxed dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-300">
            <div className="font-semibold text-ink dark:text-slate-100 mb-1">{target.name}</div>
            {target.description}
          </div>
        )}

        {/* Custom-PDB heads-up: pocket box auto-detected from co-crystal HETATM,
            falls back to origin (LIKELY WRONG). Set expectations clearly.
            Also expose the file upload path here so users with non-RCSB
            structures (AlphaFold, in-house crystals, predicted complexes)
            can dock without putting their data in a public repository. */}
        {!target && (
          <>
            <div className="mt-4 p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 leading-relaxed dark:bg-amber-900/20 dark:border-amber-800/40 dark:text-amber-200">
              <div className="font-semibold mb-1">Heads-up: custom PDB</div>
              Type a 4-character RCSB ID below (we'll fetch + clean it for you), or
              upload a .pdb file from disk. Either way we strip waters/heterogens, add
              missing residues + hydrogens, and auto-detect the pocket from any bound
              ligand. With no co-crystal ligand the docking box defaults to the
              centroid and results get unreliable — pick a curated target above for
              your first run if you're new.
            </div>
            <PdbUpload onUploaded={(r) => { setPdbId(r.pdb_id); if (r.chains[0]) setChain(r.chains[0]); }} />
          </>
        )}

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">PDB ID</label>
            <AutocompleteInput
              value={pdbId}
              onChange={setPdbId}
              fetchSuggestions={async (q) => {
                const r = await api.suggestPdb(q);
                return r.suggestions;
              }}
              getValue={(item) => item.pdb_id}
              renderItem={(item) => (
                <div className="flex items-baseline gap-2">
                  <span className="font-mono font-semibold text-delta-700 shrink-0">{item.pdb_id}</span>
                  <span className="text-[11px] text-slate-500 truncate">{item.title}</span>
                </div>
              )}
              placeholder="e.g. 2ITY, or search 'EGFR'"
              minChars={2}
              inputProps={{ required: true }}
            />
          </div>
          <div>
            <label className="label">Chain</label>
            <input className="input" value={chain} onChange={(e) => setChain(e.target.value)} maxLength={2} />
          </div>
          <div>
            <label className="label">UniProt (optional)</label>
            <input className="input" value={uniprot} onChange={(e) => setUniprot(e.target.value)} />
          </div>
        </div>
      </Step>

      {/* ── Step 2: Mutations ──────────────────────────────────────────── */}
      {/* Selectivity (multi-target) mode skips this step entirely — testing
          one compound against many WT kinases is the canonical kinome
          selectivity question, and per-target mutation spread would make
          the matrix unreadable. The "selectivity-mode" banner in Step 1
          tells the user this is happening. */}
      {!isMultiTarget && (
      <Step n={2} icon={<Beaker />} title="Pick mutations" subtitle="Click any to toggle. We always dock against WT in addition to what you select.">
        {target && target.mutations.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {target.mutations.map((m) => {
              const active = selectedMutations.includes(m.code);
              return (
                <button
                  key={m.code}
                  type="button"
                  onClick={() => toggleMutation(m.code)}
                  className={active ? "chip-active" : "chip-clickable"}
                  title={m.significance}
                >
                  {active && <Close size={11} />}
                  <span className="font-mono">{m.code}</span>
                  <span className="hidden sm:inline text-slate-500 font-normal">
                    — {m.significance.split(",")[0]}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div>
          <label className="label">Custom mutations (comma-separated)</label>
          <AutocompleteInput
            value={customMutations}
            onChange={setCustomMutations}
            mode="tokens"
            fetchSuggestions={async (q) => {
              // Pass the selected target's gene (uppercased) so on-target
              // mutations rank first. For custom PDBs we just suggest by code.
              const gene = target?.id?.toUpperCase() ?? null;
              const r = await api.suggestMutations(q, gene);
              return r.suggestions;
            }}
            getValue={(item) => item.code}
            renderItem={(item) => (
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-semibold text-delta-700 shrink-0">{item.code}</span>
                <span className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">{item.gene}</span>
                <span className="text-[11px] text-slate-500 truncate">{item.note}</span>
              </div>
            )}
            placeholder="e.g. T790M, L858R — start typing for suggestions"
            inputClassName="input font-mono"
            openOnFocus
            minChars={0}
          />
        </div>
        <SummaryRow>
          <span>{allMutations.length === 0 ? "Will dock WT only." : `Will dock WT + ${allMutations.length} mutant${allMutations.length === 1 ? "" : "s"}: `}</span>
          {allMutations.length > 0 && (
            <span className="font-mono text-ink dark:text-slate-100">{allMutations.join(", ")}</span>
          )}
        </SummaryRow>

        {/* Surface invalid mutation tokens we silently dropped — opaque
            silent-drop is worse than a friendly heads-up. */}
        {invalidMutationTokens.length > 0 && (
          <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-md px-3 py-2">
            <span className="font-semibold">Ignored:</span>{" "}
            <span className="font-mono">{invalidMutationTokens.join(", ")}</span>
            {" — "}
            <span className="text-amber-600 dark:text-amber-400/80">
              expected codes like <code className="font-mono">T790M</code>,{" "}
              <code className="font-mono">G12C</code>, or <code className="font-mono">T790M+C797S</code>.
            </span>
          </div>
        )}
      </Step>
      )}

      {/* ── Step 3: Compounds ──────────────────────────────────────────── */}
      <Step
        n={3}
        icon={<Bolt />}
        title="Add compounds"
        subtitle="Provide SMILES. Reference compounds for this target are pre-loaded — edit, remove, or add your own."
        action={
          target && target.compounds.length > compounds.length ? (
            <button type="button" onClick={loadAllCompounds} className="btn-ghost btn-sm">
              Load all reference ({target.compounds.length})
            </button>
          ) : null
        }
      >
        {/* File upload dropzone — SDF / SMI / CSV via RDKit */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
          onDragLeave={() => setDropActive(false)}
          onDrop={onDrop}
          className={`mb-3 rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
            dropActive
              ? "border-delta-500 bg-delta-50 dark:bg-delta-900/20 dark:border-delta-400"
              : "border-slate-300 bg-slate-50/50 hover:border-delta-400 dark:border-slate-600 dark:bg-slate-800/40 dark:hover:border-delta-400"
          }`}
        >
          <div className="flex items-center justify-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            {uploadMut.isPending ? (
              <><Spinner size={14} /> Parsing file…</>
            ) : (
              <>
                <Plus size={14} className="text-delta-600 dark:text-delta-400" />
                <span>
                  Drop a <strong>.sdf</strong>, <strong>.smi</strong>, or <strong>.csv</strong> file here, or
                </span>
                <label className="text-delta-700 underline cursor-pointer hover:text-delta-800 dark:text-delta-400 dark:hover:text-delta-300">
                  browse
                  <input
                    type="file"
                    accept=".sdf,.smi,.smiles,.csv,.txt"
                    onChange={onFileInput}
                    className="hidden"
                  />
                </label>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Max 5 MB · 200 compounds · CSV needs a SMILES column
          </div>
          {uploadErr && (
            <div className="mt-2 text-xs text-rose-700 dark:text-rose-400">{uploadErr}</div>
          )}
          {uploadMut.data && !uploadErr && (
            <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
              ✓ Loaded {uploadMut.data.compounds.length} compounds
              {uploadMut.data.truncated && ` (truncated to first ${uploadMut.data.limit})`}
            </div>
          )}
        </div>

        {/* PubChem name → SMILES quick lookup with autocomplete */}
        <div className="mb-3 rounded-lg bg-slate-50 border border-slate-200 p-3 dark:bg-slate-800/60 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-delta-600 shrink-0 dark:text-delta-400" />
            <input
              className="input flex-1"
              placeholder='Look up by name (e.g. "imatinib", "aspirin", "GDC-0941")'
              value={lookupQ}
              onChange={(e) => { setLookupQ(e.target.value); setLookupErr(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && lookupQ.trim()) {
                  e.preventDefault();
                  // If we have suggestions and the typed text isn't an exact match,
                  // pick the top suggestion — saves a click for typos.
                  const exact = suggestions.find((s) => s.toLowerCase() === lookupQ.trim().toLowerCase());
                  runLookup(exact || (suggestions[0] ?? lookupQ.trim()));
                }
              }}
              list="pubchem-suggestions"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => runLookup(lookupQ)}
              disabled={!lookupQ.trim() || lookupMut.isPending}
              className="btn-secondary btn-sm shrink-0"
            >
              {lookupMut.isPending ? <Spinner size={12} /> : "Look up"}
            </button>
          </div>

          {/* Native datalist gives free autocomplete in the browser */}
          {suggestions.length > 0 && (
            <datalist id="pubchem-suggestions">
              {suggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          )}

          {/* Suggestion chips when the query doesn't match exactly — useful on misses or typos */}
          {!lookupMut.isPending && lookupErr && suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-600 dark:text-slate-400">Did you mean:</span>
              {suggestions.slice(0, 5).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setLookupQ(s); runLookup(s); }}
                  className="chip-clickable text-xs"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {lookupErr && (
            <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">
              {lookupErr.replace(/^PubChem doesn't know /, "Couldn't find ")}
            </p>
          )}
          {lookupMut.data && !lookupErr && (
            <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
              ✓ Added {lookupMut.data.name} (CID {lookupMut.data.cid})
              {lookupMut.data.molecular_formula && ` · ${lookupMut.data.molecular_formula}`}
            </p>
          )}
        </div>

        <div className="space-y-2">
          {compounds.map((c, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-12 sm:col-span-3">
                <input
                  className="input"
                  placeholder="Name (optional)"
                  value={c.name}
                  onChange={(e) => setCompound(i, { name: e.target.value })}
                />
              </div>
              <div className="col-span-11 sm:col-span-8">
                <input
                  className="input-mono"
                  placeholder="SMILES"
                  value={c.smiles}
                  onChange={(e) => setCompound(i, { smiles: e.target.value })}
                />
              </div>
              <button
                type="button"
                onClick={() => removeCompound(i)}
                className="col-span-1 h-9 text-slate-400 hover:text-loss-600 flex items-center justify-center rounded-md hover:bg-loss-50 dark:text-slate-500 dark:hover:text-loss-400 dark:hover:bg-loss-900/30 transition-colors"
                aria-label="Remove"
              >
                <Close size={16} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addCompound} className="btn-ghost btn-sm mt-3">
          <Plus size={14} /> Add compound
        </button>
      </Step>

      {/* ── Run options ────────────────────────────────────────────────── */}
      <Step n={4} icon={<Sparkles />} title="Run options" subtitle="Trade speed for pose quality, or skip the WT baseline.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Exhaustiveness picker — three buttons, single-select */}
          <div>
            <div className="label mb-1.5">Search depth (exhaustiveness)</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 8 as const,  label: "Fast",      sub: "~3 s/cell · default" },
                { value: 16 as const, label: "Balanced",  sub: "~6 s/cell" },
                { value: 32 as const, label: "Thorough",  sub: "~12 s/cell" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setExhaustiveness(opt.value)}
                  className={`text-left rounded-lg border p-3 transition-colors ${
                    exhaustiveness === opt.value
                      ? "border-delta-500 bg-delta-50 dark:bg-delta-900/30 dark:border-delta-400"
                      : "border-slate-200 bg-white hover:border-delta-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-delta-400"
                  }`}
                >
                  <div className="font-semibold text-ink dark:text-slate-100 text-sm">{opt.label}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{opt.sub}</div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-mono">exh = {opt.value}</div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-snug">
              Higher search depth = more reliable convergence on the global-minimum pose, at the cost of
              GPU time. Use Thorough for publication-grade analyses; Fast is fine for screening.
            </p>
          </div>

          {/* WT toggle — checkbox-style card */}
          <div>
            <div className="label mb-1.5">Comparison baseline</div>
            <button
              type="button"
              onClick={() => setIncludeWt((v) => !v)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                includeWt
                  ? "border-delta-500 bg-delta-50 dark:bg-delta-900/30 dark:border-delta-400"
                  : "border-slate-200 bg-white hover:border-delta-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-delta-400"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded border-2 shrink-0 ${
                    includeWt
                      ? "border-delta-500 bg-delta-500 text-white"
                      : "border-slate-300 dark:border-slate-600"
                  }`}
                >
                  {includeWt && <span aria-hidden className="text-[12px] leading-none">✓</span>}
                </span>
                <div className="flex-1">
                  <div className="font-semibold text-ink dark:text-slate-100 text-sm">
                    Compare against wild-type
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Adds a WT row to the matrix and computes Δ vs WT for every mutant cell.
                  </div>
                </div>
              </div>
            </button>
            {!includeWt && allMutations.length === 0 && (
              <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
                You'll need at least one mutation listed if WT is skipped — otherwise there's nothing to dock.
              </p>
            )}
            {!includeWt && allMutations.length > 0 && (
              <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                WT skipped. The matrix won't show a Δ column — only absolute mutant scores.
              </p>
            )}
          </div>
        </div>
      </Step>

      {/* ── Submit bar ─────────────────────────────────────────────────── */}
      {submit.isError && (
        <div className="card border-loss-300 bg-loss-50 text-loss-700 dark:bg-loss-900/20 dark:text-loss-300 dark:border-loss-700/40">
          <p className="text-sm">Couldn't submit: {(submit.error as Error).message}</p>
        </div>
      )}

      <div className="sticky bottom-4 z-10">
        <div className="card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg ring-1 ring-slate-200 dark:ring-slate-700">
          <div className="text-sm">
            <div className="font-semibold text-ink dark:text-slate-100">
              {totalDockings} docking{totalDockings === 1 ? "" : "s"} queued
            </div>
            <div className="text-slate-500 text-xs mt-0.5 dark:text-slate-400">
              {compoundCount} compound{compoundCount === 1 ? "" : "s"} × {variantCount} variant{variantCount === 1 ? "" : "s"} · est. ~{estSeconds}s
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 w-full sm:w-auto">
            <button
              type="submit"
              className="btn-primary btn-lg w-full sm:w-auto"
              disabled={submit.isPending || submitting || compoundCount === 0 || (!isMultiTarget && !customMode && targets.length === 0)}
            >
              {(submit.isPending || submitting) ? (
                <><Spinner size={14} /> Submitting{isMultiTarget ? ` ${targets.length} jobs…` : "…"}</>
              ) : isMultiTarget ? (
                <>Run selectivity ({targets.length} kinases) <ArrowRight size={16} /></>
              ) : (
                <>Run docking <ArrowRight size={16} /></>
              )}
            </button>
            {submitErr && (
              <div className="text-xs text-rose-700 dark:text-rose-400 max-w-xs text-right">{submitErr}</div>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

function Step({
  n, icon, title, subtitle, action, children,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <header className="flex items-start justify-between mb-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-delta-500 to-accent-500 text-white flex items-center justify-center shadow-sm shrink-0">
            {icon}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-delta-600 dark:text-delta-400">
              Step {n}
            </div>
            <h2 className="text-lg font-semibold text-ink dark:text-slate-100">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function SummaryRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600 bg-slate-50 rounded-md px-3 py-2 border border-slate-200 dark:text-slate-300 dark:bg-slate-800/60 dark:border-slate-700">
      {children}
    </div>
  );
}

/** Drag-and-drop / click-to-pick PDB file uploader. Shown only in the
 *  custom-PDB ("Other PDB") branch. On success, fills the PDB ID + chain
 *  fields above with the upload's USR_xxxxxxxx token. */
function PdbUpload({ onUploaded }: {
  onUploaded: (resp: { pdb_id: string; chains: string[]; size_bytes: number }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ pdb_id: string; chains: string[]; bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function handle(file: File) {
    setError(null);
    if (file.size > 10 * 1024 * 1024) {
      setError("File too large (max 10 MB).");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdb") && !file.name.toLowerCase().endsWith(".ent")) {
      // Soft-warn but still try — many users name structures with .txt or no extension
      // and the backend's content sniff will catch true mis-uploads.
    }
    setBusy(true);
    try {
      const r = await api.uploadPdb(file);
      setDone({ pdb_id: r.pdb_id, chains: r.chains, bytes: r.size_bytes });
      onUploaded(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`mt-3 border-2 border-dashed rounded-lg p-4 text-sm transition-colors ${
        drag
          ? "border-delta-500 bg-delta-50 dark:bg-delta-900/20"
          : done
          ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-700/50 dark:bg-emerald-900/10"
          : "border-slate-300 bg-slate-50/60 hover:border-delta-400 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-delta-500"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) handle(f);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-slate-700 dark:text-slate-300">
          {busy ? (
            <span className="inline-flex items-center gap-2"><Spinner size={13} /> Uploading…</span>
          ) : done ? (
            <span className="text-emerald-700 dark:text-emerald-300">
              ✓ Uploaded <span className="font-mono">{done.pdb_id}</span> · {(done.bytes / 1024).toFixed(0)} KB
              · chains: {done.chains.join(", ")}
            </span>
          ) : (
            <span>
              <span className="font-semibold text-ink dark:text-slate-200">Or upload a .pdb file</span>
              <span className="text-slate-500 dark:text-slate-400"> — drop here, or </span>
              <label className="text-delta-600 dark:text-delta-400 hover:underline cursor-pointer">
                browse
                <input
                  type="file"
                  accept=".pdb,.ent,chemical/x-pdb"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); }}
                />
              </label>
              <span className="text-slate-500 dark:text-slate-400"> · max 10 MB · waters/heterogens cleaned automatically</span>
            </span>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-2 text-xs text-rose-700 dark:text-rose-400">
          {error}
        </div>
      )}
    </div>
  );
}
