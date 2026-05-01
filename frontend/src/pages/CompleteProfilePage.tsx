/**
 * CompleteProfilePage — full-page profile-completion form at /welcome.
 *
 * **Hard-block design.** First-time users (any sign-up path: email or
 * Google OAuth) MUST complete this form before they can use the rest of
 * the app. There is intentionally NO Skip button. ProfileRedirect in
 * App.tsx redirects every non-/welcome route to /welcome until the
 * profile has both `organization` and `role` populated. The backend also
 * gates write endpoints (POST /jobs, POST /me/compounds) on profile
 * completeness as defense-in-depth, so a tampered client can't bypass.
 *
 * Why hard-block? An earlier version had a Skip button + a one-shot
 * localStorage dismiss flag. In beta testing a user was never redirected
 * here at all (race between OAuth completion and /me/profile call), and
 * the silent skip path made the form effectively optional, which defeats
 * the point of capturing the data. Hard-blocking forces the form on
 * every device until it's filled — once, then never again.
 *
 * Flow:
 *   1. User signs up (email or Google OAuth).
 *   2. ProfileRedirect spots `!organization || !role` and routes to
 *      /welcome with replace:true.
 *   3. User fills required fields → POST /me/profile → navigate to /.
 *   4. Profile is editable later from /settings.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth, SIGNUP_ROLES } from "../lib/auth";
import { Spinner, LogoMark } from "../components/Icons";

export default function CompleteProfilePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState("");
  const [researchgateUrl, setResearchgateUrl] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  // Pre-fill from the existing profile (in case the user hit /welcome a
  // second time manually, or already partially completed it). Falls back
  // to OAuth user_metadata for full_name when the profile is empty —
  // saves Google users from re-typing their name.
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    api.getMyProfile()
      .then((p) => {
        if (cancelled) return;
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
      })
      .catch(() => {
        // Profile fetch failure is non-fatal — show the form empty.
      });
    return () => { cancelled = true; };
  }, [authLoading, user]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    // Required-field validation. Mirrors the server-side check in
    // ProfileRedirect: profile is "complete" iff organization AND role
    // are both non-empty. Full name is also required because most flows
    // surface it back to the user (history page, share IDs, etc.).
    if (!fullName.trim()) {
      setErr("Please enter your full name.");
      return;
    }
    if (!organization.trim()) {
      setErr("Please enter your company or institution.");
      return;
    }
    if (!role) {
      setErr("Please select your role.");
      return;
    }
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
      try { await api.dismissOnboarding(); } catch { /* non-fatal */ }
      navigate("/", { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-[60vh] flex items-start justify-center py-10">
      <div className="w-full max-w-xl">
        <div className="flex items-center justify-center mb-5">
          <LogoMark size={40} />
        </div>

        <header className="text-center mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-ink dark:text-white">
            Welcome to Liganx
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            One quick step before we get started. These details help us
            tailor Liganx to your work and credit your contributions back
            to you. You can edit any of this later from Settings.
          </p>
        </header>

        <form onSubmit={onSubmit} className="card space-y-4">
          {/* Full name — always shown (was previously hidden if pre-filled
              from OAuth metadata, which created a confusing "form already
              filled out" feel for users). Required. */}
          <div>
            <label htmlFor="welcome-name" className="label">
              Full name <span className="text-rose-600 dark:text-rose-400">*</span>
            </label>
            <input
              id="welcome-name"
              type="text"
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={submitting}
              required
              placeholder="Jane Smith"
            />
          </div>

          <div>
            <label htmlFor="welcome-org" className="label">
              Company / Institution <span className="text-rose-600 dark:text-rose-400">*</span>
            </label>
            <input
              id="welcome-org"
              type="text"
              className="input"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              disabled={submitting}
              required
              placeholder="MIT, Genentech, Stanford…"
            />
          </div>

          <div>
            <label htmlFor="welcome-role" className="label">
              Role <span className="text-rose-600 dark:text-rose-400">*</span>
            </label>
            <select
              id="welcome-role"
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={submitting}
              required
            >
              <option value="">— Select —</option>
              {SIGNUP_ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="welcome-rg" className="label">ResearchGate (optional)</label>
            <input
              id="welcome-rg"
              type="url"
              className="input"
              value={researchgateUrl}
              onChange={(e) => setResearchgateUrl(e.target.value)}
              disabled={submitting}
              placeholder="https://www.researchgate.net/profile/…"
            />
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
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

          {/* No Skip button — profile is hard-required. The redirect in
              App.tsx will bounce the user right back here from any other
              route until the form is filled out. */}
          <div className="flex items-center justify-end pt-2">
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? <Spinner size={14} className="mr-2" /> : null}
              Continue to Liganx
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
