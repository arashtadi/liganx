import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * Reproducibility footer.
 *
 * Showns at the bottom of result pages (JobPage, AtlasPage, CalibratePage,
 * ScreeningPage). Renders the build / model versions used to compute
 * what the user is looking at:
 *
 *   - git_sha — the deployed backend commit (from /health). Pairs with
 *     the frontend's __APP_VERSION__ build constant for the full pinned
 *     state at the time of the result.
 *   - environment + uptime — production vs preview, current process age.
 *   - timestamp — when the page was loaded, so a screenshot dated three
 *     months from now is still interpretable.
 *
 * The point isn't to be flashy. It's that a user revisiting the same
 * URL or paper-citing a result can SEE that the numbers came from a
 * specific reproducible state, and a future Liganx update doesn't
 * invisibly change what they trust.
 *
 * Self-contained: no props required. Fetches /health once on mount.
 * Renders nothing on /health failure (no point displaying half-truths).
 */
interface HealthInfo {
  status?: string;
  version?: string;
  env?: string;
  // Optional fields the backend may not return — fall back to the
  // /health blob we already have.
  git_sha?: string;
  uptime_s?: number;
}

export default function ReproFooter({
  className = "",
  noteWhenLoaded = "Result computed with the build below.",
}: {
  className?: string;
  noteWhenLoaded?: string;
}) {
  const [info, setInfo] = useState<HealthInfo | null>(null);
  const [renderedAt] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    api.health()
      .then((r) => { if (!cancelled) setInfo(r as HealthInfo); })
      .catch(() => { /* silent — no footer is better than a misleading one */ });
    return () => { cancelled = true; };
  }, []);

  if (!info) {
    // Still render the timestamp even when /health is unreachable, so a
    // user always has a paper trail.
    return (
      <div className={`mt-8 text-[10px] text-slate-400 dark:text-slate-600 font-mono leading-relaxed ${className}`}>
        <div className="border-t border-slate-200/60 dark:border-slate-800/60 pt-3 flex flex-wrap gap-x-4 gap-y-1">
          <span>loaded {renderedAt.toISOString().slice(0, 19) + "Z"}</span>
        </div>
      </div>
    );
  }

  const sha = (info.version || info.git_sha || "dev").slice(0, 12);
  return (
    <div className={`mt-8 text-[10px] text-slate-400 dark:text-slate-600 font-mono leading-relaxed ${className}`}>
      <div className="border-t border-slate-200/60 dark:border-slate-800/60 pt-3">
        <div className="text-slate-500 dark:text-slate-500 mb-1 text-[10px] uppercase tracking-wider font-semibold">
          Reproducibility
        </div>
        <p className="text-slate-500 dark:text-slate-500 mb-1.5 normal-case font-sans text-[11px]">
          {noteWhenLoaded}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>backend: {sha}</span>
          <span>env: {info.env || "?"}</span>
          <span>loaded {renderedAt.toISOString().slice(0, 19) + "Z"}</span>
        </div>
      </div>
    </div>
  );
}
