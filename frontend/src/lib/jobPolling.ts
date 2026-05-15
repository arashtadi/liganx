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
 *       • any result missing `extra` OR carrying the `validate=pending`
 *         placeholder  →  keep polling on `runningMs`
 *           (validation still in flight — the runner writes `validate=pending`
 *           up front in the batched path so the row is non-null even before
 *           ProLIF/PoseBusters land. Without checking that token, polling
 *           stops the moment Vina finishes and the user is stuck looking at
 *           the placeholder.)
 *       • all results have a real (non-pending) `extra`    →  stop
 *       • safety net: if the job's `updated_at` is older than 5 min,
 *           stop regardless — old history-page jobs from before the
 *           validation pipeline existed have null `extra` forever and
 *           we don't want to poll them indefinitely.
 *
 * The 5-min cap is conservative: typical validation lands in <60 s.
 */

import type { Job } from "../api";
import { parseUtcDate } from "./parseUtcDate";

const MAX_VALIDATION_WAIT_MS = 5 * 60 * 1000;

export function jobPollingInterval(
  data: Job | undefined,
  runningMs: number,
  fetchFailureCount = 0,
): number | false {
  // Backend unreachable — back off so a down API isn't hammered every
  // `runningMs` by every open tab (the JobPage polls every 1.5 s).
  // Exponential: 2×, 4×, 8× … capped at 30 s. React Query resets
  // fetchFailureCount to 0 on the next successful fetch, so the normal
  // fast cadence resumes automatically the moment the API recovers.
  if (fetchFailureCount > 0) {
    return Math.min(runningMs * 2 ** fetchFailureCount, 30_000);
  }
  if (!data) return runningMs;
  // Still docking — poll for new pose results.
  if (data.status !== "completed" && data.status !== "failed") return runningMs;
  // Failed jobs don't get validation, no point polling.
  if (data.status === "failed") return false;

  // status === "completed". Check whether per-cell validation has finished
  // by looking for any result that's still missing its `extra` blob OR
  // carrying the `validate=pending` placeholder. The runner writes that
  // placeholder up front in the batched-dispatch path so the row exists
  // and the matrix can render a Vina score immediately, then rewrites the
  // row when ProLIF / PoseBusters / strain land. If we only checked
  // `!r.extra` we'd stop polling the moment Vina finished, snapshot the
  // placeholder, and the user would never see the contact chips or 2D
  // interaction map until they manually reloaded.
  const validationPending = data.results.some(
    (r) => !r.extra || r.extra.includes("validate=pending"),
  );
  if (!validationPending) return false;

  // Cap how long we keep retrying — on truly old jobs (created before the
  // validation pipeline shipped, or where validation crashed in the
  // background) `extra` may be null forever and we'd poll forever.
  // updated_at refreshes when the row mutates; if it's recent, validation
  // is plausibly still landing.
  // parseUtcDate (not bare `new Date`): backend timestamps are bare ISO
  // strings with no `Z`, which `new Date` parses as *local* time — so the
  // age math was off by the viewer's UTC offset, making this cap fire
  // early (or never) depending on timezone.
  const ageMs = Date.now() - parseUtcDate(data.updated_at).getTime();
  if (ageMs > MAX_VALIDATION_WAIT_MS) return false;

  return runningMs;
}
