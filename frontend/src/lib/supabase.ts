// Supabase client singleton.
//
// The publishable key (sb_publishable_*) is safe to expose in the browser
// bundle — Row-Level Security policies on the database are what enforce
// who can read/write what data. The frontend never queries Postgres
// tables directly anyway; it goes through our FastAPI backend at
// VITE_API_URL, which validates the user's JWT against Supabase JWKS.
//
// The Supabase client here is used purely for the auth flow (signup, login,
// session refresh, password reset, email verification).

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Throw at import time so misconfigured deploys fail loud instead of
  // showing a broken login form.
  throw new Error(
    "Supabase config missing: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY",
  );
}

export const supabase = createClient(url, key, {
  auth: {
    // Persist the session in localStorage so users stay logged in across
    // tabs and reloads.
    persistSession: true,
    autoRefreshToken: true,
    // Don't auto-detect URL hash on every page — the only place we expect
    // an auth-redirect URL fragment is /verify-email after the user clicks
    // the link in their inbox.
    detectSessionInUrl: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});
