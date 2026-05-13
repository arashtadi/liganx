/**
 * /admin — Liganx admin dashboard.
 *
 * Server is the source of truth: every endpoint here is gated behind
 * the admin_user FastAPI dependency (ADMIN_EMAIL env on Fly). The
 * frontend mirrors that gate by hiding the user-menu link from non-
 * admin sessions, but a non-admin who navigates to /admin directly
 * gets a friendly "not authorized" card instead of a blank page.
 *
 * Layout:
 *   - Top: 6-card stats strip (total users, total jobs, jobs 24h/7d,
 *     running, failed in 7d).
 *   - Below: users table — newest signups first, with name/email/org/
 *     signup date / last sign-in / used vs quota / actions (edit
 *     quota, delete).
 *
 * Quota edit is inline (no modal) — small numeric input + Save button
 * on the row. Delete IS a modal because it's destructive and we want
 * an explicit confirm with the user's email typed back to us.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type AdminUserRow } from "../api";
import { Spinner } from "../components/Icons";
import { useAuth } from "../lib/auth";
import { usePageMeta } from "../lib/usePageMeta";
import { parseUtcDate } from "../lib/parseUtcDate";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  // parseUtcDate ensures bare backend timestamps are treated as UTC
  // and converted to the viewer's local zone (see lib/parseUtcDate.ts).
  const d = parseUtcDate(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const d = parseUtcDate(iso);
  if (isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

export default function AdminPage() {
  usePageMeta({
    title: "Admin · Liganx",
    description: "Liganx admin dashboard.",
  });

  const { user, loading: authLoading } = useAuth();

  // Server is the source of truth — but show the right thing client-side
  // while we wait for it to confirm. If we already know the user isn't
  // signed in (authLoading false, user null), short-circuit before
  // burning an /admin/stats call that we already know will 401.
  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-500">
        <Spinner size={20} className="mr-2" /> Loading…
      </div>
    );
  }
  if (!user) {
    return (
      <NotAuthorizedCard reason="signed-out" />
    );
  }
  return <AdminDashboard />;
}


function AdminDashboard() {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<AdminUserRow | null>(null);
  const [editingQuotaFor, setEditingQuotaFor] = useState<string | null>(null);
  const [pendingQuota, setPendingQuota] = useState<number>(10);
  const [filter, setFilter] = useState("");

  const statsQuery = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: api.adminStats,
    refetchInterval: 30_000,  // ~30s; cheap aggregations
    retry: false,             // 403s shouldn't auto-retry
  });

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: api.adminListUsers,
    retry: false,
  });

  const setQuotaMut = useMutation({
    mutationFn: ({ userId, quota }: { userId: string; quota: number }) =>
      api.adminSetQuota(userId, quota),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setEditingQuotaFor(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (userId: string) => api.adminDeleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      setConfirmDelete(null);
    },
  });

  // 403 → render NotAuthorized card. ApiError surfaces the status code
  // on .status; only the admin email gets past server-side, anyone else
  // gets a 403 here and we want to tell them politely.
  const apiErr = (statsQuery.error as ApiError | undefined) ?? (usersQuery.error as ApiError | undefined);
  if (apiErr instanceof ApiError && apiErr.status === 403) {
    return <NotAuthorizedCard reason="not-admin" />;
  }
  // Any non-403 error on the users query was previously hidden — the
  // page just rendered "No users yet" with the correct USERS count in
  // the stat card, leaving the admin guessing. Surface it inline so
  // we can see exactly what the backend is complaining about (500
  // detail string, 503 from auth, etc.). Stats errors handled
  // similarly — both the count and the list need to be honest.
  function fmtErr(e: unknown): string {
    if (e instanceof ApiError) return `HTTP ${e.status} — ${e.message}`;
    if (e instanceof Error) return e.message;
    return String(e);
  }
  const usersErr = usersQuery.error;
  const statsErr = statsQuery.error;
  const banner = usersErr
    ? `users query failed: ${fmtErr(usersErr)}`
    : statsErr
      ? `stats query failed: ${fmtErr(statsErr)}`
      : null;

  if (statsQuery.isLoading || usersQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-500">
        <Spinner size={20} className="mr-2" /> Loading admin dashboard…
      </div>
    );
  }

  const stats = statsQuery.data;
  const users = usersQuery.data ?? [];
  const filtered = filter.trim()
    ? users.filter((u) => {
        const q = filter.trim().toLowerCase();
        return (
          u.email.toLowerCase().includes(q) ||
          (u.full_name ?? "").toLowerCase().includes(q) ||
          (u.organization ?? "").toLowerCase().includes(q)
        );
      })
    : users;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <header className="mb-6 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink dark:text-white">Admin</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Users, usage, and quotas for liganx.com.
          </p>
        </div>
        {stats && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Auto-refreshes every 30s.
          </div>
        )}
      </header>

      {banner && (
        <div className="card border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-900/20 dark:text-rose-200 text-sm mb-4">
          <div className="font-semibold mb-1">Admin endpoint error</div>
          <div className="break-words font-mono text-xs">{banner}</div>
          <div className="text-xs mt-2 opacity-75">
            Stats may still be visible above; the user list won&apos;t load. Check Fly logs for the full traceback.
          </div>
        </div>
      )}

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          <StatCard label="Users" value={stats.total_users} />
          <StatCard label="Jobs total" value={stats.total_jobs} />
          <StatCard label="Jobs · 24h" value={stats.jobs_24h} />
          <StatCard label="Jobs · 7d" value={stats.jobs_7d} />
          <StatCard label="Running" value={stats.jobs_running} accent={stats.jobs_running > 0 ? "amber" : "default"} />
          <StatCard label="Failed · 7d" value={stats.jobs_failed_7d} accent={stats.jobs_failed_7d > 0 ? "rose" : "default"} />
        </div>
      )}

      <PodControl />


      {/* Users table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-ink dark:text-slate-100">
            Users <span className="text-slate-400 font-normal">({filtered.length}{filter && filtered.length !== users.length ? ` of ${users.length}` : ""})</span>
          </h2>
          <input
            type="search"
            placeholder="Search name, email, org…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 w-64 focus:border-delta-500 focus:ring-1 focus:ring-delta-500 outline-none"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">User</th>
                <th className="text-left px-3 py-2 font-semibold">Org</th>
                <th className="text-left px-3 py-2 font-semibold">Joined</th>
                <th className="text-left px-3 py-2 font-semibold">Last sign-in</th>
                <th className="text-right px-3 py-2 font-semibold">Used / quota</th>
                <th className="text-right px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((u) => {
                const isEditing = editingQuotaFor === u.user_id;
                const usagePct = u.job_quota > 0 ? Math.min(100, Math.round((u.jobs_used / u.job_quota) * 100)) : 0;
                const usageColor = usagePct >= 100 ? "bg-rose-500" : usagePct >= 80 ? "bg-amber-500" : "bg-delta-500";
                return (
                  <tr key={u.user_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-ink dark:text-slate-100 flex items-center gap-1.5">
                        {u.full_name || "—"}
                        {u.is_admin && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider bg-delta-100 text-delta-800 dark:bg-delta-900/40 dark:text-delta-200">
                            admin
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 break-all">{u.email}</div>
                      {u.role && (
                        <div className="text-[10px] text-slate-400 mt-0.5">{u.role.replace(/_/g, " ")}</div>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-slate-700 dark:text-slate-300">
                      {u.organization || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {fmtDate(u.created_at)}
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {fmtRelative(u.last_sign_in_at)}
                    </td>
                    <td className="px-3 py-3 align-top text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            type="number"
                            min={0}
                            max={10000}
                            value={pendingQuota}
                            onChange={(e) => setPendingQuota(Number(e.target.value))}
                            className="w-16 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-right focus:border-delta-500 outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setQuotaMut.mutate({ userId: u.user_id, quota: pendingQuota })}
                            disabled={setQuotaMut.isPending}
                            className="text-[11px] px-2 py-0.5 rounded bg-delta-600 hover:bg-delta-700 text-white font-semibold disabled:opacity-50"
                          >
                            {setQuotaMut.isPending ? "…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingQuotaFor(null)}
                            className="text-[11px] px-1.5 py-0.5 rounded text-slate-500 hover:text-slate-700"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setEditingQuotaFor(u.user_id); setPendingQuota(u.job_quota); }}
                          className="inline-flex flex-col items-end group"
                          title="Click to edit quota"
                        >
                          <span className="text-xs font-mono text-slate-700 dark:text-slate-200 group-hover:text-delta-700 dark:group-hover:text-delta-300">
                            {u.jobs_used} / {u.job_quota}
                          </span>
                          <span className="block w-20 h-1 mt-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                            <span className={`block h-full ${usageColor} transition-all`} style={{ width: `${usagePct}%` }} />
                          </span>
                          {u.jobs_total !== u.jobs_used && (
                            <span className="text-[9px] text-slate-400 mt-0.5">
                              ({u.jobs_total} all-time)
                            </span>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-right">
                      {!u.is_admin && (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(u)}
                          className="text-[11px] px-2 py-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 font-semibold"
                          title="Delete this user"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                    {filter ? "No users match that search." : "No users yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirmation modal — type-the-email guard so we can't
          fat-finger a delete on the wrong user. */}
      {confirmDelete && (
        <DeleteUserModal
          user={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteMut.mutate(confirmDelete.user_id)}
          deleting={deleteMut.isPending}
          error={deleteMut.error instanceof Error ? deleteMut.error.message : null}
        />
      )}
    </div>
  );
}


function StatCard({ label, value, accent = "default" }: {
  label: string;
  value: number;
  accent?: "default" | "amber" | "rose";
}) {
  const accentClasses = {
    default: "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900",
    amber: "border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/10",
    rose: "border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-900/10",
  }[accent];
  return (
    <div className={`rounded-xl border ${accentClasses} px-4 py-3`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
        {label}
      </div>
      <div className="text-2xl font-bold text-ink dark:text-white mt-1 tabular-nums">
        {value.toLocaleString()}
      </div>
    </div>
  );
}


function DeleteUserModal({ user, onCancel, onConfirm, deleting, error }: {
  user: AdminUserRow;
  onCancel: () => void;
  onConfirm: () => void;
  deleting: boolean;
  error: string | null;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === user.email.trim().toLowerCase();
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-800 max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-rose-700 dark:text-rose-300 mb-2">Delete user</h2>
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed mb-4">
          This permanently deletes <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{user.email}</span>{" "}
          and all of their data: <strong>{user.jobs_total} job{user.jobs_total === 1 ? "" : "s"}</strong>, profile, and saved compounds. <strong>Cannot be undone.</strong>
        </p>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
          Type the email to confirm:
        </label>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={user.email}
          autoFocus
          className="w-full text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none"
        />
        {error && (
          <div role="alert" className="mt-3 rounded-md border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
            {error}
          </div>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm px-3 py-1.5 rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches || deleting}
            className="text-sm px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold inline-flex items-center gap-1.5"
          >
            {deleting ? <><Spinner size={12} /> Deleting…</> : "Delete user"}
          </button>
        </div>
      </div>
    </div>
  );
}


function NotAuthorizedCard({ reason }: { reason: "signed-out" | "not-admin" }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 dark:text-slate-400" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-ink dark:text-white mb-1">
          {reason === "signed-out" ? "Sign-in required" : "Admin access required"}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {reason === "signed-out"
            ? "Sign in to access the admin dashboard."
            : "This page is only available to the Liganx admin."}
        </p>
      </div>
    </div>
  );
}

/* ─── Pod Control ──────────────────────────────────────────────────────
 *
 * Live status + manual start/stop of the controlled RunPod GPU pod.
 * Backed by /admin/pod/{status,start,stop}. Polls every 10s so the
 * status pill reflects mid-deploy state changes (RUNNING → EXITED on
 * the watchdog auto-stop, etc.).
 */
function PodControl() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["admin-pod-status"],
    queryFn: api.adminPodStatus,
    refetchInterval: 10_000,
    retry: false,
  });
  const stopMut = useMutation({
    mutationFn: api.adminPodStop,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-pod-status"] }),
  });
  const startMut = useMutation({
    mutationFn: api.adminPodStart,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-pod-status"] }),
  });

  const s = statusQuery.data;
  const desired = (s?.desired_status || "").toUpperCase();
  const isRunning = desired === "RUNNING";
  const isStopped = desired === "EXITED" || desired === "STOPPED";
  const lastActMin = s?.last_activity_seconds_ago != null ? Math.floor(s.last_activity_seconds_ago / 60) : null;
  const idleMin = Math.floor((s?.idle_threshold_seconds || 0) / 60);

  function fmtUptime(sec: number | null | undefined): string {
    if (!sec) return "—";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h >= 24) return `${Math.floor(h/24)}d ${h % 24}h`;
    return `${h}h ${m}m`;
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 mb-8">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-sm font-semibold text-ink dark:text-slate-100 flex items-center gap-2">
          GPU Pod
          {s?.configured === false && (
            <span className="text-[10px] font-normal text-amber-600 dark:text-amber-400">
              · RUNPOD_API_KEY / RUNPOD_POD_ID not set
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => stopMut.mutate()}
            disabled={!s?.configured || !isRunning || stopMut.isPending || startMut.isPending}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed"
            title="Stop the pod immediately. /workspace volume persists. Cold-start cost on resume is ~3-5 min."
          >
            {stopMut.isPending ? "Stopping…" : "⏹ Stop pod"}
          </button>
          <button
            type="button"
            onClick={() => startMut.mutate()}
            // 2026-05-12: enable on !isRunning instead of isStopped. RunPod
            // returns a bunch of states besides EXITED/STOPPED — STOPPING,
            // PAUSED, sometimes null mid-transition — and the user
            // couldn't click Start because none matched the narrow
            // isStopped check. start_pod is idempotent on RunPod's side
            // (no-op if the pod is already starting), so enabling
            // whenever the pod isn't actively RUNNING is safe.
            disabled={!s?.configured || isRunning || startMut.isPending || stopMut.isPending}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed"
            title="Resume the pod. ~3-5 min until ready for docking."
          >
            {startMut.isPending ? "Starting…" : "▶ Start pod"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">Status</div>
          <div className={`mt-1 font-mono text-sm font-semibold ${
            isRunning ? "text-emerald-600 dark:text-emerald-400"
            : isStopped ? "text-slate-500"
            : "text-amber-600 dark:text-amber-400"
          }`}>
            {!s?.configured ? "—"
              : isRunning ? "● RUNNING ($0.65/hr)"
              : isStopped ? "○ STOPPED ($0.13/day)"
              : (s?.desired_status || "unknown")}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">Uptime</div>
          <div className="mt-1 font-mono text-sm text-ink dark:text-slate-100 tabular-nums">
            {fmtUptime(s?.uptime_seconds)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">Last activity</div>
          <div className="mt-1 font-mono text-sm text-ink dark:text-slate-100 tabular-nums">
            {lastActMin == null ? "—" : `${lastActMin} min ago`}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">Auto-stop after</div>
          <div className="mt-1 font-mono text-sm text-ink dark:text-slate-100 tabular-nums">
            {idleMin} min idle
          </div>
        </div>
      </div>

      {s?.error && (
        <div className="mt-3 text-xs font-mono text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded p-2">
          {s.error}
        </div>
      )}
    </div>
  );
}
