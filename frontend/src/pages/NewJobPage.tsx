import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError, type AlternativePdb, type CatalogTarget, type MutationIssue, type ValidationDetail } from "../api";
import { ArrowRight, Beaker, Bolt, Close, Plus, Sparkles, Spinner, Target } from "../components/Icons";
import AutocompleteInput from "../components/AutocompleteInput";
import KetcherModal from "../components/KetcherModal";

interface CompoundRow {
  name: string;
  smiles: string;
}

// Free-tier caps. Backend enforces these in JobCreate (max_length=5 mutations,
// max_length=5 compounds, max 2 targets). Hoisted to module scope so
// mutationsForTarget() can reference MAX_MUTATIONS_PER_TARGET during render
// without a temporal-dead-zone error. The UI hard-blocks adding past these
// limits and pops a "limit reached" toast so users always know why a click
// didn't take effect.
const MAX_COMPOUNDS = 5;
const MAX_MUTATIONS_PER_TARGET = 5;
const MAX_TARGETS = 2;

/** Standard pencil icon for the "Sketch" action. The earlier pencil-on-
 *  hexagon design was illegible at 16px (read as a faint circle on screen).
 *  Lucide-style pencil with a clear diagonal body, eraser end, and tip — at
 *  16px each stroke is recognizable, and we pair it with a "Sketch" text
 *  label in the button so there's no chance of misreading the affordance. */
function SketchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
      <path d="M15 5l4 4" />
    </svg>
  );
}

export default function NewJobPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: catalog, isLoading: loadingCatalog } = useQuery({
    queryKey: ["catalog"],
    queryFn: api.catalog,
  });

  // Pre-select the target from ?target=xxx if present (e.g. coming from Library
  // or a marketing link). Otherwise start with NO target selected — we used to
  // default to EGFR, but that primed the form with EGFR's compounds + mutation
  // chips before the user expressed any intent, which felt presumptuous and
  // confused users who actually wanted ABL or KRAS. Empty start = clean slate.
  // selectedIds is an ARRAY — pick multiple to enter "selectivity mode" and
  // dock the same compound list against several kinases in parallel. Single-
  // target use is the special case selectedIds.length === 1.
  const initialTarget = searchParams.get("target")?.toLowerCase();
  const [selectedIds, setSelectedIds] = useState<string[]>(
    initialTarget ? [initialTarget] : [],
  );
  const [customMode, setCustomMode] = useState(false);

  // Ketcher sketcher modal: tracks which compound row index is being
  // edited. `null` = closed. Opening it lazily loads the self-hosted
  // Ketcher iframe (~25 MB of static assets), so we only pay the cost
  // when the user actually wants to draw.
  const [sketcherRow, setSketcherRow] = useState<number | null>(null);

  // Free-tier limit toast: a brief auto-dismissing message that pops
  // when the user tries to add a target/mutation/compound past the cap.
  // Without this, the click was silently no-op and users thought the UI
  // was broken. The toast is rendered as a fixed-position banner at the
  // top of the viewport — non-blocking, dismissible, auto-clears in 4s.
  const [capToast, setCapToast] = useState<string | null>(null);
  function flashCapToast(msg: string) {
    setCapToast(msg);
    // each call resets the timer, so rapid clicks keep the toast visible.
    if (capToastTimerRef.current) window.clearTimeout(capToastTimerRef.current);
    capToastTimerRef.current = window.setTimeout(() => setCapToast(null), 4000);
  }
  const capToastTimerRef = useRef<number | null>(null);

  const [pdbId, setPdbId] = useState("");
  const [chain, setChain] = useState("A");
  const [uniprot, setUniprot] = useState("");

  const targets: CatalogTarget[] = useMemo(
    () => (catalog ?? []).filter((t) => selectedIds.includes(t.id)),
    [catalog, selectedIds],
  );
  // Total target count = catalog kinases + the custom PDB (if Custom mode is
  // on AND has a non-empty PDB ID). This lets users mix curated targets with
  // their own AlphaFold structure or in-house crystal in a single selectivity
  // suite — e.g. "EGFR + ABL + my-internal-PDB" all in one run.
  const customCounts = customMode && pdbId.trim().length > 0;
  const totalTargets = targets.length + (customCounts ? 1 : 0);
  // Single-target mode preserves all the existing form UX (mutations, full
  // per-target tweaking). Multi-target mode is "selectivity mode" — WT only,
  // fan out N parallel jobs, redirect to a suite view.
  const isMultiTarget = totalTargets > 1;
  const target: CatalogTarget | undefined = isMultiTarget ? undefined : targets[0];

  // Synthetic id for the Custom PDB row in selectedMutationsByTarget /
  // customMutationsByTarget Records. Catalog targets use their real id
  // ("egfr", "abl"); custom uses this key. Keeping it scoped to a constant
  // means no risk of collision with a future catalog id called "__custom__".
  const CUSTOM_KEY = "__custom__";
  // Per-target mutation state. Keys are catalog target IDs (e.g. "egfr").
  // In single-target mode we only ever populate one key; in multi-target
  // (selectivity) mode each selected kinase gets its own chip selection,
  // so the user can run e.g. "EGFR + T790M, ABL + T315I, KIT WT-only"
  // in one suite. Custom PDB doesn't get mutations — there's no curated
  // mutation library for an arbitrary user-supplied structure.
  const [selectedMutationsByTarget, setSelectedMutationsByTarget] = useState<Record<string, string[]>>({});
  const [customMutationsByTarget, setCustomMutationsByTarget] = useState<Record<string, string>>({});
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

  // When the SINGLE target changes (single-target mode only), update the
  // structural fields. On the first target pick, also auto-populate the
  // compound list with this target's reference inhibitors (a "show me an
  // example to start from" affordance). Mutations are NEVER auto-checked —
  // they're shown as clickable chips in Step 2 so the user can see what's
  // available, but the user explicitly picks which to dock. Pre-selecting
  // 3 mutations was confusing because users didn't realise they'd quietly
  // signed up for 4× the docking work (WT + 3 mutants) without choosing.
  useEffect(() => {
    if (!target) return;
    if (!customMode) {
      // Only sync structural fields from catalog when NOT in custom mode —
      // otherwise we'd stomp the user's custom-PDB inputs every render.
      setPdbId(target.pdb_id);
      setChain(target.chain);
      setUniprot(target.uniprot);
    }
    if (!autoFilledRef.current) {
      // First target pick — load reference compounds only. No mutation
      // pre-selection: chips render unchecked and the user opts in.
      setCompounds(target.compounds.slice(0, 4).map((c) => ({ name: c.name, smiles: c.smiles })));
      autoFilledRef.current = true;
    }
    previousTargetIdRef.current = target.id;
  }, [target, customMode]);

  // Strict mutation-code validation. Accepts:
  //   * Standard codes:  T790M, L858R, G12C
  //   * Combos:          T790M+C797S
  //   * Indels:          E746_A750del, V559insT
  // Anything else (lowercase, gibberish, special chars) gets dropped silently
  // so it never reaches the backend. Keeps the bad-input surface small.
  const MUTATION_RE = /^[A-Z][0-9]+[A-Z]([+_][A-Za-z0-9]+)*(del|ins[A-Z]+)?$/;

  // Combine chip-selected + free-typed mutations for a single target id.
  // Returns the deduplicated, validated list, clamped to the free-tier cap
  // so the backend's max_length validator can never reject our submit.
  // Anything beyond the cap is silently dropped — the per-target summary
  // row below the inputs surfaces the truncation so the user sees what
  // happened.
  function mutationsForTarget(tid: string): string[] {
    const chips = selectedMutationsByTarget[tid] ?? [];
    const typed = (customMutationsByTarget[tid] ?? "")
      .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      .map((s) => s.toUpperCase().replace(/DEL$/, "del").replace(/INS([A-Z]+)$/, "ins$1"))
      .filter((s) => MUTATION_RE.test(s));
    const merged = Array.from(new Set([...chips, ...typed]));
    return merged.slice(0, MAX_MUTATIONS_PER_TARGET);
  }

  /** Same merge logic as mutationsForTarget but WITHOUT the cap — used to
   *  detect overflow so we can show a "limit reached" warning to the user. */
  function rawMutationsForTarget(tid: string): string[] {
    const chips = selectedMutationsByTarget[tid] ?? [];
    const typed = (customMutationsByTarget[tid] ?? "")
      .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      .map((s) => s.toUpperCase().replace(/DEL$/, "del").replace(/INS([A-Z]+)$/, "ins$1"))
      .filter((s) => MUTATION_RE.test(s));
    return Array.from(new Set([...chips, ...typed]));
  }

  // Tokens the user typed that don't match the mutation grammar — surfaced
  // as a friendly "ignored: XYZ" warning so silent-drop doesn't leave the
  // user wondering why their entry didn't take.
  function invalidTokensForTarget(tid: string): string[] {
    return (customMutationsByTarget[tid] ?? "")
      .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      .map((s) => s.toUpperCase().replace(/DEL$/, "del").replace(/INS([A-Z]+)$/, "ins$1"))
      .filter((s) => !MUTATION_RE.test(s));
  }

  // Single-target compatibility shim used by Step 4's count summary
  // (variantCount = WT? + total chosen mutations across all currently-
  // visible target cards). Includes the custom-PDB row's user-typed
  // mutations when customMode is on, so the count + single-target
  // submit payload reflect them too.
  const allMutations = useMemo(
    () => {
      const fromCatalog = targets.flatMap((t) => mutationsForTarget(t.id));
      const fromCustom = customMode && pdbId.trim() ? mutationsForTarget(CUSTOM_KEY) : [];
      return Array.from(new Set([...fromCatalog, ...fromCustom]));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targets, customMode, pdbId, selectedMutationsByTarget, customMutationsByTarget],
  );

  const submit = useMutation({
    mutationFn: api.createJob,
    // New jobs always navigate by share_id — that's what users will copy
    // out of the URL bar to share. Falls back to integer id only for the
    // unlikely case where a backend response somehow lacks share_id.
    onSuccess: (job) => navigate(`/jobs/${job.share_id || job.id}`),
  });

  function toggleMutation(targetId: string, code: string) {
    setSelectedMutationsByTarget((prev) => {
      const cur = prev[targetId] ?? [];
      // Removing a chip is always allowed.
      if (cur.includes(code)) {
        return { ...prev, [targetId]: cur.filter((c) => c !== code) };
      }
      // Free-tier cap: when at the limit and the user tries to ADD another,
      // fire a toast and no-op. The cap counts BOTH chip selections AND the
      // typed-in custom mutations — otherwise a user with 3 typed mutations
      // could click 5 chips and exceed the backend max_length.
      const totalNow = rawMutationsForTarget(targetId).length;
      if (totalNow >= MAX_MUTATIONS_PER_TARGET) {
        flashCapToast(`You've reached the free-tier limit of ${MAX_MUTATIONS_PER_TARGET} mutations per target. Remove one to pick another.`);
        return prev;
      }
      return { ...prev, [targetId]: [...cur, code] };
    });
  }
  function setCustomMutationsFor(targetId: string, value: string) {
    setCustomMutationsByTarget((prev) => {
      // Compute the projected combined-list size with this new value, so we
      // can fire a toast at the moment the user crosses the free-tier cap
      // (rather than only when they later try to submit). Mirrors the
      // logic in rawMutationsForTarget — kept inline here to avoid the
      // staleness pitfalls of calling rawMutationsForTarget(targetId)
      // before this state update commits.
      const chips = selectedMutationsByTarget[targetId] ?? [];
      const typed = value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
        .map((s) => s.toUpperCase().replace(/DEL$/, "del").replace(/INS([A-Z]+)$/, "ins$1"))
        .filter((s) => MUTATION_RE.test(s));
      const projected = new Set([...chips, ...typed]).size;
      const previousProjected = (() => {
        const prevTyped = (prev[targetId] ?? "")
          .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
          .map((s) => s.toUpperCase().replace(/DEL$/, "del").replace(/INS([A-Z]+)$/, "ins$1"))
          .filter((s) => MUTATION_RE.test(s));
        return new Set([...chips, ...prevTyped]).size;
      })();
      // Only fire the toast on the upward transition past the cap — keeps
      // the message from re-popping every keystroke while the user edits
      // an already-too-long list.
      if (projected > MAX_MUTATIONS_PER_TARGET && previousProjected <= MAX_MUTATIONS_PER_TARGET) {
        flashCapToast(`Free-tier limit reached: only the first ${MAX_MUTATIONS_PER_TARGET} mutations per target will be docked.`);
      }
      return { ...prev, [targetId]: value };
    });
  }
  function setCompound(i: number, patch: Partial<CompoundRow>) {
    setCompounds((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addCompound() {
    setCompounds((cs) => {
      if (cs.length >= MAX_COMPOUNDS) {
        flashCapToast(`You've reached the free-tier limit of ${MAX_COMPOUNDS} compounds per job. Remove one to add another.`);
        return cs;
      }
      return [...cs, { name: "", smiles: "" }];
    });
  }
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
      // Build the payload list: catalog targets first, then the custom PDB
      // if it's been filled (customMode + non-empty pdbId). This lets a
      // single suite mix curated kinases with a user-supplied structure.
      setSubmitting(true);
      setSubmitErr(null);
      const payloads = [
        ...targets.map((t) => ({
          pdb_id: t.pdb_id,
          chain: t.chain,
          uniprot_id: t.uniprot,
          // Per-target mutations from Step 2's per-target chip cards. Each
          // catalog kinase keeps its own selection so the suite can run
          // e.g. EGFR+T790M alongside ABL+T315I in one go.
          mutations: mutationsForTarget(t.id),
          compounds: compoundPayload,
          exhaustiveness,
          include_wt: true,
        })),
        ...(customCounts
          ? [{
              pdb_id: pdbId.trim().toUpperCase(),
              chain: chain || "A",
              uniprot_id: uniprot.trim() || null,
              // Custom PDB has no curated chips, but user-typed mutations
              // are honoured — the runner's PDBFixer mutation builder
              // verifies each residue exists in the PDB at the requested
              // chain+number and fails loudly if not.
              mutations: mutationsForTarget(CUSTOM_KEY),
              compounds: compoundPayload,
              exhaustiveness,
              include_wt: true,
            }]
          : []),
      ];
      Promise.all(payloads.map((p) => api.createJob(p)))
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
    <>
    {/* Free-tier limit toast — fixed at top-center, auto-dismisses in 4s.
        Pops when the user tries to add a target/mutation/compound past the
        cap, or when typed mutations would be truncated. Click to dismiss
        early. The high z-index keeps it above the Ketcher modal too. */}
    {capToast && (
      <div
        role="status"
        aria-live="polite"
        onClick={() => setCapToast(null)}
        className="fixed top-20 left-1/2 -translate-x-1/2 z-[300] cursor-pointer"
      >
        <div className="flex items-start gap-3 max-w-md bg-rose-600 text-white px-4 py-3 rounded-lg shadow-lg ring-1 ring-rose-700 animate-fade-in">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div className="text-sm leading-snug">{capToast}</div>
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 -mr-1 -mt-0.5 text-white/80 hover:text-white"
            onClick={(e) => { e.stopPropagation(); setCapToast(null); }}
          >
            <Close size={14} />
          </button>
        </div>
      </div>
    )}
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
        subtitle={`Click one for full mutation analysis · click multiple for kinase-selectivity mode. Free tier: max ${MAX_TARGETS} targets.`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {catalog?.map((t) => {
            const picked = selectedIds.includes(t.id);
            // Hit cap = catalog tile that's NOT picked is disabled (clicking
            // a picked tile still works — that's how you deselect). The
            // cap counts catalog targets + the custom-PDB row when active.
            const atCap = totalTargets >= MAX_TARGETS && !picked;
            return (
              <button
                key={t.id}
                type="button"
                title={atCap ? `Free tier: max ${MAX_TARGETS} targets` : undefined}
                onClick={() => {
                  // Toggle this catalog target. Custom PDB mode can coexist
                  // with catalog picks — the user might want to dock against
                  // EGFR + ABL + their-own-AlphaFold-structure in one run.
                  // If we're at the cap and the user clicks an unselected
                  // target, fire the toast instead of silently no-oping —
                  // earlier the button was disabled and click didn't fire,
                  // which left users wondering if the page was broken.
                  if (atCap) {
                    flashCapToast(`You've reached the free-tier limit of ${MAX_TARGETS} targets. Deselect one to pick another.`);
                    return;
                  }
                  setSelectedIds((ids) =>
                    ids.includes(t.id)
                      ? ids.filter((x) => x !== t.id)
                      : ids.length < MAX_TARGETS - (customCounts ? 1 : 0)
                        ? [...ids, t.id]
                        : ids,
                  );
                }}
                className={`relative text-left p-3 rounded-xl border transition-all ${
                  picked
                    ? "border-delta-500 bg-delta-50 shadow-glow dark:bg-delta-900/30 dark:border-delta-400"
                    : atCap
                      ? "border-slate-200 bg-white opacity-40 cursor-not-allowed dark:border-slate-700 dark:bg-slate-800"
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
              // When TURNING ON Custom PDB, clear the structural inputs so
              // the user starts with empty fields instead of stale values
              // from a previously-selected catalog target. (The catalog
              // useEffect would have populated pdbId/chain/uniprot from
              // whichever kinase was active.)
              const turningOn = !customMode;
              setCustomMode(turningOn);
              if (turningOn) {
                setPdbId("");
                setChain("A");
                setUniprot("");
              }
            }}
            className={`relative text-left p-3 rounded-xl border-2 border-dashed transition-all ${
              customMode
                ? "border-delta-500 bg-delta-50 dark:bg-delta-900/30"
                : "border-slate-200 hover:border-delta-300 text-slate-500 dark:border-slate-700 dark:hover:border-delta-500 dark:text-slate-400"
            }`}
          >
            {/* Match the catalog-tile checkmark so the Custom toggle has
                consistent visual feedback when picked. */}
            {customMode && (
              <span className="absolute top-1.5 right-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-delta-500 text-white text-[10px] font-bold leading-none">
                ✓
              </span>
            )}
            <div className="text-xs">Custom</div>
            <div className="font-semibold mt-0.5">Other PDB</div>
          </button>
        </div>

        {/* Selectivity-mode banner — shown when there's more than one target
            (catalog kinases + custom PDB combined). Mutations are skipped in
            this mode so the matrix stays focused on cross-kinase selectivity
            (the actual question multi-target mode answers). */}
        {isMultiTarget && (
          <div className="mt-4 p-4 rounded-lg bg-accent-50 border border-accent-200 dark:bg-accent-900/20 dark:border-accent-800/40">
            <div className="flex items-start gap-2.5">
              <div className="text-accent-700 dark:text-accent-300 text-base shrink-0">⚡</div>
              <div className="text-sm text-accent-900 dark:text-accent-100 leading-relaxed">
                <div className="font-semibold mb-0.5">
                  Selectivity mode · {totalTargets} target{totalTargets === 1 ? "" : "s"}
                </div>
                <p>
                  Each compound will be docked against the WT structure of every selected
                  target. Per-target mutation analysis is skipped — for that, pick exactly
                  one target. Clicking <strong>Run selectivity</strong> submits {totalTargets} parallel
                  jobs and takes you to a combined results page.
                </p>
                <p className="mt-1.5 text-xs">
                  Selected:{" "}
                  <span className="font-mono">
                    {[
                      ...targets.map((t) => t.id.toUpperCase()),
                      ...(customCounts ? [`custom:${pdbId.trim().toUpperCase()}/${chain || "A"}`] : []),
                    ].join(", ")}
                  </span>
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

        {/* Custom-PDB inputs — ONLY shown when "Other PDB" mode is on.
            When the user has picked one or more catalog targets, the PDB ID,
            chain, and UniProt are determined by the catalog entry; allowing
            edits here would create inconsistent state (typing 4XUF while
            EGFR is selected would silently dock against EGFR's pocket box
            with 4XUF's structure — nonsense). The inputs are now physically
            unreachable unless customMode is true, eliminating that footgun. */}
        {customMode && (
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
          </>
        )}
      </Step>

      {/* ── Step 2: Mutations ──────────────────────────────────────────── */}
      {/* Step 2 — Mutations.
          Renders a per-target sub-card so multi-target mode can have e.g.
          "EGFR T790M, ABL T315I, KIT WT-only" in the same selectivity run.
          Each catalog target gets its own chip strip + custom-mutation
          textarea, scoped to that target's id in selectedMutationsByTarget /
          customMutationsByTarget. Custom PDB doesn't get a card — there's
          no curated mutation library for an arbitrary structure. If the
          user has only Custom PDB selected (zero catalog targets), the
          step renders an info note instead of disappearing. */}
      <Step
        n={2}
        icon={<Beaker />}
        title={isMultiTarget ? "Pick mutations per target" : "Pick mutations"}
        subtitle={
          isMultiTarget
            ? "Each target has its own mutation list. Skip a target's chips to keep it WT-only."
            : "Click any to toggle. We always dock against WT in addition to what you select."
        }
      >
        {targets.length === 0 && !(customMode && pdbId.trim()) ? (
          <div className="text-sm text-slate-500 dark:text-slate-400 italic">
            {customMode
              ? "Type a PDB ID below first, then come back here to add mutations."
              : "Pick a target above first."}
          </div>
        ) : (
          <div className="space-y-4">
            {targets.map((t) => {
              const tid = t.id;
              const chipSelected = selectedMutationsByTarget[tid] ?? [];
              const customStr = customMutationsByTarget[tid] ?? "";
              const all = mutationsForTarget(tid);
              const raw = rawMutationsForTarget(tid);
              const truncated = raw.length > all.length;
              const invalid = invalidTokensForTarget(tid);
              return (
                <div
                  key={tid}
                  className={
                    isMultiTarget
                      ? "rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white/60 dark:bg-slate-800/40"
                      : ""
                  }
                >
                  {/* Target header — only when multi (one card visually
                      separated per target). Single-target mode gets the
                      original headerless layout for visual continuity. */}
                  {isMultiTarget && (
                    <div className="mb-2 flex items-baseline gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-delta-600 dark:text-delta-400">
                        {t.id.toUpperCase()}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{t.name}</span>
                    </div>
                  )}
                  {t.mutations.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {t.mutations.map((m) => {
                        const active = chipSelected.includes(m.code);
                        return (
                          <button
                            key={m.code}
                            type="button"
                            onClick={() => toggleMutation(tid, m.code)}
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
                      value={customStr}
                      onChange={(v) => setCustomMutationsFor(tid, v)}
                      mode="tokens"
                      fetchSuggestions={async (q) => {
                        // Pass UniProt accession so the backend can pull
                        // disease-associated natural variants from EBI in
                        // addition to our curated list and cBioPortal hotspots.
                        const r = await api.suggestMutations(q, t.id.toUpperCase(), t.uniprot);
                        return r.suggestions;
                      }}
                      getValue={(item) => item.code}
                      renderItem={(item) => (
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono font-semibold text-delta-700 shrink-0">{item.code}</span>
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">{item.gene}</span>
                          <span className="text-[11px] text-slate-500 truncate flex-1">{item.note}</span>
                          {item.source && item.source !== "curated" && (
                            <span
                              className={
                                "shrink-0 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold " +
                                (item.source === "uniprot"
                                  ? "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                                  : "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300")
                              }
                              title={item.source === "uniprot" ? "From UniProt annotated variants" : "From cBioPortal cohorts"}
                            >
                              {item.source === "uniprot" ? "UniProt" : "cBioPortal"}
                            </span>
                          )}
                        </div>
                      )}
                      emptyState={
                        <span>
                          No autocomplete match. <span className="font-semibold">Type the code anyway</span> —
                          if the residue exists in {t.pdb_id}/{t.chain || "A"}, the runner will build it.
                        </span>
                      }
                      placeholder="e.g. T790M, L858R — start typing for suggestions"
                      inputClassName="input font-mono"
                      openOnFocus
                      minChars={0}
                    />
                  </div>
                  <SummaryRow>
                    <span>
                      {all.length === 0
                        ? `Will dock WT only.`
                        : `Will dock WT + ${all.length} mutant${all.length === 1 ? "" : "s"}: `}
                    </span>
                    {all.length > 0 && (
                      <span className="font-mono text-ink dark:text-slate-100">{all.join(", ")}</span>
                    )}
                  </SummaryRow>
                  {truncated && (
                    <div className="mt-2 text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 rounded-md px-3 py-2">
                      <span className="font-semibold">Free-tier limit reached.</span>{" "}
                      Only the first {MAX_MUTATIONS_PER_TARGET} mutations will be docked
                      ({all.length}/{raw.length} kept). Remove some to use the rest.
                    </div>
                  )}
                  {invalid.length > 0 && (
                    <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-md px-3 py-2">
                      <span className="font-semibold">Ignored:</span>{" "}
                      <span className="font-mono">{invalid.join(", ")}</span>
                      {" — "}
                      <span className="text-amber-600 dark:text-amber-400/80">
                        expected codes like <code className="font-mono">T790M</code>,{" "}
                        <code className="font-mono">G12C</code>, or <code className="font-mono">T790M+C797S</code>.
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {/* Custom PDB mutation card — no curated chips (we don't know
                what's in an arbitrary user-supplied structure), but the
                custom-mutations textarea works the same as for catalog
                targets. The runner's PDBFixer mutation builder will apply
                whatever the user types, validating that the residue exists
                in the PDB at the requested chain+number. */}
            {customMode && pdbId.trim().length > 0 && (() => {
              const customStr = customMutationsByTarget[CUSTOM_KEY] ?? "";
              const all = mutationsForTarget(CUSTOM_KEY);
              const raw = rawMutationsForTarget(CUSTOM_KEY);
              const truncated = raw.length > all.length;
              const invalid = invalidTokensForTarget(CUSTOM_KEY);
              return (
                <div
                  className={
                    isMultiTarget
                      ? "rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white/60 dark:bg-slate-800/40"
                      : ""
                  }
                >
                  {isMultiTarget && (
                    <div className="mb-2 flex items-baseline gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-delta-600 dark:text-delta-400">
                        CUSTOM
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {pdbId.trim().toUpperCase()}/{chain || "A"}
                      </span>
                    </div>
                  )}
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2 leading-snug">
                    No curated chip library for custom structures. Type mutation codes by hand —
                    the runner verifies each residue exists in your PDB at the given chain+number.
                  </p>
                  <div>
                    <label className="label">Custom mutations (comma-separated)</label>
                    <AutocompleteInput
                      value={customStr}
                      onChange={(v) => setCustomMutationsFor(CUSTOM_KEY, v)}
                      mode="tokens"
                      // No gene/uniprot filter — the user picks from any
                      // gene's suggestions since we don't know what their PDB
                      // encodes. Curated list only (UniProt/cBioPortal need an
                      // identifier we don't have for arbitrary uploads).
                      fetchSuggestions={async (q) => {
                        const r = await api.suggestMutations(q, null);
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
                      emptyState={
                        <span>
                          No autocomplete match. <span className="font-semibold">Type the code anyway</span> —
                          the runner verifies the residue exists in your PDB at the given chain+number.
                        </span>
                      }
                      placeholder="e.g. T315I, L858R, T790M+C797S"
                      inputClassName="input font-mono"
                      openOnFocus
                      minChars={0}
                    />
                  </div>
                  <SummaryRow>
                    <span>
                      {all.length === 0
                        ? `Will dock WT only.`
                        : `Will dock WT + ${all.length} mutant${all.length === 1 ? "" : "s"}: `}
                    </span>
                    {all.length > 0 && (
                      <span className="font-mono text-ink dark:text-slate-100">{all.join(", ")}</span>
                    )}
                  </SummaryRow>
                  {truncated && (
                    <div className="mt-2 text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 rounded-md px-3 py-2">
                      <span className="font-semibold">Free-tier limit reached.</span>{" "}
                      Only the first {MAX_MUTATIONS_PER_TARGET} mutations will be docked
                      ({all.length}/{raw.length} kept). Remove some to use the rest.
                    </div>
                  )}
                  {invalid.length > 0 && (
                    <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-md px-3 py-2">
                      <span className="font-semibold">Ignored:</span>{" "}
                      <span className="font-mono">{invalid.join(", ")}</span>
                      {" — "}
                      <span className="text-amber-600 dark:text-amber-400/80">
                        expected codes like <code className="font-mono">T790M</code>,{" "}
                        <code className="font-mono">G12C</code>, or <code className="font-mono">T790M+C797S</code>.
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </Step>

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
              onChange={(e) => {
                const v = e.target.value;
                setLookupQ(v);
                setLookupErr(null);
                // When the user picks a suggestion from the native datalist,
                // the browser fires onChange with the full suggestion value
                // in a single event (no per-character typing). If `v` matches
                // a known suggestion exactly (case-insensitive), treat that as
                // "user picked it" and fire the lookup immediately — saves the
                // extra click on the "Look up" button. The same exact-match
                // condition will fire if the user TYPES a full name letter-by-
                // letter once the final character matches; that's the desired
                // UX too (auto-add as soon as the typed name resolves).
                if (v.trim() && suggestions.some((s) => s.toLowerCase() === v.trim().toLowerCase())) {
                  runLookup(v.trim());
                }
              }}
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
              <div className="col-span-9 sm:col-span-6">
                <input
                  className="input-mono"
                  placeholder="SMILES"
                  value={c.smiles}
                  onChange={(e) => setCompound(i, { smiles: e.target.value })}
                />
              </div>
              {/* Sketch button — opens the self-hosted Ketcher modal.
                  Pre-loads the row's existing SMILES (if any) so users can
                  edit a compound rather than start from a blank canvas.
                  Pill button with explicit "Sketch" / "Edit" text label
                  next to the pencil — earlier icon-only version was
                  illegible at 16px. Layout: name(3) + SMILES(6) +
                  sketch(2) + remove(1) = 12. */}
              <button
                type="button"
                onClick={() => setSketcherRow(i)}
                className="col-span-2 h-9 px-2 text-xs font-semibold text-delta-700 hover:text-white hover:bg-delta-600 ring-1 ring-delta-200 hover:ring-delta-600 bg-delta-50 flex items-center justify-center gap-1.5 rounded-md transition-colors dark:text-delta-300 dark:bg-delta-900/30 dark:ring-delta-700/40 dark:hover:bg-delta-600 dark:hover:text-white"
                title={c.smiles ? "Open the structure in the 2D sketcher to edit it" : "Draw a molecule with the 2D sketcher"}
              >
                <SketchIcon size={14} />
                <span>{c.smiles ? "Edit" : "Sketch"}</span>
              </button>
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
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            onClick={addCompound}
            disabled={compounds.length >= MAX_COMPOUNDS}
            className="btn-ghost btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
            title={compounds.length >= MAX_COMPOUNDS ? `Free tier: max ${MAX_COMPOUNDS} compounds` : undefined}
          >
            <Plus size={14} /> Add compound
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {compounds.length} / {MAX_COMPOUNDS} free-tier compounds
          </span>
        </div>
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
        <SubmitErrorPanel
          err={submit.error}
          onPickAlternative={(alt) => {
            // Apply the suggested PDB to the form. We turn off catalog mode
            // (alternatives come from RCSB direct, not our curated list) and
            // populate Custom mode with the new ID + chain. The user can
            // re-submit immediately — their compound list and mutations
            // are preserved.
            setSelectedIds([]);
            setCustomMode(true);
            setPdbId(alt.pdb_id);
            setChain(alt.chain);
            // Reset the upstream submit error so the panel collapses on the
            // next render — the user has effectively acknowledged the
            // suggestion by clicking it.
            submit.reset();
          }}
        />
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

    {/* Ketcher sketcher modal — rendered as a sibling to the form so it
        can portal-overlay the page without inheriting form styles. The
        Ketcher iframe (~25 MB) is only mounted when sketcherRow !== null,
        so the cost is paid lazily when the user actually clicks Sketch. */}
    {sketcherRow !== null && (
      <KetcherModal
        initialSmiles={compounds[sketcherRow]?.smiles || undefined}
        onClose={() => setSketcherRow(null)}
        onAccept={(smiles) => {
          setCompound(sketcherRow, { smiles });
          setSketcherRow(null);
        }}
      />
    )}
    </>
  );
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

/** Render a structured submit-error panel.
 *
 *  Three shapes to cover:
 *    1. SMILES validation failure (`invalid_compounds`) — reuses the
 *       legacy plain-text path; user fixes the SMILES and retries.
 *    2. Mutation residue validation failure (`mutation_issues`) — the
 *       biology-flavored case. We render one card per issue so the user
 *       can see exactly which mutation can't be built and why, plus
 *       alternative-PDB chips when the backend was able to find them.
 *    3. Anything else — bare error message in a single line.
 *
 *  This component is intentionally local to NewJobPage because the only
 *  place we render a structured submit error is here. If a second page
 *  ever needs this, lift it.
 */
function SubmitErrorPanel({
  err,
  onPickAlternative,
}: {
  err: unknown;
  onPickAlternative: (alt: AlternativePdb) => void;
}) {
  const apiErr = err instanceof ApiError ? err : null;
  const detail = apiErr?.detail as ValidationDetail | undefined;
  const issues = detail?.mutation_issues || [];

  if (issues.length > 0) {
    return (
      <div className="card border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/15 dark:text-amber-100 dark:border-amber-700/40">
        <h3 className="text-sm font-semibold mb-1">
          {detail?.message || "Some mutations can't be built on this structure"}
        </h3>
        <p className="text-xs text-amber-800 dark:text-amber-200/80 mb-3">
          We checked your structure before submitting. Crystal structures often omit flexible loops or terminal residues, so a residue that exists in the protein sequence may not be modeled in the PDB file. Below is what we found, and where to look instead.
        </p>
        <ul className="space-y-3">
          {issues.map((it, i) => (
            <MutationIssueCard
              key={`${it.mutation}-${i}`}
              issue={it}
              onPickAlternative={onPickAlternative}
            />
          ))}
        </ul>
      </div>
    );
  }

  // Fallback: plain message (covers SMILES failures and other 4xx/5xx).
  // Try to parse a Pydantic validation array first — without this, a 422
  // landed in the UI as raw JSON like `[{"type":"too_long",...}]`.
  let friendly = (err as Error)?.message ?? String(err);
  try {
    const parsed = JSON.parse(friendly);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0];
      const field = Array.isArray(first?.loc) ? first.loc[first.loc.length - 1] : first?.loc;
      if (first?.type === "too_long" && first?.ctx?.max_length != null) {
        friendly = `Free-tier limit reached: ${field} can have at most ${first.ctx.max_length} items (you sent ${first.ctx.actual_length}).`;
      } else if (first?.type === "too_short" && first?.ctx?.min_length != null) {
        friendly = `${field} needs at least ${first.ctx.min_length} item(s).`;
      } else if (typeof first?.msg === "string") {
        friendly = `${field}: ${first.msg}`;
      }
    }
  } catch {
    // not JSON → leave the message alone
  }
  return (
    <div className="card border-loss-300 bg-loss-50 text-loss-700 dark:bg-loss-900/20 dark:text-loss-300 dark:border-loss-700/40">
      <p className="text-sm">Couldn't submit: {friendly}</p>
    </div>
  );
}

function MutationIssueCard({
  issue,
  onPickAlternative,
}: {
  issue: MutationIssue;
  onPickAlternative: (alt: AlternativePdb) => void;
}) {
  const range = issue.chain_range
    ? `${issue.chain_range[0]}–${issue.chain_range[1]}`
    : null;
  // Headline label depends on the issue code — a missing residue and a
  // wildtype mismatch are different conversations with the user.
  const headline =
    issue.code === "residue_not_resolved"
      ? `Residue ${issue.residue} not modeled in ${issue.pdb_id} chain ${issue.chain}`
      : issue.code === "wildtype_mismatch"
        ? `${issue.pdb_id} ${issue.chain}${issue.residue} is ${issue.actual_wt}, not ${issue.expected_wt}`
        : issue.code === "chain_empty"
          ? `Chain ${issue.chain} is empty in ${issue.pdb_id}`
          : `Couldn't validate ${issue.mutation}`;

  return (
    <li className="rounded-md bg-white/70 dark:bg-slate-900/40 border border-amber-200 dark:border-amber-700/30 p-3">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs font-semibold rounded bg-amber-100 text-amber-900 dark:bg-amber-800/40 dark:text-amber-100 px-1.5 py-0.5">
          {issue.mutation}
        </span>
        <span className="text-sm font-semibold text-ink dark:text-slate-100">
          {headline}
        </span>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5">
        {issue.message}
      </p>
      {range && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
          Modeled residue range in this chain: {range}.
        </p>
      )}
      {issue.alternatives && issue.alternatives.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
            Structures that contain residue {issue.residue}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {issue.alternatives.map((alt) => (
              <li key={`${alt.pdb_id}_${alt.chain}`}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] hover:border-delta-400 hover:bg-delta-50 dark:bg-slate-900 dark:border-slate-700 dark:hover:border-delta-500 dark:hover:bg-slate-800 transition-colors"
                  onClick={() => onPickAlternative(alt)}
                  title={alt.title}
                >
                  <span className="font-mono font-semibold">{alt.pdb_id}</span>
                  <span className="text-slate-500 dark:text-slate-400">/{alt.chain}</span>
                  {alt.resolution_A != null && (
                    <span className="text-slate-400 dark:text-slate-500">
                      · {alt.resolution_A.toFixed(2)} Å
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">
            Sourced from RCSB. Click to swap your target — your compounds and other settings stay.
          </p>
        </div>
      )}
    </li>
  );
}

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
