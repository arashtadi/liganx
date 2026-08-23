import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * QuotaLimitModal — shown when a user hits their free-run cap (the dock
 * submit returns 402). Instead of a dead-end "contact us" message, it lets
 * the user request more runs in one click: POST /me/request-more-runs pings
 * the operator on Telegram with one-tap Grant/Deny. On success it flips to a
 * "request sent" confirmation with a Done button that closes and returns the
 * user to the Studio — same pattern as the feature-access modal.
 *
 * Parent owns the open flag. `message` is the backend's 402 text (e.g. how
 * many free runs were used), shown so the user sees why they're blocked.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  /** The backend's 402 detail message, shown as context. Optional. */
  message?: string | null;
}

export default function QuotaLimitModal({ open, onClose, message }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state only when the modal opens (keyed on `open`), not
  // on every parent re-render — see FeatureRequestModal for the same fix.
  useEffect(() => {
    setSubmitting(false);
    setDone(false);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function requestMore() {
    setSubmitting(true);
    setError(null);
    try {
      await api.requestMoreRuns();
      setDone(true);
    } catch (e: any) {
      setError(
        e?.message ||
          "Could not send your request. Please try again in a moment.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quota-gate-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-amber-700/50 bg-slate-950 shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden>
              🚦
            </span>
            <h2
              id="quota-gate-title"
              className="text-base font-semibold text-amber-200"
            >
              You're out of free runs
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 text-xl leading-none -mt-1"
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {done ? (
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 text-amber-300 text-xs font-semibold px-3 py-1">
                ✓ Request sent
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                Thanks — your request is in. We'll top up your account and email
                you the moment it's done. You can close this and keep exploring
                in the meantime.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-300 leading-relaxed">
                {message ||
                  "You've used all of your free docking runs."}{" "}
                Want to keep going? Request more and we'll top up your account —
                usually quickly.
              </p>
              <div className="text-xs text-slate-400 bg-slate-900/50 rounded border border-slate-800 px-3 py-2">
                One click sends us a note. You'll get an email as soon as your
                runs are refreshed — no need to ask again.
              </div>
              {error && (
                <div className="text-xs text-red-300 bg-red-950/40 rounded border border-red-900/50 px-3 py-2">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-800">
          {done ? (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-mono uppercase tracking-[0.18em] transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded text-xs font-mono uppercase tracking-[0.18em] text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={requestMore}
                disabled={submitting}
                className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-mono uppercase tracking-[0.18em] transition-colors"
              >
                {submitting ? "Sending…" : "Request more runs →"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
