/**
 * Shared refetch-interval policy for job queries.
 *
 * Why this exists: the backend pipeline marks a job COMPLETED as soon as
 * docking poses are written, but per-cell validation (PoseBusters /
 * ProLIF 2D-interaction map / strain) runs asynchronously in a follow-up
 * pass and populates `result.extra` 5-30 s later (per cell). If we stop
 * polling on `status === "completed"` we'd freeze the cached Job snapshot
 * with `extra: null` on every result — the user opens a pose modal,
 * sees no 2D contact map, has to manually refresh. Pretty broken.
 *
 * Policy:
 *   • status running / pending  →  poll on the supplied `runningMs`
 *   • status failed             →  stop (no validation expected)
 *   • status completed:
 *       • any result missing `extra`  →  keep polling on `runningMs`
 *           (validation still in flight)
 *       • all results have `extra`    →  stop
 *       • safety net: if the job's `updated_at` is older than 5 min,
 *           stop regardless — old history-page jobs from before the
 *           validation pipeline existed have null `extra` forever and
 *           we don't want to poll them indefinitely.
 *
 * The 5-min cap is conservative: typical validation lands in <60 s.
 */

import type { Job } from "../api";

const MAX_VALIDATION_WAIT_MS = 5 * 60 * 1000;

export function jobPollingInterval(
  data: Job | undefined,
  runningMs: number,
): number | false {
  if (!data) return runningMs;
  // Still docking — poll for new pose results.
  if (data.status !== "completed" && data.status !== "failed") return runningMs;
  // Failed jobs don't get validation, no point polling.
  if (data.status === "failed") return false;

  // status === "completed". Check whether per-cell validation has finished
  // by looking for any result that's still missing its `extra` blob.
  const validationPending = data.results.some((r) => !r.extra);
  if (!validationPending) return false;

  // Cap how long we keep retrying — on truly old jobs (created before the
  // validation pipeline shipped, or where validation crashed in the
  // background) `extra` may be null forever and we'd poll forever.
  // updated_at refreshes when the row mutates; if it's recent, validation
  // is plausibly still landing.
  const ageMs = Date.now() - new Date(data.updated_at).getTime();
  if (ageMs > MAX_VALIDATION_WAIT_MS) return false;

  return runningMs;
}
