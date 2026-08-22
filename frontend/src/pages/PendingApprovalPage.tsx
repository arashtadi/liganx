/**
 * Pending-approval lock screen.
 *
 * Hard-blocks a signed-up user from the cockpit (Studio, History, FEP, etc.)
 * until the admin flips their access_status to 'approved' via the Telegram
 * Approve button or the /admin/users page. Mirrors the ProfileRedirect
 * pattern in App.tsx — short, declarative, no "skip" affordance.
 *
 * Why this exists separately from /welcome (which gates profile completeness):
 *   - Profile completeness is a *user* action (they fill the form themselves).
 *   - Approval is an *admin* action they can't unblock — so the messaging
 *     and the affordances are different: no form to fill, just a status
 *     poll + clear "we'll email you when ready" copy + a sign-out so they
 *     can leave cleanly.
 *
 * Backend is the authority on the gate (POST /jobs etc. return 403 for
 * non-approved users). This screen is purely UX so a pending user sees a
 * friendly waiting page instead of a console error when they click Run Dock.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import { useAuth } from "../lib/auth";

export default function PendingApprovalPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"pending" | "approved" | "denied" | "loading" | "error">(
    "loading",
  );
  const [polling, setPolling] = useState(false);

  // Initial fetch + a slow background poll so the page auto-unlocks the
  // moment the admin approves — no manual refresh needed. 20 s cadence is
  // a friendly compromise: not chatty enough to matter for the backend,
  // fast enough that a user staring at the screen sees the unlock within
  // half a minute of the Telegram tap.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      if (cancelled) return;
      setPolling(true);
      try {
        const r = await api.getMyAccessStatus();
        if (cancelled) return;
        setStatus(r.status);
        if (r.status === "approved") {
          // Sent through to Studio — the page they were headed for in the
          // first place. ProfileRedirect already cached profile completeness
          // on initial load, so this hop is direct.
          navigate("/studio", { replace: true });
          return;
        }
      } catch {
        if (!cancelled) setStatus("error");
      } finally {
        if (!cancelled) setPolling(false);
      }
      if (!cancelled) timer = window.setTimeout(poll, 20_000);
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [navigate]);

  // Denied -> the operator revoked access. Sign the user out automatically
  // (after a brief beat so the reason is visible) rather than leaving an
  // authenticated session parked on this screen.
  useEffect(() => {
    if (status !== "denied") return;
    const t = window.setTimeout(async () => {
      await signOut();
      navigate("/", { replace: true });
    }, 3000);
    return () => window.clearTimeout(t);
  }, [status, signOut, navigate]);

  const denied = status === "denied";

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6 py-16">
      <div className="max-w-md w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className={
            "w-10 h-10 rounded-full flex items-center justify-center text-lg " +
            (denied
              ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
              : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300")
          }>
            {denied ? "✕" : "⏳"}
          </div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {denied ? "Account not approved" : "Awaiting approval"}
          </h1>
        </div>

        {denied ? (
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Your Liganx account isn't approved for the live docking platform,
            and you're being signed out now. If you think this is a mistake or
            you'd like to request access, please reach out via the{" "}
            <a href="/contact" className="text-delta-600 hover:underline">contact page</a>.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Thanks for signing up{user?.email ? <> as <code className="text-xs">{user.email}</code></> : null}. To
              keep GPU costs sustainable, Liganx is invite-only right now — the
              admin reviews new sign-ups manually.
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mt-3">
              You'll get an email the moment you're approved, and this page
              will unlock automatically (it re-checks every 20 seconds, you
              can leave the tab open).
            </p>
          </>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate("/", { replace: true });
            }}
            className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Sign out
          </button>
          {!denied && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {polling ? "checking…" : "auto-refreshing"}
            </span>
          )}
        </div>

        {status === "error" && (
          <p className="mt-4 text-xs text-rose-600 dark:text-rose-400">
            Couldn't reach the server. Will retry automatically.
          </p>
        )}
      </div>
    </div>
  );
}
