/**
 * /contact — public contact form.
 *
 * Submissions hit POST /contact on the backend, which forwards them to
 * a Telegram bot so Arash gets a push notification on his phone.
 *
 * Anti-spam:
 *  - Honeypot field "website" — visually hidden via CSS + aria-hidden +
 *    tabIndex={-1} + autoComplete="off". Real users never touch it; most
 *    form-spam bots fill every input. Backend silently 200-swallows any
 *    submission with non-empty `website` so bots don't learn the trap.
 *  - Rate limited server-side (CONTACT_LIMIT) at 5/hr/IP.
 *
 * UX:
 *  - Single submit button with three states: idle / sending / success.
 *  - On success the form is replaced with a confirmation card so the
 *    user can't accidentally re-submit on a flaky connection.
 *  - On 503 (Telegram not configured yet — pre-bot-token state) we show
 *    the email fallback the backend returns, so the page never feels
 *    broken even mid-rollout.
 */

import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api";
import { Spinner, ArrowRight } from "../components/Icons";
import { usePageMeta } from "../lib/usePageMeta";
import Turnstile from "../components/Turnstile";

type Status = "idle" | "sending" | "sent" | "error";

// Cloudflare Turnstile site key — public, safe to ship in the bundle.
// Stored in Vercel as VITE_TURNSTILE_SITE_KEY. The matching SECRET
// key lives only on the backend (TURNSTILE_SECRET_KEY Fly secret).
// When unset (local dev / pre-rollout), the Turnstile component
// renders a small dev note and the form proceeds without a token.
const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "";

export default function ContactPage() {
  // SEO meta. Indexed via robots.txt (Allow: /contact). The title is
  // intentionally generic — "Contact Liganx" is what users will type
  // when they're searching for our contact info. Description gives them
  // a reason to fill the form (response time + scope).
  usePageMeta({
    title: "Contact Liganx — questions, feedback, partnerships",
    description:
      "Get in touch with the Liganx team. Questions about mutation-aware molecular docking, feedback, bug reports, or partnership inquiries — we usually reply within 24 hours.",
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  // Honeypot — bound to React state so we can read it on submit, but
  // visually hidden in the DOM so humans don't see it. Default empty.
  const [website, setWebsite] = useState("");
  // Turnstile token. Empty until the widget passes the challenge.
  // The form's submit button stays disabled until we have one (when
  // Turnstile is configured) so the user gets a clear "wait for the
  // CAPTCHA" affordance instead of a server-side rejection.
  const [turnstileToken, setTurnstileToken] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Char counter for the message field — we cap server-side at 5000 chars
  // and want the user to know before they hit submit. Soft-warn at 4500.
  const MIN_MESSAGE = 10;
  const MAX_MESSAGE = 5000;
  const messageOver = message.length > MAX_MESSAGE;
  const messageTooShort = message.trim().length > 0 && message.trim().length < MIN_MESSAGE;

  // CAPTCHA-required when the site key is configured. Without a key
  // (local dev / pre-rollout), we skip the gate so devs can still
  // exercise the form. Backend has its own enforcement so a tampered
  // bundle can't bypass.
  const captchaSatisfied = !TURNSTILE_SITE_KEY || turnstileToken.length > 0;

  const canSubmit =
    status !== "sending" &&
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    message.trim().length >= MIN_MESSAGE &&
    !messageOver &&
    captchaSatisfied;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("sending");
    setErrorMsg(null);
    try {
      await api.submitContact({
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
        website,
        turnstile_token: turnstileToken,
      });
      setStatus("sent");
    } catch (err) {
      // ApiError surfaces backend's `detail` string when present —
      // both rate-limit messages and the Telegram-unconfigured fallback
      // are user-facing strings the backend wrote, so passing them
      // through is the right move.
      const msg =
        err instanceof ApiError
          ? err.message
          : "Something went wrong sending your message. Please try again in a few minutes.";
      setErrorMsg(msg);
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <article className="mx-auto max-w-xl px-4 sm:px-6 py-16">
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-900/20 p-8 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-700 dark:text-emerald-300" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-ink dark:text-white mb-2">Message sent</h1>
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            Thanks for reaching out. We typically reply within 24 hours
            (usually faster).
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link to="/" className="btn-secondary btn-sm">Back to home</Link>
            <Link to="/new" className="btn-primary btn-sm">
              Try a docking job <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="mx-auto max-w-xl px-4 sm:px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-ink dark:text-white mb-2">Get in touch</h1>
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          Questions about mutation-aware docking, feedback, bug reports,
          partnership inquiries, or anything else — drop a note and we'll
          get back to you. Most messages get a reply within 24 hours.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Honeypot field — visually hidden but present in the DOM so
            naive form-spam bots fill it. Real users don't see it.
            Belt-and-braces: aria-hidden, tabIndex=-1, autoComplete=off,
            and CSS that pushes it off-screen rather than display:none
            (some bots skip display:none). */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-10000px",
            top: "auto",
            width: "1px",
            height: "1px",
            overflow: "hidden",
          }}
        >
          <label htmlFor="website">
            Don't fill this out if you're human:
            <input
              type="text"
              id="website"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
        </div>

        <div>
          <label htmlFor="contact-name" className="block text-sm font-semibold text-ink dark:text-slate-200 mb-1.5">
            Name
          </label>
          <input
            id="contact-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-ink dark:text-slate-100 placeholder-slate-400 focus:border-delta-500 focus:ring-1 focus:ring-delta-500 outline-none"
            placeholder="Jane Doe"
          />
        </div>

        <div>
          <label htmlFor="contact-email" className="block text-sm font-semibold text-ink dark:text-slate-200 mb-1.5">
            Email
          </label>
          <input
            id="contact-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-ink dark:text-slate-100 placeholder-slate-400 focus:border-delta-500 focus:ring-1 focus:ring-delta-500 outline-none"
            placeholder="jane@university.edu"
          />
        </div>

        <div>
          <label htmlFor="contact-message" className="flex items-baseline justify-between text-sm font-semibold text-ink dark:text-slate-200 mb-1.5">
            <span>Message</span>
            <span className={
              "text-[11px] font-normal " +
              (messageOver
                ? "text-rose-600 dark:text-rose-400"
                : message.length > 4500
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-slate-400 dark:text-slate-500")
            }>
              {message.length} / {MAX_MESSAGE}
            </span>
          </label>
          <textarea
            id="contact-message"
            name="message"
            required
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-ink dark:text-slate-100 placeholder-slate-400 focus:border-delta-500 focus:ring-1 focus:ring-delta-500 outline-none resize-y"
            placeholder="What can we help with?"
          />
          {messageTooShort && (
            <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
              A few more words please — at least {MIN_MESSAGE} characters.
            </p>
          )}
          {messageOver && (
            <p className="mt-1.5 text-[11px] text-rose-700 dark:text-rose-300">
              That's longer than we can send. Please trim to {MAX_MESSAGE} characters or fewer.
            </p>
          )}
        </div>

        {/* Cloudflare Turnstile widget — invisible/lightweight challenge
            that gates the submit button. Most users never see anything
            beyond a brief spinner; only suspicious sessions get an
            interactive prompt. The token from a successful challenge
            flows into form state via setTurnstileToken and is sent to
            the backend, which re-verifies with Cloudflare server-side. */}
        <Turnstile
          siteKey={TURNSTILE_SITE_KEY}
          onVerify={setTurnstileToken}
          onExpire={() => setTurnstileToken("")}
          onError={() => setTurnstileToken("")}
        />

        {errorMsg && (
          <div role="alert" className="rounded-md border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            {errorMsg}
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            By submitting you agree to our{" "}
            <Link to="/privacy" className="text-delta-700 hover:underline dark:text-delta-300">privacy policy</Link>.
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-md bg-delta-600 hover:bg-delta-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 transition-colors"
          >
            {status === "sending" ? (
              <>
                <Spinner size={14} /> Sending…
              </>
            ) : (
              <>Send message <ArrowRight size={14} /></>
            )}
          </button>
        </div>
      </form>

    </article>
  );
}
