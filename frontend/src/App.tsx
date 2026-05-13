import { useEffect, useRef, useState } from "react";
import { Routes, Route, Link, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
// NewJobPage import removed 2026-05-08 — /new now redirects to /studio
// and the page is no longer mounted on any route. The file itself still
// lives in src/pages/NewJobPage.tsx in case we need to grep its history,
// but it's no longer in the bundle.
import JobPage from "./pages/JobPage";
import ScreeningPage from "./pages/ScreeningPage";
import LibraryPage from "./pages/LibraryPage";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";
import SuitePage from "./pages/SuitePage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import ValidationPage from "./pages/ValidationPage";
import CompleteProfilePage from "./pages/CompleteProfilePage";
import CompoundsPage from "./pages/CompoundsPage";
import MutationDockingGuidePage from "./pages/MutationDockingGuidePage";
import ContactPage from "./pages/ContactPage";
import AdminPage from "./pages/AdminPage";
import StudioPage from "./pages/StudioPage";
import BlogIndexPage from "./pages/BlogIndexPage";
import BlogPostPage from "./pages/BlogPostPage";
import AtlasPage from "./pages/AtlasPage";
import CalibratePage from "./pages/CalibratePage";

// Admin email — must match the ADMIN_EMAIL env var on the backend
// (Fly secret). Used only to show/hide the user-menu entry; the real
// authority is the backend's admin_user dependency. If you rotate the
// admin, update both this constant and the Fly secret in lockstep.
const ADMIN_EMAIL = "arashtadi@gmail.com";
import { LogoMark, Spinner } from "./components/Icons";
import ErrorBoundary from "./components/ErrorBoundary";

/**
 * Per-route ErrorBoundary helper. Wraps a route element so that any
 * render exception in the route's component tree renders the friendly
 * recovery card instead of unmounting the whole React tree (which used
 * to give the user a blank white page). routeName is plumbed into the
 * fallback copy + the support-email subject so we can tell where the
 * crash happened from a bug report alone.
 */
function withBoundary(element: React.ReactNode, routeName: string): React.ReactNode {
  return <ErrorBoundary routeName={routeName}>{element}</ErrorBoundary>;
}
// (v0.28) ThemeToggle import removed — site is dark-only now.
// import ThemeToggle from "./components/ThemeToggle";
import { AuthProvider, useAuth } from "./lib/auth";
import { api } from "./api";
// DocFlaskTour was removed 2026-05-12 — first-run mascot/tour retired.
// Component files under components/DocFlask/ have been deleted.

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col">
        <Header />
        <Main>
          <Routes>
            {/* Every route element wrapped in <ErrorBoundary> so a render
                exception in one page surfaces a recovery card instead of
                unmounting the whole React tree (blank white page). Route
                name is plumbed for the support-email subject. */}
            <Route path="/" element={withBoundary(<HomePage />, "Home")} />
            {/* Legacy /new — NewJobPage retired 2026-05-08, all flows
                consolidated into Studio. Permanent redirect so old
                bookmarks, email links, and any caller still calling
                navigate("/new") all land in /studio without a 404. */}
            <Route path="/new" element={<Navigate to="/studio" replace />} />
            <Route path="/studio" element={withBoundary(<RequireAuth><StudioPage /></RequireAuth>, "Studio")} />
            <Route path="/history" element={withBoundary(<RequireAuth><HistoryPage /></RequireAuth>, "History")} />
            <Route path="/settings" element={withBoundary(<RequireAuth><SettingsPage /></RequireAuth>, "Settings")} />
            <Route path="/welcome" element={withBoundary(<RequireAuth><CompleteProfilePage /></RequireAuth>, "Welcome / Profile")} />
            <Route path="/compounds" element={withBoundary(<RequireAuth><CompoundsPage /></RequireAuth>, "My Compounds")} />
            <Route path="/jobs/:id" element={withBoundary(<JobPage />, "Job results")} />
            {/* Public — anyone with the share_id can view the ranked
                hit list. Like /jobs/:id, this is read-only and we
                rely on share_id being a random token, not a sequential
                int, so guessing isn't tractable. */}
            <Route path="/screening/:shareId" element={withBoundary(<ScreeningPage />, "Screening results")} />
            <Route path="/library" element={withBoundary(<LibraryPage />, "Library")} />
            {/* v1.23 P1.4: public landing pages for pre-computed library
                screenings. Same ScreeningPage component renders these in
                read-only mode (no Promote / Cancel buttons); fetcher is
                /library/precomputed/{slug} instead of /screening/{id}.
                SEO-friendly URLs — every snapshot has its own page. */}
            <Route path="/library/precomputed/:slug" element={withBoundary(<ScreeningPage />, "Pre-computed screening")} />
            <Route path="/suite" element={withBoundary(<SuitePage />, "Suite")} />
            <Route path="/login" element={withBoundary(<LoginPage />, "Sign in")} />
            <Route path="/signup" element={withBoundary(<SignupPage />, "Sign up")} />
            <Route path="/verify-email" element={withBoundary(<VerifyEmailPage />, "Verify email")} />
            <Route path="/forgot-password" element={withBoundary(<ForgotPasswordPage />, "Forgot password")} />
            <Route path="/privacy" element={withBoundary(<PrivacyPage />, "Privacy")} />
            <Route path="/terms" element={withBoundary(<TermsPage />, "Terms")} />
            <Route path="/validation" element={withBoundary(<ValidationPage />, "Validation")} />
            <Route path="/mutation-docking-guide" element={withBoundary(<MutationDockingGuidePage />, "Mutation docking guide")} />
            <Route path="/contact" element={withBoundary(<ContactPage />, "Contact")} />
            {/* Blog — public, indexed by Google. /blog is the listing,
                /blog/:slug renders one post. Posts are .tsx modules
                under src/blog/posts/, discovered at build time via
                import.meta.glob (see src/blog/registry.ts). */}
            <Route path="/blog" element={withBoundary(<BlogIndexPage />, "Blog")} />
            <Route path="/blog/:slug" element={withBoundary(<BlogPostPage />, "Blog post")} />
            <Route path="/atlas" element={withBoundary(<AtlasPage />, "Atlas")} />
            {/* Pro feature: score user-uploaded (drug, mutation) data
                against the calibrated 2-signal model. Free tier = 10
                rows / request, ESM2-cache + BLOSUM proxy. Pro tier
                (Stripe-stubbed) = unlimited rows + real GPU docking. */}
            <Route path="/atlas/calibrate" element={withBoundary(<CalibratePage />, "Calibrate your data")} />
            <Route path="/atlas/:slug" element={withBoundary(<AtlasPage />, "Atlas drug page")} />
            <Route path="/admin" element={withBoundary(<AdminPage />, "Admin")} />
            {/* Capital-A alias so /Admin (which is what user typed) works
                too. Without this React Router would 404 because routes
                are case-sensitive. */}
            <Route path="/Admin" element={<Navigate to="/admin" replace />} />
            {/* Catch-all 404 — used to leak through as a blank page */}
            <Route path="*" element={withBoundary(<NotFound />, "Not Found")} />
          </Routes>
        </Main>
        <FooterUnlessStudio />
        {/* DocFlaskTour removed 2026-05-12 — first-run mascot retired. */}
        {/* On first sign-in (and only first sign-in), redirects to the
            full-page /welcome onboarding form. Replaces the previous
            popup-modal pattern — users prefer a real page where they
            can take their time over a modal that feels like a blocker. */}
        <ProfileRedirect />
      </div>
    </AuthProvider>
  );
}

/**
 * Page wrapper that decides whether to constrain the column.
 *
 * Internal pages (NewJob, History, Job, Settings, Library, etc.) are dense
 * data UIs that read better in a centered max-w-6xl column with horizontal
 * padding — exactly what we had before. The marketing HomePage at "/", on
 * the other hand, wants to do edge-to-edge gradient bands and section
 * stripes (Schrödinger / Stripe / Vercel pattern), so it opts out of any
 * outer max-width and handles its own internal centering per section.
 *
 * We keep the "centered column" as the default to avoid touching every
 * other page; only "/" gets the full-bleed escape hatch. If we add another
 * marketing-ish route later (e.g. /pricing, /about) just extend the array.
 */
function Main({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  // Routes that opt out of the centered max-w-6xl column.
  // - "/"        : marketing landing page with edge-to-edge gradient bands.
  // - "/studio"  : control-center cockpit; needs the full viewport so the
  //                two-column 2D-editor + 3D-viewer layout doesn't get
  //                squeezed AND so the dark background covers everything
  //                (otherwise in light mode the body bg leaks around the
  //                centered Studio panels — the "half white, half black"
  //                bug the user reported on v0.27).
  const fullBleedRoutes = ["/", "/studio"];
  const fullBleed = fullBleedRoutes.includes(pathname);
  return (
    <main
      className={
        fullBleed
          ? "flex-1 w-full"
          : "flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-8"
      }
    >
      {children}
    </main>
  );
}

/**
 * ProfileRedirect — hard-blocks every route until the signed-in user
 * has both `organization` and `role` set on their profile.
 *
 * **Hard-block design.** First-time users (any sign-up path: email or
 * Google OAuth) MUST complete the profile form before they can use the
 * app. There is intentionally no Skip and no localStorage dismiss flag.
 * This is enforced server-side too — POST /jobs and POST /me/compounds
 * return 403 when the profile is incomplete — so a tampered client can't
 * bypass.
 *
 * Why? Earlier version had a Skip button + a one-shot dismiss flag. In
 * beta a user signed in via Google and was never redirected here at all
 * (silent /me/profile failure during the OAuth-callback race window —
 * Supabase JWT not propagated yet) and made it through job submission
 * with an empty profile. Hard-blocking + retry + cache makes that
 * impossible.
 *
 * Behavior:
 *  - On every navigation, if profile isn't yet known-complete for the
 *    current user.id, fetch /me/profile.
 *  - If the call fails transiently (auth-callback race), retry with
 *    backoff up to 3 attempts. After all attempts fail we still
 *    redirect — /welcome's own fetch will recover, worst case the user
 *    re-types their name.
 *  - Once a user.id is verified complete, cache that for the page's
 *    lifetime so we don't /me/profile-spam on every nav.
 *
 * Skipped on:
 *  - /welcome itself (we're already there)
 *  - Auth pages /login, /signup, /verify-email, /forgot-password (no
 *    point bouncing the user mid-auth flow)
 *  - Public pages /privacy, /terms, /contact (a signed-in user may
 *    still legitimately want to read their privacy policy, etc.)
 */
const REDIRECT_SKIP_PATHS = [
  "/welcome",
  "/login",
  "/signup",
  "/verify-email",
  "/forgot-password",
  "/privacy",
  "/terms",
  "/contact",
];
// Once we've confirmed a user's profile is complete, cache the user.id
// for the page's lifetime so we don't /me/profile-spam on every nav.
// Keyed by user.id so a different user signing in on the same browser
// doesn't inherit the previous user's completeness state.
const profileCompleteCache = new Set<string>();

async function fetchProfileWithRetry(maxAttempts = 3): Promise<{ organization?: string | null; role?: string | null } | null> {
  // Linear backoff: 0ms, 400ms, 1200ms total of ~1.6s. Covers the
  // OAuth-callback race window (Supabase JWT not yet in request headers
  // immediately after Google redirect). Past 1.6s any further failure
  // is real, and we'd rather over-redirect than leave the user hanging.
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 400 + 400));
    try {
      return await api.getMyProfile();
    } catch {
      // Swallow and retry. After all attempts fail we return null and
      // the caller still navigates to /welcome — see ProfileRedirect.
    }
  }
  return null;
}

function ProfileRedirect() {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || !user) return;
    if (REDIRECT_SKIP_PATHS.includes(location.pathname)) return;
    if (profileCompleteCache.has(user.id)) return;

    let cancelled = false;
    fetchProfileWithRetry().then((p) => {
      if (cancelled) return;
      // Defensive: if every attempt errored (e.g. backend is down),
      // redirect to /welcome anyway. /welcome's own fetch will retry;
      // worst case the user re-types their name. That's much better
      // than them silently slipping through with an unfilled profile,
      // which is the bug we're fixing.
      const orgFilled = !!(p?.organization && String(p.organization).trim());
      const roleFilled = !!(p?.role && String(p.role).trim());
      if (orgFilled && roleFilled) {
        profileCompleteCache.add(user.id);
        return;
      }
      navigate("/welcome", { replace: true });
    });
    return () => { cancelled = true; };
  }, [authLoading, user, location.pathname, navigate]);

  return null;
}

/** Gates a route on auth. While the initial getSession() resolves, render a
 *  spinner — without this we'd flash the login redirect for users with a
 *  persisted session before realizing they're already signed in. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-500 dark:text-slate-400">
        <Spinner size={20} className="mr-2" /> Loading…
      </div>
    );
  }
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

function Header() {
  // Header typography matches Studio's control-center aesthetic: monospace,
  // small caps, and a touch of letter-tracking. This was bolted on after
  // Studio shipped — the rest of the site still uses the default sans
  // body font, but having the chrome (header + nav + profile menu) in
  // mono unifies the brand feel across pages without rewriting every
  // page's body content.
  //
  // 2026-05-12: mobile-friendly pass. Below `md` (768px) the inline nav
  // collapses into a hamburger that opens a slide-down panel — keeping the
  // 5 nav links + auth buttons reachable on phones without overflowing the
  // header bar. Studio CTA stays in the header even on mobile, because the
  // banner on /studio itself routes phone visitors to a working page.
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `text-[11px] font-mono uppercase tracking-[0.15em] transition-colors ${
      isActive
        ? "text-delta-700 dark:text-delta-300"
        : "text-slate-600 hover:text-ink dark:text-slate-400 dark:hover:text-white"
    }`;
  const { user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const mobileNavRef = useRef<HTMLDivElement>(null);

  // Auto-close the mobile menu whenever the route changes — otherwise
  // clicking a link inside the panel navigates but the panel stays open.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Click outside the dropdown OR the toggle button closes it.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (mobileNavRef.current && !mobileNavRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [mobileMenuOpen]);

  // Mobile-panel link variant — uppercase mono like desktop, but
  // block-sized for tap targets (>=44px tall) and full-width so the
  // active state has a clean column to highlight.
  const mobileLinkCls = ({ isActive }: { isActive: boolean }) =>
    `block w-full px-4 py-3 text-[12px] font-mono uppercase tracking-[0.15em] transition-colors ${
      isActive
        ? "text-delta-700 dark:text-delta-300 bg-delta-50/60 dark:bg-delta-900/30"
        : "text-slate-700 hover:text-ink hover:bg-slate-50 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/60"
    }`;

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-3 relative">
        <Link to="/" className="flex items-center gap-2.5 group">
          <LogoMark size={28} className="transition-transform group-hover:rotate-[-4deg]" />
          <span className="text-base font-mono font-bold uppercase tracking-[0.18em] text-ink dark:text-white">Liganx</span>
          <span className="badge font-mono uppercase tracking-wider bg-delta-50 text-delta-700 ring-1 ring-inset ring-delta-200 dark:bg-delta-900/40 dark:text-delta-300 dark:ring-delta-700">
            beta
          </span>
        </Link>

        {/* Desktop nav — visible md+ */}
        <nav className="hidden md:flex items-center gap-1 sm:gap-2">
          <NavLink to="/" end className={({ isActive }) => `${linkCls({ isActive })} px-3 py-2`}>
            Home
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => `${linkCls({ isActive })} px-3 py-2`}>
            Library
          </NavLink>
          {/* Resistance Atlas — public per-drug forecast pages. New top-
              level nav item added 2026-05-12 alongside the multi-signal
              calibrated model launch; otherwise the only discovery path
              is the homepage card. NEW badge stripped after 30 days. */}
          <NavLink to="/atlas" className={({ isActive }) => `${linkCls({ isActive })} px-3 py-2 relative`}>
            <span>Atlas</span>
            <span className="ml-1 inline-flex items-center rounded-full bg-violet-500/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white align-middle">
              NEW
            </span>
          </NavLink>
          <NavLink to="/blog" className={({ isActive }) => `${linkCls({ isActive })} px-3 py-2`}>
            Blog
          </NavLink>
          {user && (
            <NavLink to="/history" className={({ isActive }) => `${linkCls({ isActive })} px-3 py-2`}>
              History
            </NavLink>
          )}
          {/* (v0.28) ThemeToggle removed — dark-only site. */}
          {user ? (
            <UserMenu
              email={user.email || "account"}
              avatarUrl={(user.user_metadata?.avatar_url as string | undefined) || ""}
              isAdmin={(user.email || "").toLowerCase() === ADMIN_EMAIL}
              onSignOut={signOut}
            />
          ) : (
            <>
              <Link to="/login" className="text-[11px] font-mono uppercase tracking-[0.15em] text-slate-600 hover:text-ink dark:text-slate-400 dark:hover:text-white px-3 py-2">
                Sign in
              </Link>
              {/* Sign-up button next to Sign in for signed-out users.
                  Outlined (not solid) so it doesn't compete with the
                  primary "New job" CTA; sized down to match the link
                  rhythm. New job stays as a soft trial path that
                  redirects to /login?next=/new for unauth visitors. */}
              <Link
                to="/signup"
                className="text-[11px] font-mono uppercase tracking-[0.15em] font-semibold text-delta-700 dark:text-delta-300 border border-delta-300 dark:border-delta-700 rounded-md px-3 py-1.5 hover:bg-delta-50 dark:hover:bg-delta-900/30 transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
          {/* (Studio v0.88) Studio is now the canonical entry point
              for new jobs — the unified workspace with Ketcher canvas,
              live 3D viewer, multi-target/multi-mutation/multi-compound
              support, AI variants, and inline Full Job submission. The
              legacy /new form is preserved for users with bookmarks,
              but everyone arriving fresh is routed straight to Studio. */}
          <Link to="/studio" className="btn-primary btn-sm ml-1 font-mono uppercase tracking-[0.15em]">
            Studio
          </Link>
        </nav>

        {/* Mobile nav — visible <md. Studio CTA + hamburger toggle. */}
        <div ref={mobileNavRef} className="md:hidden flex items-center gap-2">
          <Link to="/studio" className="btn-primary btn-sm font-mono uppercase tracking-[0.15em]">
            Studio
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            className="p-2 -mr-2 text-slate-700 dark:text-slate-200 hover:text-ink dark:hover:text-white"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {mobileMenuOpen ? (
                // X
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                // Hamburger
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>

          {/* Slide-down panel — absolute-positioned below the header bar.
              Anchored to the parent flex container so it spans the full
              viewport width via the outer header's max-w-6xl + inset. */}
          {mobileMenuOpen && (
            <div className="absolute left-0 right-0 top-full bg-white dark:bg-slate-950 border-b border-slate-200/70 dark:border-slate-800 shadow-lg z-50">
              <nav className="flex flex-col py-2">
                <NavLink to="/" end className={mobileLinkCls}>Home</NavLink>
                <NavLink to="/library" className={mobileLinkCls}>Library</NavLink>
                <NavLink to="/atlas" className={mobileLinkCls}>
                  <span>Atlas</span>
                  <span className="ml-2 inline-flex items-center rounded-full bg-violet-500/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white align-middle">
                    NEW
                  </span>
                </NavLink>
                <NavLink to="/blog" className={mobileLinkCls}>Blog</NavLink>
                {user && <NavLink to="/history" className={mobileLinkCls}>History</NavLink>}
                {user && <NavLink to="/settings" className={mobileLinkCls}>Settings</NavLink>}
                {user && (user.email || "").toLowerCase() === ADMIN_EMAIL && (
                  <NavLink to="/admin" className={mobileLinkCls}>Admin</NavLink>
                )}
                <div className="border-t border-slate-200/70 dark:border-slate-800 mt-1 pt-1">
                  {user ? (
                    <button
                      type="button"
                      onClick={() => { setMobileMenuOpen(false); void signOut(); }}
                      className="block w-full text-left px-4 py-3 text-[12px] font-mono uppercase tracking-[0.15em] text-slate-700 hover:text-ink hover:bg-slate-50 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/60"
                    >
                      Sign out
                    </button>
                  ) : (
                    <>
                      <Link to="/login" className="block w-full px-4 py-3 text-[12px] font-mono uppercase tracking-[0.15em] text-slate-700 hover:text-ink hover:bg-slate-50 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/60">
                        Sign in
                      </Link>
                      <Link to="/signup" className="block w-full px-4 py-3 text-[12px] font-mono uppercase tracking-[0.15em] font-semibold text-delta-700 dark:text-delta-300 hover:bg-delta-50 dark:hover:bg-delta-900/30">
                        Sign up
                      </Link>
                    </>
                  )}
                </div>
              </nav>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function UserMenu({ email, avatarUrl, isAdmin, onSignOut }: { email: string; avatarUrl: string; isAdmin: boolean; onSignOut: () => Promise<void> }) {
  // Lightweight popover — no portal, just absolute-positioned card. Click-
  // outside dismisses via a document-level mousedown listener (same pattern
  // as AutocompleteInput). Avatar shows the user's uploaded picture
  // (user_metadata.avatar_url, set via SettingsPage or pulled from Google
  // OAuth) when present; otherwise falls back to the first letter of the
  // email so the header always has *something*. The full address is only
  // shown when the menu is open so the header stays compact.
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const initial = (email[0] || "?").toUpperCase();
  // (Studio v0.90) Always render a clean monogram — the auto-generated
  // Supabase / dicebear polyhedron avatars looked busy against the
  // dark Studio header. A single cyan-tinted initial letter in mono
  // font matches the brand, stays legible at 32px, and never clashes
  // with the rest of the nav. avatarUrl from user_metadata is kept
  // around for the dropdown panel below if it's actually a real
  // user-set photo, but the trigger button always shows the monogram.
  void avatarUrl; // intentionally unused — see comment above
  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center w-8 h-8 rounded-full font-mono uppercase tracking-wider text-[12px] font-semibold text-cyan-200 bg-cyan-900/30 border border-cyan-700/50 hover:bg-cyan-900/50 hover:border-cyan-500/60 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 rounded-lg border border-slate-200 bg-white shadow-xl py-1 z-30 dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              Signed in
            </div>
            <div className="text-[11px] font-mono text-slate-900 dark:text-slate-100 truncate" title={email}>
              {email}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); navigate("/settings"); }}
            className="w-full text-left px-3 py-2 text-[11px] font-mono uppercase tracking-[0.15em] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
            role="menuitem"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); navigate("/history"); }}
            className="w-full text-left px-3 py-2 text-[11px] font-mono uppercase tracking-[0.15em] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
            role="menuitem"
          >
            My history
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); navigate("/compounds"); }}
            className="w-full text-left px-3 py-2 text-[11px] font-mono uppercase tracking-[0.15em] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
            role="menuitem"
          >
            My compounds
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { setOpen(false); navigate("/admin"); }}
              className="w-full text-left px-3 py-2 text-[11px] font-mono uppercase tracking-[0.15em] font-semibold text-delta-700 hover:bg-delta-50 dark:text-delta-300 dark:hover:bg-delta-900/30 border-t border-slate-100 dark:border-slate-700"
              role="menuitem"
            >
              Admin
            </button>
          )}
          <button
            type="button"
            onClick={async () => { setOpen(false); await onSignOut(); navigate("/"); }}
            className="w-full text-left px-3 py-2 text-[11px] font-mono uppercase tracking-[0.15em] text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-900/30 border-t border-slate-100 dark:border-slate-700"
            role="menuitem"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Wrapper that suppresses the Footer on Studio (and any other route that
 * declares itself a "cockpit" by entering the fullBleedRoutes list and
 * using the entire viewport). Adding the footer underneath a min-h-screen
 * Studio caused the body to be slightly taller than 100vh, which was
 * enough to make the page itself scrollable — and that scroll was hiding
 * the sticky header behind Studio's content (the "menu bar goes under"
 * bug). Studio's own bottom strip already provides a logical page bottom.
 */
function FooterUnlessStudio() {
  const { pathname } = useLocation();
  if (pathname === "/studio") return null;
  return <Footer />;
}

function Footer() {
  return (
    <footer className="border-t border-slate-200/70 bg-white/60 backdrop-blur dark:border-slate-800 dark:bg-slate-950/60">
      <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between px-4 sm:px-6 py-5 text-xs text-slate-500 dark:text-slate-400 gap-2">
        <div className="flex items-center gap-2">
          <LogoMark size={16} />
          <span>© {new Date().getFullYear()} Liganx — mutation-aware structural biology.</span>
        </div>
        <div className="flex items-center gap-4">
          {/* Footer link to the long-tail SEO landing page — gives the
              guide an internal link from every page on the site, which is
              the single highest-leverage thing we can do for its rank. */}
          <Link to="/mutation-docking-guide" className="hover:text-ink dark:hover:text-slate-100 transition-colors">Guide</Link>
          <Link to="/validation" className="hover:text-ink dark:hover:text-slate-100 transition-colors">Validation</Link>
          <Link to="/contact" className="hover:text-ink dark:hover:text-slate-100 transition-colors">Contact</Link>
          <Link to="/privacy" className="hover:text-ink dark:hover:text-slate-100 transition-colors">Privacy</Link>
          <Link to="/terms" className="hover:text-ink dark:hover:text-slate-100 transition-colors">Terms</Link>
          <span className="text-slate-400 dark:text-slate-500">v0.0.1 · Phase 1</span>
        </div>
      </div>
    </footer>
  );
}

/**
 * Catch-all 404. The previous router silently rendered nothing for unknown
 * routes (e.g., a typo'd /libary), which looked broken. Now we show a clear
 * "not found" card with a way back to safe ground.
 */
function NotFound() {
  return (
    <div className="card max-w-xl mx-auto text-center">
      <div className="text-6xl mb-3">⌕</div>
      <h1 className="text-2xl font-bold text-ink dark:text-white">Page not found</h1>
      <p className="muted mt-2">
        That URL doesn't lead anywhere. It might be a typo, or the page may have moved.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <Link to="/" className="btn-secondary btn-sm">Go home</Link>
        <Link to="/studio" className="btn-primary btn-sm">Open Studio</Link>
      </div>
    </div>
  );
}
