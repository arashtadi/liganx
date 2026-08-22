/**
 * "Ask for feedback after 5 docks" trigger.
 *
 * We count DISTINCT completed dock jobs the user has viewed (by share_id) in
 * localStorage, and once they cross 5 we surface the feedback modal exactly
 * once. localStorage (not a backend counter) is deliberate: this is a gentle
 * nudge, not an audited metric — per-browser is fine, and it keeps the trigger
 * entirely client-side with no extra API calls. Every access is guarded so a
 * private-mode / blocked-storage browser simply never prompts rather than
 * throwing.
 */
const KEY_JOBS = "liganx_docked_jobs_v1";
const KEY_PROMPTED = "liganx_feedback_prompted_v1";
const THRESHOLD = 5;

/** Record that the user viewed a completed dock (idempotent per share_id).
 *  Returns true exactly once — when the 5th distinct dock is recorded and we
 *  haven't already prompted. */
export function recordDockAndShouldPrompt(shareId: string): boolean {
  if (!shareId) return false;
  try {
    if (localStorage.getItem(KEY_PROMPTED) === "1") return false;
    const raw = localStorage.getItem(KEY_JOBS);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const set = new Set(list);
    if (!set.has(shareId)) {
      set.add(shareId);
      localStorage.setItem(KEY_JOBS, JSON.stringify([...set]));
    }
    return set.size >= THRESHOLD;
  } catch {
    return false;
  }
}

/** Mark the one-time prompt as shown so we never nag again (called whether the
 *  user submits or dismisses). */
export function markFeedbackPrompted(): void {
  try { localStorage.setItem(KEY_PROMPTED, "1"); } catch { /* ignore */ }
}
