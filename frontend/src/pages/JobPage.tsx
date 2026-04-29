import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type CatalogMutation, type CatalogTarget, type Compound, type DockingResult, type Job, type PdbQuality } from "../api";
import SelectivityMatrix from "../components/SelectivityMatrix";
import PoseDetail from "../components/PoseDetail";
import HeroBanner from "../components/HeroBanner";
import { ArrowRight, Beaker, Spinner, Target } from "../components/Icons";
import { parseExtra } from "../lib/parseExtra";

type Pick = { compound: Compound; variant: string; score: number; deltaWt: number | null; extra?: string | null };

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

  // Ref on the hero banner so a matrix cell click can smooth-scroll the
  // banner into view. Without this, clicking a cell at the bottom of the
  // page silently updates the 3D viewer at the top — the user sees no
  // change unless they scroll up themselves, which feels broken.
  const bannerRef = useRef<HTMLDivElement | null>(null);

  // Wrapper around setPick that records the selection origin. Pass `false`
  // for fromUser when the runner code itself sets the pick (auto-pick on
  // first load); pass true when a matrix cell click triggered it. On user
  // clicks, smooth-scroll the banner into view so the action feels connected.
  const choosePick = (next: Pick | null, fromUser: boolean) => {
    setPick(next);
    setSelectionReason(fromUser ? "user" : "auto");
    if (fromUser && next != null) {
      // requestAnimationFrame so the scroll fires after React commits the
      // pick state — otherwise we scroll before the banner has updated and
      // the user sees the old pose at the top for a frame.
      requestAnimationFrame(() => {
        bannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
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
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === "completed" || status === "failed" ? false : 1500;
    },
    enabled: !!jobKey,
  });

  // Pull catalog so we can find the pocket box for known targets
  const { data: catalog } = useQuery({ queryKey: ["catalog"], queryFn: api.catalog });
  const target: CatalogTarget | undefined = useMemo(
    () => catalog?.find((t) => t.pdb_id === job?.pdb_id),
    [catalog, job?.pdb_id],
  );

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
          <Link to="/new" className="btn-primary btn-sm">Start a new job</Link>
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
      {job.error_message && (
        <div className="card border-loss-300 bg-loss-50 text-loss-700 dark:bg-loss-900/20 dark:text-loss-300 dark:border-loss-700/40 text-sm">
          <div className="font-semibold mb-1">Job failed</div>
          <div>{job.error_message}</div>
        </div>
      )}

      {/* Live progress banner — stays visible until the job finishes, while the
          matrix below renders cells incrementally as each docking commits.
          Suppress in subset view: the streaming UI is misleading when most of
          the matrix has been intentionally hidden. */}
      {!inSubsetView && job.status !== "completed" && job.status !== "failed" && (
        <StreamingBanner job={job} />
      )}

      {/* Selectivity matrix on top — users scan the table of scores first,
          then click into a cell to see the 3D pose below. Clicking flows
          DOWN the page (natural reading direction) instead of up; the
          auto-scroll in choosePick takes them to the banner so the change
          is on-screen without manual scrolling. */}
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
      />

      {/* Hero 3D banner — full-width, sits below the matrix. Auto-loads
          the best mutant Δ on page open via the effect above; updates in
          place when a cell is clicked. The wrapping div carries `bannerRef`
          so cell clicks above can smooth-scroll the banner into view. */}
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

      {/* Deeper drill-down — interpretation paragraph, ProLIF contacts list,
          2D interaction map, mutation-outside-pocket explainer. Lives below
          the matrix when a cell is selected, instead of beside it as a
          right rail. The banner above already shows the score / Δ / drug-
          likeness summary, so PoseDetail is purely the deep dive here. */}
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

      {/* Insights cards — same as before, scoped to the active pick when
          present, else job-wide. */}
      {viewJob.status === "completed" && <Insights job={viewJob} pick={pick} />}
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

  return (
    <header className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <Link to="/history" className="text-xs text-slate-500 hover:text-delta-600 dark:text-slate-400 dark:hover:text-delta-400 inline-flex items-center gap-1">
          <ArrowRight size={11} className="rotate-180" /> Back to history
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
          <Stat icon={null} label="Job #" value={job.id} />
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

function StreamingBanner({ job }: { job: Job }) {
  const total = job.compounds.length * (job.mutations.length + 1);
  const done = job.results.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-3">
        <Spinner size={16} className="text-delta-600 dark:text-delta-400" />
        <div className="flex-1">
          <div className="font-semibold text-ink dark:text-slate-100 text-sm">
            {job.status === "pending" ? "Queued for execution" : "Docking in progress"}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {done} of {total} dockings complete · cells fill in below as each pose finishes
          </div>
        </div>
        <span className="text-sm font-semibold text-delta-600 dark:text-delta-300 tabular-nums">{pct}%</span>
      </div>
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

function Insights({ job, pick }: { job: Job; pick: Pick | null }) {
  // When the user has selected a cell, the cards reshape to describe that
  // specific compound × variant. Otherwise, fall back to the job-wide summary.
  const { insights, scope } = useMemo(
    () => pick
      ? { insights: computePickInsights(job, pick), scope: pickName(pick) }
      : { insights: computeJobInsights(job), scope: "job summary" },
    [job, pick],
  );
  if (insights.length === 0) return null;
  return (
    <div className="mt-5">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-2">
        {pick ? `Insights for ${scope}` : "Job summary"}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
