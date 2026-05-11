import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";

/**
 * Liganx AI Beta — floating action button + slide-out chat panel.
 *
 * Mounted on JobPage (and eventually Studio). The FAB lives at the
 * bottom-right corner; clicking it slides a 380px-wide panel in from
 * the right edge. Every question hits POST /jobs/{key}/ask on the
 * backend, which composes a structured page-snapshot + the user's
 * question, sends them to Claude Haiku, and returns plain text.
 *
 * Why FAB + slide-out (not a header button + modal):
 *   - Chemists are typically reading the selectivity matrix when the
 *     question hits them. A right-rail slide-out keeps the data
 *     visible while they type, instead of a full-screen modal that
 *     hides the table they're asking about.
 *   - The FAB position matches what users expect from chat widgets
 *     (Intercom, HelpScout). Familiar = no onboarding overhead.
 *   - Bottom-right is the safe corner: HeroBanner sits top-right at
 *     400px wide on lg, so the FAB doesn't collide with it.
 *
 * "Beta" tag is load-bearing — it sets the user's expectation that
 * answers may be imperfect, and gives us latitude to ship and iterate
 * instead of holding for perfection.
 */

interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
  modelId?: string;
}

/** Curated quick-question prompts shown above the input on first open.
 *  They serve a real onboarding purpose — chemists who've never used an
 *  in-product AI feature don't know what kind of question is in-scope.
 *  These three cover the three most common questions ('explain a term',
 *  'tell me which compound to look at', 'why is this score weird?')
 *  which trains them to ask similar things. */
const QUICK_QUESTIONS: string[] = [
  "Explain the outside-pocket badge on this matrix.",
  "Which compound here looks most promising and why?",
  "Why is this Δ flagged as unreliable?",
];

/** Subtle sparkles icon — used in the FAB and panel header. Inlined as
 *  SVG so we don't take a `lucide-react` dependency just for this. */
function SparklesIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

interface Props {
  jobKey: string | number;
}

export default function LiganxAIPanel({ jobKey }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Pin the scroll position to the latest message every time the
  // transcript grows. We use scrollTop = scrollHeight (not
  // scrollIntoView on the last child) because the scrollIntoView
  // approach also affects the page scroll when the panel is mid-screen.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // Focus the textarea on open so users can start typing immediately.
  useEffect(() => {
    if (open && inputRef.current) {
      // Defer so the slide-in animation doesn't fight the focus.
      const t = setTimeout(() => inputRef.current?.focus(), 220);
      return () => clearTimeout(t);
    }
  }, [open]);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    setBusy(true);
    try {
      const resp = await api.askJob(jobKey, trimmed);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: resp.answer, modelId: resp.model },
      ]);
    } catch (e) {
      // Map common error shapes to friendly chat bubbles. The backend
      // sets a human-readable `detail` on 503/429/401 so we just
      // surface it verbatim.
      const msg = e instanceof ApiError
        ? (e.status === 429
            ? "You've hit the AI rate limit — please try again in a few minutes."
            : e.status === 401
              ? "Please sign in to use Liganx AI."
              : e.message)
        : "Something went wrong reaching the AI service. Try again in a moment.";
      setMessages((prev) => [...prev, { role: "error", text: msg }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a newline. Matches chat-app
    // conventions (Slack, Discord, ChatGPT).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <>
      {/* ── FAB launcher ───────────────────────────────────────────── */}
      {/* Position: fixed bottom-right. z-40 so it sits above page
          content but below modal overlays (which use z-50). The
          gradient + glow + tiny BETA pill is the "professional + fun"
          treatment — looks AI-native, doesn't scream chatbot. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 group flex items-center gap-2 pl-3.5 pr-4 py-2.5
                     rounded-full shadow-lg shadow-violet-900/40
                     bg-gradient-to-br from-violet-600 via-fuchsia-600 to-rose-500
                     hover:from-violet-500 hover:via-fuchsia-500 hover:to-rose-400
                     text-white text-sm font-semibold tracking-wide
                     ring-1 ring-white/10 ring-inset
                     transition-transform hover:-translate-y-0.5 active:translate-y-0
                     before:absolute before:inset-0 before:rounded-full before:bg-white/10 before:opacity-0
                     hover:before:opacity-100 before:transition-opacity"
          aria-label="Open Liganx AI"
          title="Ask Liganx AI about anything on this page"
        >
          <span className="relative flex items-center justify-center w-6 h-6">
            {/* Pulsing halo — gives the FAB a subtle "I'm alive" cue
                without animating the whole button. Pure CSS, no JS. */}
            <span className="absolute inset-0 rounded-full bg-white/30 animate-ping opacity-60" />
            <SparklesIcon className="relative w-4 h-4" />
          </span>
          <span>Liganx AI</span>
          <span className="ml-0.5 rounded-md bg-white/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
            Beta
          </span>
        </button>
      )}

      {/* ── Slide-out panel ─────────────────────────────────────────── */}
      {/* Always rendered (so the transform animation works) but
          translated off-screen when closed. 380px wide on desktop,
          full-width on mobile so the keyboard doesn't squash it. */}
      <aside
        className={`fixed top-0 right-0 z-40 h-full w-full sm:w-[400px]
                    bg-white dark:bg-slate-900
                    border-l border-slate-200 dark:border-slate-800
                    shadow-2xl shadow-slate-900/30
                    flex flex-col
                    transition-transform duration-200 ease-out
                    ${open ? "translate-x-0" : "translate-x-full pointer-events-none"}`}
        aria-hidden={!open}
      >
        {/* Header — same gradient as the FAB so the open animation
            feels continuous. */}
        <div className="relative px-4 py-3 border-b border-slate-200 dark:border-slate-800
                        bg-gradient-to-br from-violet-600 via-fuchsia-600 to-rose-500 text-white">
          <div className="flex items-center gap-2">
            <SparklesIcon className="w-4 h-4" />
            <h2 className="text-sm font-bold tracking-wide">Liganx AI</h2>
            <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
              Beta
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto rounded-md w-7 h-7 flex items-center justify-center
                         text-white/80 hover:text-white hover:bg-white/15 transition-colors"
              aria-label="Close panel"
              title="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-[11px] text-white/80 mt-1 leading-snug">
            Ask anything about this job's results. Scoped to what's on the page — no extrapolation.
          </p>
        </div>

        {/* Transcript */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-3 text-sm bg-slate-50/40 dark:bg-slate-900/60"
        >
          {messages.length === 0 && (
            <div className="space-y-3">
              <div className="rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-3.5 py-3 text-slate-700 dark:text-slate-200 leading-relaxed">
                <strong className="text-slate-900 dark:text-slate-100">Hi! I can explain anything on this page</strong> — what the badges mean, why a Δ is unreliable, which compound looks most promising, what's driving the ADMET risk on a specific row. I'm scoped to the data shown here, so I'll tell you when something isn't on the page.
              </div>
              {/* Quick-question chips — onboarding seed. */}
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1">
                  Try asking
                </div>
                {QUICK_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void send(q)}
                    disabled={busy}
                    className="text-left rounded-lg px-3 py-2 text-[12px]
                               bg-white dark:bg-slate-800/60
                               border border-slate-200 dark:border-slate-700
                               text-slate-700 dark:text-slate-200
                               hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20
                               hover:text-violet-700 dark:hover:text-violet-300
                               transition-colors disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <Bubble key={i} message={m} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 px-1">
              <span className="inline-flex">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-500 animate-bounce mx-1" style={{ animationDelay: "120ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-bounce" style={{ animationDelay: "240ms" }} />
              </span>
              <span>Liganx AI is thinking…</span>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
          <div className="relative rounded-xl border border-slate-300 dark:border-slate-700 focus-within:ring-2 focus-within:ring-violet-400/60 focus-within:border-violet-400">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about a score, a badge, or a compound…"
              rows={2}
              maxLength={1000}
              disabled={busy}
              className="w-full resize-none bg-transparent px-3 py-2 pr-12 text-sm
                         text-ink dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500
                         outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={busy || !input.trim()}
              className="absolute right-1.5 bottom-1.5 inline-flex items-center justify-center
                         w-8 h-8 rounded-lg
                         bg-gradient-to-br from-violet-600 to-fuchsia-600
                         hover:from-violet-500 hover:to-fuchsia-500
                         text-white shadow disabled:opacity-40 disabled:cursor-not-allowed
                         transition-opacity"
              title="Send (Enter)"
              aria-label="Send"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
            <span>Enter to send · Shift+Enter for newline</span>
            <span>AI guidance — verify before acting</span>
          </div>
        </div>
      </aside>
    </>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-[13px]
                        bg-violet-600 text-white shadow-sm">
          {message.text}
        </div>
      </div>
    );
  }
  if (message.role === "error") {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800/60 px-3.5 py-2 text-[12px] text-rose-700 dark:text-rose-300">
        {message.text}
      </div>
    );
  }
  // assistant
  return (
    <div className="space-y-1">
      <div className="rounded-2xl rounded-bl-md bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 px-3.5 py-2.5 text-[13px] text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-wrap">
        {message.text}
      </div>
      {message.modelId && (
        <div className="text-[9px] text-slate-400 dark:text-slate-500 px-1">
          powered by {message.modelId}
        </div>
      )}
    </div>
  );
}
