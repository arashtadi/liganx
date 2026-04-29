// User's job history — newest-first list with search across title, target,
// mutation, and compound name. Clicking a row deep-links into JobPage. Empty
// state has a clear CTA to /new.
//
// Tagging: each row carries a "+ Tag" pill that opens a popover with a
// preset menu (Favorite, Promising, Bad, Send to lab, etc.) plus a free-text
// "Add custom" input. Tags persist server-side via PATCH /jobs/{id}; the
// list query refetches after each save so other tabs see the change.
//
// Filter bar: chips at the top show every tag that's been used in the
// current job list. Clicking one filters jobs to those carrying it; click
// again to clear. Multi-select uses OR semantics — selecting Favorite +
// Promising shows jobs that have either tag.

import { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Job } from "../api";
import { Close, Spinner } from "../components/Icons";
import {
  TAG_PRESETS,
  TAG_BY_VALUE,
  CUSTOM_TAG_CHIP,
  sortTags,
  type JobTag,
} from "../lib/jobTags";

function statusPill(s: Job["status"]) {
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset";
  switch (s) {
    case "running":
      return <span className={`${base} bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800/40`}>running</span>;
    case "pending":
      return <span className={`${base} bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700`}>pending</span>;
    case "completed":
      return <span className={`${base} bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-800/40`}>completed</span>;
    case "failed":
      return <span className={`${base} bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-800/40`}>failed</span>;
    case "cancelled":
      return <span className={`${base} bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700`}>cancelled</span>;
  }
}

function fmtDate(iso: string): string {
  // "2026-04-28T18:22:01" → "Apr 28, 6:22 PM"
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Synthesize a fallback title when the user didn't provide one. */
function defaultTitle(j: Job): string {
  const muts = j.mutations.length ? ` · ${j.mutations.join(", ")}` : "";
  return `${j.pdb_id}/${j.chain} · ${j.compounds.length} compound${j.compounds.length === 1 ? "" : "s"}${muts}`;
}

export default function HistoryPage() {
  const { data: jobs, isLoading, error } = useQuery({
    queryKey: ["jobs"],
    queryFn: api.listJobs,
    refetchOnWindowFocus: true,
  });

  const [q, setQ] = useState("");
  // Selected filter tags. OR semantics across selected tags. Starts empty
  // (= show everything). Cleared when the user clicks the active chip again.
  const [filterTags, setFilterTags] = useState<string[]>([]);

  // The set of every tag currently in use across the job list, in preset-
  // order then alphabetical. Used to populate the filter bar — we only show
  // chips for tags the user has actually applied somewhere, so the bar
  // doesn't fill up with presets they don't care about.
  const tagsInUse = useMemo(() => {
    if (!jobs) return [] as string[];
    const seen = new Set<string>();
    for (const j of jobs) {
      for (const t of j.tags) seen.add(t);
    }
    return sortTags([...seen]);
  }, [jobs]);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    let out = jobs;
    if (filterTags.length > 0) {
      // OR semantics: a job passes if it has ANY of the selected tags.
      const wanted = new Set(filterTags);
      out = out.filter((j) => j.tags.some((t) => wanted.has(t)));
    }
    const needle = q.trim().toLowerCase();
    if (needle) {
      out = out.filter((j) => {
        const hay = [
          j.title || defaultTitle(j),
          j.pdb_id,
          j.uniprot_id || "",
          j.chain,
          ...j.mutations,
          ...j.compounds.map((c) => c.name || ""),
          ...j.compounds.map((c) => c.smiles),
          ...j.tags,
          // Also include the human label for preset tags so searching
          // "send to lab" matches the slug "send-to-lab".
          ...j.tags.map((t) => TAG_BY_VALUE[t]?.label || ""),
        ].join(" ").toLowerCase();
        return hay.includes(needle);
      });
    }
    return out;
  }, [jobs, q, filterTags]);

  function toggleFilterTag(value: string) {
    setFilterTags((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value],
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-500 dark:text-slate-400">
        <Spinner size={20} className="mr-2" /> Loading your jobs…
      </div>
    );
  }
  if (error) {
    return (
      <div className="card max-w-xl mx-auto">
        <h1 className="text-xl font-semibold text-rose-700 dark:text-rose-300 mb-2">Couldn't load history</h1>
        <p className="text-slate-700 dark:text-slate-300">
          {(error as Error).message}
        </p>
      </div>
    );
  }
  if (!jobs || jobs.length === 0) {
    return (
      <div className="card max-w-xl mx-auto text-center py-16">
        <h1 className="text-2xl font-bold text-ink dark:text-white mb-2">No jobs yet</h1>
        <p className="muted mb-5">Your docking history will appear here once you run your first job.</p>
        <Link to="/new" className="btn btn-primary">Start a new docking job</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My history</h1>
        <p className="muted mt-1">
          {jobs.length} job{jobs.length === 1 ? "" : "s"} · click any to open ·
          tag jobs to color-code and filter them
        </p>
      </div>

      <input
        type="search"
        className="input"
        placeholder="Search by title, target, mutation, compound name, SMILES, or tag…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {tagsInUse.length > 0 && (
        <FilterBar
          tagsInUse={tagsInUse}
          selected={filterTags}
          onToggle={toggleFilterTag}
          onClear={() => setFilterTags([])}
        />
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {q || filterTags.length > 0
              ? "No jobs match the current filters."
              : "No jobs to show."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((j) => (
              <HistoryRow key={j.id} job={j} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Filter bar                                                                 */
/* -------------------------------------------------------------------------- */

function FilterBar({
  tagsInUse, selected, onToggle, onClear,
}: {
  tagsInUse: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mr-1">
        Filter
      </span>
      {tagsInUse.map((value) => {
        const preset = TAG_BY_VALUE[value];
        const active = selected.includes(value);
        const chipClass = preset?.chip ?? CUSTOM_TAG_CHIP;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onToggle(value)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-all ${chipClass} ${
              active ? "ring-2 shadow-sm scale-[1.02]" : "opacity-80 hover:opacity-100"
            }`}
            title={active ? "Click to remove from filter" : "Filter by this tag"}
          >
            {preset && <span aria-hidden="true">{preset.icon}</span>}
            <span>{preset?.label ?? value}</span>
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-slate-500 dark:text-slate-400 hover:text-ink dark:hover:text-slate-200 underline-offset-2 hover:underline ml-1"
        >
          Clear
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Row + tag picker                                                           */
/* -------------------------------------------------------------------------- */

/** A single history list row with an inline two-step delete button.
 *
 * Why two-step: confirm-on-click avoids native `confirm()` (ugly + can't be
 * styled to match the app) without making misclicks irreversible. First click
 * arms the button; second click within ~5s actually deletes. Outside that
 * window the button reverts to its idle state — the timeout protects against
 * "armed forever" footguns.
 *
 * The whole row is wrapped in a Link, but we stop propagation on the delete
 * and tag-picker controls so clicking them never navigates into the job. */
function HistoryRow({ job }: { job: Job }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onDeleteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      setErr(null);
      window.setTimeout(() => setConfirming(false), 5000);
      return;
    }
    setBusy(true);
    try {
      await api.deleteJob(job.share_id);
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch (e) {
      setBusy(false);
      setConfirming(false);
      setErr((e as Error).message);
    }
  }

  return (
    <li className="relative">
      <Link
        to={`/jobs/${job.share_id}`}
        className="block px-4 py-3 hover:bg-slate-50 transition-colors dark:hover:bg-slate-800/60"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold text-ink dark:text-slate-100 truncate">
                {job.title || defaultTitle(job)}
              </span>
              {statusPill(job.status)}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono truncate">
              {job.pdb_id}/{job.chain}
              {job.mutations.length > 0 && ` · ${job.mutations.join(", ")}`}
              {` · ${job.compounds.length} compound${job.compounds.length === 1 ? "" : "s"}`}
            </div>
            <TagStrip job={job} />
            {err && (
              <div className="text-[11px] text-rose-700 dark:text-rose-300 mt-1">
                Couldn't delete: {err}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 whitespace-nowrap">
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {fmtDate(job.created_at)}
            </span>
            <button
              type="button"
              onClick={onDeleteClick}
              disabled={busy}
              className={
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors " +
                (confirming
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 dark:hover:text-rose-300")
              }
              title={confirming ? "Click again to confirm delete" : "Delete this job"}
              aria-label={confirming ? "Confirm delete" : "Delete job"}
            >
              {busy ? (
                <Spinner size={12} />
              ) : confirming ? (
                <>Confirm delete</>
              ) : (
                <Close size={14} />
              )}
            </button>
          </div>
        </div>
      </Link>
    </li>
  );
}

/** The chip strip shown under each row's metadata line. Renders existing
 *  tags as colored pills (clickable to remove) plus a "+ Tag" trigger that
 *  opens the picker popover. */
function TagStrip({ job }: { job: Job }) {
  const queryClient = useQueryClient();
  // Anchor rect captured when the trigger is clicked. The popover renders
  // via portal at document.body and positions itself with fixed coords
  // anchored to this rect — that way it can escape the row's
  // overflow-hidden wrapper without getting clipped.
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Optimistic local copy so chip clicks feel instant. Server state syncs
  // back on mutation success via query invalidation.
  const [localTags, setLocalTags] = useState(job.tags);
  // Re-sync when the server sends a different tag set (e.g. another tab
  // edited the job).
  useEffect(() => {
    setLocalTags(job.tags);
  }, [job.tags]);

  const updateMut = useMutation({
    mutationFn: (next: string[]) => api.updateJob(job.share_id, { tags: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: Error) => {
      // Roll back optimistic state on failure.
      setLocalTags(job.tags);
      // eslint-disable-next-line no-alert
      alert(`Couldn't update tags: ${e.message}`);
    },
  });

  function setTags(next: string[], e?: React.MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    setLocalTags(next);
    updateMut.mutate(next);
  }

  function openPicker(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (triggerRef.current) {
      setAnchorRect(triggerRef.current.getBoundingClientRect());
    }
  }

  const sorted = sortTags(localTags);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {sorted.map((value) => {
        const preset = TAG_BY_VALUE[value];
        const chip = preset?.chip ?? CUSTOM_TAG_CHIP;
        return (
          <button
            key={value}
            type="button"
            onClick={(e) => setTags(localTags.filter((t) => t !== value), e)}
            className={`group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${chip}`}
            title="Click to remove this tag"
          >
            {preset && <span aria-hidden="true">{preset.icon}</span>}
            <span>{preset?.label ?? value}</span>
            <span className="text-[10px] opacity-50 group-hover:opacity-100 transition-opacity">×</span>
          </button>
        );
      })}
      <button
        ref={triggerRef}
        type="button"
        onClick={openPicker}
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-inset ring-dashed ring-slate-300 hover:ring-slate-400 hover:text-slate-700 dark:text-slate-400 dark:ring-slate-700 dark:hover:ring-slate-500 dark:hover:text-slate-200"
        title="Add a tag to this job"
      >
        <span aria-hidden="true">+</span>
        <span>Tag</span>
      </button>
      {anchorRect && (
        <TagPicker
          anchorRect={anchorRect}
          existing={localTags}
          onClose={() => setAnchorRect(null)}
          onChange={(next) => setTags(next)}
        />
      )}
      {updateMut.isPending && <Spinner size={10} className="text-slate-400" />}
    </div>
  );
}

/** Lightweight popover with the preset menu + custom-tag input.
 *
 *  Renders via portal at document.body so it can escape the row's
 *  overflow-hidden wrapper. Position is computed from the trigger's
 *  bounding rect: by default opens below-left, flips above when there
 *  isn't room below, and clamps left/right to keep it on-screen. We
 *  recompute on scroll/resize so the popover tracks its anchor while
 *  the user moves the page.
 *
 *  Click-outside / Escape dismisses. Tags toggle on click — checking
 *  applies, unchecking removes. The popover stays open for multi-
 *  select; users click outside or hit Done to close. */
function TagPicker({
  anchorRect, existing, onClose, onChange,
}: {
  anchorRect: DOMRect;
  existing: string[];
  onClose: () => void;
  onChange: (next: string[]) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");
  // Live rect — updated on scroll/resize so the popover tracks the
  // trigger as the user scrolls the list. Falls back to the initial
  // anchor if we lose the source.
  const [rect, setRect] = useState(anchorRect);
  useEffect(() => setRect(anchorRect), [anchorRect]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Track the anchor through scroll + resize. We close on scroll instead
  // of trying to move along — moving popovers feel janky next to a
  // scrolling list, and the user can re-open at the new position.
  useEffect(() => {
    function onScroll() { onClose(); }
    function onResize() { onClose(); }
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  // Compute position. Width 256 px (w-64). Estimate height ~360 px for
  // the bottom-flip decision; we don't measure pre-mount. Side margins
  // 12 px so we don't sit flush against the viewport edge.
  const W = 256;
  const H = 380;
  const M = 12;
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeBelow = spaceBelow >= H + M || spaceBelow >= window.innerHeight - rect.top;
  const top = placeBelow
    ? Math.min(rect.bottom + 4, window.innerHeight - H - M)
    : Math.max(M, rect.top - H - 4);
  // Try to align the popover's left edge with the trigger; clamp to
  // viewport so it never spills off the right edge on narrow screens.
  const left = Math.max(M, Math.min(rect.left, window.innerWidth - W - M));

  function toggle(t: JobTag, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const has = existing.includes(t.value);
    onChange(has ? existing.filter((v) => v !== t.value) : [...existing, t.value]);
  }

  function addCustom(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const v = custom.trim();
    if (!v) return;
    if (existing.some((t) => t.toLowerCase() === v.toLowerCase())) {
      setCustom("");
      return;
    }
    if (v.length > 32) return;
    onChange([...existing, v]);
    setCustom("");
  }

  return createPortal(
    <div
      ref={wrapRef}
      role="menu"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{ position: "fixed", top, left, width: W }}
      className="z-[60] rounded-lg border border-slate-200 bg-white shadow-xl py-1 dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
          Tags
        </div>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
          className="text-xs text-slate-500 hover:text-ink dark:text-slate-400 dark:hover:text-white"
          title="Close"
        >
          Done
        </button>
      </div>
      <div className="py-1 max-h-72 overflow-y-auto">
        {TAG_PRESETS.map((t) => {
          const checked = existing.includes(t.value);
          return (
            <button
              key={t.value}
              type="button"
              onClick={(e) => toggle(t, e)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
              role="menuitemcheckbox"
              aria-checked={checked}
            >
              <span
                className={`w-3.5 h-3.5 rounded-sm border border-slate-300 dark:border-slate-600 flex items-center justify-center text-[9px] text-white ${
                  checked ? "bg-delta-600 border-delta-600" : ""
                }`}
              >
                {checked && "✓"}
              </span>
              <span className={`inline-block w-2 h-2 rounded-full ${t.dot}`} aria-hidden="true" />
              <span className="flex-1 text-left">{t.label}</span>
              <span className="text-xs text-slate-400">{t.icon}</span>
            </button>
          );
        })}
      </div>
      <form
        onSubmit={addCustom}
        className="border-t border-slate-100 dark:border-slate-700 px-3 py-2 flex gap-2"
      >
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          maxLength={32}
          placeholder="Custom tag…"
          onClick={(e) => e.stopPropagation()}
          className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-delta-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        <button
          type="submit"
          disabled={!custom.trim()}
          className="rounded-md bg-delta-600 px-2 py-1 text-xs font-medium text-white hover:bg-delta-700 disabled:opacity-40"
        >
          Add
        </button>
      </form>
      {existing.filter((t) => !TAG_BY_VALUE[t]).length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-1.5">
            Custom
          </div>
          <div className="flex flex-wrap gap-1">
            {existing.filter((t) => !TAG_BY_VALUE[t]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(existing.filter((v) => v !== value));
                }}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CUSTOM_TAG_CHIP}`}
                title="Click to remove"
              >
                <span>{value}</span>
                <span className="opacity-60">×</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
