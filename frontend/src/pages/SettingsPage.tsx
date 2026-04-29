/**
 * SettingsPage — user profile / account settings.
 *
 * Four sections:
 *   1. Profile picture — file upload, resized client-side to a 128 px
 *      square JPEG and stored as a base64 data URL in Supabase
 *      user_metadata.avatar_url. We avoid Supabase Storage on purpose
 *      to keep the surface area small (no extra bucket, no RLS policies,
 *      no signed-URL plumbing). 128×128 JPEG q=0.85 is typically <30 KB
 *      which fits comfortably under user_metadata's ~50 KB soft cap.
 *
 *   2. Email — supabase.auth.updateUser({ email }) sends a verification
 *      link to the NEW address. The email only flips after the user
 *      clicks that link, so we surface a "verification sent" notice
 *      instead of pretending the change is instant.
 *
 *   3. Password — supabase.auth.updateUser({ password }). Works for
 *      Google-OAuth-only users too: it adds a password as a backup
 *      sign-in method without breaking Google sign-in. We say so in
 *      the helper text rather than hiding the section for them.
 *
 *   4. Doc Flask tour — wraps the same localStorage flag the in-tour
 *      checkbox writes. ON → tour fires on every /new visit. OFF →
 *      tour stays dismissed.
 *
 * Auth state (and hence avatar URL / email) updates flow through
 * supabase.auth.onAuthStateChange in AuthProvider, so saving here
 * propagates to the header avatar without a page reload.
 */

import { useState } from "react";
import type { ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  isDocFlaskTourDismissed,
  resetDocFlaskTour,
  dismissDocFlaskTour,
} from "../components/DocFlask/DocFlaskTour";
import { Spinner } from "../components/Icons";

export default function SettingsPage() {
  const { user } = useAuth();

  if (!user) {
    // RequireAuth in App.tsx already gates this route, but render a
    // graceful fallback in case the user signs out from another tab
    // mid-render.
    return (
      <div className="card max-w-2xl mx-auto text-center">
        <p className="muted">You need to be signed in to view settings.</p>
        <div className="mt-4">
          <Link to="/login" className="btn-primary btn-sm">Sign in</Link>
        </div>
      </div>
    );
  }

  const initialAvatar =
    (user.user_metadata?.avatar_url as string | undefined) || "";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink dark:text-white">Settings</h1>
        <p className="muted mt-1">
          Account, security, and tour preferences. Changes here apply to your
          Liganx account everywhere you're signed in.
        </p>
      </header>

      <ProfilePictureCard userEmail={user.email ?? ""} initialAvatarUrl={initialAvatar} />
      <EmailCard currentEmail={user.email ?? ""} />
      <PasswordCard
        signedInWithPasswordOnly={!user.app_metadata?.providers?.some(
          (p: string) => p !== "email",
        )}
      />
      <DocFlaskCard />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Profile picture                                                            */
/* -------------------------------------------------------------------------- */

interface ProfilePictureProps {
  userEmail: string;
  initialAvatarUrl: string;
}
function ProfilePictureCard({ userEmail, initialAvatarUrl }: ProfilePictureProps) {
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Pull the first letter for the placeholder. Mirrors UserMenu's logic so
  // the header avatar and the page avatar stay in sync visually.
  const initial = (userEmail[0] || "?").toUpperCase();

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null); setOk(null);
    if (!file.type.startsWith("image/")) {
      setErr("Please choose an image file (PNG, JPG, GIF, or WebP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr("That file is too large. Pick an image under 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await resizeImage(file, 128, 0.85);
      const { error } = await supabase.auth.updateUser({
        data: { avatar_url: dataUrl },
      });
      if (error) throw new Error(error.message);
      setAvatarUrl(dataUrl);
      setOk("Profile picture updated.");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Couldn't update profile picture.");
    } finally {
      setBusy(false);
      // Clear the input so picking the same file again still triggers onChange.
      e.target.value = "";
    }
  }

  async function handleRemove() {
    setBusy(true);
    setErr(null); setOk(null);
    try {
      // We set avatar_url to null rather than deleting the key so the
      // header falls back to the initial-letter placeholder.
      const { error } = await supabase.auth.updateUser({
        data: { avatar_url: null },
      });
      if (error) throw new Error(error.message);
      setAvatarUrl("");
      setOk("Profile picture removed.");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Couldn't remove profile picture.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="text-lg font-semibold text-ink dark:text-white">Profile picture</h2>
      <p className="muted mt-1 text-sm">
        Shown in the top-right avatar and on shared job links. Resized to 128 ×
        128 before upload — keep it small.
      </p>

      <div className="mt-4 flex items-center gap-5">
        <div className="shrink-0 w-20 h-20 rounded-full overflow-hidden bg-delta-100 dark:bg-delta-900/40 ring-1 ring-slate-200 dark:ring-slate-700 flex items-center justify-center">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl font-semibold text-delta-700 dark:text-delta-200">{initial}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <label
              className={`btn-secondary btn-sm cursor-pointer ${busy ? "opacity-60 pointer-events-none" : ""}`}
            >
              {busy ? "Working…" : avatarUrl ? "Replace" : "Upload"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={handleFile}
                disabled={busy}
              />
            </label>
            {avatarUrl && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy}
                className="text-xs text-rose-700 dark:text-rose-300 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
          {err && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{err}</p>}
          {ok && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{ok}</p>}
        </div>
      </div>
    </section>
  );
}

/** Resize an image File to a square `size`-px JPEG data URL. We render to a
 *  canvas, center-crop to a square, and export at the supplied JPEG quality.
 *  All client-side — no upload, no extra dependency. */
async function resizeImage(file: File, size: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported in this browser.");

  // Center-crop to a square so non-square uploads don't get stretched.
  const sourceSize = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - sourceSize) / 2;
  const sy = (bitmap.height - sourceSize) / 2;
  ctx.drawImage(bitmap, sx, sy, sourceSize, sourceSize, 0, 0, size, size);

  return canvas.toDataURL("image/jpeg", quality);
}

/* -------------------------------------------------------------------------- */
/* Email                                                                      */
/* -------------------------------------------------------------------------- */

function EmailCard({ currentEmail }: { currentEmail: string }) {
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setOk(null);
    const target = newEmail.trim().toLowerCase();
    if (!target || target === currentEmail.toLowerCase()) {
      setErr("Enter a different email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setErr("That doesn't look like a valid email.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: target });
      if (error) throw new Error(error.message);
      setOk(
        `Verification email sent to ${target}. Click the link there to finish the change — your current email stays active until you do.`,
      );
      setNewEmail("");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Couldn't update email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="text-lg font-semibold text-ink dark:text-white">Email address</h2>
      <p className="muted mt-1 text-sm">
        Currently <span className="font-medium text-ink dark:text-slate-200">{currentEmail}</span>.
        Changing it sends a verification link to the new address — the change
        only takes effect after you click that link.
      </p>
      <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
            New email
          </label>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            disabled={busy}
            placeholder="you@new-address.com"
            className="input"
          />
        </div>
        <button type="submit" disabled={busy || !newEmail} className="btn-primary btn-sm">
          {busy ? <><Spinner size={14} className="mr-1.5" /> Sending…</> : "Send verification"}
        </button>
      </form>
      {err && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{err}</p>}
      {ok && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{ok}</p>}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Password                                                                   */
/* -------------------------------------------------------------------------- */

function PasswordCard({ signedInWithPasswordOnly }: { signedInWithPasswordOnly: boolean }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setOk(null);
    if (pw.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (pw !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw new Error(error.message);
      setOk("Password updated. You'll use the new one next time you sign in.");
      setPw("");
      setConfirm("");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Couldn't update password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="text-lg font-semibold text-ink dark:text-white">Password</h2>
      <p className="muted mt-1 text-sm">
        {signedInWithPasswordOnly
          ? "Set a new password for sign-in. You'll be signed out of other devices on the next page load."
          : "You sign in with Google. You can also set a password here as a backup login method — Google sign-in keeps working either way."}
      </p>
      <form onSubmit={submit} className="mt-4 grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
            New password
          </label>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={busy}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            className="input"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
            Confirm new password
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
            placeholder="Type it again"
            autoComplete="new-password"
            className="input"
          />
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button type="submit" disabled={busy || !pw || !confirm} className="btn-primary btn-sm">
            {busy ? <><Spinner size={14} className="mr-1.5" /> Updating…</> : "Update password"}
          </button>
          {err && <span className="text-xs text-rose-600 dark:text-rose-400">{err}</span>}
          {ok && <span className="text-xs text-emerald-600 dark:text-emerald-400">{ok}</span>}
        </div>
      </form>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Doc Flask tour toggle                                                      */
/* -------------------------------------------------------------------------- */

function DocFlaskCard() {
  // Read once on mount; toggling updates immediately. We don't subscribe to
  // localStorage events because nothing else writes this key while the page
  // is open (the in-tour checkbox lives on /new).
  const [enabled, setEnabled] = useState(() => !isDocFlaskTourDismissed());

  function toggle() {
    if (enabled) {
      // Was on → turn off → persist dismissed flag.
      dismissDocFlaskTour();
      setEnabled(false);
    } else {
      // Was off → turn on → clear the flag. resetDocFlaskTour also dispatches
      // the docflask:show event, but we're not on /new, so the listener just
      // ignores it. The flag is what matters: next /new visit, the tour
      // will fire on settle.
      resetDocFlaskTour();
      setEnabled(true);
    }
  }

  return (
    <section className="card">
      <h2 className="text-lg font-semibold text-ink dark:text-white">Doc Flask tour</h2>
      <p className="muted mt-1 text-sm">
        The first-run walkthrough on the New Job page. When ON, Doc Flask
        appears every visit. When OFF, the tour stays hidden until you turn
        it back on (or click "Show Doc Flask tour" in the avatar menu).
      </p>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40 px-4 py-3">
        <div>
          <div className="text-sm font-medium text-ink dark:text-slate-100">
            Show Doc Flask on the New Job page
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {enabled
              ? "Currently on — the tour will appear next time you open New Job."
              : "Currently off — you've opted out of the walkthrough."}
          </div>
        </div>
        <button
          type="button"
          onClick={toggle}
          role="switch"
          aria-checked={enabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? "bg-delta-600" : "bg-slate-300 dark:bg-slate-600"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </section>
  );
}
