import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type CatalogMutation, type CatalogTarget, type Compound, type DockingResult, type Job, type PdbQuality } from "../api";
import SelectivityMatrix from "../components/SelectivityMatrix";
import PoseDetail from "../components/PoseDetail";
import HeroBanner from "../components/HeroBanner";
import KetcherModal from "../components/KetcherModal";
import RenamePrompt from "../components/RenamePrompt";
import LiganxAIPanel from "../components/LiganxAIPanel";
import { ArrowRight, Beaker, Spinner, Target } from "../components/Icons";
import { parseExtra } from "../lib/parseExtra";
import { jobPollingInterval } from "../lib/jobPolling";
import { usePageMeta } from "../lib/usePageMeta";
import { parseUtcDate } from "../lib/parseUtcDate";

export type Pick = { compound: Compound; variant: string; score: number; deltaWt: number | null; extra?: string | null };

/** Cell key used everywhere subset selection touches: `${compound_id}.${variant}`.
 *  The variant may legitimately contain "+" (e.g. "T790M+C797S"), so we always
 *  encode/decode through encodeURIComponent on the variant half. */
function cellKey(compoundId: number, variant: string): string {
  return `${compoundId}.${variant}`;
}
function encodeCells(keys: Set<string>): string {
  // Encode each key — only the variant contains characters that need escaping
  // (the integer compound_id never does), but encoding the whole key is safe.
  return [...keys].map((k) => encodeURIComponent(k)).join(",");
}
function decodeCells(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => decodeURIComponent(s).trim())
      .filter((s) => /^\d+\..+/.test(s)),
  );
}

export default function JobPage() {
  const { id } = useParams();
  // `id` is now a share_id (random URL-safe token) for new jobs, OR a legacy
  // integer ID for old bookmarks — backend resolves either. Pass the raw
  // string through so we don't coerce a token like "VXrA3kF9zY1" into NaN.
  const jobKey = id ?? "";
  const [pick, setPick] = useState<Pick | null>(null);
  // Track whether the current pick was auto-selected on page load or
  // explicitly clicked by the user. Used to surface a "best mutant Δ"
  // badge in the hero banner when the page just opened — clicked
  // selections shouldn't carry that label since they're user intent.
  const [selectionReason, setSelectionReason] = useState<"auto" | "user">("auto");
  // Edit & re-dock modal — opens KetcherModal pre-loaded with the
  // chosen compound's SMILES + the job's target/mutations, so chemists
  // can iterate on a structure without retyping anything. After accept
  // the user gets a RenamePrompt: if the original name exists in their
  // library they can either Update it (overwrite the saved entry) or
  // Save as new; otherwise just Save as new. Once they pick a path we
  // persist to /me/compounds AND navigate to /new with a reseed payload
  // that pre-fills target/mutations/engine so they only have to click
  // Submit. Closes the iterate-after-results loop end-to-end without
  // forcing the user to re-set anything.
  const [editingCompound, setEditingCompound] = useState<Compound | null>(null);
  const [editRename, setEditRename] = useState<{
    originalName: string;
    newSmiles: string;
  } | null>(null);
  const editNavigate = useNavigate();
  // User's saved compound library — needed so we can show the
  // "Update <name>" path in the rename prompt only when the original
  // name actually corresponds to a library entry the user owns.
  // For compounds typed inline in the original job (no library row),
  // the rename prompt only offers Save-as-new.
  const { data: editSavedCompounds } = useQuery({
    queryKey: ["my-compounds"],
    queryFn: () => api.getMyCompounds(),
    staleTime: 30 * 1000,
  });
  const editQueryClient = useQueryClient();
  const editSaveCompoundMut = useMutation({
    mutationFn: (payload: { name: string; smiles: string }) => api.saveMyCompound(payload),
    onSuccess: () => {
      editQueryClient.invalidateQueries({ queryKey: ["my-compounds"] });
    },
    // No onError here — the navigation continues even if the library
    // save hiccups (the user's primary intent is to re-dock, not to
    // file the compound). NewJobPage will surface any save error if
    // they hit the library manually.
  });

  /** Build the reseed payload + navigate to either /studio or /new
   *  with one compound row, depending on where the user came from.
   *  When ?from=studio is present in the URL (set by Studio's view ↗
   *  link in v0.49), the user expects Edit & re-dock to drop them
   *  back into the Studio cockpit with this compound preloaded for
   *  iteration — not the legacy /new form. The reseed payload shape
   *  is identical between the two routes; Studio reads it from
   *  location.state on mount the same way NewJobPage does. */
  function navigateToReseed(name: string, smiles: string) {
    if (!job) return;
    const j = job as Job & { exhaustiveness?: number; include_wt?: boolean };
    // (Studio v0.91) Always go to /studio regardless of how the user
    // got to JobPage.
    // (Studio v0.96) replaceSession=true so Studio loads ONLY this
    // compound + this job's target/mutations, not a merge with the
    // user's prior workspace. Without it, every click of Edit &
    // re-dock added the new compound on top of whatever was already
    // staged — users hit 4/10 compounds after iterating a few times
    // even though they only ever wanted one focused edit. The user
    // who wants "Studio as I left it" uses the Back to Studio link
    // instead (which still restores the full session via
    // restoreSession:true).
    editNavigate("/studio", {
      state: {
        reseed: {
          pdb_id: job.pdb_id,
          chain: job.chain,
          mutations: job.mutations,
          compounds: [{ name, smiles }],
          engine: job.engine ?? "quickvina2_gpu",
          exhaustiveness: j.exhaustiveness ?? 8,
          include_wt: j.include_wt ?? true,
          replaceSession: true,
          // (Studio v1.06) Carry the source job's share_id so Studio
          // can re-hydrate the 3D viewer + score panel + per-compound
          // results from the prior docking run. The user clicked Edit
          // & re-dock specifically to iterate on these results — losing
          // the 3D pose + scores on transit was a real complaint.
          // Studio's existing /jobs/{key} polling loop picks up
          // fullJobKey on mount and populates rows + poses (~100 ms
          // for a completed job, no UI flicker).
          sourceJobKey: job.share_id,
        },
      },
    });
  }
  // (v0.75) Used to be needed for the from=studio gate above; kept
  // around since other code paths may read it later. The reseed
  // navigation no longer consults it as of v0.91.
  const [backSearchParamsForReseed] = useSearchParams();
  void backSearchParamsForReseed;

  // Ref on the hero banner so a matrix cell click can smooth-scroll the
  // banner into view. Without this, clicking a cell at the bottom of the
  // page silently updates the 3D viewer at the top — the user sees no
  // change unless they scroll up themselves, which feels broken.
  const bannerRef = useRef<HTMLDivElement | null>(null);

  // Wrapper around setPick that records the selection origin. Pass `false`
  // for fromUser when the runner code itself sets the pick (auto-pick on
  // first load); pass true when a matrix cell click triggered it.
  // The side-by-side layout (sticky banner on the right) means the banner
  // is always visible during scroll, so we no longer need to scroll-into-
  // view on click — the action feedback is automatic. On narrow screens
  // (mobile/tablet, single-column stacked layout), we still scroll because
  // the banner is below the matrix there.
  const choosePick = (next: Pick | null, fromUser: boolean) => {
    setPick(next);
    setSelectionReason(fromUser ? "user" : "auto");
    if (fromUser && next != null) {
      // Only scroll when the sticky layout isn't active (i.e. window is
      // below the lg breakpoint, ~1024px). matchMedia is the cheap way
      // to check this without coupling to Tailwind directly.
      const isStacked =
        typeof window !== "undefined" &&
        !window.matchMedia("(min-width: 1024px)").matches;
      if (isStacked) {
        requestAnimationFrame(() => {
          bannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }
  };

  // Subset sharing — when the URL has `?cells=...`, the page renders ONLY
  // those compound × variant cells (a "curated view" the sender hand-picked).
  // Without `?cells=`, `selected` is the user's working selection that powers
  // the Share-selected button. Two distinct concepts, both live in the URL
  // and component state respectively.
  const [searchParams, setSearchParams] = useSearchParams();
  const subsetKeys = useMemo(() => decodeCells(searchParams.get("cells")), [searchParams]);
  const inSubsetView = subsetKeys.size > 0;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset working selection if the user navigates between jobs.
  useEffect(() => { setSelected(new Set()); }, [jobKey]);

  const { data: job, isLoading, error } = useQuery({
    queryKey: ["job", jobKey],
    queryFn: () => api.getJob(jobKey),
    // Polling continues past status=completed until per-cell validation
    // (ProLIF 2D map / PoseBusters / strain) has populated `result.extra`
    // — the backend flips to COMPLETED before validation lands, so
    // stopping at that flip would freeze the cached snapshot with
    // null `extra` and the 2D interaction map would never appear.
    refetchInterval: (q) => jobPollingInterval(q.state.data, 1500),
    enabled: !!jobKey,
  });

  // Pull catalog so we can find the pocket box for known targets
  const { data: catalog } = useQuery({ queryKey: ["catalog"], queryFn: api.catalog });
  const target: CatalogTarget | undefined = useMemo(
    () => catalog?.find((t) => t.pdb_id === job?.pdb_id),
    [catalog, job?.pdb_id],
  );

  // Reactive tab title — once the job loads, surface the target/PDB and
  // mutation count in the browser tab so a user with a few open jobs can
  // tell them apart at a glance. Falls back to a generic title pre-load.
  // (Job pages are noindex via robots.txt — these random share IDs have
  // no SEO value — but per-tab titles still help users.)
  const titleParts = job
    ? [
        target?.name ?? job.pdb_id,
        job.mutations.length ? job.mutations.join("/") : "WT",
        `${job.compounds.length} cmpd${job.compounds.length === 1 ? "" : "s"}`,
      ].filter(Boolean)
    : null;
  usePageMeta({
    title: titleParts ? `${titleParts.join(" · ")} · Liganx` : "Docking job · Liganx",
    description: job
      ? `Docking results for ${target?.name ?? job.pdb_id} (${job.mutations.length ? job.mutations.join(", ") : "wild-type"}) on Liganx — wild-type vs. mutant scores, 3D pose, ProLIF interactions.`
      : "Liganx docking results — wild-type vs. mutant scores, 3D pose viewer, and ProLIF interaction analysis.",
  });

  // When the URL pins a curated subset, project the job down so the matrix
  // shows ONLY the chosen cells. Filter rules:
  //   - compounds = those that have at least one selected cell
  //   - mutations = non-WT variants that appear in any selected cell
  //   - results   = only the (compound, variant) pairs in subsetKeys
  // The original `job` object is unchanged; everything below this line that
  // renders the matrix uses `viewJob`.
  const viewJob: Job | undefined = useMemo(() => {
    if (!job) return undefined;
    if (!inSubsetView) return job;
    const compoundIds = new Set<number>();
    const variants = new Set<string>();
    for (const k of subsetKeys) {
      const dot = k.indexOf(".");
      if (dot < 0) continue;
      const cid = Number(k.slice(0, dot));
      const v = k.slice(dot + 1);
      if (Number.isFinite(cid)) compoundIds.add(cid);
      variants.add(v);
    }
    const filteredCompounds = job.compounds.filter((c) => compoundIds.has(c.id));
    const filteredMutations = job.mutations.filter((m) => variants.has(m));
    const filteredResults: DockingResult[] = job.results.filter((r) =>
      subsetKeys.has(cellKey(r.compound_id, r.variant)),
    );
    return {
      ...job,
      compounds: filteredCompounds,
      mutations: filteredMutations,
      results: filteredResults,
    };
  }, [job, inSubsetView, subsetKeys]);

  // Auto-pick a default cell once the job has results. The hero banner needs
  // *something* to show on page load — without this the canvas is empty and
  // the user has to click before they see the headline 3D pose. Algorithm:
  //   1. Best mutant Δ that's NOT outside-pocket (the real selectivity story).
  //   2. If every mutant is outside-pocket, fall back to best raw mutant score.
  //   3. If no mutants at all, the best WT score.
  //   4. Skip cells with `failed` extras — those have no pose to render.
  // Re-runs when results stream in (status changes to completed) so we don't
  // get stuck on an early-arriving WT row when the better mutant Δ comes in
  // a few seconds later.
  useEffect(() => {
    if (pick != null) return;       // user already picked something — leave alone
    if (!viewJob || viewJob.results.length === 0) return;

    type Candidate = { result: DockingResult; delta: number | null; outsidePocket: boolean };
    // Build a (compound_id → WT score) map for delta computation.
    const wtByCompound = new Map<number, number>();
    for (const r of viewJob.results) {
      if (r.variant === "WT" && !parseExtra(r.extra).failure) {
        wtByCompound.set(r.compound_id, r.best_score);
      }
    }
    const candidates: Candidate[] = [];
    for (const r of viewJob.results) {
      const ext = parseExtra(r.extra);
      if (ext.failure) continue;     // failed cell has no pose
      const wt = wtByCompound.get(r.compound_id);
      const delta = r.variant !== "WT" && wt != null ? r.best_score - wt : null;
      candidates.push({
        result: r,
        delta,
        outsidePocket: r.variant !== "WT" && ext.outsidePocketA != null,
      });
    }
    if (candidates.length === 0) return;

    // Try strict ranking: most-negative non-outside-pocket Δ first.
    candidates.sort((a, b) => {
      // Prefer in-pocket mutants over outside-pocket
      if (a.outsidePocket !== b.outsidePocket) return a.outsidePocket ? 1 : -1;
      // Prefer mutants over WT (mutant Δ is the headline story)
      const aMut = a.result.variant !== "WT";
      const bMut = b.result.variant !== "WT";
      if (aMut !== bMut) return aMut ? -1 : 1;
      // Among mutants: most-negative Δ wins
      if (aMut && bMut) {
        const ad = a.delta ?? 0;
        const bd = b.delta ?? 0;
        return ad - bd;
      }
      // Among WT: best (most-negative) raw score wins
      return a.result.best_score - b.result.best_score;
    });
    const top = candidates[0];
    const compound = viewJob.compounds.find((c) => c.id === top.result.compound_id);
    if (!compound) return;
    choosePick(
      {
        compound,
        variant: top.result.variant,
        score: top.result.best_score,
        deltaWt: top.delta,
        extra: top.result.extra,
      },
      false,
    );
  }, [viewJob, pick]);

  // Build a code → metadata lookup so the matrix can show "T790M (gatekeeper —
  // 1st-gen TKI resistance)" instead of just the bare code. We merge mutations
  // from every target so user-typed mutations from a related catalog entry
  // still get a friendly subtitle.
  const mutationInfo: Record<string, CatalogMutation> = useMemo(() => {
    const out: Record<string, CatalogMutation> = {};
    if (!catalog) return out;
    for (const t of catalog) {
      for (const m of t.mutations) {
        // First definition wins; later targets are reference-only context.
        if (!out[m.code]) out[m.code] = m;
      }
    }
    return out;
  }, [catalog]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-500 dark:text-slate-400">
        <Spinner size={20} className="mr-2" /> Loading job…
      </div>
    );
  }
  // 404 deserves a real "not found" card, not a generic error blob. Anything
  // else (network, 5xx) keeps the existing inline error treatment.
  if (error) {
    const e = error as ApiError | Error;
    const is404 = e instanceof ApiError && e.status === 404;
    return (
      <div className="card max-w-xl mx-auto text-center">
        <div className="text-6xl mb-3">{is404 ? "⌕" : "⚠"}</div>
        <h1 className="text-2xl font-bold text-ink dark:text-white">
          {is404 ? `Job not found` : "Couldn't load job"}
        </h1>
        <p className="muted mt-2">
          {is404
            ? "The job may have been deleted, or this URL has a typo."
            : e.message}
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Link to="/" className="btn-secondary btn-sm">Go home</Link>
          <Link to="/studio" className="btn-primary btn-sm">Open Studio</Link>
        </div>
      </div>
    );
  }
  if (!job || !viewJob) return null;

  // Toggle a cell's membership in the working selection. No-op while the user
  // is viewing a pinned subset — they should clear the URL first to curate a
  // different view (otherwise the matrix would offer cells the URL has hidden).
  const onToggleSelect = (key: string) => {
    if (inSubsetView) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const onClearSelection = () => setSelected(new Set());
  // "Select all" picks every cell that has a real result (excluding empty /
  // pending cells). Failure cells are still selectable so users can share a
  // failure with context if they want.
  const onSelectAll = () => {
    const all = new Set<string>();
    for (const r of job.results) all.add(cellKey(r.compound_id, r.variant));
    setSelected(all);
  };
  // Drop the `?cells=...` param to return to the full matrix view.
  const onClearSubset = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("cells");
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Header
        job={job}
        selected={selected}
        inSubsetView={inSubsetView}
        subsetCount={subsetKeys.size}
      />
      {inSubsetView && (
        <div className="card flex items-center justify-between gap-3 bg-delta-50/60 ring-1 ring-delta-200/70 dark:bg-delta-900/15 dark:ring-delta-700/40">
          <div className="text-sm text-slate-700 dark:text-slate-200">
            <span className="font-semibold text-delta-700 dark:text-delta-300">
              Viewing a curated subset
            </span>{" "}
            <span className="text-slate-500 dark:text-slate-400">
              · {subsetKeys.size} cell{subsetKeys.size === 1 ? "" : "s"} from a {job.compounds.length}×{job.mutations.length + 1} matrix
            </span>
          </div>
          <button
            type="button"
            onClick={onClearSubset}
            className="text-xs font-semibold text-delta-700 dark:text-delta-300 hover:underline"
          >
            View full matrix →
          </button>
        </div>
      )}
      {job.error_message && <JobErrorCard job={job} />}

      {/* Live progress banner — stays visible until the job finishes, while the
          matrix below renders cells incrementally as each docking commits.
          Suppress in subset view: the streaming UI is misleading when most of
          the matrix has been intentionally hidden. */}
      {!inSubsetView && job.status !== "completed" && job.status !== "failed" && (
        <StreamingBanner job={job} />
      )}

      {/* Side-by-side layout for desktop (lg+): matrix + drill-down + insights
          flow in the LEFT column (~⅔ width); HeroBanner pinned sticky on the
          RIGHT (~⅓ width) so a 50-row matrix doesn't push the 3D viewer off
          screen. Below the lg breakpoint we drop back to a single column
          stacked top-to-bottom, with the banner below the matrix and the
          smooth-scroll fallback handling visibility. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
        {/* LEFT column — matrix, drill-down, insights. Stays in normal flow
            so vertical scrolling reads the way it always did. */}
        <div className="space-y-6 min-w-0">
          <SelectivityMatrix
            compounds={viewJob.compounds}
            mutations={viewJob.mutations}
            results={viewJob.results}
            mutationInfo={mutationInfo}
            onPick={(p) => choosePick(p, true)}
            isStreaming={!inSubsetView && (job.status === "running" || job.status === "pending")}
            selected={inSubsetView ? undefined : selected}
            onToggleSelect={inSubsetView ? undefined : onToggleSelect}
            onSelectAll={inSubsetView ? undefined : onSelectAll}
            onClearSelection={inSubsetView ? undefined : onClearSelection}
            currentPickKey={pick ? `${pick.compound.id}.${pick.variant}` : null}
            // Hide Edit & re-dock in subset views (the share recipient
            // doesn't own the original job state and shouldn't be encouraged
            // to fork from a curated subset). Owners on the full view get
            // the iterate loop.
            // (Studio v0.91) Edit & re-dock now ALWAYS bypasses the
            // legacy Ketcher modal and lands the user in Studio with
            // the compound preloaded. The previous from=studio gate
            // was the source of "I clicked Edit & re-dock from history
            // and got the old Sketch popup" — Studio is the canonical
            // edit destination regardless of how the user arrived at
            // JobPage.
            onEditCompound={inSubsetView ? undefined : (c) => {
              navigateToReseed(c.name ?? "", c.smiles);
            }}
          />

          {/* Deeper drill-down — interpretation paragraph, ProLIF contacts,
              2D interaction map, mutation-outside-pocket explainer. The
              banner on the right already shows the at-a-glance numbers; this
              section is the deep dive. */}
          {pick && (
            <PoseDetail
              pick={pick}
              pdbId={job.pdb_id}
              chain={job.chain}
              pocketCenter={target?.pocket.center}
              jobId={job.share_id || job.id}
              onClose={() => setPick(null)}
            />
          )}

          {/* Insights cards — scoped to the active pick when present, else
              job-wide. */}
          {viewJob.status === "completed" && <Insights job={viewJob} pick={pick} />}
        </div>

        {/* RIGHT column — 3D banner. Used to be lg:sticky so the viewer
            stayed visible while the user scrolled through PoseDetail +
            Insights on the left, but users reported it felt like only
            the bottom of the page moved (the right side appeared
            frozen). Dropped the sticky so both columns scroll together
            as one unit, matching the Suite popup behavior. The
            scroll-mt-24 is kept so smooth-scrolls into this anchor
            (cell click → scroll to viewer) clear the page's sticky
            top header. */}
        <div ref={bannerRef} className="scroll-mt-24">
          <HeroBanner
            pick={pick}
            pdbId={job.pdb_id}
            chain={job.chain}
            pocketCenter={target?.pocket.center}
            jobId={job.share_id || job.id}
            selectionReason={selectionReason}
          />
        </div>
      </div>
      {/* Edit & re-dock modal — owned by JobPage so the iterate loop
          works without forcing the user back to /new just to swap one
          atom. On accept we hand off to the RenamePrompt below (rather
          than navigating immediately) so the user gets the same
          Update-vs-Save-as-new choice as in NewJobPage Step 3. */}
      {editingCompound && (
        <KetcherModal
          // Pass the compound's database id so KetcherModal's draft-recovery
          // key is unique per compound (`liganx_draft:<id>:<pdb>:<muts>`).
          // Without this, compoundId fell back to "new" and collided with
          // the slot the user wrote when they originally drew the parent
          // in NewJobPage — so clicking "Edit & re-dock" on a variant
          // restored the parent's draft instead of loading the variant's
          // SMILES. (2026-05-05 user-reported bug: variant
          // Aspirin_v2_may5_126 opened with plain aspirin in the canvas.)
          compoundId={editingCompound.id}
          compoundName={editingCompound.name}
          initialSmiles={editingCompound.smiles}
          targetPdb={job.pdb_id}
          mutations={job.mutations.join(", ") || undefined}
          onClose={() => setEditingCompound(null)}
          onAccept={(newSmiles, unchanged) => {
            const original = editingCompound;
            setEditingCompound(null);
            if (unchanged || !original) return;
            // Hand off to the RenamePrompt to collect the user's
            // intent (Update existing library entry vs Save as a new
            // compound) before persisting + navigating.
            setEditRename({
              originalName: original.name ?? "",
              newSmiles,
            });
          }}
          // Promote-to-Full-Job: navigate to /new with the current
          // canvas SMILES and the job's target / mutations / engine
          // pre-filled. Without this, KetcherModal falls into its
          // legacy fallback (onAccept + onClose + navigate inline)
          // which silently fails when the parent page's onAccept
          // opens its own RenamePrompt — the rename-popup state
          // races React's batched unmount and the navigate gets
          // swallowed. 2026-05-04 user report: "I am unable to click
          // promote to full job. nothing happens." Fix: bypass the
          // rename popup entirely (promote is a navigate intent, not
          // a save-to-library intent — Step 3 on NewJobPage already
          // lets the user rename the row before submit) and call
          // navigateToReseed directly with the original compound's
          // name carried forward.
          onPromote={(newSmiles) => {
            const original = editingCompound;
            setEditingCompound(null);
            navigateToReseed(original?.name ?? "", newSmiles);
          }}
        />
      )}
      {/* Rename + persist + navigate — shows a clear two-path choice:
          1. Update <name> in your library  (only when the original name
             matches a library entry; emerald primary button)
          2. Save as a new compound          (collect a unique name)
          Either way we save to /me/compounds and then navigate to /new
          with the reseed payload, so the user only has to click Submit
          on the new-job page. */}
      {editRename && (
        <RenamePrompt
          initialName={(editRename.originalName || "edited") + "_v2"}
          existingNames={(editSavedCompounds ?? []).map((c) => c.name)}
          currentRowName={editRename.originalName}
          title="Save your edit & re-dock"
          subtitle={
            <>
              You modified <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{editRename.originalName || "this compound"}</span>.
              Update the saved entry in your library, or save as a new compound. Either way the next page pre-fills the same target / mutations / engine — just click Submit.
            </>
          }
          // Overwrite path — only offered when the original name is
          // actually in the user's library. Updates the row in place
          // and navigates with the same name carried forward.
          onOverwrite={
            editRename.originalName &&
            (editSavedCompounds ?? []).some(
              (c) => c.name.toLowerCase() === editRename.originalName.toLowerCase(),
            )
              ? () => {
                  const name = editRename.originalName;
                  editSaveCompoundMut.mutate({ name, smiles: editRename.newSmiles });
                  setEditRename(null);
                  navigateToReseed(name, editRename.newSmiles);
                }
              : undefined
          }
          onCancel={() => {
            // Bailing drops the edit entirely — the user's canvas
            // SMILES is gone but their original docking row is
            // untouched. Deliberate: cancel = don't change anything.
            setEditRename(null);
          }}
          onSave={(newName) => {
            editSaveCompoundMut.mutate({ name: newName, smiles: editRename.newSmiles });
            setEditRename(null);
            navigateToReseed(newName, editRename.newSmiles);
          }}
        />
      )}
      {/* Liganx AI Beta — floating Q&A panel scoped to this job's data.
          Mounted at the page root (sibling to the grid) so the FAB
          stays anchored to the viewport rather than scrolling with
          the content. The backend snapshots whichever results are in
          the DB at click-time, so partial / streaming jobs answer
          questions about what's loaded so far. */}
      <LiganxAIPanel jobKey={jobKey} />
    </div>
  );
}

/* ─── Header ────────────────────────────────────────────────────────── */

/** Convert RCSB's all-caps protein descriptions ("HEPATOCYTE GROWTH FACTOR
 *  RECEPTOR") into Title Case ("Hepatocyte Growth Factor Receptor"). Lowercases
 *  short connecting words ("of", "the", "and", "to", etc.) so it reads
 *  naturally rather than looking like a movie title. Already-mixed-case names
 *  pass through untouched. */
function prettifyProtein(name: string): string {
  if (!name) return name;
  // Already mixed-case (>= 1 lowercase letter present)? Leave as is — RCSB
  // sometimes returns "Hepatocyte growth factor receptor" already.
  if (/[a-z]/.test(name)) return name;
  const small = new Set(["of", "the", "and", "to", "in", "for", "with", "a", "an"]);
  return name
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part, i) => {
      if (/^\s+$/.test(part) || part === "-") return part;
      // Roman numerals + Greek letters stay upper.
      if (/^(i{1,3}|iv|vi{0,3}|i?x)$/i.test(part)) return part.toUpperCase();
      if (i > 0 && small.has(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

/**
 * JobErrorCard — failed-job banner with one-click Re-run + Report buttons.
 *
 * Replaces the previous read-only error block. The Re-run path mirrors
 * HistoryPage.onRerunClick (task #298): navigates to /new with a reseed
 * payload in router state so NewJobPage pre-fills target/mutations/
 * compounds/engine/exhaustiveness/include_wt and the user just clicks
 * Submit. The Report path POSTs a free-form comment + job context to
 * /jobs/{share_id}/report; the backend forwards to our Telegram bot so
 * we get a push notification on every user-reported issue.
 */
function JobErrorCard({ job }: { job: Job }) {
  const navigate = useNavigate();
  const [reportOpen, setReportOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [reportErr, setReportErr] = useState<string | null>(null);

  function onRerunClick() {
    // Same reseed shape as HistoryPage so Studio's reseed handler
    // (which the legacy NewJobPage handler was forked into) picks it
    // up unchanged. Fields that aren't on Job (e.g. exhaustiveness,
    // include_wt) are read defensively; cast to a partial type to
    // satisfy strict TS without a backend round-trip.
    const j = job as Job & { exhaustiveness?: number; include_wt?: boolean };
    navigate("/studio", {
      state: {
        reseed: {
          pdb_id: job.pdb_id,
          chain: job.chain,
          mutations: job.mutations,
          compounds: job.compounds.map((c) => ({ name: c.name ?? "", smiles: c.smiles })),
          engine: job.engine ?? "quickvina2_gpu",
          exhaustiveness: j.exhaustiveness ?? 8,
          include_wt: j.include_wt ?? true,
        },
      },
    });
  }

  async function onReportSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = comment.trim();
    if (trimmed.length < 1) {
      setReportErr("Please add a short note before sending.");
      return;
    }
    setReportStatus("sending");
    setReportErr(null);
    try {
      await api.reportJob(job.share_id, trimmed);
      setReportStatus("sent");
      // Auto-collapse after a beat so the user sees the confirmation
      // and the page returns to its normal layout.
      window.setTimeout(() => {
        setReportOpen(false);
        setReportStatus("idle");
        setComment("");
      }, 1800);
    } catch (err) {
      setReportStatus("error");
      setReportErr(err instanceof ApiError ? err.message : "Couldn't send. Please try again.");
    }
  }

  return (
    <div className="card border-loss-300 bg-loss-50 text-loss-700 dark:bg-loss-900/20 dark:text-loss-300 dark:border-loss-700/40 text-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="font-semibold mb-1">Job failed</div>
          <div className="leading-relaxed break-words">{job.error_message}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRerunClick}
            className="inline-flex items-center gap-1.5 rounded-md bg-loss-700 hover:bg-loss-800 dark:bg-loss-600 dark:hover:bg-loss-500 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
            title="Open the new-job form pre-filled with this job's settings"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.7 9.7 0 0 0-7 3l-2 2" />
              <path d="M3 4v6h6" />
            </svg>
            Re-run
          </button>
          <button
            type="button"
            onClick={() => setReportOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-loss-300 dark:border-loss-700/60 bg-white/60 dark:bg-loss-900/30 hover:bg-white dark:hover:bg-loss-900/50 text-loss-700 dark:text-loss-300 text-xs font-semibold px-3 py-1.5 transition-colors"
            title="Tell us what went wrong — sends to our team"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M3 5h18v10H8l-5 5z" />
            </svg>
            {reportOpen ? "Cancel" : "Report issue"}
          </button>
        </div>
      </div>

      {/* Inline report form — collapses below the error message. We
          deliberately don't use a modal here because (a) modals on the
          JobPage are already used by the pose detail panel and we want
          to avoid stacking, and (b) the inline pattern feels lighter
          for a quick text comment. */}
      {reportOpen && (
        <form onSubmit={onReportSubmit} className="mt-4 pt-4 border-t border-loss-200 dark:border-loss-700/40">
          {reportStatus === "sent" ? (
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Thanks — we got your report and will look at it.
            </div>
          ) : (
            <>
              <label htmlFor="report-comment" className="block text-xs font-semibold text-loss-800 dark:text-loss-200 mb-1.5">
                What happened? (anything helps — what you were trying to do, what you saw, what surprised you)
              </label>
              <textarea
                id="report-comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={reportStatus === "sending"}
                maxLength={2000}
                className="w-full rounded-md border border-loss-300 dark:border-loss-700/60 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-ink dark:text-slate-100 placeholder-slate-400 focus:border-loss-500 focus:ring-1 focus:ring-loss-500 outline-none resize-y"
                placeholder="The job stayed on 'Fetching protein structure' for 5 minutes…"
              />
              <div className="flex items-center justify-between mt-2">
                <div className="text-[11px] text-loss-700/80 dark:text-loss-300/70">
                  Sent privately to the Liganx team along with this job's details.
                </div>
                <button
                  type="submit"
                  disabled={reportStatus === "sending" || comment.trim().length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md bg-loss-700 hover:bg-loss-800 disabled:bg-loss-300 dark:disabled:bg-loss-900/40 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-1.5 transition-colors"
                >
                  {reportStatus === "sending" ? (
                    <><Spinner size={12} /> Sending…</>
                  ) : (
                    "Send report"
                  )}
                </button>
              </div>
              {reportErr && (
                <div className="mt-2 text-[11px] text-loss-800 dark:text-loss-200">{reportErr}</div>
              )}
            </>
          )}
        </form>
      )}
    </div>
  );
}

function Header({
  job, selected, inSubsetView, subsetCount,
}: {
  job: Job;
  selected: Set<string>;
  inSubsetView: boolean;
  subsetCount: number;
}) {
  // Look up the protein name for non-uploaded PDBs. The endpoint is cheap and
  // backend-cached for 24h, so this fires once per session per PDB. Uploads
  // (USR_*) skip the call — there's no RCSB entry to resolve.
  const isUpload = job.pdb_id.startsWith("USR_");
  const { data: pdbInfo } = useQuery({
    queryKey: ["pdb-info", job.pdb_id],
    queryFn: () => api.pdbInfo(job.pdb_id),
    enabled: !isUpload,
    staleTime: 24 * 3600 * 1000, // 24h — same as backend cache
    retry: 1,
  });
  const proteinLabel = pdbInfo?.protein ? prettifyProtein(pdbInfo.protein) : null;

  // (v0.49) Back-link target. Studio's "view ↗" link passes
  // ?from=studio so we can offer a single-click return path back to
  // the cockpit instead of forcing the user through History.
  const [backSearchParams] = useSearchParams();
  const backFrom = backSearchParams.get("from");
  const backHref = backFrom === "studio" ? "/studio" : "/history";
  const backLabel = backFrom === "studio" ? "Back to Studio" : "Back to history";

  return (
    <header className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        {/* (v0.79) When the user came from Studio, pass restoreSession
            in router state so Studio rehydrates the prior workspace
            on this navigation specifically. Direct visits to /studio
            (typing the URL or clicking the header nav) keep showing
            the empty cockpit; only this Back link triggers restore. */}
        <Link
          to={backHref}
          state={backFrom === "studio" ? { restoreSession: true } : undefined}
          className="text-xs text-slate-500 hover:text-delta-600 dark:text-slate-400 dark:hover:text-delta-400 inline-flex items-center gap-1"
        >
          <ArrowRight size={11} className="rotate-180" /> {backLabel}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink dark:text-slate-100 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-delta-700 dark:text-delta-300">{job.pdb_id}</span>
          {proteinLabel && (
            <span
              className="text-base font-semibold text-slate-700 dark:text-slate-200"
              title={pdbInfo?.title}
            >
              {proteinLabel}
            </span>
          )}
          <span className="text-sm font-normal text-slate-500 dark:text-slate-400">chain {job.chain}</span>
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Stat icon={<Target />} label="Compounds" value={job.compounds.length} />
          <Stat icon={<Beaker />} label="Variants" value={job.mutations.length + 1} hint={["WT", ...job.mutations].join(", ")} />
          <EnginePill engine={job.engine} />
          {/* Click-to-copy job ID pill. Replaces the previous Stat-only
              "Job #N" label with an interactive version so the user can
              copy the ID straight into a support message. Same component
              used by HistoryPage so both surfaces match. 2026-05-04. */}
          <JobIdCopyPill jobId={job.id} />
          <PdbQualityBadge quality={job.pdb_quality} />
        </div>
      </div>
      <div className="flex items-center gap-2 sm:flex-col sm:items-end">
        <StatusPill status={job.status} />
        <div className="flex items-center gap-2">
          <CancelButton job={job} />
          <ShareButton job={job} selected={selected} inSubsetView={inSubsetView} subsetCount={subsetCount} />
        </div>
      </div>
    </header>
  );
}

/** Share button — copies a shareable URL to clipboard. On mobile, tries the
 *  native Web Share sheet first. The URL shape changes with context:
 *
 *    - In subset view (`?cells=...` already in URL): share the same subset URL.
 *    - With cells selected: share `/jobs/{id}?cells=...` so the receiver lands
 *      on a curated view of just those cells.
 *    - With nothing selected: share the full job URL.
 *
 *  The button label flips to "Share N" when there's a selection so the user
 *  can see at a glance what they're about to share. */
function ShareButton({
  job, selected, inSubsetView, subsetCount,
}: {
  job: Job;
  selected: Set<string>;
  inSubsetView: boolean;
  subsetCount: number;
}) {
  const [copied, setCopied] = useState(false);

  // Effective scope for this share:
  //   - inSubsetView    → re-share the curated URL the user is currently looking at
  //   - selected.size>0 → share that specific selection
  //   - else            → share the full job
  const isSubset = inSubsetView || selected.size > 0;
  const effectiveCount = inSubsetView ? subsetCount : selected.size;

  async function onShare() {
    // Always build the URL from share_id so we never accidentally share the
    // legacy integer ID (which is guessable by anyone who can count).
    const base = `${window.location.origin}/jobs/${job.share_id || job.id}`;
    let url = base;
    if (inSubsetView) {
      // Preserve whatever ?cells= the URL already encodes.
      url = `${base}?${window.location.search.replace(/^\?/, "")}`;
    } else if (selected.size > 0) {
      url = `${base}?cells=${encodeCells(selected)}`;
    }

    // The compound × variant headline auto-generated below makes for a
    // nice native-share preview when the user picks Mail / Messages / etc.
    const compoundList = job.compounds.map((c) => c.name || "compound").slice(0, 2).join(" + ");
    const variantList = ["WT", ...job.mutations].slice(0, 3).join(" / ");
    const title = isSubset
      ? `Liganx · ${effectiveCount} curated cell${effectiveCount === 1 ? "" : "s"} from ${job.pdb_id}`
      : `Liganx · ${compoundList} vs ${job.pdb_id}`;
    const text = isSubset
      ? `A curated view of ${effectiveCount} docking${effectiveCount === 1 ? "" : "s"} on ${job.pdb_id} — mutation-aware results on Liganx.`
      : `${compoundList} docked against ${job.pdb_id} (${variantList}). Mutation-aware results on Liganx.`;

    // Try the native Web Share API first — best UX on mobile + supported
    // browsers, gracefully falls back to clipboard copy elsewhere.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // User cancelled or share unsupported — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Old-browser fallback: temporary input + execCommand
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* give up */ }
      document.body.removeChild(ta);
    }
  }

  const label = isSubset
    ? `Share ${effectiveCount}`
    : "Share";
  const titleAttr = copied
    ? "Link copied to clipboard"
    : isSubset
      ? `Copy a link that shows just ${effectiveCount} curated cell${effectiveCount === 1 ? "" : "s"}`
      : "Copy a shareable link to this job";

  return (
    <button
      type="button"
      onClick={onShare}
      title={titleAttr}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors ${
        copied
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:ring-emerald-700/50"
          : isSubset
            ? "bg-delta-600 text-white ring-delta-700 hover:bg-delta-700 dark:bg-delta-500 dark:ring-delta-400/40 dark:hover:bg-delta-400"
            : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 hover:text-delta-700 hover:ring-delta-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700 dark:hover:text-delta-300 dark:hover:ring-delta-600"
      }`}
    >
      {copied ? (
        <>
          <span aria-hidden>✓</span> Copied
        </>
      ) : (
        <>
          {/* Inline link/share icon — keeps us off another icon dependency */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

/** Click-to-copy job-ID pill. Same idea as HistoryPage's JobIdPill but
 *  styled to fit the JobPage header's badge row. Click → "#NNN" copies to
 *  clipboard, brief "Copied!" flash so the user knows it worked, idle
 *  state shows the bare ID. The user can paste this number straight into
 *  a support message ("issue with job #145") instead of reading it off
 *  the URL. 2026-05-04 user request — same data already on every job
 *  via the Job.id auto-increment PK, present on old AND new rows. */
function JobIdCopyPill({ jobId }: { jobId: number | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (jobId == null) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(`#${jobId}`).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }).catch(() => { /* clipboard unavailable — id is still readable */ });
      }}
      title={copied ? "Copied!" : `Job #${jobId} — click to copy. Share this when reporting an issue.`}
      className={
        "badge ring-1 ring-inset transition-colors cursor-pointer " +
        (copied
          ? "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-800/40"
          : "bg-slate-100 text-slate-700 ring-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700")
      }
    >
      {copied ? (
        <>Copied!</>
      ) : (
        <>
          <span className="text-slate-500 dark:text-slate-400">Job</span>{" "}
          <span className="font-mono font-semibold">#{jobId}</span>
        </>
      )}
    </button>
  );
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number; hint?: string }) {
  return (
    <span
      className="badge bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
      title={hint}
    >
      {icon} <span className="text-slate-500 dark:text-slate-400">{label}:</span> <span className="font-semibold">{value}</span>
    </span>
  );
}

/** Engine pill — surfaces which scoring backend produced this job's results.
 *  Three engines today: QuickVina2-GPU (Vina-family physics, default), GNINA
 *  (Vina + CNN pose rescoring), Boltz-2 (full ML co-folding + affinity head).
 *  Tone is engine-specific so users can spot at a glance which method ran —
 *  the scores are not directly comparable across engines (kcal/mol vs
 *  log10(IC50)) so making the engine visible is correctness, not decoration. */
export function EnginePill({ engine }: { engine?: string | null }) {
  const e = engine ?? "quickvina2_gpu";
  let label: string;
  let cls: string;
  if (e === "boltz2" || e.startsWith("boltz2")) {
    label = "Boltz-2 (ML)";
    cls = "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/40";
  } else if (e === "gnina") {
    label = "GNINA (CNN)";
    cls = "bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:ring-violet-700/40";
  } else {
    label = "QuickVina2-GPU";
    cls = "bg-sky-100 text-sky-800 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-700/40";
  }
  return (
    <span
      className={`badge ring-1 ring-inset ${cls}`}
      title={`Docking engine: ${label}. Scores from different engines are not directly comparable.`}
    >
      <span className="text-current/70 mr-1">Engine:</span>
      <span className="font-semibold">{label}</span>
    </span>
  );
}

/** PDB-quality badge: surfaces the cross-docking sanity check.
 *  - valid       (RMSD < 2 Å)  → green; pocket geometry trustworthy
 *  - uncertain   (2-4 Å)       → amber; docked in the right neighborhood
 *  - questionable (> 4 Å)      → rose; pocket likely mis-defined
 *  - null                      → no badge (background check still pending,
 *                                or apo structure with no co-crystal ligand) */
function PdbQualityBadge({ quality }: { quality?: PdbQuality | null }) {
  if (!quality) return null;
  const tone =
    quality.verdict === "valid"
      ? "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/40"
      : quality.verdict === "uncertain"
        ? "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-700/40"
        : "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-700/40";
  const label =
    quality.verdict === "valid"
      ? "Pocket validated"
      : quality.verdict === "uncertain"
        ? "Pocket uncertain"
        : "Pocket questionable";
  const tip =
    `Cross-docking sanity check: re-docked the bound ${quality.ligand_resname} ligand and ` +
    `compared the docked pose to the original crystal pose. RMSD = ${quality.rmsd_angstroms.toFixed(2)} Å. ` +
    `Industry threshold: <2 Å valid, 2-4 Å uncertain, >4 Å questionable.`;
  return (
    <span
      title={tip}
      className={`badge ring-1 ring-inset ${tone}`}
    >
      <span aria-hidden>✓</span> {label} · <span className="font-semibold">{quality.rmsd_angstroms.toFixed(2)} Å</span>
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, { bg: string; dot: string; label: string }> = {
    pending:   { bg: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",       dot: "bg-slate-400 dark:bg-slate-500", label: "Pending" },
    running:   { bg: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",     dot: "bg-amber-500 animate-pulse-soft", label: "Running" },
    completed: { bg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300", dot: "bg-emerald-500", label: "Completed" },
    failed:    { bg: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",         dot: "bg-rose-500", label: "Failed" },
    cancelled: { bg: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",       dot: "bg-slate-400", label: "Cancelled" },
  };
  const s = styles[status] ?? styles.pending;
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${s.bg}`}>
      <span className={`w-2 h-2 rounded-full ${s.dot}`} /> {s.label}
    </span>
  );
}

/**
 * Cancel button — visible only while a job is in flight (pending/running).
 * Hits POST /jobs/{share_id}/cancel which sets status=CANCELLED. The runner
 * checks this between cells and bails out — currently in-flight Pod GPU
 * call (~3 s) finishes, no further cells dispatch. Idempotent on terminal
 * statuses, so a stale click won't error.
 */
function CancelButton({ job }: { job: Job }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const cancelMut = useMutation({
    mutationFn: () => api.cancelJob(job.share_id || job.id),
    onSuccess: () => {
      // Force the JobPage's polling query to refetch immediately so the
      // status flips to "cancelled" without waiting for the next 3 s tick.
      queryClient.invalidateQueries({ queryKey: ["job", job.share_id || String(job.id)] });
      setConfirming(false);
    },
  });

  // Only show for in-flight states. Once a job is terminal there's nothing
  // to cancel and the button would be misleading.
  if (job.status !== "pending" && job.status !== "running") return null;

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => cancelMut.mutate()}
          disabled={cancelMut.isPending}
          className="text-xs font-semibold px-2.5 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-60"
        >
          {cancelMut.isPending ? "Cancelling…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs px-2 py-1 rounded-md text-slate-500 hover:text-ink dark:hover:text-slate-100"
        >
          Keep
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      title="Cancel this job. The currently in-flight cell finishes (~3 s); no further cells run."
      className="text-xs font-semibold px-2.5 py-1 rounded-md bg-white text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50 dark:bg-slate-800 dark:text-rose-300 dark:ring-rose-800/40 dark:hover:bg-rose-900/20 transition-colors"
    >
      Cancel
    </button>
  );
}

/* ─── Streaming banner shown above the matrix while results arrive ─── */

/** Pre-flight stages the runner walks through before the first cell finishes
 *  and the matrix can fill in. The bar used to sit at 0% for ~30-60s while
 *  the receptor was being fetched + cleaned + the WT/mutant structures
 *  built — felt like the system was stuck. We now animate a small "phantom
 *  progress" through these stages based on elapsed time + engine, so the
 *  user sees concrete activity from the moment they hit Run.
 *
 *  Stage timings are CALIBRATED against typical Fly + Pod-warm runs (we
 *  don't try to be exact — just plausible enough that the active step
 *  matches what's roughly happening). A stage transitions to the next
 *  when (a) elapsed time exceeds its budget, or (b) the runner has
 *  written its first DocketResult row (which means docking actually
 *  started — we've moved past pre-flight regardless of the timer).
 *
 *  Engine differences worth noting:
 *  - Vina/GNINA: extra "Building mutants" stage when mutations are
 *    requested (FoldX/PDBFixer adds 5-10s per mutation).
 *  - Boltz-2: skips receptor PDBQT prep + mutant builds (the model
 *    consumes a sequence + applies the substitution at the input
 *    layer), but each cell takes ~130s vs Vina's ~3-5s — so the
 *    "Docking" stage spends most of its time with very few cells
 *    visible. That's a real trade-off, not a bug. */
interface Stage {
  key: string;
  label: string;
  /** Estimated cumulative time in seconds at the END of this stage.
   *  The active stage is the FIRST one whose budget the elapsed time
   *  hasn't exceeded yet (and where cells haven't started landing). */
  budgetS: number;
}

/** Translate a runner-emitted stage slug into a friendly UI label.
 *  Returns null for slugs we don't recognize so the caller can fall back
 *  to timing-driven stage detection. The runner prefers short snake_case
 *  slugs so we can add new stages without renegotiating with the
 *  frontend; the friendly labels live entirely on this side. */
function labelForStageSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  if (slug === "fetching_pdb") return "Fetching protein structure";
  if (slug === "cleaning_pdb") return "Cleaning structure (PDBFixer)";
  if (slug === "preparing_receptor") return "Preparing receptor (Meeko)";
  if (slug === "preparing_compounds") return "Preparing compounds (Meeko)";
  if (slug === "extracting_sequence") return "Extracting protein sequence";
  if (slug === "validating_poses") return "Validating poses (PoseBusters / ProLIF)";
  // Pattern-based slugs:
  let m = slug.match(/^building_mutant_(.+)$/);
  if (m) return `Building mutant receptor (${m[1]})`;
  m = slug.match(/^docking_(\d+)_of_(\d+)$/);
  if (m) return `Docking · ${m[1]} of ${m[2]}`;
  m = slug.match(/^predicting_(\d+)_of_(\d+)$/);
  if (m) return `Predicting complex (Boltz-2) · ${m[1]} of ${m[2]}`;
  return null;
}

function preflightStages(job: Job): Stage[] {
  const isBoltz2 = (job.engine ?? "").startsWith("boltz2");
  const hasMutations = job.mutations.length > 0;
  if (isBoltz2) {
    // Boltz-2 path: fetch → clean → extract sequence → predict.
    // The model handles mutations at its input layer so there's no
    // separate "Building mutants" stage.
    return [
      { key: "fetch",   label: "Fetching protein structure",  budgetS: 6 },
      { key: "clean",   label: "Cleaning structure (PDBFixer)", budgetS: 16 },
      { key: "seq",     label: "Extracting sequence",          budgetS: 20 },
      { key: "predict", label: "Predicting complex (Boltz-2 ML)", budgetS: 25 },
    ];
  }
  // Vina/GNINA path: more pre-flight stages because we have to build
  // PDBQT receptors + (optionally) FoldX mutants before docking can
  // start.
  const stages: Stage[] = [
    { key: "fetch",    label: "Fetching protein structure",        budgetS: 6 },
    { key: "clean",    label: "Cleaning structure (PDBFixer)",     budgetS: 16 },
    { key: "receptor", label: "Preparing receptor (Meeko)",        budgetS: 24 },
  ];
  if (hasMutations) {
    // Each mutation adds ~5s of build time (PDBFixer applyMutations +
    // optional OpenMM minimisation), so widen the budget proportionally.
    const mutBudget = 24 + Math.min(20, 5 * job.mutations.length);
    stages.push({ key: "mutants", label: "Building mutant receptors", budgetS: mutBudget });
  }
  stages.push({ key: "ligand", label: "Preparing compounds (Meeko)", budgetS: (stages[stages.length - 1].budgetS) + 6 });
  return stages;
}

function StreamingBanner({ job }: { job: Job }) {
  const total = job.compounds.length * (job.mutations.length + 1);
  const done = job.results.length;
  // Tick 1×/sec so the elapsed-driven stage indicator and phantom
  // progress are smooth without re-rendering the whole tree on every
  // frame. Hard cap so we don't keep updating once docking actually
  // starts (cell-driven progress takes over then).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (job.status !== "running" && job.status !== "pending") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [job.status]);
  // Backend timestamps are bare UTC ISO strings (no Z). parseUtcDate
  // appends Z so the elapsed-time math doesn't get an offset error
  // — without it the running-banner stage stepper drifts by hours.
  const elapsedS = Math.max(0, (now - parseUtcDate(job.created_at).getTime()) / 1000);

  // ── Stage detection ────────────────────────────────────────────────
  // PREFER the backend-emitted stage slug when available — it's the
  // ground truth ('the runner is currently in step X'). Fall back to
  // timing + cell-count heuristics for legacy jobs that pre-date the
  // job.stage column or when the runner hasn't written a slug yet
  // (very early in the job, before the first set_stage call lands).
  const stages = preflightStages(job);
  const allCellsDone = total > 0 && done >= total;
  const validatingOnly = allCellsDone && job.status === "running";
  const dockingActive = done > 0 && !allCellsDone;
  const backendLabel = labelForStageSlug(job.stage);
  let stageLabel: string;
  if (backendLabel) {
    // Backend has spoken — trust it.
    stageLabel = backendLabel;
  } else if (validatingOnly) {
    stageLabel = "Validating poses (PoseBusters / ProLIF)";
  } else if (dockingActive) {
    stageLabel = `Docking · ${done} of ${total} done`;
  } else {
    // Pre-flight: pick first stage whose budget hasn't been exceeded.
    const idx = stages.findIndex((s) => elapsedS < s.budgetS);
    const stage = idx >= 0 ? stages[idx] : stages[stages.length - 1];
    stageLabel = stage.label;
  }

  // ── Progress bar percentage ────────────────────────────────────────
  // Three-phase model so the bar ALWAYS feels alive:
  //   Phase 1 — pre-flight (0–15%):    eases in over the estimated
  //             pre-flight time so the user sees movement immediately.
  //   Phase 2 — docking   (15–95%):    driven by cells done / total.
  //   Phase 3 — validate  (95–100%):   small final step once docking
  //             ends and we're waiting on the deferred validation pass.
  const preflightTotal = stages[stages.length - 1].budgetS;
  const realPct = total === 0 ? 0 : (done / total) * 80; // 80, not 85, leaves headroom for validation
  const phantomPct = Math.min(15, (elapsedS / preflightTotal) * 15);
  let pct: number;
  if (validatingOnly) {
    pct = 95;
  } else if (dockingActive) {
    pct = Math.max(15, 15 + realPct);
  } else {
    pct = phantomPct;
  }
  const pctLabel = Math.round(pct);

  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-3">
        <Spinner size={16} className="text-delta-600 dark:text-delta-400" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-ink dark:text-slate-100 text-sm">
            {job.status === "pending" ? "Queued for execution" : stageLabel}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {dockingActive || validatingOnly
              ? `${done} of ${total} dockings complete · cells fill in below as each pose finishes`
              : `Setting up — ${total} docking${total === 1 ? "" : "s"} queued · usually under a minute before the first result`}
          </div>
        </div>
        <span className="text-sm font-semibold text-delta-600 dark:text-delta-300 tabular-nums">{pctLabel}%</span>
      </div>

      {/* Stage chip stepper REMOVED 2026-04-30 — the chips were stuck on
          "Fetching protein structure" because the backend job.stage column
          isn't populated in production (migration 004 not applied), and the
          timing-driven fallback was misleading enough that users read the
          stuck chip as "the job is broken". Headline label + percentage +
          progress bar are enough; the matrix below shows real per-cell
          progress as soon as docking starts. Re-introduce stepper only if
          we ever reliably receive backend stage updates AND know they're
          accurate. */}

      <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-delta-500 to-accent-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ─── Insights bar (under the matrix) ──────────────────────────────── */

type Insight = { tag: string; tone: "good" | "bad" | "neutral"; body: string };

export function Insights({
  job,
  pick,
  compact = false,
}: {
  job: Job;
  pick: Pick | null;
  /** When true, force a single-column stack regardless of viewport. Used
   *  inside the Suite page detail rail (~400 px wide) where the default
   *  `lg:grid-cols-3` would crush each card to ~120 px and wrap every
   *  word onto its own line. The parent's container width can't be read
   *  with Tailwind viewport breakpoints (which key on the window, not
   *  the container), so callers opt in explicitly. */
  compact?: boolean;
}) {
  // When the user has selected a cell, the cards reshape to describe that
  // specific compound × variant. Otherwise, fall back to the job-wide summary.
  const { insights, scope } = useMemo(
    () => pick
      ? { insights: computePickInsights(job, pick), scope: pickName(pick) }
      : { insights: computeJobInsights(job), scope: "job summary" },
    [job, pick],
  );
  if (insights.length === 0) return null;
  // In compact mode, always single-column. In normal mode, the default
  // responsive ladder: 1 col on phones → 2 on tablets → 3 on desktops.
  const gridCls = compact
    ? "grid grid-cols-1 gap-3"
    : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3";
  return (
    <div className="mt-5">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-2">
        {pick ? `Insights for ${scope}` : "Job summary"}
      </div>
      <div className={gridCls}>
        {insights.map((ins, i) => (
          <div key={i} className="card">
            <div className={`badge mb-2 ${
              ins.tone === "good" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" :
              ins.tone === "bad"  ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" :
                                    "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}>
              {ins.tag}
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{ins.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function pickName(pick: Pick): string {
  const compound = pick.compound.name ?? `Compound #${pick.compound.id}`;
  return `${compound} × ${pick.variant}`;
}

/** Job-wide stats — shown when nothing is picked. */
function computeJobInsights(job: Job): Insight[] {
  const out: Insight[] = [];
  const byCompound: Record<number, Record<string, number>> = {};
  for (const r of job.results) {
    byCompound[r.compound_id] ??= {};
    byCompound[r.compound_id][r.variant] = r.best_score;
  }
  // Best mutant-selective compound (lowest delta)
  let bestSel: { name: string; variant: string; delta: number } | null = null;
  // Worst resistance hit (largest positive delta)
  let worstRes: { name: string; variant: string; delta: number } | null = null;
  // Build a (compound_id, variant) → outsidePocket lookup so we can skip
  // outside-pocket cells when picking the best selectivity / worst resistance
  // headlines. Δ values for outside-pocket cells are method noise (PDBFixer
  // local relaxation + QuickVina-GPU stochastic search), not biology — if we
  // included them in the headlines, we'd be confidently announcing fake
  // selectivity/resistance signals.
  const outsidePocketKey = new Set<string>();
  for (const r of job.results) {
    if (r.variant === "WT") continue;
    if (parseExtra(r.extra).outsidePocketA != null) {
      outsidePocketKey.add(`${r.compound_id}|${r.variant}`);
    }
  }
  for (const c of job.compounds) {
    const scores = byCompound[c.id] ?? {};
    const wt = scores["WT"];
    if (wt == null) continue;
    for (const m of job.mutations) {
      const s = scores[m];
      if (s == null) continue;
      // Skip outside-pocket cells — their Δ doesn't reflect biology.
      if (outsidePocketKey.has(`${c.id}|${m}`)) continue;
      const d = s - wt;
      if (d < (bestSel?.delta ?? Infinity)) bestSel = { name: c.name ?? `Compound #${c.id}`, variant: m, delta: d };
      if (d > (worstRes?.delta ?? -Infinity)) worstRes = { name: c.name ?? `Compound #${c.id}`, variant: m, delta: d };
    }
  }
  if (bestSel && bestSel.delta < -0.4) {
    out.push({
      tag: "Mutant-selective hit",
      tone: "good",
      body: `${bestSel.name} binds ${bestSel.variant} ${Math.abs(bestSel.delta).toFixed(2)} kcal/mol better than WT — strongest selectivity gain in the matrix.`,
    });
  }
  if (worstRes && worstRes.delta > 0.4) {
    out.push({
      tag: "Resistance signature",
      tone: "bad",
      body: `${worstRes.name} loses ${worstRes.delta.toFixed(2)} kcal/mol against ${worstRes.variant} — consistent with this mutation conferring resistance.`,
    });
  }
  // Mean WT score
  const wts = Object.values(byCompound).map((s) => s["WT"]).filter((v): v is number => v != null);
  if (wts.length) {
    const meanWt = wts.reduce((a, b) => a + b, 0) / wts.length;
    out.push({
      tag: "WT baseline",
      tone: "neutral",
      body: `Mean wild-type binding affinity across ${wts.length} compound${wts.length === 1 ? "" : "s"} is ${meanWt.toFixed(2)} kcal/mol.`,
    });
  }
  return out;
}

/** Per-cell context cards — shown when the user clicks a docking row.
 *  Reshapes the same data into stats about THIS pick: its score, its delta
 *  vs WT, and where it ranks among other variants for the same compound. */
function computePickInsights(job: Job, pick: Pick): Insight[] {
  const out: Insight[] = [];
  const compoundName = pick.compound.name ?? `Compound #${pick.compound.id}`;

  // 1) Score card — always show the absolute affinity for this pick.
  out.push({
    tag: pick.variant === "WT" ? "Wild-type binding" : `${pick.variant} binding`,
    tone: "neutral",
    body: `${compoundName} against ${pick.variant} scored ${pick.score.toFixed(2)} kcal/mol. Lower is stronger predicted binding.`,
  });

  // 2) Delta-vs-WT card — only meaningful for mutant variants.
  // Outside-pocket cells get a NOISE-warning card instead of a
  // selectivity/resistance interpretation. Their Δ comes from PDBFixer
  // local relaxation + QuickVina-GPU stochastic search, not biology, so
  // claiming "Selectivity hint: Vemurafenib gains 1.30 kcal/mol on L597R"
  // would be straightforwardly wrong.
  const pickOutsidePocket =
    pick.variant !== "WT" && parseExtra(pick.extra).outsidePocketA != null;

  if (pickOutsidePocket) {
    const dist = parseExtra(pick.extra).outsidePocketA?.toFixed(1) ?? "12+";
    const dWt = pick.deltaWt;
    const dWtStr = dWt != null ? `Δ ${dWt > 0 ? "+" : ""}${dWt.toFixed(2)} kcal/mol` : "any Δ shown";
    out.push({
      tag: "Outside docking pocket",
      tone: "neutral",
      body: (
        `Residue ${pick.variant.match(/\d+/)?.[0] ?? pick.variant} sits ~${dist} Å from the docking-box ` +
        `centre — outside Vina's search space. ${dWtStr} here is method noise (PDBFixer local ` +
        `relaxation + QuickVina-GPU stochastic search), not a real selectivity or resistance signal. ` +
        `Treat WT and ${pick.variant} as effectively the same affinity for this compound.`
      ),
    });
  } else if (pick.variant !== "WT" && pick.deltaWt != null) {
    const dWt = pick.deltaWt;
    const tone: Insight["tone"] = dWt > 0.4 ? "bad" : dWt < -0.4 ? "good" : "neutral";
    const verb =
      dWt > 0.4 ? `loses ${dWt.toFixed(2)} kcal/mol against ${pick.variant} — likely resistance signal`
      : dWt < -0.4 ? `gains ${Math.abs(dWt).toFixed(2)} kcal/mol on ${pick.variant} — possible mutant-selective hit`
      : `is essentially flat against ${pick.variant} (Δ ${dWt.toFixed(2)} kcal/mol — within noise)`;
    out.push({
      tag: tone === "bad" ? "Resistance hint" : tone === "good" ? "Selectivity hint" : "No selectivity",
      tone,
      body: `${compoundName} ${verb}.`,
    });
  } else if (pick.variant === "WT") {
    // When the user picked the WT cell, give them a cross-mutant snapshot for
    // the same compound so the second card still does useful work.
    const sameCompound = job.results.filter((r) => r.compound_id === pick.compound.id);
    const mutantRows = sameCompound.filter((r) => r.variant !== "WT");
    if (mutantRows.length) {
      const deltas = mutantRows.map((r) => ({
        variant: r.variant,
        delta: r.best_score - pick.score,
      }));
      const worst = deltas.reduce((a, b) => (b.delta > a.delta ? b : a), deltas[0]);
      const best = deltas.reduce((a, b) => (b.delta < a.delta ? b : a), deltas[0]);
      const tone: Insight["tone"] =
        worst.delta > 0.4 ? "bad" : best.delta < -0.4 ? "good" : "neutral";
      out.push({
        tag: "Mutation profile",
        tone,
        body:
          tone === "bad"
            ? `${compoundName} loses the most ground against ${worst.variant} (Δ +${worst.delta.toFixed(2)} kcal/mol).`
            : tone === "good"
            ? `${compoundName} gains the most on ${best.variant} (Δ ${best.delta.toFixed(2)} kcal/mol vs WT).`
            : `${compoundName} is roughly flat across all tested mutants (max |Δ| ${Math.max(Math.abs(best.delta), Math.abs(worst.delta)).toFixed(2)} kcal/mol).`,
      });
    }
  }

  // 3) Rank card — show where this docking sits among all rows for the same
  // compound. Helps the user place the score in context without scrolling.
  const sameCompoundRows = job.results
    .filter((r) => r.compound_id === pick.compound.id)
    .map((r) => r.best_score)
    .sort((a, b) => a - b); // ascending = strongest first
  if (sameCompoundRows.length > 1) {
    const rank = sameCompoundRows.indexOf(pick.score) + 1;
    out.push({
      tag: "Rank for this compound",
      tone: "neutral",
      body: `Among the ${sameCompoundRows.length} variants tested for ${compoundName}, this docking ranks #${rank} (1 = strongest predicted binder).`,
    });
  }

  return out;
}
