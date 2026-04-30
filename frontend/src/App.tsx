import { useEffect, useRef, useState } from "react";
import { Routes, Route, Link, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import NewJobPage from "./pages/NewJobPage";
import JobPage from "./pages/JobPage";
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
import { LogoMark, Spinner } from "./components/Icons";
import ThemeToggle from "./components/ThemeToggle";
import { AuthProvider, useAuth } from "./lib/auth";
import DocFlaskTour from "./components/DocFlask/DocFlaskTour";
import ProfileCompletionModal from "./components/ProfileCompletionModal";

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-8">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/new" element={<RequireAuth><NewJobPage /></RequireAuth>} />
            <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
            <Route path="/jobs/:id" element={<JobPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/suite" element={<SuitePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            {/* Catch-all 404 — used to leak through as a blank page */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
        {/* First-run tour mascot. Self-gates on route + localStorage —
            renders nothing for users who've seen it or are off the
            tour-eligible pages. Mounted once at app root so the tour
            survives client-side route transitions. */}
        <DocFlaskTour />
        {/* Auto-shows when a signed-in user has incomplete profile
            (missing organization or role) and hasn't dismissed it.
            Designed for OAuth users who skip the SignupPage form. */}
        <ProfileCompletionModal />
      </div>
    </AuthProvider>
  );
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
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium transition-colors ${
      isActive
        ? "text-delta-700 dark:text-delta-300"
        : "text-slate-600 hover:text-ink dark:text-slate-400 dark:hover:text-white"
    }`;
  const { user, signOut } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-3">
        <Link to="/" className="flex items-center gap-2.5 group">
          <LogoMark size={28} className="transition-transform group-hover:rotate-[-4deg]" />
          <span className="text-lg font-bold tracking-tight text-ink dark:text-white">Liganx</span>
          <span className="badge bg-delta-50 text-delta-700 ring-1 ring-inset ring-delta-200 dark:bg-delta-900/40 dark:text-delta-300 dark:ring-delta-700">
            beta
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <NavLink to="/" end className={({ isActive }) => `${linkCls({ isActive })} px-3 py-2`}>
            Home
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => `${linkCls({ isActive })} px-3 py-2`}>
            Library
          </NavLink>
          {user && (
            <NavLink to="/history" className={({ isActive }) => `${linkCls({ isActive })} px-3 py-2`}>
              History
            </NavLink>
          )}
          <ThemeToggle />
          {user ? (
            <UserMenu
              email={user.email || "account"}
              avatarUrl={(user.user_metadata?.avatar_url as string | undefined) || ""}
              onSignOut={signOut}
            />
          ) : (
            <>
              <Link to="/login" className="text-sm font-medium text-slate-600 hover:text-ink dark:text-slate-400 dark:hover:text-white px-3 py-2">
                Sign in
              </Link>
              {/* Sign-up button next to Sign in for signed-out users.
                  Outlined (not solid) so it doesn't compete with the
                  primary "New job" CTA; sized down to match the link
                  rhythm. New job stays as a soft trial path that
                  redirects to /login?next=/new for unauth visitors. */}
              <Link
                to="/signup"
                className="text-sm font-semibold text-delta-700 dark:text-delta-300 border border-delta-300 dark:border-delta-700 rounded-md px-3 py-1.5 hover:bg-delta-50 dark:hover:bg-delta-900/30 transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
          <Link to="/new" className="btn-primary btn-sm ml-1">
            New job
          </Link>
        </nav>
      </div>
    </header>
  );
}

function UserMenu({ email, avatarUrl, onSignOut }: { email: string; avatarUrl: string; onSignOut: () => Promise<void> }) {
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
  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center w-8 h-8 rounded-full overflow-hidden bg-delta-100 text-delta-700 font-semibold text-sm hover:bg-delta-200 transition-colors dark:bg-delta-900/40 dark:text-delta-200 dark:hover:bg-delta-900/70"
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={email} className="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 rounded-lg border border-slate-200 bg-white shadow-xl py-1 z-30 dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Signed in
            </div>
            <div className="text-sm text-slate-900 dark:text-slate-100 truncate" title={email}>
              {email}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); navigate("/settings"); }}
            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
            role="menuitem"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); navigate("/history"); }}
            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
            role="menuitem"
          >
            My history
          </button>
          {/* The Doc Flask tour toggle moved to /settings — keeping it
              there only avoids two parallel UI entry points that can
              drift apart. Users reach it via Settings → "Doc Flask
              tour" instead. */}
          <button
            type="button"
            onClick={async () => { setOpen(false); await onSignOut(); navigate("/"); }}
            className="w-full text-left px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-900/30 border-t border-slate-100 dark:border-slate-700"
            role="menuitem"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
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
        <Link to="/new" className="btn-primary btn-sm">Start a new job</Link>
      </div>
    </div>
  );
}
