// Reset-password landing page.
//
// Supabase's password-reset email (resetPasswordForEmail) links here with a
// recovery token in the URL hash. The Supabase client's detectSessionInUrl:true
// (see lib/supabase.ts) processes that token on mount and establishes a
// temporary PASSWORD_RECOVERY session — so once auth finishes loading, useAuth()
// has a user and supabase.auth.updateUser({ password }) succeeds.
//
// Without this page the reset link (redirectTo: /reset-password) 404s, so a user
// could request a reset but never actually set a new password. This page closes
// that gap.

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { Spinner } from "../components/Icons";

export default function ResetPasswordPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (pw !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setDone(true);
    setTimeout(() => navigate("/studio", { replace: true }), 1200);
  }

  // Still resolving the recovery session from the URL.
  if (loading) {
    return (
      <div className="mx-auto max-w-md py-16 text-center text-slate-500 dark:text-slate-400">
        <Spinner size={20} className="inline mr-2" />
        Loading…
      </div>
    );
  }

  // No recovery session — link invalid, already used, or expired.
  if (!user) {
    return (
      <div className="mx-auto max-w-md py-16 text-center animate-fade-in">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Link expired</h1>
        <p className="text-slate-700 dark:text-slate-300 mb-6">
          This password-reset link is invalid or has already been used. Request a
          fresh one and try again.
        </p>
        <Link to="/forgot-password" className="btn btn-primary">
          Send a new reset link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md py-16 text-center animate-fade-in">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Password updated</h1>
        <p className="text-slate-700 dark:text-slate-300">Signing you in…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-12 animate-fade-in">
      <h1 className="text-3xl font-bold tracking-tight mb-1">Choose a new password</h1>
      <p className="muted mb-6">
        Setting a new password for{" "}
        <span className="font-mono font-semibold">{user.email}</span>.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">New password</label>
          <input
            type="password"
            className="input"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            required
            disabled={busy}
          />
        </div>
        <div>
          <label className="label">Confirm new password</label>
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
          Update password
        </button>
      </form>

      <p className="mt-6 text-sm text-center text-slate-600 dark:text-slate-400">
        <Link to="/login" className="text-delta-600 hover:underline dark:text-delta-400 font-semibold">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
