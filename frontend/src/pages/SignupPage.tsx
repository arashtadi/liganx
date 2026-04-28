// Sign-up page. Same shape as login but with a confirm-password field and a
// success message that explains the email-verification gate.

import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/Icons";

export default function SignupPage() {
  const { signUpWithPassword, signInWithGoogle } = useAuth();
  const [search] = useSearchParams();
  const next = search.get("next") || "/new";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setErr("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    const { error } = await signUpWithPassword(email.trim(), password);
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    setDone(true);
  }

  async function onGoogle() {
    setErr(null);
    setBusy(true);
    const { error } = await signInWithGoogle();
    if (error) {
      setBusy(false);
      setErr(error);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md py-12 animate-fade-in">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Check your inbox</h1>
        <p className="text-slate-700 dark:text-slate-300 mb-4">
          We sent a verification link to <span className="font-mono font-semibold">{email}</span>.
          Click it to activate your account, then sign in.
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Didn't get an email? Check spam, or wait 60s and try signing up again from this address.
        </p>
        <Link to="/login" className="btn btn-primary">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-12 animate-fade-in">
      <h1 className="text-3xl font-bold tracking-tight mb-1">Create an account</h1>
      <p className="muted mb-6">
        Free tier: 2 targets, 2 mutations, 5 compounds per submit.
      </p>

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
          <label className="label">Password</label>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            disabled={busy}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Minimum 8 characters.
          </p>
        </div>
        <div>
          <label className="label">Confirm password</label>
          <input
            type="password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
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
          Create account
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
        Already have an account?{" "}
        <Link to={`/login${next !== "/new" ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-delta-600 hover:underline dark:text-delta-400 font-semibold">
          Sign in
        </Link>
      </p>
    </div>
  );
}
