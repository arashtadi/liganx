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
 * (Doc Flask tour card was removed 2026-05-12 along with the mascot itself.)
 *
 * Auth state (and hence avatar URL / email) updates flow through
 * supabase.auth.onAuthStateChange in AuthProvider, so saving here
 * propagates to the header avatar without a page reload.
 */

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth, SIGNUP_ROLES } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { api, ApiError } from "../api";
import type { UserProfile } from "../api";
// DocFlask tour helpers removed 2026-05-12 — first-run mascot retired.
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
      <ProfileFieldsCard />
      <EmailCard
        currentEmail={user.email ?? ""}
        signedInWithGoogle={
          !!user.app_metadata?.providers?.some((p: string) => p !== "email")
        }
      />
      <PasswordCard
        signedInWithPasswordOnly={!user.app_metadata?.providers?.some(
          (p: string) => p !== "email",
        )}
      />
      {/* DocFlaskCard removed 2026-05-12 — first-run mascot retired. */}
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

function EmailCard({ currentEmail, signedInWithGoogle }: { currentEmail: string; signedInWithGoogle: boolean }) {
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

  // Google/OAuth users: their login is bound to their Google account, so
  // changing the app email here would not change how they sign in and could
  // desync on the next Google login. Show an informational note instead.
  if (signedInWithGoogle) {
    return (
      <section className="card">
        <h2 className="text-lg font-semibold text-ink dark:text-white">Email address</h2>
        <p className="muted mt-1 text-sm">
          You sign in with Google, so your email{" "}
          <span className="font-medium text-ink dark:text-slate-200">{currentEmail}</span>{" "}
          comes from your Google account. To use a different address, sign in
          with that Google account instead.
        </p>
      </section>
    );
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

  // Google/OAuth users log in through Google — there is no separate password
  // to manage here. (If they ever needed an email/password login they could
  // still create one via the "Forgot password" flow.)
  if (!signedInWithPasswordOnly) {
    return (
      <section className="card">
        <h2 className="text-lg font-semibold text-ink dark:text-white">Password</h2>
        <p className="muted mt-1 text-sm">
          You sign in with Google, so there is no password to manage here —
          your Google account is your login.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 className="text-lg font-semibold text-ink dark:text-white">Password</h2>
      <p className="muted mt-1 text-sm">
        Set a new password for sign-in. You'll be signed out of other devices on
        the next page load.
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
/* Doc Flask tour toggle — REMOVED 2026-05-12 (mascot retired).               */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Profile fields                                                             */
/* -------------------------------------------------------------------------- */
//
// Editable mirror of the sign-up form: full_name, organization, role,
// ResearchGate URL, marketing opt-in. Reads from /me/profile (typed
// public.user_profile), writes via PUT /me/profile. The Supabase
// user_metadata JSON stays in sync from the metadata side via the
// trigger; writes from this card update the typed table directly,
// which is the source of truth the History/Insights UI reads from.
//
// Why a separate card instead of bundling into the Profile picture
// card: keeps the diff readable, lets us add/remove fields here
// without touching the avatar upload logic, and matches the visual
// pattern of the existing Email/Password cards.

function ProfileFieldsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Single source of truth for the form state. We hydrate it from
  // GET /me/profile on mount; on save we PUT back the diff and
  // refresh from the server response so any server-side normalization
  // (e.g. trimming, role validation) is reflected in the UI.
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let mounted = true;
    api.getMyProfile()
      .then((p) => {
        if (mounted) {
          setProfile(p);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (mounted) {
          setErr(e instanceof ApiError ? e.message : "Failed to load profile");
          setLoading(false);
        }
      });
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return (
      <section className="card p-6">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Spinner size={14} /> Loading profile…
        </div>
      </section>
    );
  }
  if (!profile) {
    return null;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setErr(null);
    setOk(null);
    // Soft-validate ResearchGate URL — same rule as sign-up.
    if (profile.researchgate_url && !/^https?:\/\//i.test(profile.researchgate_url)) {
      setErr("ResearchGate URL must start with https://");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateMyProfile({
        full_name: profile.full_name ?? "",
        organization: profile.organization ?? "",
        role: profile.role ?? "",
        researchgate_url: profile.researchgate_url ?? "",
        marketing_opt_in: profile.marketing_opt_in,
      });
      setProfile(updated);
      setOk("Saved");
      // Auto-clear the success message after 3 s so the panel doesn't
      // accumulate stale "Saved" notices.
      setTimeout(() => setOk(null), 3000);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-ink dark:text-white mb-1">
        Profile
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
        These details help us tailor Liganx to your work and credit your contributions back to you.
      </p>

      <form onSubmit={onSave} className="space-y-4">
        <div>
          <label className="label">Full name</label>
          <input
            type="text"
            className="input"
            value={profile.full_name ?? ""}
            onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
            disabled={saving}
            placeholder="Jane Smith"
          />
        </div>
        <div>
          <label className="label">Company / Institution</label>
          <input
            type="text"
            className="input"
            value={profile.organization ?? ""}
            onChange={(e) => setProfile({ ...profile, organization: e.target.value })}
            disabled={saving}
            placeholder="MIT, Genentech, Stanford…"
          />
        </div>
        <div>
          <label className="label">Role</label>
          <select
            className="input"
            value={profile.role ?? ""}
            onChange={(e) => setProfile({ ...profile, role: e.target.value })}
            disabled={saving}
          >
            <option value="">— Select —</option>
            {SIGNUP_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">ResearchGate profile</label>
          <input
            type="url"
            className="input"
            value={profile.researchgate_url ?? ""}
            onChange={(e) => setProfile({ ...profile, researchgate_url: e.target.value })}
            disabled={saving}
            placeholder="https://www.researchgate.net/profile/…"
          />
        </div>
        <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
          <input
            type="checkbox"
            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-delta-600 focus:ring-delta-500 dark:border-slate-600 dark:bg-slate-800"
            checked={profile.marketing_opt_in}
            onChange={(e) => setProfile({ ...profile, marketing_opt_in: e.target.checked })}
            disabled={saving}
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
        {ok && (
          <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-800/40 dark:text-emerald-200">
            {ok}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Spinner size={14} className="mr-2" /> : null}
            Save profile
          </button>
        </div>
      </form>
    </section>
  );
}
