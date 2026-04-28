// Sign-in page. Email + password is the primary path; Google sign-in is the
// secondary CTA. Forgot-password link sends a magic email via Supabase.

import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/Icons";

export default function LoginPage() {
  const { signInWithPassword, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  // Where to send the user after sign-in. Defaults to /new — the most common
  // post-login destination. ?next=/history sends them to history (used when
  // a protected link redirected them here).
  const next = search.get("next") || "/new";

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

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">Email</label>
          <input
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
            <label className="label">Password</label>
            <Link to="/forgot-password" className="text-xs text-delta-600 hover:underline dark:text-delta-400">
              Forgot?
            </Link>
          </div>
          <input
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

      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-slate-400">
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" /> or
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      </div>

      <button
        type="button"
        onClick={onGoogle}
        disabled={busy}
        className="btn btn-secondary w-full"
      >
        Continue with Google
      </button>

      <p className="mt-6 text-sm text-center text-slate-600 dark:text-slate-400">
        New to Liganx?{" "}
        <Link to={`/signup${search.get("next") ? `?next=${encodeURIComponent(search.get("next")!)}` : ""}`} className="text-delta-600 hover:underline dark:text-delta-400 font-semibold">
          Create an account
        </Link>
      </p>
    </div>
  );
}
