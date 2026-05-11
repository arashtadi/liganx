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

import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError, api } from "../api";
import { Spinner, ArrowRight } from "../components/Icons";
import { usePageMeta } from "../lib/usePageMeta";
import { useAuth } from "../lib/auth";
import Turnstile from "../components/Turnstile";

// Map the 9-value profile-side role taxonomy down to the 4-value contact
// taxonomy. Used to pre-fill the contact form's role select for signed-in
// users — no perfect 1:1, so we collapse the academic-side variants into
// "academic" and student variants into "student" by default.
function mapProfileRoleToContactRole(profileRole: string | null | undefined): string {
  if (!profileRole) return "";
  const r = profileRole.toLowerCase();
  if (r === "grad_student" || r === "undergrad") return "student";
  if (r === "postdoc" || r === "pi" || r === "comp_chem" || r === "med_chem" || r === "structural_bio") return "academic";
  if (r === "industry_sci") return "industry";
  if (r === "other") return "other";
  return "";
}

// Pre-filled message templates keyed by the `reason` we get from
// location.state. Keeps the form natural for direct visitors while
// removing the "what do I write?" friction for users routed here from
// a feature gate (e.g. clicking the Boltz-2 engine card).
const PREFILL_MESSAGES: Record<string, string> = {
  boltz2_request:
    "Hi — I'd like to enable Boltz-2 (the ML co-folding engine) on my account. " +
    "A bit about my use case:\n\n",
  quick_dock_request:
    "Hi — I'd like to enable Quick dock (the live dock-while-you-draw + AI optimize " +
    "feature in the compound editor) on my account. A bit about my use case:\n\n",
};

type Status = "idle" | "sending" | "sent" | "error";

// Role choices keep the question crisp without forcing the user into a
// fake bucket. "Other" lets us catch people who don't see themselves in
// the academic/industry binary (govt labs, indie researchers, hobbyists,
// students who are also working part-time, etc.) without us guessing
// what bucket they belong in. Order roughly matches expected volume —
// students and academics are the bulk of early demand for an
// open-science-leaning docking tool.
const ROLE_OPTIONS = [
  { value: "", label: "Select…" },
  { value: "student", label: "Student" },
  { value: "academic", label: "Academic researcher (postdoc, PI, staff scientist)" },
  { value: "industry", label: "Industry / professional" },
  { value: "other", label: "Other" },
] as const;

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

  // location.state may carry a `reason` string from the calling page
  // (e.g. NewJobPage's Boltz-2 engine card routes here with
  // reason: "boltz2_request"). We use that to pre-fill the message and
  // give the visit a clear "you came here to ask for X" framing.
  const location = useLocation();
  // Reason can arrive two ways:
  //  1. Router state (`navigate("/contact", { state: { reason: ... } })`) —
  //     used when the contact page opens IN-TAB. Survives SPA route
  //     transitions but is lost across new-tab boundaries.
  //  2. Query param (`?reason=...`) — used when the calling page opens
  //     contact in a NEW TAB via window.open, because router state
  //     can't cross window boundaries. Both Quick-dock and Boltz-2
  //     request CTAs use this path so the user keeps their in-progress
  //     work (Ketcher canvas, NewJob form state) in the original tab.
  // We read state first (fast path for in-tab navigations), then fall
  // back to the query param.
  const stateReason = (location.state as { reason?: string } | null)?.reason ?? "";
  const queryReason = new URLSearchParams(location.search).get("reason") ?? "";
  const reason = stateReason || queryReason;
  const prefilled = reason && PREFILL_MESSAGES[reason] ? PREFILL_MESSAGES[reason] : "";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // Who is this person? Helps Arash triage Boltz-2 access requests
  // (academic vs industry pricing) and weight feature priorities by
  // who's actually asking. Required so we never get a faceless "please
  // enable X" message.
  const [role, setRole] = useState("");
  // Free-text "what's your actual role" — only meaningful when role
  // === "other". The Telegram body shows "Other — <text>" so we get
  // useful triage info instead of a bare "Other".
  const [roleOther, setRoleOther] = useState("");
  // Free-form affiliation — university name, company, lab, hospital,
  // etc. Required so a Boltz-2 request comes with enough context to
  // do a quick credibility check before flipping a $497/mo pod on.
  const [affiliation, setAffiliation] = useState("");
  // Country/region — optional; helps with timezone-aware replies and
  // gives a coarse sense of where demand is coming from. Free-form
  // (not a 250-entry dropdown) because most users will type their
  // own country faster than they'd scroll a select.
  const [country, setCountry] = useState("");
  const [message, setMessage] = useState(prefilled);
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

  // Pre-fill from the signed-in user's profile so they don't have to
  // re-type info we already have (name, email, role, organization).
  // Only fills empty fields — if the user has already started typing
  // we don't clobber their input. Country isn't on the profile, so it
  // stays blank; Boltz-2-style power users tend to fill it themselves.
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.getMyProfile()
      .then((p) => {
        if (cancelled) return;
        setName((cur) => cur || p.full_name || "");
        setEmail((cur) => cur || user.email || "");
        setAffiliation((cur) => cur || p.organization || "");
        const mappedRole = mapProfileRoleToContactRole(p.role);
        setRole((cur) => cur || mappedRole);
        // role_other on profile → role_other on contact, but only when
        // the mapped contact role is "other" (otherwise the input is
        // hidden anyway and roleOther won't be sent).
        if (mappedRole === "other") {
          setRoleOther((cur) => cur || p.role_other || "");
        }
      })
      .catch(() => {
        // Profile fetch failure is non-fatal — the form still works,
        // user just types it manually. Common case: anon user, or a
        // brand-new account before the profile row exists.
      });
    return () => { cancelled = true; };
  }, [user]);

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
    role.trim().length > 0 &&
    // Other-specify is required when the user picks Other.
    (role !== "other" || roleOther.trim().length > 0) &&
    affiliation.trim().length > 0 &&
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
        role: role.trim(),
        // Only send role_other when role is Other. Empty string for any
        // other choice, so a stale value from a prior selection doesn't
        // bleed into the Telegram body.
        role_other: role === "other" ? roleOther.trim() : "",
        affiliation: affiliation.trim(),
        country: country.trim(),
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
            <Link to="/studio" className="btn-primary btn-sm">
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
        {/* Reason banner — shown when the visitor was routed here from a
            specific feature gate (e.g. clicking the Boltz-2 engine card).
            Confirms what they're asking about so the prefilled message
            doesn't feel like it appeared from nowhere, and so they can
            edit/delete it if they actually wanted to ask about something
            else. */}
        {reason === "boltz2_request" && (
          <div className="mt-4 rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-200">
            <strong>Requesting Boltz-2 access.</strong> The Boltz-2 ML engine runs on a
            dedicated GPU pod that we wake on demand for paying users. Tell us a bit about
            your use case and we'll get back to you within a day.
          </div>
        )}
        {reason === "quick_dock_request" && (
          <div className="mt-4 rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-200">
            <strong>Requesting Quick dock access.</strong> Quick dock runs real Vina inside
            the compound editor (~10s per click) so you see live scores + contact maps as
            you draw, with an AI-optimize loop that proposes pocket-targeted variants.
            We enable it per account so GPU cost stays predictable.
          </div>
        )}
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

        {/* Who-are-you block — role + affiliation are required so any
            Boltz-2 access request (or any partnership inquiry) lands in
            Telegram with enough context to triage on the spot, instead
            of triggering a back-and-forth email thread. Country is
            optional because it's nice-to-have rather than essential. */}
        <div>
          <label htmlFor="contact-role" className="block text-sm font-semibold text-ink dark:text-slate-200 mb-1.5">
            I am a
          </label>
          <select
            id="contact-role"
            name="role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-ink dark:text-slate-100 focus:border-delta-500 focus:ring-1 focus:ring-delta-500 outline-none"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.value === ""}>
                {opt.label}
              </option>
            ))}
          </select>
          {/* Conditional "please specify" — appears under the role
              dropdown when the user picks Other. Required when shown
              (canSubmit gates submit on it being non-empty). */}
          {role === "other" && (
            <input
              id="contact-role-other"
              type="text"
              required
              value={roleOther}
              onChange={(e) => setRoleOther(e.target.value)}
              maxLength={200}
              className="mt-2 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-ink dark:text-slate-100 placeholder-slate-400 focus:border-delta-500 focus:ring-1 focus:ring-delta-500 outline-none"
              placeholder="Please describe — e.g. Drug discovery scientist"
              aria-label="Please describe your role"
            />
          )}
        </div>

        <div>
          <label htmlFor="contact-affiliation" className="block text-sm font-semibold text-ink dark:text-slate-200 mb-1.5">
            School, company, or institution
          </label>
          <input
            id="contact-affiliation"
            name="affiliation"
            type="text"
            required
            autoComplete="organization"
            value={affiliation}
            onChange={(e) => setAffiliation(e.target.value)}
            maxLength={200}
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-ink dark:text-slate-100 placeholder-slate-400 focus:border-delta-500 focus:ring-1 focus:ring-delta-500 outline-none"
            placeholder="e.g. Stanford University, Genentech, Mayo Clinic"
          />
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            Helps us understand your context and reply with the most relevant info.
          </p>
        </div>

        <div>
          <label htmlFor="contact-country" className="block text-sm font-semibold text-ink dark:text-slate-200 mb-1.5">
            Country / region <span className="font-normal text-slate-400 dark:text-slate-500">(optional)</span>
          </label>
          <input
            id="contact-country"
            name="country"
            type="text"
            autoComplete="country-name"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            maxLength={100}
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-ink dark:text-slate-100 placeholder-slate-400 focus:border-delta-500 focus:ring-1 focus:ring-delta-500 outline-none"
            placeholder="e.g. United States, Germany, India"
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
