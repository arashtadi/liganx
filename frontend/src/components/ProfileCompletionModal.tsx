/**
 * ProfileCompletionModal — auto-shows for signed-in users whose profile
 * is incomplete (no organization OR no role) and who haven't dismissed
 * the prompt yet.
 *
 * Why we need this: OAuth users (Google sign-in) skip the SignupPage
 * form entirely, so we never get their organization / role / ResearchGate.
 * Without this prompt, every Google user would have a permanently empty
 * profile unless they happened to navigate to /settings.
 *
 * Trigger logic:
 *   1. User signs in (any path).
 *   2. We fetch /me/profile.
 *   3. If organization OR role is empty AND onboarding wasn't dismissed
 *      server-side, the modal opens.
 *   4. User can fill it in (saves via PUT /me/profile and closes) OR
 *      click Skip (POSTs to /me/profile/dismiss-onboarding so the modal
 *      won't bug them next session, and stores a localStorage flag
 *      for instant local hide before the API call resolves).
 *
 * The localStorage flag handles the "dismissed seconds ago, navigated"
 * case so the modal doesn't flicker back. The server-side dismissal is
 * the canonical state for cross-device persistence.
 */

import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth, SIGNUP_ROLES } from "../lib/auth";
import { Spinner, Close } from "./Icons";

const LOCAL_DISMISS_KEY = "liganx.profileCompletion.dismissed";

export default function ProfileCompletionModal() {
  const { user, loading: authLoading } = useAuth();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Form state — pre-fill full_name from session.user.user_metadata if
  // available (Google OAuth puts display name in `name`). Saves a
  // typing step for OAuth users; email/password users already typed
  // it on sign-up so the field arrives pre-filled from the API.
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState("");
  const [researchgateUrl, setResearchgateUrl] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [fullName, setFullName] = useState("");

  // On sign-in, check whether the modal should fire.
  useEffect(() => {
    // Wait until auth has resolved + a user is present. RequireAuth
    // gates protected routes elsewhere; this modal lives at the app
    // root so it shows on any post-login page.
    if (authLoading || !user) {
      setOpen(false);
      return;
    }
    // Local dismissal short-circuits the API call so navigating after
    // dismissing doesn't briefly re-open the modal.
    if (localStorage.getItem(LOCAL_DISMISS_KEY)) {
      return;
    }
    let cancelled = false;
    api.getMyProfile()
      .then((p) => {
        if (cancelled) return;
        // Server-side dismissed? (TODO: add this field to GET /me/profile
        // response — for now we infer "not dismissed" if any field is
        // missing AND the local flag is unset.)
        const incomplete = !p.organization || !p.role;
        if (incomplete) {
          setFullName(
            p.full_name
            ?? (user.user_metadata?.full_name as string | undefined)
            ?? (user.user_metadata?.name as string | undefined)
            ?? "",
          );
          setOrganization(p.organization ?? "");
          setRole(p.role ?? "");
          setResearchgateUrl(p.researchgate_url ?? "");
          setMarketingOptIn(p.marketing_opt_in ?? false);
          setOpen(true);
        }
      })
      .catch(() => {
        // Silent fail — if the profile API is down, don't blast a
        // modal at the user. They can edit from /settings later.
      });
    return () => { cancelled = true; };
  }, [authLoading, user]);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (researchgateUrl.trim() && !/^https?:\/\//i.test(researchgateUrl.trim())) {
      setErr("ResearchGate URL must start with https://");
      return;
    }
    setSubmitting(true);
    try {
      await api.updateMyProfile({
        full_name: fullName,
        organization,
        role,
        researchgate_url: researchgateUrl,
        marketing_opt_in: marketingOptIn,
      });
      // Mark dismissed (server-side) so we don't re-open even if the
      // user later clears one of the fields from Settings — they've
      // already engaged with this prompt.
      try { await api.dismissOnboarding(); } catch { /* non-fatal */ }
      localStorage.setItem(LOCAL_DISMISS_KEY, "1");
      setOpen(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSkip() {
    // Local-first so the modal closes instantly even if the API call
    // is slow.
    localStorage.setItem(LOCAL_DISMISS_KEY, "1");
    setOpen(false);
    try { await api.dismissOnboarding(); } catch { /* non-fatal */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
        <header className="flex items-start justify-between p-5 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-ink dark:text-white">
              Tell us a bit about you
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Optional but helps us tailor the platform. Skippable — you can fill this in later from Settings.
            </p>
          </div>
          <button
            onClick={onSkip}
            type="button"
            className="text-slate-400 hover:text-ink p-1 rounded-md hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-100 dark:hover:bg-slate-700"
            aria-label="Skip for now"
          >
            <Close size={18} />
          </button>
        </header>
        <form onSubmit={onSubmit} className="p-5 space-y-4">
          {/* Hide full_name when we already have one (e.g. Google
              filled it from `name`) to keep the modal short. */}
          {!fullName && (
            <div>
              <label className="label">Full name</label>
              <input
                type="text"
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={submitting}
                placeholder="Jane Smith"
              />
            </div>
          )}
          <div>
            <label className="label">Company / Institution</label>
            <input
              type="text"
              className="input"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              disabled={submitting}
              placeholder="MIT, Genentech, Stanford…"
            />
          </div>
          <div>
            <label className="label">Role</label>
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={submitting}
            >
              <option value="">— Select —</option>
              {SIGNUP_ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">ResearchGate (optional)</label>
            <input
              type="url"
              className="input"
              value={researchgateUrl}
              onChange={(e) => setResearchgateUrl(e.target.value)}
              disabled={submitting}
              placeholder="https://www.researchgate.net/profile/…"
            />
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-delta-600 focus:ring-delta-500 dark:border-slate-600 dark:bg-slate-800"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
              disabled={submitting}
            />
            <span className="text-sm text-slate-700 dark:text-slate-300 leading-snug">
              Send me product updates and the occasional research newsletter.
            </span>
          </label>

          {err && (
            <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800 dark:bg-rose-900/20 dark:border-rose-800/40 dark:text-rose-200">
              {err}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={onSkip}
              className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              disabled={submitting}
            >
              Skip for now
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <Spinner size={14} className="mr-2" /> : null}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
