// User's job history — newest-first list with search across title, target,
// mutation, and compound name. Clicking a row deep-links into JobPage. Empty
// state has a clear CTA to /new.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Job } from "../api";
import { Close, Spinner } from "../components/Icons";

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

  const filtered = useMemo(() => {
    if (!jobs) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return jobs;
    return jobs.filter((j) => {
      const hay = [
        j.title || defaultTitle(j),
        j.pdb_id,
        j.uniprot_id || "",
        j.chain,
        ...j.mutations,
        ...j.compounds.map((c) => c.name || ""),
        ...j.compounds.map((c) => c.smiles),
        ...j.tags,
      ].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [jobs, q]);

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
          {jobs.length} job{jobs.length === 1 ? "" : "s"} · click any to open
        </p>
      </div>

      <input
        type="search"
        className="input"
        placeholder="Search by title, target, mutation, compound name, or SMILES…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No jobs match "{q}".
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

/** A single history list row with an inline two-step delete button.
 *
 * Why two-step: confirm-on-click avoids native `confirm()` (ugly + can't be
 * styled to match the app) without making misclicks irreversible. First click
 * arms the button; second click within ~5s actually deletes. Outside that
 * window the button reverts to its idle state — the timeout protects against
 * "armed forever" footguns.
 *
 * The whole row is wrapped in a Link, but we stop propagation on the delete
 * button so clicking it never navigates into the job. */
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
      // Auto-revert after 5s so the row doesn't stay armed if the user
      // wandered off. Safe to call setConfirming(false) unconditionally —
      // if the deletion is already in flight, busy=true is the source of
      // truth for "click does nothing", and confirming gets reset on row
      // unmount anyway.
      window.setTimeout(() => setConfirming(false), 5000);
      return;
    }
    setBusy(true);
    try {
      await api.deleteJob(job.share_id);
      // Optimistic refresh. Could be `setQueryData` to remove just this row,
      // but a refetch is cheap (one GET /jobs) and stays in sync if other
      // tabs deleted/added jobs in parallel.
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
            <div className="flex items-baseline gap-2">
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
