import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * Boltz2RequestModal — shown when a non-approved user clicks the
 * "AI Resistance Prediction" (Boltz-2) action in the Studio. Mirrors
 * ProGateModal's look, but instead of routing to /contact it fires the
 * real request: POST /me/request-boltz2-access, which pings the operator
 * on Telegram (Approve/Deny) + emails the admin. On success it flips to a
 * "request sent — pending" state.
 *
 * Parent owns the open flag and is told when a request lands (onRequested)
 * so it can refresh access status and swap the button to "Pending".
 */
interface Props {
  open: boolean;
  onClose: () => void;
  /** Fired after a successful request so the parent can refresh state. */
  onRequested?: (newStatus: string) => void;
}

export default function Boltz2RequestModal({ open, onClose, onRequested }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSubmitting(false);
    setDone(false);
    setError(null);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function requestAccess() {
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.requestBoltz2Access();
      setDone(true);
      onRequested?.(r.boltz2_access);
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
      aria-labelledby="bz2-gate-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-teal-700/50 bg-slate-950 shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden>
              🧬
            </span>
            <h2
              id="bz2-gate-title"
              className="text-base font-semibold text-teal-200"
            >
              AI Resistance Prediction
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
              <div className="inline-flex items-center gap-2 rounded-full bg-teal-500/10 text-teal-300 text-xs font-semibold px-3 py-1">
                ✓ Request sent
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                Thanks — your request is in. You'll get an email the moment it's
                approved, and the AI Resistance Prediction button will unlock
                here automatically. No need to ask again.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-300 leading-relaxed">
                AI Resistance Prediction uses a deep-learning co-folding model
                (Boltz-2) to predict how a mutation changes a drug's binding —
                the resistance question — from sequence alone, no fixed
                structure required. It's in limited early access while we
                validate and scale the GPU pipeline.
              </p>
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-teal-300/70 mb-2">
                  What you get
                </div>
                <ul className="space-y-1.5">
                  {[
                    "Wild-type vs. mutant binding-affinity prediction",
                    "A predicted 3D complex for each run",
                    "An early resistance signal to help prioritise, strongest on gatekeeper mutations",
                  ].map((line) => (
                    <li
                      key={line}
                      className="text-sm text-slate-200 flex items-start gap-2"
                    >
                      <span className="text-teal-400 mt-0.5">✓</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="text-xs text-slate-400 bg-slate-900/50 rounded border border-slate-800 px-3 py-2">
                Access is granted per account. Request it and we'll get a ping —
                approvals are usually quick.
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
              className="px-4 py-2 rounded bg-teal-600 hover:bg-teal-500 text-white text-xs font-mono uppercase tracking-[0.18em] transition-colors"
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
                onClick={requestAccess}
                disabled={submitting}
                className="px-4 py-2 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-mono uppercase tracking-[0.18em] transition-colors"
              >
                {submitting ? "Sending…" : "Request access →"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
