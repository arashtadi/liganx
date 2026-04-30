/**
 * DocFlaskTour — first-run walkthrough for new users on the New Job page.
 *
 * Orchestrates a small step machine: each step has a target CSS selector,
 * a title, body copy, and a Doc Flask pose. The tour:
 *
 *   1. Mounts globally (in App.tsx) but renders nothing unless we're on a
 *      page where a tour is configured AND the user hasn't already
 *      completed/skipped it.
 *   2. Highlights the target element by drawing a soft ring around it
 *      (computed from getBoundingClientRect — no DOM mutation on the
 *      target itself).
 *   3. Anchors a speech bubble next to the target with a tail pointing
 *      at it.
 *   4. Doc Flask floats in a screen corner, points / cheers / thinks
 *      based on the step's pose.
 *
 * Cross-browser hardening:
 *   - getBoundingClientRect (universal)
 *   - Position recomputed on scroll + resize via passive listeners
 *   - localStorage wrapped in try/catch (Safari incognito throws)
 *   - All animations use transform + opacity (Safari-safe)
 *   - No backdrop-filter, no scroll-behavior:smooth (older Safari quirks)
 *   - prefers-reduced-motion honored by the mascot's keyframes
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import DocFlaskMascot, { type DocFlaskPose } from "./DocFlaskMascot";

interface TourStep {
  /** CSS selector of the element this step is teaching about. The element
   *  is highlighted with a ring and the speech bubble anchors near it.
   *  If null, the speech bubble is centered (used for welcome / outro). */
  selector: string | null;
  title: string;
  body: string;
  pose: DocFlaskPose;
  /** Where the bubble sits relative to the target. 'auto' tries to find
   *  the side with the most room. */
  side?: "auto" | "top" | "bottom" | "left" | "right";
}

/** Steps for the New Job page first-run tour. Each one teaches one
 *  concept tied to a stable selector — most of these match
 *  data-tour="..." attributes in NewJobPage.tsx. Stable data-tour markers
 *  prevent the tour from breaking when class names get refactored. */
const NEW_JOB_TOUR: TourStep[] = [
  {
    selector: null,
    title: "Hi! I'm Doc Flask.",
    body:
      "I'll walk you through a docking run — about 30 seconds. I'll come back each time you visit New Job unless you tick \"Don't show this again\" below.",
    pose: "idle",
  },
  {
    selector: '[data-tour="step-targets"]',
    title: "Step 1 — pick a target",
    body:
      "Choose the kinase you want to study. Each card represents a clinically actionable drug target. EGFR or ALK are gentle starting points if you're new.",
    pose: "pointing-down",
    side: "top",
  },
  {
    selector: '[data-tour="step-mutations"]',
    title: "Step 2 — pick mutations",
    body:
      "Click any chip to add a clinical mutation. Each card below has its own mutation list — so for two targets, you set them separately. Skip a card to dock that target as wild-type only.",
    pose: "pointing-down",
    side: "top",
  },
  {
    selector: '[data-tour="step-compounds"]',
    title: "Step 3 — add your compounds",
    body:
      "Reference compounds are pre-loaded. Edit, paste a SMILES, or click Sketch to draw one in the 2D editor. Up to 5 on the free tier.",
    pose: "pointing-down",
    side: "top",
  },
  {
    selector: '[data-tour="step-run-options"]',
    title: "Step 4 — run options",
    body:
      "Tune search depth (Fast / Balanced / Thorough), opt out of the wild-type baseline if you only want absolute mutant scores, and pick the docking engine. The default QuickVina2-GPU is fast and Vina-family. GNINA adds CNN-based pose rescoring — slower per cell but a genuinely different ranking signal worth trying for a second opinion.",
    pose: "pointing-down",
    side: "top",
  },
  {
    selector: '[data-tour="step-run"]',
    title: "Run it!",
    body:
      "Each compound docks against the wild-type structure plus every mutation you picked. You'll get a selectivity matrix in seconds.",
    pose: "celebrating",
    side: "top",
  },
  {
    selector: null,
    title: "That's the whole loop.",
    body:
      "Click any matrix cell to inspect a pose in 3D. You can revisit jobs from History anytime. Good luck!",
    pose: "celebrating",
  },
];

const STORAGE_KEY = "liganx-tour:new-job";
const DISMISSED_VALUE = "dismissed";
/** sessionStorage flag set by resetDocFlaskTour() to tell the next mount
 *  of DocFlaskTour to skip the 600 ms settle delay and pop up instantly.
 *  Cleared as soon as it's consumed. sessionStorage (not localStorage) so
 *  it doesn't leak across tabs/sessions if something goes wrong. */
const FORCE_NOW_KEY = "liganx-tour:force-now";
/** Window event name dispatched by resetDocFlaskTour(). The currently-
 *  mounted DocFlaskTour listens for this and fires immediately if it's
 *  on /new. Covers the case where the user clicks "Show Doc Flask tour"
 *  while already on /new — the path doesn't change, so the route-change
 *  effect won't re-fire on its own. */
const SHOW_EVENT = "docflask:show";

/** The tour now shows on EVERY visit to /new, UNTIL the user explicitly
 *  ticks "Don't show again" and dismisses. Just clicking Skip or
 *  finishing the tour without the checkbox leaves the dismissed flag
 *  unset, so the tour reappears next visit. This matches "Clippy on
 *  every new doc" energy — the user opted into Liganx, the brief tour
 *  helps every time, and there's a clear opt-out for power users. */
function readTourState(): "dismissed" | "fresh" {
  try {
    return localStorage.getItem(STORAGE_KEY) === DISMISSED_VALUE ? "dismissed" : "fresh";
  } catch {
    return "fresh";
  }
}
function markTourDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, DISMISSED_VALUE);
  } catch {
    /* private mode — the user will see the tour again next session.
       That's the conservative outcome: better re-shown than silently
       lost on a flag we couldn't write. */
  }
}

/** Public reset — used by the user-menu "Show Doc Flask again" option to
 *  un-dismiss the tour. After calling this, the user should land on /new
 *  (the menu handles navigation) and the tour fires INSTANTLY — no
 *  600 ms settle delay — because explicit menu invocations don't need
 *  to wait for layout to stabilize the way first-page-load does.
 *
 *  We do two things to guarantee it pops up immediately:
 *    1. Set FORCE_NOW_KEY in sessionStorage. The /new mount-time effect
 *       reads this and skips the setTimeout when it's "1".
 *    2. Dispatch a window event. If a DocFlaskTour is already mounted on
 *       /new (user clicked the menu while already on /new — the navigate
 *       to /new is a no-op, no route change), it activates on the spot. */
export function resetDocFlaskTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* private mode */ }
  try { sessionStorage.setItem(FORCE_NOW_KEY, "1"); } catch { /* private mode */ }
  try { window.dispatchEvent(new Event(SHOW_EVENT)); } catch { /* SSR / older */ }
}

/** Read whether the user has currently opted out of the tour. The user
 *  menu uses this to decide whether to show the "Show again" item. We
 *  show it always when the user is signed in — even if they haven't
 *  dismissed yet — so people who *want* to revisit the tour after
 *  finishing it normally still have the entry point. */
export function isDocFlaskTourDismissed(): boolean {
  return readTourState() === "dismissed";
}

/** Public dismiss — used by the SettingsPage Doc Flask toggle so users
 *  can opt out without having to navigate to /new and tick the in-tour
 *  checkbox. Persists the same flag the in-tour checkbox does. */
export function dismissDocFlaskTour() {
  markTourDismissed();
}

export default function DocFlaskTour() {
  const location = useLocation();
  // Only run on the New Job page for now. Other pages can wire their own
  // tour by adding a steps definition + a path check here.
  const onNewJob = location.pathname === "/new";
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);

  // "Don't show again" checkbox — when checked at dismiss time, we
  // persist the dismissed flag. Otherwise the tour just closes for
  // this session and will return on the next /new visit.
  const [neverAgain, setNeverAgain] = useState(false);

  // Auto-start on every visit to /new for users who haven't permanently
  // dismissed. Delay 600 ms to let the page settle (catalog API,
  // layout) — without the delay the bubble anchors at coordinates that
  // change as content loads, so it visibly jumps once before the first
  // step. The checkbox state resets each time the tour fires.
  //
  // EXCEPTION — when FORCE_NOW_KEY is set (the user just clicked
  // "Show Doc Flask tour" in the user menu), we skip the settle and
  // fire instantly. The user explicitly asked for it; making them wait
  // 600 ms after a click feels broken.
  useEffect(() => {
    if (!onNewJob) {
      setActive(false);
      return;
    }
    if (readTourState() === "dismissed") return;
    setNeverAgain(false);

    let forceNow = false;
    try {
      forceNow = sessionStorage.getItem(FORCE_NOW_KEY) === "1";
      if (forceNow) sessionStorage.removeItem(FORCE_NOW_KEY);
    } catch { /* private mode */ }

    if (forceNow) {
      setActive(true);
      setStepIdx(0);
      return;
    }

    const t = window.setTimeout(() => {
      setActive(true);
      setStepIdx(0);
    }, 600);
    return () => window.clearTimeout(t);
  }, [onNewJob]);

  // Already-on-/new case: when the user clicks "Show Doc Flask tour" from
  // the user menu while they're already on /new, navigate("/new") is a
  // no-op (no path change), so the effect above doesn't re-fire.
  // resetDocFlaskTour() also dispatches SHOW_EVENT — we listen for it and
  // activate immediately. Guard on `onNewJob` so the event is ignored
  // from other pages (the navigate will land first and the effect above
  // will handle it via FORCE_NOW_KEY).
  useEffect(() => {
    function onShow() {
      if (!onNewJob) return;
      // Clear the force flag if it's still set — we're handling it here
      // instead of via the route-change effect.
      try { sessionStorage.removeItem(FORCE_NOW_KEY); } catch { /* private mode */ }
      setNeverAgain(false);
      setStepIdx(0);
      setActive(true);
    }
    window.addEventListener(SHOW_EVENT, onShow);
    return () => window.removeEventListener(SHOW_EVENT, onShow);
  }, [onNewJob]);

  if (!active) return null;
  const step = NEW_JOB_TOUR[stepIdx];
  if (!step) return null;

  function dismiss() {
    // Only persist the dismissed flag when the user opts out via the
    // checkbox. Without it, "Skip" / "Got it" just closes for now and
    // the tour returns next visit — exactly the "always show until told
    // to stop" behavior we want.
    if (neverAgain) markTourDismissed();
    setActive(false);
  }
  function next() {
    if (stepIdx + 1 >= NEW_JOB_TOUR.length) {
      dismiss();
    } else {
      setStepIdx(stepIdx + 1);
    }
  }
  function skip() {
    dismiss();
  }

  return (
    <TourOverlay
      step={step}
      stepIdx={stepIdx}
      total={NEW_JOB_TOUR.length}
      neverAgain={neverAgain}
      onToggleNeverAgain={setNeverAgain}
      onNext={next}
      onSkip={skip}
    />
  );
}

interface OverlayProps {
  step: TourStep;
  stepIdx: number;
  total: number;
  neverAgain: boolean;
  onToggleNeverAgain: (v: boolean) => void;
  onNext: () => void;
  onSkip: () => void;
}

function TourOverlay({
  step, stepIdx, total, neverAgain, onToggleNeverAgain, onNext, onSkip,
}: OverlayProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  // Resolve and track the target element's bounding rect. Recomputes on
  // scroll, resize, and any DOM size change in the target's subtree. We
  // also re-resolve the selector each tick because the target may not
  // exist yet on first render (catalog still loading, etc.) — without
  // re-querying we'd miss the element when it appears.
  useEffect(() => {
    if (!step.selector) {
      setTargetRect(null);
      return;
    }
    let raf = 0;
    function refresh() {
      const el = document.querySelector(step.selector!);
      if (el) {
        setTargetRect((el as HTMLElement).getBoundingClientRect());
        // Scroll the target into view if it's offscreen — without
        // scroll-behavior:smooth (Safari iOS bug) we use a manual
        // smooth-ish call by setting block:'center' and letting the
        // browser handle it.
        const rect = (el as HTMLElement).getBoundingClientRect();
        const offTop = rect.top < 80;
        const offBot = rect.bottom > window.innerHeight - 100;
        if (offTop || offBot) {
          (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
        }
      } else {
        setTargetRect(null);
      }
    }
    function tick() {
      refresh();
      raf = window.requestAnimationFrame(tick);
    }
    raf = window.requestAnimationFrame(tick);
    window.addEventListener("scroll", refresh, { passive: true, capture: true });
    window.addEventListener("resize", refresh, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
      observerRef.current?.disconnect();
    };
  }, [step.selector]);

  // Esc dismisses
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onSkip();
      else if (e.key === "Enter" || e.key === " ") {
        // Only advance on Enter when the focus isn't on a form input —
        // otherwise typing Space in the SMILES field would skip the tour.
        const tag = (document.activeElement?.tagName || "").toLowerCase();
        if (tag !== "input" && tag !== "textarea" && tag !== "select") {
          e.preventDefault();
          onNext();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, onSkip]);

  // Bubble position. If we have a target, anchor near it; otherwise center.
  const bubble = useMemo(() => computeBubblePosition(targetRect, step.side ?? "auto"), [targetRect, step.side]);

  // Z-index plan:
  //   - Backdrop: 200
  //   - Highlight ring: 201
  //   - Speech bubble + Doc Flask: 202
  // Above modals (which use 100–200) but below browser UI.
  return (
    <>
      {/* Soft backdrop. We don't dim too aggressively — this is a tour,
          not a blocking modal. The user should still be able to read the
          page underneath. Click anywhere on the backdrop = advance. */}
      <div
        className="fixed inset-0 z-[200] bg-ink/30 dark:bg-ink/50 cursor-pointer"
        style={{ pointerEvents: "auto" }}
        onClick={onNext}
        aria-hidden="true"
      />

      {/* Highlight ring around the target. Drawn as a fixed-positioned
          div with no fill so the underlying element is fully visible. */}
      {targetRect && (
        <div
          className="fixed z-[201] pointer-events-none rounded-xl ring-4 ring-delta-400/80 dark:ring-delta-300/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.0)] transition-all"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
        />
      )}

      {/* Speech bubble — anchored near the target or centered when none.
          Spring-in scale + fade on each step change. The bubble is keyed
          by stepIdx so React remounts it (re-runs the entry animation)
          when the user advances, giving each step a fresh feel. The
          mascot inside the bubble also remounts and replays its own
          spring-in. */}
      <style>{`
        @keyframes df-bubble-in {
          0%   { transform: translateY(8px) scale(0.94); opacity: 0; }
          70%  { transform: translateY(-2px) scale(1.01); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes df-progress-pulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.25); }
        }
        .df-bubble-card {
          animation: df-bubble-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
        .df-dot.active {
          animation: df-progress-pulse 1.6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .df-bubble-card, .df-dot.active { animation: none; }
        }
      `}</style>
      <div
        key={stepIdx}
        className="df-bubble-card fixed z-[202] max-w-sm bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl shadow-[0_20px_60px_-15px_rgba(15,23,42,0.45)] ring-1 ring-slate-200 dark:ring-slate-700 p-4 sm:p-5"
        style={{ top: bubble.top, left: bubble.left, transform: bubble.transform }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 -mt-2 -ml-1">
            <DocFlaskMascot
              pose={step.pose}
              size={84}
              attentionBounce={stepIdx === 0}
            />
          </div>
          <div className="min-w-0 flex-1">
            {/* Progress dots — modern alternative to "Step N of M".
                The active dot pulses gently to draw the eye. Click to
                jump to that step. */}
            <div className="flex items-center gap-1.5 mb-1.5">
              {Array.from({ length: total }).map((_, i) => (
                <span
                  key={i}
                  className={`df-dot inline-block rounded-full transition-all ${
                    i === stepIdx
                      ? "active bg-delta-500 w-6 h-1.5 dark:bg-delta-400"
                      : i < stepIdx
                        ? "bg-delta-300 w-1.5 h-1.5 dark:bg-delta-700"
                        : "bg-slate-200 w-1.5 h-1.5 dark:bg-slate-700"
                  }`}
                />
              ))}
            </div>
            <h3 className="text-base font-semibold text-ink dark:text-slate-100 leading-tight">
              {step.title}
            </h3>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {step.body}
            </p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
          {/* "Don't show again" — only persists the dismissed flag when
              checked. Without this checkbox ticked, Skip / Got it just
              closes for this session and the tour returns next /new visit.
              Default unchecked so first-timers can read every step without
              opting out by accident. */}
          <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-500 dark:text-slate-400 select-none">
            <input
              type="checkbox"
              checked={neverAgain}
              onChange={(e) => onToggleNeverAgain(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-300 text-delta-600 focus:ring-delta-500 dark:border-slate-600 dark:bg-slate-800"
            />
            <span>Don't show this again on the New Job page</span>
          </label>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onSkip}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-ink dark:hover:text-slate-100"
              title={neverAgain ? "Close — tour will not return" : "Close for now — tour returns next visit"}
            >
              {neverAgain ? "Close" : "Skip for now"}
            </button>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[10px] text-slate-400 dark:text-slate-500">
                Esc to dismiss · Enter to advance
              </span>
              <button
                type="button"
                onClick={onNext}
                className="btn-primary btn-sm"
              >
                {stepIdx + 1 === total ? "Got it" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Pick a sensible fixed-position for the speech bubble.
 *
 * If we have a target rect, anchor the bubble on the side with the most
 * room. If we don't have a target (welcome / outro steps), center the
 * bubble on the screen.
 *
 * Returns CSS position values directly — no transform tricks beyond an
 * occasional translate, which is universally supported.
 */
function computeBubblePosition(
  rect: DOMRect | null,
  side: "auto" | "top" | "bottom" | "left" | "right",
): { top: number; left: number; transform?: string } {
  const margin = 16;
  const bubbleW = Math.min(420, window.innerWidth - margin * 2);
  // Estimated bubble height — we don't measure pre-mount. 200 px covers
  // the ~3-line body cases, slight overshoot is fine since we clamp to
  // viewport below.
  const bubbleH = 220;

  if (!rect) {
    // No target — center on screen.
    return {
      top: Math.max(margin, (window.innerHeight - bubbleH) / 2),
      left: Math.max(margin, (window.innerWidth - bubbleW) / 2),
    };
  }

  // Find the side with the most room. If `side` is explicit, prefer it
  // unless it doesn't fit, in which case fall back to auto.
  const room = {
    top: rect.top,
    bottom: window.innerHeight - rect.bottom,
    left: rect.left,
    right: window.innerWidth - rect.right,
  };

  let chosen: "top" | "bottom" | "left" | "right" = "bottom";
  if (side !== "auto") {
    chosen = side;
  } else {
    chosen = (Object.entries(room).sort((a, b) => b[1] - a[1])[0][0]) as typeof chosen;
  }

  // If the chosen side doesn't have room for the bubble, fall back to
  // the side with the most room. Prevents the bubble from being clipped.
  if (room[chosen] < (chosen === "top" || chosen === "bottom" ? bubbleH : bubbleW) + margin) {
    chosen = (Object.entries(room).sort((a, b) => b[1] - a[1])[0][0]) as typeof chosen;
  }

  let top: number, left: number;
  switch (chosen) {
    case "top":
      top = Math.max(margin, rect.top - bubbleH - margin);
      left = clamp(rect.left + rect.width / 2 - bubbleW / 2, margin, window.innerWidth - bubbleW - margin);
      break;
    case "bottom":
      top = Math.min(window.innerHeight - bubbleH - margin, rect.bottom + margin);
      left = clamp(rect.left + rect.width / 2 - bubbleW / 2, margin, window.innerWidth - bubbleW - margin);
      break;
    case "left":
      top = clamp(rect.top + rect.height / 2 - bubbleH / 2, margin, window.innerHeight - bubbleH - margin);
      left = Math.max(margin, rect.left - bubbleW - margin);
      break;
    case "right":
      top = clamp(rect.top + rect.height / 2 - bubbleH / 2, margin, window.innerHeight - bubbleH - margin);
      left = Math.min(window.innerWidth - bubbleW - margin, rect.right + margin);
      break;
  }
  return { top, left };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
