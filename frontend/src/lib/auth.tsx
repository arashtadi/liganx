// Auth context — wraps the app with the current Supabase session and exposes
// useAuth() / useUser() hooks. Components call these instead of poking at the
// Supabase client directly so the session lifecycle is consistent everywhere.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/** Acquisition-time profile metadata captured at sign-up. All optional;
 *  Supabase only requires email + password. Stored in
 *  `auth.users.raw_user_meta_data` for v1 — promoting to a typed table
 *  is a follow-up. Keep field names snake_case to match how they'll
 *  eventually surface as SQL columns. */
export interface SignupProfile {
  full_name?: string;
  organization?: string;        // free-text company / lab / university
  role?: string;                // dropdown enum, see SIGNUP_ROLES below
  researchgate_url?: string;    // optional academic profile link
  marketing_opt_in?: boolean;   // EU-default false; checked elsewhere
}

/** Canonical role choices offered on the sign-up form. Snake_case values
 *  store cleanly; the UI renders human-readable labels. Order matters —
 *  most-common first so the dropdown defaults land near the top. */
export const SIGNUP_ROLES: { value: string; label: string }[] = [
  { value: "grad_student",   label: "Graduate student" },
  { value: "postdoc",        label: "Postdoc" },
  { value: "pi",             label: "Principal Investigator" },
  { value: "industry_sci",   label: "Industry scientist" },
  { value: "comp_chem",      label: "Computational chemist / biologist" },
  { value: "med_chem",       label: "Medicinal chemist" },
  { value: "structural_bio", label: "Structural biologist" },
  { value: "undergrad",      label: "Undergraduate" },
  { value: "other",          label: "Other" },
];

export interface AuthState {
  /** Full Supabase Session. Null when signed out. Includes the access_token
   *  the backend will validate against JWKS — read it via session.access_token
   *  in api.ts to attach Authorization headers. */
  session: Session | null;
  /** Convenience getter — same as session?.user but without the optional chain. */
  user: User | null;
  /** True until the initial getSession() resolves. Use this to render a
   *  loading state on protected routes so we don't flash "Sign in" before
   *  realizing the user is already logged in via persisted localStorage. */
  loading: boolean;
  /** Whether the user has clicked the email-verification link. Email/password
   *  signup leaves this false until the link is clicked; POST /jobs is gated
   *  on this so unverified accounts can't burn GPU credit. */
  emailVerified: boolean;

  // Auth actions — thin wrappers around the Supabase client. Components use
  // these so the session-update side effect (re-render via setSession) is
  // handled in one place.
  /** Sign up with email/password + optional acquisition profile.
   *
   *  Profile fields go to Supabase's `auth.users.raw_user_meta_data`
   *  (readable later via `session.user.user_metadata`). We use this in
   *  v1 — no separate user_profile table — because it's the lightest
   *  path to capturing acquisition signals (org, role, marketing
   *  opt-in) without a DB migration. When we want SQL-queryable
   *  analytics, a follow-up migration mirrors the JSON into a typed
   *  table via a Postgres trigger. All profile fields are optional;
   *  only email + password are required by Supabase.
   */
  signUpWithPassword: (
    email: string,
    password: string,
    profile?: SignupProfile,
  ) => Promise<{ error: string | null }>;
  signInWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** Trigger a fresh verification email if the user lost the original. */
  resendVerification: (email: string) => Promise<{ error: string | null }>;
}

// Exported so the build-time prerender (src/prerender/entry.tsx) can wrap
// marketing pages in a static, logged-out auth context WITHOUT booting the
// real AuthProvider (which runs window/localStorage-touching effects). Runtime
// app code should keep using <AuthProvider> + useAuth(), not this directly.
export const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: read the persisted session from localStorage (Supabase handles
  // the storage; we just await its resolution). Subscribe to onAuthStateChange
  // so subsequent sign-in / sign-out events update the context everywhere.
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(() => {
    const user = session?.user ?? null;
    const emailVerified = !!user?.email_confirmed_at;

    return {
      session,
      user,
      loading,
      emailVerified,
      async signUpWithPassword(email, password, profile) {
        // Build the user_metadata payload Supabase will store on
        // auth.users.raw_user_meta_data. Drop empty/undefined fields so
        // we don't pollute the JSON with nulls. `marketing_opt_in` is
        // explicit boolean — preserve it even when false.
        const data: Record<string, unknown> = {};
        if (profile?.full_name?.trim())        data.full_name        = profile.full_name.trim();
        if (profile?.organization?.trim())     data.organization     = profile.organization.trim();
        if (profile?.role)                     data.role             = profile.role;
        if (profile?.researchgate_url?.trim()) data.researchgate_url = profile.researchgate_url.trim();
        if (typeof profile?.marketing_opt_in === "boolean") {
          data.marketing_opt_in = profile.marketing_opt_in;
        }
        // Stamp acquisition timestamp + source so we can later filter
        // analytics by signup-cohort or referrer without storing it
        // elsewhere. signup_source is "email" here; the OAuth path
        // (signInWithGoogle) doesn't currently capture profile data.
        data.signup_source = "email";
        data.signup_at = new Date().toISOString();

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            // Where Supabase sends users after they click the verification
            // link in their inbox. Lands on a page that auto-detects the
            // session hash and redirects to /new.
            emailRedirectTo: `${window.location.origin}/verify-email`,
            data,
          },
        });
        return { error: error?.message ?? null };
      },
      async signInWithPassword(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        return { error: error?.message ?? null };
      },
      async signInWithGoogle() {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/verify-email`,
            // Force Google's account chooser every time. Without
            // prompt=select_account, Google silently re-uses the only
            // signed-in browser session — meaning a user who signs out
            // of Liganx and clicks "Sign in with Google" again gets
            // sent right back into the same Google account with no way
            // to switch. Most noticeable in Safari, where typically
            // just one Google account is signed in (Chrome usually has
            // multiple, in which case Google shows the chooser by
            // default). 2026-05-04 user report. Trade-off is one
            // extra chooser click when only one account is active —
            // small price for the ability to switch accounts.
            queryParams: { prompt: "select_account" },
          },
        });
        return { error: error?.message ?? null };
      },
      async resetPassword(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        return { error: error?.message ?? null };
      },
      async signOut() {
        await supabase.auth.signOut();
      },
      async resendVerification(email) {
        const { error } = await supabase.auth.resend({ type: "signup", email });
        return { error: error?.message ?? null };
      },
    };
  }, [session, loading]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Shortcut hook for components that only need the User object. Returns null
 *  when signed out. */
export function useUser(): User | null {
  return useAuth().user;
}
