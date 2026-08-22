import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { markFeedbackPrompted } from "../lib/feedbackTrigger";

/**
 * One-time feedback prompt, surfaced after the user's 5th dock. Collects a
 * 1-5 star rating + an optional written comment; the submission is relayed to
 * the operator (Telegram + email) with the user's identity and the page
 * context attached server-side. Dismissing or submitting both mark the prompt
 * as shown so the user is never nagged twice.
 */
export default function FeedbackModal({
  context,
  onClose,
}: {
  context?: string;
  onClose: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  function dismiss() {
    markFeedbackPrompted();
    onClose();
  }

  async function submit() {
    if (sending) return;
    setSending(true);
    try {
      await api.submitFeedback({
        rating: rating || undefined,
        message: message.trim() || undefined,
        context,
      });
    } catch {
      /* fire-and-forget — never block the user on a feedback POST */
    }
    markFeedbackPrompted();
    setSending(false);
    setSent(true);
    window.setTimeout(onClose, 1400);
  }

  const canSend = rating > 0 || message.trim().length > 0;

  const node = (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-fade-in"
      onClick={dismiss}
    >
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {sent ? (
          <div className="px-6 py-10 text-center">
            <div className="text-3xl mb-2">🙏</div>
            <div className="text-lg font-semibold text-white">Thank you!</div>
            <div className="text-sm text-slate-400 mt-1">Your feedback went straight to the team.</div>
          </div>
        ) : (
          <>
            <div className="px-6 pt-6 pb-2 relative">
              <button
                onClick={dismiss}
                aria-label="Close"
                className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 text-lg leading-none"
              >
                ✕
              </button>
              <h2 className="text-lg font-semibold text-white pr-6">How's Liganx working for you?</h2>
              <p className="text-sm text-slate-400 mt-1">
                You've run a few docks — we'd love a quick rating and any suggestions.
              </p>
            </div>

            <div className="px-6 py-4">
              {/* Star rating */}
              <div className="flex items-center gap-1.5 mb-4" onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onMouseEnter={() => setHover(n)}
                    onClick={() => setRating(n)}
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                    className="text-3xl leading-none transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-violet-500 rounded"
                    style={{ color: (hover || rating) >= n ? "#f59e0b" : "#475569" }}
                  >
                    ★
                  </button>
                ))}
                {rating > 0 && (
                  <span className="ml-2 text-xs text-slate-400">{rating}/5</span>
                )}
              </div>

              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                autoFocus
                placeholder="What would make Liganx better? Bugs, missing features, anything at all…"
                className="w-full resize-y rounded-lg bg-slate-950/60 border border-slate-700 text-slate-100 placeholder:text-slate-600 text-sm px-3 py-2 focus:outline-none focus:border-violet-500"
              />
            </div>

            <div className="px-6 pb-6 pt-1 flex items-center justify-between gap-3">
              <button
                onClick={dismiss}
                className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                Maybe later
              </button>
              <button
                onClick={submit}
                disabled={!canSend || sending}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-700 disabled:bg-slate-700 disabled:text-slate-500 text-white transition-colors"
              >
                {sending ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
