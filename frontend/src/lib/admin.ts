// Admin identity (frontend UX gate). MUST match the backend ADMIN_EMAIL env
// var (auth.py admin_user) and the ADMIN_EMAIL constant in App.tsx — the
// backend admin_user dependency is the real authority; this only decides what
// the UI shows. If you rotate the admin, update all three in lockstep.
export const ADMIN_EMAIL = "arashtadi@gmail.com";

export function isAdminEmail(email?: string | null): boolean {
  return (email || "").toLowerCase() === ADMIN_EMAIL;
}
