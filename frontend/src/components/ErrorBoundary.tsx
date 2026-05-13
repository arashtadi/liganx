import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Per-route ErrorBoundary.
 *
 * Two problems this fixes:
 *
 *   1. Blank-white-page-on-exception. Today if anything in JobPage,
 *      Studio, or CalibratePage throws during render (a null-deref on a
 *      missing field, a bad cast, a third-party library crash), React
 *      unmounts the whole tree and the user sees a white screen. Worst-
 *      possible first impression — feels like the entire site is broken.
 *      An ErrorBoundary catches the exception and renders a recovery
 *      card instead, so the rest of the app (header, footer) stays alive
 *      and the user can navigate away.
 *
 *   2. Visibility. Without a catch, we never know an exception fired —
 *      no Sentry, no logs, nothing. The boundary calls a global hook
 *      `window.__liganx_capture_error__` so any monitoring product we
 *      wire up later (Sentry, LogRocket, plain fetch to /api/log) just
 *      attaches itself to that hook. Until then the error still surfaces
 *      to the console via componentDidCatch's default behaviour.
 *
 * Usage: wrap each <Route element={...}> in App.tsx. Per-route (not
 * app-root) so that the header + nav stay rendered when one page bombs.
 *
 * NOT a substitute for handling expected errors (network failures, 404s,
 * "no job found"). Those should be handled in the page itself with
 * tasteful error UI. The boundary is the LAST line of defense for
 * unexpected exceptions.
 */

interface Props {
  /** Human-readable name for the surface; rendered in the fallback */
  routeName?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  /** Bumped on retry — keying children with this value forces a remount */
  resetCount: number;
}

declare global {
  interface Window {
    __liganx_capture_error__?: (err: Error, info: ErrorInfo, routeName?: string) => void;
  }
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null, resetCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Always log to console — useful for the user reporting back and for
    // dev work. Production minification keeps the stack readable via
    // sourcemaps in DevTools.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", this.props.routeName ?? "unnamed", error, errorInfo);
    this.setState({ errorInfo });

    // Fire the global hook so external monitoring (Sentry, etc.) can
    // pick this up by registering at window.__liganx_capture_error__.
    // When no hook is set, nothing happens — safe no-op.
    try {
      window.__liganx_capture_error__?.(error, errorInfo, this.props.routeName);
    } catch {
      /* monitoring failures must not cascade — drop quietly */
    }
  }

  retry = () => {
    // Reset our error state; the resetCount key on the wrapper below
    // remounts children, throwing away any corrupt internal state in
    // the failed subtree.
    this.setState((s) => ({ error: null, errorInfo: null, resetCount: s.resetCount + 1 }));
  };

  render() {
    const { error, errorInfo, resetCount } = this.state;
    if (!error) {
      // Key children with resetCount so a Retry remounts the failed
      // subtree from scratch instead of re-running the same broken
      // render against the same prop snapshot.
      return <div key={resetCount}>{this.props.children}</div>;
    }

    const routeName = this.props.routeName || "this page";
    const subject = encodeURIComponent(`Liganx error on ${routeName}`);
    const body = encodeURIComponent(
      `Page: ${typeof window !== "undefined" ? window.location.href : routeName}\n` +
      `Time: ${new Date().toISOString()}\n` +
      `Error: ${error.name}: ${error.message}\n\n` +
      `Stack:\n${error.stack || "(no stack)"}\n\n` +
      `What I was doing: \n(please describe)\n`,
    );
    const mailto = `mailto:hello@liganx.com?subject=${subject}&body=${body}`;

    return (
      <div className="max-w-2xl mx-auto my-12 card border-rose-300 dark:border-rose-700/40 bg-rose-50/60 dark:bg-rose-950/30">
        <div className="text-rose-700 dark:text-rose-300 text-sm font-semibold mb-2">
          Something went wrong on this page
        </div>
        <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
          Sorry about that — {routeName} hit an error while rendering. The rest of
          the site still works. The error has been logged in the browser console
          (open DevTools to see the full stack); we'd love a quick report so we
          can fix it.
        </p>
        <div className="mt-4 rounded-md border border-rose-200 dark:border-rose-800/50 bg-white/70 dark:bg-slate-900/40 px-3 py-2 text-xs font-mono text-rose-700 dark:text-rose-300 break-all">
          <div className="font-semibold mb-1">{error.name}: {error.message}</div>
          {errorInfo?.componentStack && (
            <div className="text-slate-500 dark:text-slate-400 mt-2 whitespace-pre-wrap leading-tight">
              {errorInfo.componentStack.split("\n").slice(0, 5).join("\n")}
            </div>
          )}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={this.retry}
            className="btn-primary btn-sm"
          >
            Retry
          </button>
          <Link to="/" className="btn-secondary btn-sm">
            Go to home
          </Link>
          <a href={mailto} className="btn-secondary btn-sm">
            Email support
          </a>
        </div>
      </div>
    );
  }
}
