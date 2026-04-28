// Forgot-password page. Asks for the email, fires Supabase's
// resetPasswordForEmail (which mails a reset link), then shows a "check
// inbox" success state.

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/Icons";

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await resetPassword(email.trim());
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md py-12 animate-fade-in">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Check your inbox</h1>
        <p className="text-slate-700 dark:text-slate-300 mb-6">
          If an account exists for <span className="font-mono font-semibold">{email}</span>,
          we just sent it a password reset link.
        </p>
        <Link to="/login" className="btn btn-primary">Back to sign in</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-12 animate-fade-in">
      <h1 className="text-3xl font-bold tracking-tight mb-1">Reset your password</h1>
      <p className="muted mb-6">
        We'll email you a link to set a new password.
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
        {err && (
          <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800 dark:bg-rose-900/20 dark:border-rose-800/40 dark:text-rose-200">
            {err}
          </div>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? <Spinner size={14} className="mr-2" /> : null}
          Send reset link
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
