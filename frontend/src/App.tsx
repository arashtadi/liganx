import { Routes, Route, Link, NavLink } from "react-router-dom";
import HomePage from "./pages/HomePage";
import NewJobPage from "./pages/NewJobPage";
import JobPage from "./pages/JobPage";
import LibraryPage from "./pages/LibraryPage";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";
import { LogoMark } from "./components/Icons";
import ThemeToggle from "./components/ThemeToggle";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/new" element={<NewJobPage />} />
          <Route path="/jobs/:id" element={<JobPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          {/* Catch-all 404 — used to leak through as a blank page */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium transition-colors ${
      isActive
        ? "text-delta-700 dark:text-delta-300"
        : "text-slate-600 hover:text-ink dark:text-slate-400 dark:hover:text-white"
    }`;
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
          <ThemeToggle />
          <Link to="/new" className="btn-primary btn-sm ml-1">
            New job
          </Link>
        </nav>
      </div>
    </header>
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
