// Sign-in page.
//
// Layout choices:
//   • Google button is at the TOP of the form, branded, before the email
//     fields. OAuth converts ~3x faster than typing email + password and
//     this ordering nudges users toward the faster path. The official
//     multicolor G mark is the recognition shortcut.
//   • Email + password is below, separated by an "or sign in with email"
//     divider so it reads as the secondary path, not the only path.
//   • The "New to Liganx?" CTA at the bottom is a real outlined button —
//     not a tiny gray text link. The previous treatment buried sign-up
//     to the point new visitors might leave thinking the page wasn't
//     for them. Now both paths (existing user → Sign in, new user →
//     Create account) are first-class buttons.

import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/Icons";
import GoogleSignInButton from "../components/GoogleSignInButton";
import { usePageMeta } from "../lib/usePageMeta";

export default function LoginPage() {
  // Auth pages are noindex via robots.txt, but a clear tab title still
  // helps when a user has multiple Liganx tabs open.
  usePageMeta({
    title: "Sign in · Liganx",
    description: "Sign in to Liganx — free mutation-aware molecular docking with Vina, GNINA, and Boltz-2.",
  });
  const { signInWithPassword, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  // Where to send the user after sign-in. Defaults to /studio — the
  // single workspace users now operate in (NewJobPage was retired
  // 2026-05-08 in favour of Studio's unified flow). ?next=/history
  // sends them to history (used when a protected link redirected
  // them here). Any cached ?next=/new from old links is rewritten
  // to /studio below so signed-in users never land on the legacy form.
  const rawNext = search.get("next") || "/studio";
  const next = rawNext === "/new" ? "/studio" : rawNext;
  // Preserve the `next` param when bouncing to /signup so users who hit a
  // protected page, redirected to login, then chose "Create account" still
  // land back where they wanted to go after verification.
  const signupHref = `/signup${search.get("next") ? `?next=${encodeURIComponent(search.get("next")!)}` : ""}`;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await signInWithPassword(email.trim(), password);
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    navigate(next, { replace: true });
  }

  async function onGoogle() {
    setErr(null);
    setBusy(true);
    const { error } = await signInWithGoogle();
    if (error) {
      setBusy(false);
      setErr(error);
    }
    // On success, Supabase redirects the browser away — no further action.
  }

  return (
    <div className="mx-auto max-w-md py-12 animate-fade-in">
      <h1 className="text-3xl font-bold tracking-tight mb-1">Sign in</h1>
      <p className="muted mb-6">Welcome back. Pick up where you left off.</p>

      {/* Google goes FIRST — the recognition badge + faster conversion path. */}
      <GoogleSignInButton
        label="Continue with Google"
        onClick={onGoogle}
        busy={busy}
      />

      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-slate-400">
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
        or sign in with email
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="label">Email</label>
          <input
            id="login-email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            disabled={busy}
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="login-password" className="label">Password</label>
            <Link to="/forgot-password" className="text-xs text-delta-600 hover:underline dark:text-delta-400">
              Forgot?
            </Link>
          </div>
          <input
            id="login-password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            minLength={6}
            disabled={busy}
          />
        </div>
        {err && (
          <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800 dark:bg-rose-900/20 dark:border-rose-800/40 dark:text-rose-200">
            {err}
          </div>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? <Spinner size={14} className="mr-2" /> : null}
          Sign in
        </button>
      </form>

      {/* New-user CTA. Previously a tiny grey text link tucked at the bottom;
          now it's a real outlined button so the "I don't have an account
          yet" path has the same visual weight as the existing-user paths
          above. The card framing also separates it from the sign-in form so
          new visitors immediately see the alternative without scanning. */}
      <div className="mt-8 rounded-xl border border-delta-200 bg-delta-50/40 p-4 text-center dark:border-delta-800/60 dark:bg-delta-900/15">
        <p className="text-sm text-slate-700 dark:text-slate-200 mb-3">
          New to Liganx? <span className="text-slate-500 dark:text-slate-400">Free tier — 50 free dockings: up to 2 targets, 2 mutations &amp; 50 compounds per run.</span>
        </p>
        <Link
          to={signupHref}
          className="inline-flex w-full items-center justify-center rounded-lg border-2 border-delta-500 bg-white px-4 py-2.5 text-[15px] font-semibold text-delta-700 shadow-sm transition-colors hover:bg-delta-50 active:bg-delta-100 dark:border-delta-400 dark:bg-slate-800 dark:text-delta-300 dark:hover:bg-slate-750"
        >
          Create an account
        </Link>
      </div>
    </div>
  );
}
