// Auth context — wraps the app with the current Supabase session and exposes
// useAuth() / useUser() hooks. Components call these instead of poking at the
// Supabase client directly so the session lifecycle is consistent everywhere.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface AuthState {
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
  signUpWithPassword: (
    email: string,
    password: string,
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

const AuthCtx = createContext<AuthState | null>(null);

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
      async signUpWithPassword(email, password) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            // Where Supabase sends users after they click the verification
            // link in their inbox. Lands on a page that auto-detects the
            // session hash and redirects to /new.
            emailRedirectTo: `${window.location.origin}/verify-email`,
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
          options: { redirectTo: `${window.location.origin}/verify-email` },
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
