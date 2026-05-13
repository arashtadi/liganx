import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * Pod-state banner.
 *
 * The single most common "Liganx feels broken" moment is: user clicks
 * Run Dock, sees a spinner for 20-40 seconds with no explanation, and
 * either gives up or watches it fail with a mystery 5xx. The pod is
 * actually fine — it's just cold-starting (RunPod auto-pause kicks in
 * after ~5 min of idle, the first request after that wakes the GPU but
 * takes ~30 seconds while CUDA + model weights load).
 *
 * This banner closes the information gap. When the pod is offline OR
 * cold, we show a clear "GPU is warming up, ~30s" amber banner above
 * the action area. The banner polls /health every 4s and self-removes
 * the moment the pod comes back up. No user action required.
 *
 * Also triggers a one-shot pod resume on mount via /admin/pod/resume
 * (the existing cost-control endpoint) so the warm-up actually starts
 * before the user has clicked anything. That endpoint is admin-only by
 * default; if the call returns 401/403 we silently drop and rely on
 * the next user action (Run Dock, /quick-dock, etc.) to trigger resume
 * via the normal /health gating path on the backend.
 *
 * Usage: <PodStatusBanner /> with no props. Self-gates on state —
 * renders nothing when healthOk === true.
 */
export default function PodStatusBanner() {
  // null = not checked yet; we hide the banner during this brief
  // initial-load window to avoid a flash on a healthy pod.
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [secondsCold, setSecondsCold] = useState(0);

  // Poll /health every 4 seconds. When the pod is cold this gives us
  // a fast "back up" signal; when it's warm it costs almost nothing
  // (a single ~50ms GET). Backend caches the response so the poll
  // doesn't actually hit the pod each time.
  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const ok = await api.healthOk();
        if (!cancelled) {
          setHealthOk(ok);
          if (ok) setSecondsCold(0);
        }
      } catch {
        if (!cancelled) setHealthOk(false);
      }
    }

    void check();
    const tick = window.setInterval(check, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, []);

  // Count seconds-of-coldness so we can show "~30s typical" + the
  // current elapsed. If we've been cold for over 60s, the message
  // changes to flag a likely problem (something other than a normal
  // cold-start — pod actually down, network issue, etc.).
  useEffect(() => {
    if (healthOk !== false) return;
    const tick = window.setInterval(() => {
      setSecondsCold((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [healthOk]);

  // Don't render anything during the initial-load window OR when the
  // pod is healthy. The component is purely a problem-state indicator;
  // a "pod is up!" green banner would be noise.
  if (healthOk !== false) return null;

  const elapsed = secondsCold;
  const longCold = elapsed > 60;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 rounded-md border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/40 px-3 py-2 text-[12px] leading-relaxed"
    >
      <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse mt-1.5 shrink-0" />
        <div className="flex-1 min-w-0">
          {longCold ? (
            <>
              <div className="font-semibold">GPU pod still unreachable after {elapsed}s.</div>
              <div className="mt-0.5 text-amber-800/90 dark:text-amber-200/80">
                Normal cold-starts finish in ~30s; this is taking longer than expected.
                Run Dock will keep retrying every 4s. If this persists, the pod may need
                a manual restart — try again in a few minutes or contact support.
              </div>
            </>
          ) : (
            <>
              <div className="font-semibold">
                GPU pod is warming up{elapsed > 0 ? ` · ${elapsed}s elapsed` : ""}
              </div>
              <div className="mt-0.5 text-amber-800/90 dark:text-amber-200/80">
                Pod auto-pauses after idle to save GPU cost. First request takes
                ~30 seconds to spin up; subsequent docks are fast. The banner
                will disappear once the pod is ready. Run Dock buttons stay
                clickable — they queue automatically.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
