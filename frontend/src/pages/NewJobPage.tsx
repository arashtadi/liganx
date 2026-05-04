import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type AlternativePdb, type CatalogTarget, type MutationIssue, type ValidationDetail } from "../api";
import { ArrowRight, Beaker, Bolt, Close, Plus, Sparkles, Spinner, Target } from "../components/Icons";
import AutocompleteInput from "../components/AutocompleteInput";
import KetcherModal from "../components/KetcherModal";
import MoleculePreview, { useSmilesValidity, type SmilesValidity } from "../components/MoleculePreview";
import RenamePrompt from "../components/RenamePrompt";
import { usePageMeta } from "../lib/usePageMeta";

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
  // App page (noindex via robots.txt) but the tab title still benefits
  // from being descriptive when users have multiple Liganx tabs open.
  usePageMeta({
    title: "New docking job · Liganx",
    description: "Set up a new mutation-aware molecular docking run on Liganx.",
  });
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { data: catalog, isLoading: loadingCatalog } = useQuery({
    queryKey: ["catalog"],
    queryFn: api.catalog,
  });
  // User's saved compound library — populates the "Your library" pill row
  // above the compound inputs so users can re-add anything they've named
  // before in one click. Cached for 5 min; explicit saves (via the Ketcher
  // rename popup or the CompoundsPage Save button) invalidate this query
  // so the row reflects fresh state immediately.
  //
  // NB: there is intentionally NO auto-save here. Earlier versions POSTed
  // every compound row with both name+smiles to /me/compounds 800 ms after
  // any edit, but that surprised users by saving compounds they had
  // selected from the catalog/PubChem-lookup but never explicitly saved.
  // Saves to the user's library now happen ONLY through explicit user
  // action (Save button in Ketcher's rename popup, or the CompoundsPage
  // Edit/Create flow). The "Your library" row above just READS from the
  // server-side library — it doesn't write to it.
  const queryClient = useQueryClient();
  const { data: savedCompounds = [] } = useQuery({
    queryKey: ["my-compounds"],
    queryFn: api.getMyCompounds,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const deleteCompoundMut = useMutation({
    mutationFn: (id: number) => api.deleteMyCompound(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["my-compounds"] }); },
  });
  // Persist a sketcher-produced compound to the user's library on
  // explicit save (Save-as-new from RenamePrompt). Distinct from the
  // 800ms auto-save we removed in #334 — that fired on every keystroke
  // and spammed the table; this one only fires when the user
  // deliberately commits a renamed structure. Surfaces failures via
  // an inline banner so saves never fail silently again (the same
  // class of bug as the CompoundsPage save-without-onError issue).
  const [saveCompoundError, setSaveCompoundError] = useState<string | null>(null);
  const saveCompoundMut = useMutation({
    mutationFn: (payload: { name: string; smiles: string }) => api.saveMyCompound(payload),
    onSuccess: () => {
      setSaveCompoundError(null);
      queryClient.invalidateQueries({ queryKey: ["my-compounds"] });
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError ? `${err.status} ${err.message}`
        : err instanceof Error ? err.message
        : String(err);
      console.error("[NewJobPage] saveMyCompound failed:", err);
      setSaveCompoundError(`Couldn't save to library: ${msg}`);
    },
  });
  // Re-run-from-history payload — a History row pushes navigate("/new", {state: {reseed: ...}})
  // and we hydrate the form once the catalog has loaded. The reseed handler
  // runs at most once per mount; after firing we replace the route to clear
  // the state so a refresh doesn't re-trigger the seed (and the user's
  // subsequent edits aren't undone). Type-narrowed defensively because router
  // state is `unknown`.
  const reseedRef = useRef(false);

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
  // Rename prompt — fires when the user accepts a sketch that CHANGED an
  // already-named compound. The point: "Aspirin" with a new SMILES is no
  // longer Aspirin, so the library shouldn't be silently overwritten.
  // Pre-fills the input with "<OriginalName>_" so the user can append a
  // suffix or rename entirely. Duplicates are blocked client-side.
  const [renamePrompt, setRenamePrompt] = useState<{
    rowIdx: number;
    newSmiles: string;
    originalName: string;
  } | null>(null);

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
  // Docking engine: QuickVina2-GPU is the default (fast Vina-family on the
  // Pod GPU). GNINA is opt-in — Vina derivative with a CNN-based pose
  // rescoring head trained on PDBbind, ~2-3x slower per cell but with a
  // genuinely different ranking signal. The backend silently falls back to
  // QuickVina2 if GNINA_ENABLED is off on Fly, so picking GNINA is always
  // safe even if the Pod side hasn't been turned on yet.
  const [engine, setEngine] = useState<"quickvina2_gpu" | "gnina" | "boltz2">("quickvina2_gpu");

  // Reseed-from-history effect — runs once after the catalog has resolved so
  // we can match the job's PDB to a catalog target id (pdb_id is what's on
  // the job; selectedIds wants catalog ids). Falls through to Custom mode
  // when the PDB isn't in the catalog (e.g. a user-uploaded structure).
  useEffect(() => {
    if (reseedRef.current) return;
    if (!catalog) return; // wait for catalog to load before deciding catalog vs custom
    const state = location.state as { reseed?: {
      pdb_id?: string; chain?: string; mutations?: string[];
      // catalog_target_id is the editor's Promote-to-Full-Job path —
      // when the user iterates with Quick dock against a catalog target
      // (e.g. "kras") and never resolves a real PDB id, this lets us
      // map back to the catalog target by id directly. Tried first;
      // falls through to pdb_id lookup when absent.
      catalog_target_id?: string;
      compounds?: { name?: string; smiles: string }[];
      engine?: string; exhaustiveness?: number; include_wt?: boolean;
    } } | null;
    const seed = state?.reseed;
    if (!seed) return;
    reseedRef.current = true;

    // Catalog-id-first lookup (Promote-to-Full-Job from editor).
    const catId = (seed.catalog_target_id ?? "").trim();
    const catMatch = catId ? catalog.find((t) => t.id === catId) : undefined;
    if (catMatch) {
      setSelectedIds([catMatch.id]);
      setCustomMode(false);
      if (seed.mutations && seed.mutations.length > 0) {
        setCustomMutationsByTarget((prev) => ({ ...prev, [catMatch.id]: seed.mutations!.join(", ") }));
      }
    } else {
      // Only touch target/mutation state when the seed actually carries a
      // PDB. The "Use in new job" path from /compounds reseeds JUST the
      // compound list — nothing about the target — and we used to flip
      // Custom mode on with an empty pdbId, leaving the user staring at
      // an unwanted "Other PDB" tile pre-selected. Bail early here so the
      // target picker stays in its untouched default state.
      const pdbUp = (seed.pdb_id ?? "").trim().toUpperCase();
      if (pdbUp) {
        const match = catalog.find((t) => t.pdb_id.toUpperCase() === pdbUp);
        if (match) {
          // Catalog target — flip to single-target catalog mode.
          setSelectedIds([match.id]);
          setCustomMode(false);
          if (seed.mutations && seed.mutations.length > 0) {
            setCustomMutationsByTarget((prev) => ({ ...prev, [match.id]: seed.mutations!.join(", ") }));
          }
        } else {
          // PDB not in catalog (e.g. a user-uploaded structure) — flip to
          // Custom mode and pre-fill the id + chain. Runner self-heals the
          // receptor on first dock.
          setSelectedIds([]);
          setCustomMode(true);
          setPdbId(pdbUp);
          setChain((seed.chain || "A").toUpperCase());
          if (seed.mutations && seed.mutations.length > 0) {
            setCustomMutationsByTarget((prev) => ({ ...prev, [CUSTOM_KEY]: seed.mutations!.join(", ") }));
          }
        }
      }
    }

    if (seed.compounds && seed.compounds.length > 0) {
      setCompounds(seed.compounds.map((c) => ({ name: c.name ?? "", smiles: c.smiles })));
    }
    if (seed.engine === "quickvina2_gpu" || seed.engine === "gnina" || seed.engine === "boltz2") {
      setEngine(seed.engine);
    }
    if (seed.exhaustiveness === 8 || seed.exhaustiveness === 16 || seed.exhaustiveness === 32) {
      setExhaustiveness(seed.exhaustiveness);
    }
    if (typeof seed.include_wt === "boolean") {
      setIncludeWt(seed.include_wt);
    }

    // Clear the state so a manual refresh doesn't re-seed the form
    // (which would clobber any tweaks the user just made).
    navigate(location.pathname, { replace: true, state: null });
  }, [catalog, location.state, location.pathname, navigate]);

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
    // No compound auto-load. Users opt in by clicking "Load all reference"
    // (the button is still present below the upload area for one-click
    // pre-fill) OR by pasting / typing / sketching their own. Pre-loading
    // ~4 reference compounds was nudging users toward the curated list
    // without them choosing it; for a docking platform that's a real
    // problem because the docked compound is the whole input. Empty
    // compounds is the honest default — the user picks.
    //
    // autoFilledRef stays for mutation-related state below; removing the
    // compound pre-load made the variable functionally a no-op for
    // compounds, but the rest of the file still reads it as the
    // "first-target-picked-yet?" sentinel for related side effects.
    autoFilledRef.current = true;
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
  // Drops a mutation from BOTH the chip-selection set AND the typed custom
  // string. Used by the unified pill-row remove-X — the user shouldn't have
  // to remember which of the two state shapes a given pill came from.
  function removeAnyMutation(targetId: string, code: string) {
    // Drop from chip selection if present (toggleMutation handles the
    // includes() check itself, so this is a safe no-op when the code was
    // typed-only).
    setSelectedMutationsByTarget((prev) => {
      const cur = prev[targetId] ?? [];
      if (!cur.includes(code)) return prev;
      return { ...prev, [targetId]: cur.filter((c) => c !== code) };
    });
    // Re-parse the custom string and rebuild without the removed code.
    // We work off the canonical form (uppercased, ins/del normalized) so a
    // pill labelled "T790M" cleanly removes a typed "t790m" or stray spaces.
    setCustomMutationsByTarget((prev) => {
      const raw = prev[targetId] ?? "";
      const tokens = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      const kept = tokens.filter((t) => {
        const norm = t.toUpperCase().replace(/DEL$/, "del").replace(/INS([A-Z]+)$/, "ins$1");
        return norm !== code;
      });
      return { ...prev, [targetId]: kept.join(", ") };
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
  // Custom dropdown state — replaces the previous browser-native <datalist>
  // (which rendered as a black/dark unstyled OS popup that didn't match the
  // site chrome). dropdownOpen gates visibility, activeIdx tracks the
  // currently-highlighted row for keyboard navigation (Down/Up + Enter).
  const [lookupDropdownOpen, setLookupDropdownOpen] = useState(false);
  const [lookupActiveIdx, setLookupActiveIdx] = useState(0);
  const lookupWrapRef = useRef<HTMLDivElement>(null);
  // Multi-select for PubChem suggestions — chemists triaging a series often
  // want to grab 3–5 related compounds in one search ("aspirin" + several
  // ester/amide analogs surfaced by the suggester) instead of re-firing the
  // dropdown for each. Cap at 5 so the per-job compound list stays
  // manageable. Picks reset when the dropdown closes.
  const PUBCHEM_MULTI_MAX = 5;
  const [lookupPicked, setLookupPicked] = useState<string[]>([]);
  function togglePubchemPick(name: string) {
    setLookupPicked((cur) => {
      if (cur.includes(name)) return cur.filter((n) => n !== name);
      if (cur.length >= PUBCHEM_MULTI_MAX) return [...cur.slice(1), name];
      return [...cur, name];
    });
  }
  // Reset picks when the dropdown closes so reopening starts clean.
  useEffect(() => {
    if (!lookupDropdownOpen) setLookupPicked([]);
  }, [lookupDropdownOpen]);
  // Reset the highlighted row whenever the suggestion list changes so we
  // don't end up with activeIdx pointing past the new array's length.
  useEffect(() => { setLookupActiveIdx(0); }, [suggestions]);
  // Click-outside dismissal — same pattern as UserMenu in App.tsx so the
  // dropdown closes when the user clicks anywhere off the search field.
  useEffect(() => {
    if (!lookupDropdownOpen) return;
    function onDoc(e: MouseEvent) {
      if (lookupWrapRef.current && !lookupWrapRef.current.contains(e.target as Node)) {
        setLookupDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [lookupDropdownOpen]);

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

  /** Multi-select commit — fire N PubChem lookups in parallel and append
   *  every successful resolution to the compound list. Misses get
   *  collected in a single error banner so the user knows which names
   *  failed without seeing N separate toasts. Skips duplicates against
   *  the current compound list (case-insensitive on name). */
  async function runMultiLookup(names: string[]) {
    if (names.length === 0) return;
    setLookupErr(null);
    setLookupQ("");
    setSuggestions([]);
    setLookupDropdownOpen(false);
    setLookupPicked([]);
    // Skip names already in the compound list — common when the user
    // re-opens the dropdown after a previous batch.
    const existingLower = new Set(
      compounds
        .map((c) => (c.name ?? "").trim().toLowerCase())
        .filter((n) => n.length > 0),
    );
    const fresh = names.filter((n) => !existingLower.has(n.trim().toLowerCase()));
    if (fresh.length === 0) return;
    const results = await Promise.allSettled(fresh.map((n) => api.lookupCompound(n)));
    const ok: { name: string; smiles: string }[] = [];
    const failed: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") ok.push({ name: r.value.name, smiles: r.value.smiles });
      else failed.push(fresh[i]);
    });
    if (ok.length > 0) {
      setCompounds((cs) => {
        const next = [...cs];
        for (const row of ok) {
          // Reuse the same empty-row-first placement as runLookup so a
          // freshly-empty row gets filled before pushing new ones.
          const emptyIdx = next.findIndex((c) => !c.smiles.trim());
          if (emptyIdx !== -1) next[emptyIdx] = row;
          else next.push(row);
        }
        return next;
      });
    }
    if (failed.length > 0) {
      setLookupErr(`Couldn't find ${failed.length === 1 ? "this name" : "these names"} on PubChem: ${failed.join(", ")}`);
    }
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
          engine,
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
              engine,
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
      engine,
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
    {/* Library-save error toast — fires when saveCompoundMut fails
        (the rare case where the user names a sketcher-produced
        structure but the POST to /me/compounds errors out — auth
        expired, network blip, library cap reached). The job-form
        flow is unaffected; this just tells the user the *library*
        copy didn't persist so they can retry from /compounds. */}
    {saveCompoundError && (
      <div
        role="alert"
        aria-live="polite"
        onClick={() => setSaveCompoundError(null)}
        className="fixed top-32 left-1/2 -translate-x-1/2 z-[300] cursor-pointer"
      >
        <div className="flex items-start gap-3 max-w-md bg-amber-600 text-white px-4 py-3 rounded-lg shadow-lg ring-1 ring-amber-700 animate-fade-in">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div className="text-sm leading-snug">
            <div className="font-semibold">Compound saved to job, not library</div>
            <div className="text-white/90 mt-0.5 break-words">{saveCompoundError}</div>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 -mr-1 -mt-0.5 text-white/80 hover:text-white"
            onClick={(e) => { e.stopPropagation(); setSaveCompoundError(null); }}
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
        dataTour="step-targets"
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
        dataTour="step-mutations"
        icon={<Beaker />}
        title={isMultiTarget ? "Pick mutations per target" : "Pick mutations"}
        subtitle={
          isMultiTarget
            ? `You picked ${targets.length} targets. Each one has its own mutation list — set them separately in the cards below. Skip a target's chips to keep it WT-only.`
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
          <>
            {/* Multi-target callout banner — appears only when 2+ targets
                are selected. Makes the per-target structure unmissable so
                users don't try to add mutations once and assume they apply
                to everything. */}
            {isMultiTarget && (
              <div className="mb-4 flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg bg-delta-50 border border-delta-200 dark:bg-delta-900/20 dark:border-delta-800/50">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-delta-600 dark:text-delta-300">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <div className="text-xs sm:text-sm text-delta-900 dark:text-delta-100 leading-relaxed">
                  <strong>{targets.length} target cards below</strong> — set mutations separately for each one. Each target card maintains its own mutation list; mutations don't carry across.
                </div>
              </div>
            )}
            <div className="space-y-4">
            {targets.map((t, targetIdx) => {
              const tid = t.id;
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
                      ? "relative rounded-lg border-2 border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800/40 overflow-hidden"
                      : ""
                  }
                >
                  {/* Per-target header — much more prominent in multi-target
                      mode so the user can't miss that each card is its own
                      mutation list. A left-edge accent bar + numbered pill
                      ('Target 1 of 2') + larger target name + selection
                      status badge ('0 selected · WT only' vs '2 selected')
                      gives four redundant cues that this is a per-target
                      slot. Single-target mode keeps the original headerless
                      layout. */}
                  {isMultiTarget && (
                    <>
                      {/* Left-edge accent bar — visually anchors the card
                          as a distinct unit and reinforces the per-target
                          boundary at a glance. */}
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-delta-500 dark:bg-delta-400" />
                      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-md bg-delta-100 text-delta-700 dark:bg-delta-900/40 dark:text-delta-300 text-[10px] font-semibold uppercase tracking-wider">
                            Target {targetIdx + 1} of {targets.length}
                          </span>
                          <span className="font-mono font-semibold text-base text-ink dark:text-slate-100">
                            {t.id.toUpperCase()}
                          </span>
                          <span className="text-sm text-slate-500 dark:text-slate-400 truncate">
                            {t.name}
                          </span>
                        </div>
                        <span
                          className={
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap " +
                            (all.length === 0
                              ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-700/40"
                              : "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/40")
                          }
                          title={
                            all.length === 0
                              ? "No mutations picked for this target — only wild-type will be docked"
                              : `${all.length} mutation${all.length === 1 ? "" : "s"} selected for this target`
                          }
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {all.length === 0
                            ? "WT only"
                            : `${all.length} mutation${all.length === 1 ? "" : "s"}`}
                        </span>
                      </div>
                    </>
                  )}
                  {/* ── Token-field pill row ────────────────────────────
                      Every mutation looks the same regardless of source —
                      no chip-strip vs typed-list split. WT is pinned at the
                      start as a non-removable baseline pill so users always
                      see what's actually getting docked. */}
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-200 text-slate-700 text-xs font-mono font-semibold dark:bg-slate-700 dark:text-slate-200"
                        title="Wild-type runs as the comparison baseline for every job"
                      >
                        WT
                        <span className="text-[9px] font-sans font-normal text-slate-500 dark:text-slate-400 uppercase tracking-wider">baseline</span>
                      </span>
                      {all.map((code) => (
                        <span
                          key={code}
                          className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full bg-delta-600 text-white text-xs font-mono font-semibold dark:bg-delta-500"
                        >
                          {code}
                          <button
                            type="button"
                            onClick={() => removeAnyMutation(tid, code)}
                            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/25 hover:bg-white/40 transition-colors"
                            aria-label={`Remove ${code}`}
                            title={`Remove ${code}`}
                          >
                            <Close size={10} />
                          </button>
                        </span>
                      ))}
                      {all.length === 0 && (
                        <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                          No mutations yet — only wild-type will be docked
                        </span>
                      )}
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
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
                          // Visual parity with the PubChem compound row:
                          // - icon square (same as compound)
                          // - WHITE/light headline label (compound uses
                          //   text-ink/slate-100 for the name; we mirror
                          //   that so the picker reads as the same pattern
                          //   instead of "blue mutation rows vs white
                          //   compound rows" which was visually jarring)
                          // - secondary slate-gray line beneath
                          // - violet source pill matching the PUBCHEM pill
                          //   styling (both are "where this came from"
                          //   provenance tags — same semantic, same color)
                          <div className="flex items-center gap-3 w-full min-w-0">
                            <div className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                              <Beaker size={14} />
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col">
                              <div className="flex items-baseline gap-2">
                                <span className="font-mono font-semibold text-sm text-ink dark:text-slate-100">{item.code}</span>
                                <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{item.gene}</span>
                              </div>
                              {item.note && (
                                <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.note}</span>
                              )}
                            </div>
                            <span
                              className="shrink-0 text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                              title={
                                item.source === "uniprot" ? "From UniProt annotated variants"
                                : item.source === "cbioportal" ? "From cBioPortal cohorts"
                                : "From Liganx curated mutation library"
                              }
                            >
                              {item.source === "uniprot" ? "UniProt"
                                : item.source === "cbioportal" ? "cBioPortal"
                                : "Curated"}
                            </span>
                          </div>
                        )}
                        emptyState={
                          <span>
                            No autocomplete match. <span className="font-semibold">Type the code anyway</span> —
                            if the residue exists in {t.pdb_id}/{t.chain || "A"}, the runner will build it.
                          </span>
                        }
                        placeholder="Start typing — pick up to 5 mutations (or type a code directly)"
                        inputClassName="input font-mono"
                        openOnFocus
                        minChars={0}
                        // Multi-select: chemists triaging a kinase often want
                        // to grab 3–5 known variants in one open instead of
                        // re-firing the dropdown for each. Cap at 5 — past
                        // that the matrix gets unwieldy and the free-tier
                        // mutation cap kicks in anyway.
                        multi
                        multiMax={5}
                        onMultiCommit={(items) => {
                          // Append the picked codes to the existing
                          // comma-separated value, deduping case-insensitively
                          // so picking the same code twice (or one already in
                          // the list) is a no-op.
                          const existing = customStr
                            .split(",")
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0);
                          const existingLower = new Set(existing.map((s) => s.toLowerCase()));
                          const fresh = items
                            .map((it) => it.code)
                            .filter((c) => !existingLower.has(c.toLowerCase()));
                          if (fresh.length === 0) return;
                          const next = [...existing, ...fresh].join(", ");
                          setCustomMutationsFor(tid, next + ", ");
                        }}
                      />
                    </div>
                    {/* Curated suggestions for this target — only those NOT
                        already selected, dashed outline so they read as
                        "available to add" rather than "currently in the
                        run". Click adds via the same chip selection state. */}
                    {(() => {
                      const remaining = t.mutations.filter((m) => !all.includes(m.code));
                      if (remaining.length === 0) return null;
                      return (
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mr-1">
                            Curated for {t.id.toUpperCase()}:
                          </span>
                          {remaining.slice(0, 8).map((m) => (
                            <button
                              key={m.code}
                              type="button"
                              onClick={() => toggleMutation(tid, m.code)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono text-slate-600 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-600 hover:border-delta-400 hover:text-delta-700 dark:hover:text-delta-300 transition-colors"
                              title={m.significance}
                            >
                              + {m.code}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
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
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-200 text-slate-700 text-xs font-mono font-semibold dark:bg-slate-700 dark:text-slate-200"
                        title="Wild-type runs as the comparison baseline for every job"
                      >
                        WT
                        <span className="text-[9px] font-sans font-normal text-slate-500 dark:text-slate-400 uppercase tracking-wider">baseline</span>
                      </span>
                      {all.map((code) => (
                        <span
                          key={code}
                          className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full bg-delta-600 text-white text-xs font-mono font-semibold dark:bg-delta-500"
                        >
                          {code}
                          <button
                            type="button"
                            onClick={() => removeAnyMutation(CUSTOM_KEY, code)}
                            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/25 hover:bg-white/40 transition-colors"
                            aria-label={`Remove ${code}`}
                            title={`Remove ${code}`}
                          >
                            <Close size={10} />
                          </button>
                        </span>
                      ))}
                      {all.length === 0 && (
                        <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                          No mutations yet — only wild-type will be docked
                        </span>
                      )}
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
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
                          // Visual parity with the PubChem compound row —
                          // same icon, same white headline label, same
                          // violet provenance pill (Curated here, since
                          // custom-PDB suggestions only come from our
                          // curated library; no UniProt accession to query).
                          <div className="flex items-center gap-3 w-full min-w-0">
                            <div className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                              <Beaker size={14} />
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col">
                              <div className="flex items-baseline gap-2">
                                <span className="font-mono font-semibold text-sm text-ink dark:text-slate-100">{item.code}</span>
                                <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">{item.gene}</span>
                              </div>
                              {item.note && (
                                <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.note}</span>
                              )}
                            </div>
                            <span
                              className="shrink-0 text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                              title="From Liganx curated mutation library"
                            >
                              Curated
                            </span>
                          </div>
                        )}
                        emptyState={
                          <span>
                            No autocomplete match. <span className="font-semibold">Type the code anyway</span> —
                            the runner verifies the residue exists in your PDB at the given chain+number.
                          </span>
                        }
                        placeholder="Start typing — pick up to 5 mutations (or type a code directly)"
                        inputClassName="input font-mono"
                        openOnFocus
                        minChars={0}
                        // Same multi-select treatment as the catalog-target
                        // mutation field above. Caps at 5 — past that the
                        // matrix gets unwieldy and free-tier kicks in.
                        multi
                        multiMax={5}
                        onMultiCommit={(items) => {
                          const existing = customStr
                            .split(",")
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0);
                          const existingLower = new Set(existing.map((s) => s.toLowerCase()));
                          const fresh = items
                            .map((it) => it.code)
                            .filter((c) => !existingLower.has(c.toLowerCase()));
                          if (fresh.length === 0) return;
                          const next = [...existing, ...fresh].join(", ");
                          setCustomMutationsFor(CUSTOM_KEY, next + ", ");
                        }}
                      />
                    </div>
                  </div>
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
          </>
        )}
      </Step>

      {/* ── Step 3: Compounds ──────────────────────────────────────────── */}
      <Step
        n={3}
        dataTour="step-compounds"
        icon={<Bolt />}
        title="Add compounds"
        subtitle="Provide SMILES. Paste, upload, sketch, or click 'Load all reference' to fill in the curated set for this target."
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

        {/* PubChem name → SMILES quick lookup with custom autocomplete dropdown.
            Earlier this used <datalist> for cheap browser-native suggestions,
            but the OS popup (especially in dark mode on macOS) rendered as a
            black box that looked off-brand. This is a custom dropdown that
            matches the site's white-card chrome. */}
        <div className="mb-3 rounded-lg bg-slate-50 border border-slate-200 p-3 dark:bg-slate-800/60 dark:border-slate-700">
          <div ref={lookupWrapRef} className="relative">
            <div className="relative">
              {/* Magnifying-glass icon inside the input — visual hint that
                  this is a search field, not a free-form text box. */}
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                className="input pl-9 pr-24"
                placeholder='Search by name — "imatinib", "aspirin", "GDC-0941"…'
                value={lookupQ}
                onChange={(e) => {
                  const v = e.target.value;
                  setLookupQ(v);
                  setLookupErr(null);
                  setLookupDropdownOpen(true);
                }}
                onFocus={() => setLookupDropdownOpen(true)}
                onKeyDown={(e) => {
                  // Keyboard navigation through the suggestion list. We only
                  // intercept these keys when the dropdown is open AND has
                  // suggestions — so a user with no suggestions can still
                  // type and Enter to fire a free-form lookup.
                  if (lookupDropdownOpen && suggestions.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setLookupActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setLookupActiveIdx((i) => Math.max(i - 1, 0));
                      return;
                    }
                    if (e.key === "Escape") {
                      setLookupDropdownOpen(false);
                      return;
                    }
                  }
                  if (e.key === "Enter" && lookupQ.trim()) {
                    e.preventDefault();
                    setLookupDropdownOpen(false);
                    // If the user has been arrow-keying through suggestions,
                    // honour that pick. Otherwise fall back to the exact-match
                    // / first-suggestion / raw-query cascade for typo tolerance.
                    if (lookupDropdownOpen && suggestions.length > 0 && lookupActiveIdx < suggestions.length) {
                      runLookup(suggestions[lookupActiveIdx]);
                      return;
                    }
                    const exact = suggestions.find((s) => s.toLowerCase() === lookupQ.trim().toLowerCase());
                    runLookup(exact || (suggestions[0] ?? lookupQ.trim()));
                  }
                }}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => { setLookupDropdownOpen(false); runLookup(lookupQ); }}
                disabled={!lookupQ.trim() || lookupMut.isPending}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-8 px-3 rounded-md bg-delta-600 hover:bg-delta-700 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {lookupMut.isPending ? <Spinner size={12} /> : "Look up"}
              </button>
            </div>

            {/* Custom dropdown with multi-select checkboxes + commit footer.
                Click a row → toggles its checkbox (no auto-commit). Footer
                "Add N selected" fires runMultiLookup which dispatches the
                PubChem lookups in parallel and appends each hit to the
                compound list. Single-click-and-go is still possible: just
                tick one + click Add. Footer also shows the running tally
                vs the cap. */}
            {lookupDropdownOpen && suggestions.length > 0 && (
              <div
                className="absolute left-0 right-0 top-full mt-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg overflow-hidden z-20"
              >
                <div role="listbox">
                  {suggestions.slice(0, 8).map((s, idx) => {
                    const active = idx === lookupActiveIdx;
                    const isPicked = lookupPicked.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        role="option"
                        aria-selected={isPicked}
                        onMouseEnter={() => setLookupActiveIdx(idx)}
                        onClick={() => togglePubchemPick(s)}
                        className={
                          "w-full text-left flex items-center gap-3 px-3.5 py-2.5 border-b border-slate-100 dark:border-slate-700 last:border-b-0 transition-colors " +
                          (isPicked
                            ? "bg-delta-50 dark:bg-delta-900/30"
                            : active
                              ? "bg-slate-50 dark:bg-slate-700/40"
                              : "hover:bg-slate-50 dark:hover:bg-slate-700/40")
                        }
                      >
                        {/* Checkbox glyph — drawn as a square that fills
                            with brand-blue + a check when picked. Same
                            visual treatment as AutocompleteInput's multi
                            mode for consistency across the page. */}
                        <span
                          aria-hidden="true"
                          className={
                            "shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors " +
                            (isPicked
                              ? "bg-delta-600 border-delta-600 text-white"
                              : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900")
                          }
                        >
                          {isPicked && (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        <div className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                          <Beaker size={14} />
                        </div>
                        <span className="font-medium text-sm text-ink dark:text-slate-100 flex-1 truncate">{s}</span>
                        <span className="text-[9px] uppercase tracking-wider font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 px-1.5 py-0.5 rounded shrink-0">
                          PubChem
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/* Sticky footer — selection counter + commit / clear buttons.
                    Mirrors the AutocompleteInput multi footer so the page
                    has one consistent multi-select pattern. */}
                <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">
                    {lookupPicked.length === 0
                      ? `Pick up to ${PUBCHEM_MULTI_MAX} compounds`
                      : lookupPicked.length >= PUBCHEM_MULTI_MAX
                        ? `${lookupPicked.length}/${PUBCHEM_MULTI_MAX} selected (max)`
                        : `${lookupPicked.length}/${PUBCHEM_MULTI_MAX} selected`}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {lookupPicked.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setLookupPicked([])}
                        className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={lookupPicked.length === 0 || lookupMut.isPending}
                      onClick={() => runMultiLookup(lookupPicked)}
                      className="text-[11px] font-semibold px-3 py-1 rounded-md bg-delta-600 hover:bg-delta-700 text-white disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors"
                    >
                      Add {lookupPicked.length || ""} →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {lookupErr && (
            <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">
              {lookupErr.replace(/^PubChem doesn't know /, "Couldn't find ")}
            </p>
          )}
          {lookupMut.data && !lookupErr && (
            <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <Sparkles size={12} className="shrink-0" />
              Added {lookupMut.data.name} (CID {lookupMut.data.cid})
              {lookupMut.data.molecular_formula && ` · ${lookupMut.data.molecular_formula}`}
            </p>
          )}
        </div>

        {/* ── Your library ────────────────────────────────────────────
            Pills for every compound the user has saved (auto-saved on
            name+SMILES). Click a pill to drop the compound into the
            current job — fills an empty row first if any, otherwise
            appends. The X on hover removes the compound from the
            library entirely (with a quick confirm on the click). */}
        {savedCompounds.length > 0 && (
          <LibraryPicker
            savedCompounds={savedCompounds}
            jobCompounds={compounds}
            onAdd={(sc) => {
              setCompounds((cs) => {
                const next = [...cs];
                const emptyIdx = next.findIndex((c) => !c.smiles.trim() && !c.name.trim());
                if (emptyIdx >= 0) {
                  next[emptyIdx] = { name: sc.name, smiles: sc.smiles };
                } else if (next.length < MAX_COMPOUNDS) {
                  next.push({ name: sc.name, smiles: sc.smiles });
                } else {
                  flashCapToast(`Free tier: max ${MAX_COMPOUNDS} compounds per job. Remove one to add another.`);
                  return cs;
                }
                return next;
              });
            }}
            onDelete={(sc) => {
              if (window.confirm(`Remove "${sc.name}" from your library? (This won't affect any past jobs.)`)) {
                deleteCompoundMut.mutate(sc.id);
              }
            }}
          />
        )}

        <div className="space-y-3">
          {compounds.map((c, i) => (
            <CompoundRowEditor
              key={i}
              index={i}
              compound={c}
              onChange={(patch) => setCompound(i, patch)}
              onOpenSketcher={() => setSketcherRow(i)}
              onRemove={() => removeCompound(i)}
            />
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
      <Step n={4} icon={<Sparkles />} title="Run options" subtitle="Trade speed for pose quality, or skip the WT baseline." dataTour="step-run-options">
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

          {/* Engine picker — second row, full width on lg. Two cards
              side-by-side: QuickVina2-GPU (default, fast Vina) and GNINA
              (Vina derivative with CNN rescoring head). Picking GNINA
              flips the per-job dispatch on the backend; the runner falls
              back to QuickVina silently if the Pod-side endpoint or the
              GNINA_ENABLED flag is missing, so this is always a safe pick. */}
          <div className="lg:col-span-2">
            <div className="label mb-1.5">Scoring engine</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                {
                  value: "quickvina2_gpu" as const,
                  label: "QuickVina2-GPU",
                  sub: "Default · ~3 s/cell · Vina-family",
                  body:
                    "The classical AutoDock Vina scoring function, OpenCL-accelerated on the Pod GPU. Best for speed and the de-facto reproducibility baseline (~22,000 Vina citations).",
                  badge: null as null | "beta" | "coming",
                },
                {
                  value: "gnina" as const,
                  label: "GNINA (CNN-rescored)",
                  sub: "~10–30 s/cell · Vina + PDBbind CNN",
                  body:
                    "Vina fork from the Koes lab with a convolutional-neural-net pose-rescoring head trained on PDBbind. Genuinely different ranking signal — useful as a second opinion when Vina is borderline.",
                  badge: null,
                },
                {
                  value: "boltz2" as const,
                  label: "Boltz-2 (ML)",
                  sub: "~20 s/cell · MIT · Sequence-input",
                  body:
                    "MIT/Recursion's open-source AlphaFold-3-class biomolecular foundation model. Predicts pose + binding affinity end-to-end from sequence + SMILES. Different methodology from Vina/GNINA — useful as a cross-validation third opinion.",
                  // Available only by request (paid). The Boltz-2 GPU pod (~$15/day to keep
                  // resident) is stopped by default; we wake it on demand for paying users.
                  // We keep the card visible so prospects can SEE the capability and the value
                  // prop — clicking just routes them to /contact instead of selecting the
                  // engine. Backend BOLTZ2_ENABLED=false also rejects the engine if anyone
                  // tampers with the bundle to bypass this gate.
                  badge: "request" as const,
                },
              ].map((opt) => {
                const requestOnly = opt.badge === "request";
                const isSelected = engine === opt.value;
                const handleClick = () => {
                  if (requestOnly) {
                    // Open Contact in a NEW TAB so the user keeps their
                    // in-progress New-job state (selected target,
                    // mutations, compound rows) intact. In-tab navigate
                    // would unmount this whole page and lose everything.
                    // Reason travels via query param because router state
                    // can't cross window boundaries; ContactPage reads
                    // either state or query.
                    window.open(
                      "/contact?reason=boltz2_request",
                      "_blank",
                      "noopener,noreferrer",
                    );
                    return;
                  }
                  setEngine(opt.value);
                };
                return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={handleClick}
                  className={`text-left rounded-lg border p-3 transition-colors ${
                    isSelected
                      ? "border-delta-500 bg-delta-50 dark:bg-delta-900/30 dark:border-delta-400"
                      : requestOnly
                        ? "border-slate-200 bg-slate-50/60 hover:border-amber-300 hover:bg-amber-50/50 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-amber-400/60 dark:hover:bg-amber-900/10"
                        : "border-slate-200 bg-white hover:border-delta-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-delta-400"
                  }`}
                  aria-label={requestOnly ? `${opt.label} — available on request, click to contact us` : opt.label}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="font-semibold text-ink dark:text-slate-100 text-sm truncate">{opt.label}</div>
                      {opt.badge === "coming" && (
                        <span className="shrink-0 text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          Soon
                        </span>
                      )}
                      {opt.badge === "beta" && (
                        <span className="shrink-0 text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded bg-delta-100 text-delta-700 dark:bg-delta-900/40 dark:text-delta-300">
                          Beta
                        </span>
                      )}
                      {opt.badge === "request" && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="11" width="18" height="11" rx="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                          By request
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <span aria-hidden className="text-delta-600 dark:text-delta-400 text-xs shrink-0">✓</span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{opt.sub}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">{opt.body}</div>
                  {requestOnly && (
                    <div className="mt-2 text-[10.5px] text-amber-800 dark:text-amber-300 font-semibold inline-flex items-center gap-1">
                      Contact us to enable
                      <span aria-hidden>→</span>
                    </div>
                  )}
                </button>
                );
              })}
            </div>
            {engine === "gnina" && (
              <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                Each cell will report both the Vina-style affinity and a 0–1 CNN confidence. Slower than
                QuickVina2-GPU; budget ~10 minutes per matrix instead of ~2.
              </p>
            )}
            {engine === "boltz2" && (
              <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                Each cell reports a predicted log<sub>10</sub> IC<sub>50</sub> (μM) and a 0–1
                binder probability — different units from Vina kcal/mol, so the absolute
                numbers won&rsquo;t match across engines. The matrix Δ (mutant − WT) is still
                a meaningful direction signal. First request after the pod warms up
                takes ~60–90 s while the model loads; subsequent cells run in ~20 s.
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
          onFixCompound={(idx, newSmiles) => {
            // Replace the offending row's SMILES with the largest-fragment
            // form so the user can re-submit immediately.
            setCompound(idx, { smiles: newSmiles });
            submit.reset();
          }}
          onOpenSketcherFor={(idx) => {
            setSketcherRow(idx);
            submit.reset();
          }}
        />
      )}

      {/* Footer B — two-row run summary with the Run button as the hero. */}
      <div className="sticky bottom-4 z-10">
        <div className="card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg ring-1 ring-slate-200 dark:ring-slate-700">
          <div className="text-sm leading-snug">
            {/* Row 1 — target identity + engine, calmly muted. */}
            <div className="text-slate-600 dark:text-slate-300">
              {(() => {
                const engineLabel =
                  engine === "boltz2" ? "Boltz-2 (ML)"
                  : engine === "gnina" ? "GNINA (CNN)"
                  : "QuickVina2-GPU";
                let targetText: React.ReactNode;
                if (customMode) {
                  targetText = (
                    <>
                      <span className="text-slate-400 dark:text-slate-500">Target&nbsp;</span>
                      <span className="font-mono font-semibold text-ink dark:text-slate-100">
                        {pdbId.trim().toUpperCase() || "— pick a PDB —"}
                      </span>
                      {pdbId.trim() && <> · custom upload</>}
                    </>
                  );
                } else if (isMultiTarget) {
                  targetText = (
                    <>
                      <span className="text-slate-400 dark:text-slate-500">Targets&nbsp;</span>
                      <span className="font-semibold text-ink dark:text-slate-100">
                        {targets.length} kinases
                      </span>
                    </>
                  );
                } else if (targets.length === 1) {
                  targetText = (
                    <>
                      <span className="text-slate-400 dark:text-slate-500">Target&nbsp;</span>
                      <span className="font-mono font-semibold text-ink dark:text-slate-100">
                        {targets[0].id.toUpperCase()}
                      </span>
                      <> · {targets[0].name}</>
                    </>
                  );
                } else {
                  targetText = (
                    <span className="text-slate-400 dark:text-slate-500 italic">
                      Pick a target above
                    </span>
                  );
                }
                return (
                  <>
                    {targetText}
                    <span className="text-slate-300 dark:text-slate-600 mx-2">·</span>
                    <span className="text-slate-400 dark:text-slate-500">Engine&nbsp;</span>
                    <span className="font-semibold text-ink dark:text-slate-100">
                      {engineLabel}
                    </span>
                  </>
                );
              })()}
            </div>
            {/* Row 2 — math + ETA. The numbers are the load-bearing line, so
                they get the stronger weight; ETA is the soft footnote. */}
            <div className="mt-0.5">
              <span className="font-semibold text-ink dark:text-slate-100">
                {compoundCount} compound{compoundCount === 1 ? "" : "s"} × {variantCount} variant{variantCount === 1 ? "" : "s"} = {totalDockings} cell{totalDockings === 1 ? "" : "s"}
              </span>
              <span className="text-slate-400 dark:text-slate-500"> · est. ~{estSeconds}s</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 w-full sm:w-auto">
            <button
              type="submit"
              data-tour="step-run"
              className="btn-primary btn-lg w-full sm:w-auto text-base px-7 py-3"
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
        // Pocket context for the AI sidebar — pull whichever target is
        // currently active (single-target mode) and its mutations, or
        // the custom-PDB selection. The AI uses this to tailor
        // suggestions to the specific pocket and mutation residue.
        // Falls back gracefully (generic medchem advice) when empty.
        targetPdb={target?.id || pdbId || undefined}
        mutations={
          target
            ? [
                ...(selectedMutationsByTarget[target.id] ?? []),
                customMutationsByTarget[target.id] ?? "",
              ].filter(Boolean).join(", ")
            : (customMutationsByTarget[CUSTOM_KEY] ?? "") || undefined
        }
        onClose={() => setSketcherRow(null)}
        onAccept={(smiles, unchanged) => {
          const idx = sketcherRow;
          // KetcherModal flagged "no real change vs the loaded baseline"
          // — close cleanly without touching the form row OR triggering
          // any rename prompt. Defense-in-depth: the modal also hides
          // the Use button when unchanged, so this branch should be
          // rare, but a stale React state could still let it through.
          if (unchanged) {
            setSketcherRow(null);
            return;
          }
          // Intercept: if the row had a NAME and the user CHANGED the
          // SMILES, the resulting molecule is no longer "the named
          // compound" — fire the rename prompt before committing so
          // the library doesn't silently swap one structure for another
          // under the same label.
          const row = compounds[idx];
          const originalName = (row?.name ?? "").trim();
          if (originalName) {
            setRenamePrompt({ rowIdx: idx, newSmiles: smiles, originalName });
            setSketcherRow(null);
            return;
          }
          // No name yet — accept straight through. Saving to the user's
          // library now requires an explicit Save action elsewhere
          // (the auto-save was removed in task #334).
          setCompound(idx, { smiles });
          setSketcherRow(null);
        }}
      />
    )}
    {renamePrompt && (
      <RenamePrompt
        initialName={renamePrompt.originalName + "_"}
        existingNames={savedCompounds.map((c) => c.name)}
        currentRowName={renamePrompt.originalName}
        onCancel={() => {
          // Bailing keeps the row as it was — the SMILES change is dropped.
          // We deliberately do NOT auto-commit on cancel because the user
          // explicitly chose to back out.
          setRenamePrompt(null);
        }}
        // PRIMARY ACTION when the row was sourced from the user's
        // library. Backend upserts on (user_id, name), so re-saving
        // the same name overwrites the existing entry — exactly the
        // "iterate on the same compound" workflow chemists want.
        // Without this, every edit forced a renamed copy and users
        // couldn't tell their changes were being persisted at all
        // (they were, just to a NEW row each time). Only offered
        // when the original name actually exists in the library —
        // for an unnamed-row workflow there's no existing entry to
        // overwrite, so the rename input is the only path.
        onOverwrite={
          savedCompounds.some(
            (c) => c.name.toLowerCase() === renamePrompt.originalName.toLowerCase(),
          )
            ? () => {
                setCompound(renamePrompt.rowIdx, { smiles: renamePrompt.newSmiles });
                saveCompoundMut.mutate({
                  name: renamePrompt.originalName,
                  smiles: renamePrompt.newSmiles,
                });
                setRenamePrompt(null);
              }
            : undefined
        }
        onSave={(newName) => {
          // Two side effects in lockstep: update the form row in
          // local state AND persist the new compound to the user's
          // library so it shows up on /compounds for re-use later.
          // Until 2026-05-03 we only did the local update — meaning
          // a user would name a structure here, submit a job, and
          // then wonder why the compound never appeared in their
          // library. Save is fire-and-forget (no await) — failures
          // surface via the saveCompoundError banner; the form row
          // update happens regardless so the in-progress job flow
          // isn't blocked by a library-save hiccup.
          setCompound(renamePrompt.rowIdx, { smiles: renamePrompt.newSmiles, name: newName });
          saveCompoundMut.mutate({ name: newName, smiles: renamePrompt.newSmiles });
          setRenamePrompt(null);
        }}
      />
    )}
    </>
  );
}

/** A single compound row in Step 3 — name + SMILES + Sketch + Remove,
 *  with a 2D thumbnail to the left. Wraps the row in a colored card whose
 *  state mirrors the SMILES validity:
 *
 *    valid     → brand-blue "will be docked" tile (matches selected
 *                target tile in Step 1).
 *    fragments → amber tile + "multiple fragments" pill (the
 *                MoleculePreview shows the Keep-largest button).
 *    invalid   → rose tile with a soft glow + "invalid SMILES" pill;
 *                the MoleculePreview shows a Fix-in-sketcher button.
 *    empty     → dashed slate tile with an "empty" pill.
 *
 *  Lifted into its own component so each row can call useSmilesValidity
 *  on its own SMILES without violating the rules of hooks. */
function CompoundRowEditor({
  index,
  compound,
  onChange,
  onOpenSketcher,
  onRemove,
}: {
  index: number;
  compound: CompoundRow;
  onChange: (patch: Partial<CompoundRow>) => void;
  onOpenSketcher: () => void;
  onRemove: () => void;
}) {
  const validity: SmilesValidity = useSmilesValidity(compound.smiles);
  // Style buckets keyed off validity. We pick the visual treatment in
  // one place rather than threading the state through three different
  // className strings.
  const tone = (() => {
    switch (validity) {
      case "valid":
        return {
          card: "border-2 border-delta-300 bg-delta-50/40 dark:border-delta-700/50 dark:bg-delta-900/15",
          accent: "bg-delta-500 dark:bg-delta-400",
          pill: "bg-delta-600 text-white dark:bg-delta-500",
          dot: "bg-white/90",
          label: `Compound ${index + 1} · will be docked`,
        };
      case "fragments":
        return {
          card: "border-2 border-amber-300 bg-amber-50/40 dark:border-amber-700/50 dark:bg-amber-900/15",
          accent: "bg-amber-500 dark:bg-amber-400",
          pill: "bg-amber-600 text-white dark:bg-amber-500",
          dot: "bg-white/90",
          label: `Compound ${index + 1} · multiple fragments`,
        };
      case "invalid":
        return {
          // Soft glow via box-shadow so it draws the eye without the
          // jumpy feel of an animated pulse. ring + shadow stack reads
          // as "this needs your attention" without screaming.
          card: "border-2 border-rose-400 bg-rose-50/60 dark:border-rose-700/60 dark:bg-rose-900/20 ring-2 ring-rose-300/50 dark:ring-rose-700/40 shadow-[0_0_20px_rgba(244,63,94,0.18)] dark:shadow-[0_0_24px_rgba(244,63,94,0.22)]",
          accent: "bg-rose-500 dark:bg-rose-400",
          pill: "bg-rose-600 text-white dark:bg-rose-500",
          dot: "bg-white/90",
          label: `Compound ${index + 1} · invalid SMILES — fix to dock`,
        };
      case "loading":
        return {
          card: "border-2 border-slate-200 bg-slate-50/30 dark:border-slate-700 dark:bg-slate-800/20",
          accent: "bg-slate-300 dark:bg-slate-600",
          pill: "bg-slate-300 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
          dot: "bg-slate-500/70",
          label: `Compound ${index + 1} · checking…`,
        };
      case "empty":
      default:
        return {
          card: "border-2 border-dashed border-slate-200 bg-slate-50/30 dark:border-slate-700 dark:bg-slate-800/20",
          accent: "",
          pill: "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
          dot: "",
          label: `Compound ${index + 1} · empty`,
        };
    }
  })();

  const showAccent = validity !== "empty";
  return (
    <div className={"relative rounded-lg overflow-hidden transition-colors " + tone.card}>
      {showAccent && (
        <div className={"absolute left-0 top-0 bottom-0 w-1 " + tone.accent} />
      )}
      <div className="p-3 flex flex-wrap gap-2 items-start">
        <div className="basis-full flex items-center justify-between gap-2 mb-1">
          <span className={"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " + tone.pill}>
            {tone.dot && <span aria-hidden="true" className={"w-1.5 h-1.5 rounded-full " + tone.dot} />}
            {tone.label}
          </span>
        </div>

        <div className="shrink-0">
          <MoleculePreview
            smiles={compound.smiles}
            width={140}
            height={88}
            onUseLargestFragment={(largest) => onChange({ smiles: largest })}
            onOpenInSketcher={onOpenSketcher}
          />
        </div>
        <div className="flex-1 min-w-[280px] grid grid-cols-12 gap-2">
          <div className="col-span-12 sm:col-span-4">
            <input
              className="input"
              placeholder="Name (saves to your library)"
              value={compound.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </div>
          <div className="col-span-9 sm:col-span-5">
            <input
              className="input-mono"
              placeholder="SMILES"
              value={compound.smiles}
              onChange={(e) => onChange({ smiles: e.target.value })}
            />
          </div>
          <button
            type="button"
            onClick={onOpenSketcher}
            className="col-span-2 h-9 px-2 text-xs font-semibold text-delta-700 hover:text-white hover:bg-delta-600 ring-1 ring-delta-200 hover:ring-delta-600 bg-delta-50 flex items-center justify-center gap-1.5 rounded-md transition-colors dark:text-delta-300 dark:bg-delta-900/30 dark:ring-delta-700/40 dark:hover:bg-delta-600 dark:hover:text-white"
            title={compound.smiles ? "Open the structure in the 2D sketcher to edit it" : "Draw a molecule with the 2D sketcher"}
          >
            <SketchIcon size={14} />
            <span>{compound.smiles ? "Edit" : "Sketch"}</span>
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="col-span-1 h-9 text-slate-400 hover:text-loss-600 flex items-center justify-center rounded-md hover:bg-loss-50 dark:text-slate-500 dark:hover:text-loss-400 dark:hover:bg-loss-900/30 transition-colors"
            aria-label="Remove"
          >
            <Close size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Your library" picker shown above the manual compound rows in Step 3.
 *
 *  Designed to scale: with 5 entries it shows a flat pill row; with 1000
 *  it adds a search input and caps the pill area to ~3 rows tall with
 *  vertical scroll. The earlier version dumped every entry into an
 *  unbounded flex-wrap which became unusable past ~50 saved compounds.
 *  Tag filters from /compounds aren't repeated here — users who want to
 *  filter by tag jump to the management page via the "Manage" link. */
function LibraryPicker({
  savedCompounds,
  jobCompounds,
  onAdd,
  onDelete,
}: {
  savedCompounds: import("../api").UserCompound[];
  jobCompounds: CompoundRow[];
  onAdd: (sc: import("../api").UserCompound) => void;
  onDelete: (sc: import("../api").UserCompound) => void;
}) {
  const [filter, setFilter] = useState("");
  const showSearch = savedCompounds.length > 12;
  const filtered = useMemo(() => {
    if (!filter.trim()) return savedCompounds;
    const q = filter.toLowerCase();
    return savedCompounds.filter(
      (c) => c.name.toLowerCase().includes(q) || c.smiles.toLowerCase().includes(q)
              || (c.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [savedCompounds, filter]);

  return (
    <div className="mb-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800/30 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
          Your library · {savedCompounds.length}
          {filter && ` · ${filtered.length} matching`}
        </span>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-slate-400 dark:text-slate-500">
            Auto-saved when you give a compound a name
          </span>
          <Link
            to="/compounds"
            className="text-delta-600 hover:text-delta-700 dark:text-delta-400 dark:hover:text-delta-300 font-semibold"
          >
            Manage →
          </Link>
        </div>
      </div>
      {showSearch && (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter library by name, SMILES, or tag…"
          className="input w-full text-xs h-8 mb-2"
        />
      )}
      {/* Cap visible height — past ~3 rows of pills the area scrolls. With a
          flat row of 1000 pills the page used to grow forever and the rest
          of Step 3 fell off-screen. */}
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
        {filtered.map((sc) => {
          const alreadyInJob = jobCompounds.some(
            (c) => c.name.trim().toLowerCase() === sc.name.toLowerCase()
                    || c.smiles.trim() === sc.smiles,
          );
          return (
            <span
              key={sc.id}
              className={
                "group inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full text-xs transition-colors " +
                (alreadyInJob
                  ? "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                  : "bg-white text-slate-700 border border-slate-200 hover:border-delta-400 hover:text-delta-700 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:border-delta-500 dark:hover:text-delta-300")
              }
              title={alreadyInJob ? `${sc.name} is already in this job` : `Click to add ${sc.name}`}
            >
              <button
                type="button"
                disabled={alreadyInJob}
                onClick={() => onAdd(sc)}
                className="font-medium text-current disabled:cursor-not-allowed"
              >
                {alreadyInJob ? "✓ " : "+ "}{sc.name}
              </button>
              <button
                type="button"
                onClick={() => onDelete(sc)}
                className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-4 h-4 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition"
                aria-label={`Remove ${sc.name} from library`}
                title={`Remove ${sc.name} from your library`}
              >
                <Close size={10} />
              </button>
            </span>
          );
        })}
        {filter && filtered.length === 0 && (
          <span className="text-xs text-slate-500 dark:text-slate-400 italic px-1">
            No matches in your library.
          </span>
        )}
      </div>
    </div>
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
  onFixCompound,
  onOpenSketcherFor,
}: {
  err: unknown;
  onPickAlternative: (alt: AlternativePdb) => void;
  /** Called when the user clicks "Keep largest fragment" on a fragments-
   *  type compound failure. Caller swaps the row's SMILES to the
   *  largest-fragment SMILES and resets the submit error. */
  onFixCompound?: (compoundIndex: number, newSmiles: string) => void;
  /** Called when the user clicks "Open in sketcher" on a parse-type
   *  failure. Caller opens Ketcher pre-loaded with the offending SMILES. */
  onOpenSketcherFor?: (compoundIndex: number) => void;
}) {
  const apiErr = err instanceof ApiError ? err : null;
  const detail = apiErr?.detail as ValidationDetail | undefined;
  const issues = detail?.mutation_issues || [];
  const compoundIssues = detail?.invalid_compounds || [];

  // Per-compound SMILES failures get the rich layout: name + reason + the
  // offending SMILES + per-row action buttons. Keep-largest for fragments,
  // Open-in-sketcher for parse/embed failures.
  if (compoundIssues.length > 0) {
    return (
      <div className="card border-rose-300 bg-rose-50 text-rose-900 dark:bg-rose-900/15 dark:text-rose-100 dark:border-rose-700/40">
        <h3 className="text-sm font-semibold mb-1">
          {detail?.message || `${compoundIssues.length} compound${compoundIssues.length === 1 ? "" : "s"} couldn't be validated`}
        </h3>
        <p className="text-xs text-rose-800 dark:text-rose-200/80 mb-3">
          We checked each compound before submitting. Below is what we found and how to fix it. Edits to the form clear this panel.
        </p>
        <ul className="space-y-2">
          {compoundIssues.map((c) => (
            <li
              key={c.index}
              className="rounded-md bg-white/80 dark:bg-slate-900/40 border border-rose-200 dark:border-rose-700/30 p-3"
            >
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-semibold rounded bg-rose-100 text-rose-900 dark:bg-rose-800/40 dark:text-rose-100 px-1.5 py-0.5">
                  Row {c.index + 1}
                </span>
                {c.name && (
                  <span className="text-sm font-semibold text-ink dark:text-slate-100">
                    {c.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 mt-1.5">
                {c.reason}
              </p>
              {c.smiles && (
                <div className="mt-1.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all bg-slate-50 dark:bg-slate-800/60 rounded px-2 py-1">
                  {c.smiles}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {c.kind === "fragments" && c.largest_fragment && onFixCompound && (
                  <button
                    type="button"
                    onClick={() => onFixCompound(c.index, c.largest_fragment!)}
                    className="btn-primary btn-sm text-xs"
                  >
                    Keep largest fragment
                  </button>
                )}
                {(c.kind === "parse" || c.kind === "embed") && onOpenSketcherFor && (
                  <button
                    type="button"
                    onClick={() => onOpenSketcherFor(c.index)}
                    className="btn-secondary btn-sm text-xs"
                  >
                    Open in sketcher
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

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
  n, icon, title, subtitle, action, children, dataTour,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Optional data-tour="…" attribute. Used by the Doc Flask onboarding
   *  tour to anchor a speech bubble on this step's card. Stable across
   *  className refactors because we key off this attribute, not class. */
  dataTour?: string;
}) {
  return (
    <section className="card" data-tour={dataTour}>
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
