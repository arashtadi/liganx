// Landing page for the email-verification redirect.
//
// When a user clicks the link in their inbox, Supabase redirects them here
// with the session in the URL hash (`#access_token=...&refresh_token=...`).
// The Supabase client's detectSessionInUrl: true picks that up automatically
// — by the time this page mounts, useAuth() has the refreshed session and
// emailVerified should be true. We poll briefly and then redirect to /new.
//
// Also used as the OAuth (Google) redirect target for the same reason.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Spinner } from "../components/Icons";

export default function VerifyEmailPage() {
  const { user, loading, emailVerified, resendVerification } = useAuth();
  const navigate = useNavigate();
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  // If we already have a verified session by the time the page renders,
  // skip straight to /new. Use a small timeout so the success message is
  // visible for a moment.
  useEffect(() => {
    if (loading) return;
    if (user && emailVerified) {
      const t = setTimeout(() => navigate("/new", { replace: true }), 1000);
      return () => clearTimeout(t);
    }
  }, [loading, user, emailVerified, navigate]);

  if (loading) {
    return (
      <div className="mx-auto max-w-md py-16 text-center text-slate-500 dark:text-slate-400">
        <Spinner size={20} className="inline mr-2" />
        Verifying…
      </div>
    );
  }

  if (user && emailVerified) {
    return (
      <div className="mx-auto max-w-md py-16 text-center animate-fade-in">
        <h1 className="text-3xl font-bold tracking-tight mb-2">You're in.</h1>
        <p className="text-slate-700 dark:text-slate-300">
          Redirecting to your first docking job…
        </p>
      </div>
    );
  }

  if (user && !emailVerified) {
    return (
      <div className="mx-auto max-w-md py-16 animate-fade-in">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Almost there</h1>
        <p className="text-slate-700 dark:text-slate-300 mb-4">
          Click the verification link we sent to{" "}
          <span className="font-mono font-semibold">{user.email}</span>.
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Didn't get it? Check your spam folder, or send another:
        </p>
        <button
          type="button"
          className="btn btn-secondary w-full"
          disabled={resendBusy}
          onClick={async () => {
            if (!user.email) return;
            setResendBusy(true);
            setResendMsg(null);
            const { error } = await resendVerification(user.email);
            setResendBusy(false);
            setResendMsg(error || "Sent — check your inbox.");
          }}
        >
          {resendBusy ? <Spinner size={14} className="mr-2" /> : null}
          Resend verification email
        </button>
        {resendMsg && (
          <p className="text-sm mt-3 text-slate-600 dark:text-slate-400">{resendMsg}</p>
        )}
      </div>
    );
  }

  // No user — link expired or signed out
  return (
    <div className="mx-auto max-w-md py-16 text-center animate-fade-in">
      <h1 className="text-3xl font-bold tracking-tight mb-2">Link expired</h1>
      <p className="text-slate-700 dark:text-slate-300 mb-6">
        Try signing in again to get a fresh link.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => navigate("/login", { replace: true })}
      >
        Back to sign in
      </button>
    </div>
  );
}
