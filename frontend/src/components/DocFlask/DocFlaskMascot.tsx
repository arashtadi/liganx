/**
 * Doc Flask — the friendly Erlenmeyer-flask mascot for the first-run tour.
 *
 * Inline SVG character (no external assets, no filters/masks — Safari and
 * Firefox render identically). Five poses share the same head/face anchor
 * so transitions between poses feel like the same character moving, not a
 * card flipping. The bubbly liquid in the flask gently animates via CSS
 * keyframes (transform + opacity only — no top/left animations that would
 * cause Safari to stutter).
 *
 * Cross-browser hardening:
 *   - No <filter> or <mask> elements (Safari rendering bugs)
 *   - No backdrop-filter on accompanying speech bubble (older browsers)
 *   - All animations use transform/opacity (universal, GPU-friendly)
 *   - Animations honor prefers-reduced-motion (set animation-duration: 0
 *     via a media query on the same selector)
 *   - Stable across Chrome / Safari / Firefox / Edge evergreen
 */

import { useEffect, useState } from "react";

export type DocFlaskPose = "idle" | "pointing-right" | "pointing-down" | "thinking" | "celebrating";

interface Props {
  pose?: DocFlaskPose;
  /** Pixel size of the bounding square. Default 110. */
  size?: number;
  /** When true, character bounces a little to grab attention on entry. */
  attentionBounce?: boolean;
  className?: string;
}

export default function DocFlaskMascot({
  pose = "idle",
  size = 110,
  attentionBounce = false,
  className = "",
}: Props) {
  // Eyes blink on a loose 4-7 s timer (random within range, so two blinks
  // are never quite in sync — feels alive without being distracting).
  // Disabled when reduced-motion is requested.
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    let t1: number, t2: number;
    function loop() {
      t1 = window.setTimeout(() => {
        setBlink(true);
        t2 = window.setTimeout(() => {
          setBlink(false);
          loop();
        }, 140);
      }, 4000 + Math.random() * 3000);
    }
    loop();
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  // Mouth path varies by pose — same lip line, different curve, so the
  // character's expression matches what they're doing.
  const mouth = mouthPathFor(pose);
  // Eye direction cue: pointing-right → eyes drift right; pointing-down →
  // eyes drift down. Subtle (1–2 px) so it's "looking at" not "side-eye".
  const eyeOffset = eyeOffsetFor(pose);

  return (
    <div
      className={`doc-flask-mascot relative inline-block ${attentionBounce ? "doc-flask-bounce" : "doc-flask-idle"} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <style>{`
        @keyframes doc-flask-idle-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
        @keyframes doc-flask-attention {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25%      { transform: translateY(-6px) rotate(-3deg); }
          50%      { transform: translateY(0) rotate(0deg); }
          75%      { transform: translateY(-6px) rotate(3deg); }
        }
        @keyframes doc-flask-bubble {
          0%   { transform: translateY(0) scale(1);   opacity: 0.85; }
          50%  { transform: translateY(-6px) scale(1.1); opacity: 0.6; }
          100% { transform: translateY(-12px) scale(0.7); opacity: 0; }
        }
        .doc-flask-idle    { animation: doc-flask-idle-bob 4s ease-in-out infinite; }
        .doc-flask-bounce  { animation: doc-flask-attention 0.9s ease-in-out 1; }
        .doc-flask-bubble  { animation: doc-flask-bubble 2.4s ease-in infinite; transform-origin: center; }
        .doc-flask-bubble.b2 { animation-delay: 0.8s; }
        .doc-flask-bubble.b3 { animation-delay: 1.6s; }
        @media (prefers-reduced-motion: reduce) {
          .doc-flask-idle, .doc-flask-bounce, .doc-flask-bubble { animation: none; }
        }
      `}</style>
      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        role="img"
      >
        <title>Doc Flask, your lab guide</title>
        <desc>A friendly cartoon Erlenmeyer flask with eyes, eyebrows, and a smile, holding a small clipboard.</desc>

        {/* Stoppered neck — sits on top of the conical body */}
        <rect x="86" y="14" width="28" height="9" rx="2.5" fill="#94a3b8" />
        <rect x="89" y="22" width="22" height="6" fill="#64748b" />

        {/* Conical body — Erlenmeyer profile, wide base narrow neck */}
        <path
          d="M 89 28 L 89 70 L 50 158 Q 46 175 64 175 L 136 175 Q 154 175 150 158 L 111 70 L 111 28 Z"
          fill="#bfdbfe"
          stroke="#1e3a8a"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* Liquid inside the flask — meniscus curve at the top */}
        <path
          d="M 56 144 Q 60 138 70 144 Q 80 150 90 144 Q 100 138 110 144 Q 120 150 130 144 Q 140 138 144 144 L 148 158 Q 152 175 134 175 L 66 175 Q 48 175 52 158 Z"
          fill="#1e40af"
          opacity="0.22"
        />

        {/* Animated bubbles in the liquid — three bubbles at staggered times.
            Pure decorative; honors prefers-reduced-motion via the keyframes. */}
        <circle cx="80" cy="158" r="2.5" fill="white" opacity="0.85" className="doc-flask-bubble" style={{ transformBox: "fill-box" }} />
        <circle cx="100" cy="162" r="2" fill="white" opacity="0.85" className="doc-flask-bubble b2" style={{ transformBox: "fill-box" }} />
        <circle cx="118" cy="158" r="2.2" fill="white" opacity="0.85" className="doc-flask-bubble b3" style={{ transformBox: "fill-box" }} />

        {/* Eyebrows — angle changes with mood */}
        {pose === "thinking" ? (
          <>
            <path d="M 72 56 Q 76 52 84 54" stroke="#0c1e44" strokeWidth="3" strokeLinecap="round" fill="none" />
            <path d="M 116 54 Q 124 56 122 60" stroke="#0c1e44" strokeWidth="3" strokeLinecap="round" fill="none" />
          </>
        ) : pose === "celebrating" ? (
          <>
            <path d="M 70 50 Q 78 44 86 48" stroke="#0c1e44" strokeWidth="3" strokeLinecap="round" fill="none" />
            <path d="M 114 48 Q 122 44 130 50" stroke="#0c1e44" strokeWidth="3" strokeLinecap="round" fill="none" />
          </>
        ) : (
          <>
            <path d="M 72 56 Q 80 50 88 56" stroke="#0c1e44" strokeWidth="3" strokeLinecap="round" fill="none" />
            <path d="M 112 56 Q 120 50 128 56" stroke="#0c1e44" strokeWidth="3" strokeLinecap="round" fill="none" />
          </>
        )}

        {/* Eyes — whites + pupils. Blink collapses the height. Pose
             changes the pupil offset so Doc Flask "looks at" the target. */}
        <g>
          <ellipse cx="80" cy={blink ? 70 : 70} rx="9" ry={blink ? 1 : 11} fill="white" stroke="#1e3a8a" strokeWidth="1.5" />
          <ellipse cx="120" cy={blink ? 70 : 70} rx="9" ry={blink ? 1 : 11} fill="white" stroke="#1e3a8a" strokeWidth="1.5" />
          {!blink && (
            <>
              <circle cx={80 + eyeOffset.x} cy={70 + eyeOffset.y} r="4" fill="#0c1e44" />
              <circle cx={120 + eyeOffset.x} cy={70 + eyeOffset.y} r="4" fill="#0c1e44" />
              <circle cx={81 + eyeOffset.x} cy={68 + eyeOffset.y} r="1.4" fill="white" />
              <circle cx={121 + eyeOffset.x} cy={68 + eyeOffset.y} r="1.4" fill="white" />
            </>
          )}
        </g>

        {/* Mouth — varies by pose */}
        <path d={mouth} stroke="#0c1e44" strokeWidth="2.5" fill={pose === "celebrating" ? "#0c1e44" : "none"} strokeLinecap="round" />

        {/* Cheek blush — soft pink dabs, always present */}
        <ellipse cx="64" cy="86" rx="7" ry="3" fill="#fbb6ce" opacity="0.65" />
        <ellipse cx="136" cy="86" rx="7" ry="3" fill="#fbb6ce" opacity="0.65" />

        {/* Pose-specific accessories */}
        {pose === "pointing-right" && (
          <g>
            {/* Right arm extended out — points to UI elements on the right */}
            <path d="M 145 110 Q 170 105 185 100" stroke="#1e3a8a" strokeWidth="6" fill="none" strokeLinecap="round" />
            <circle cx="187" cy="98" r="6" fill="#bfdbfe" stroke="#1e3a8a" strokeWidth="2" />
          </g>
        )}
        {pose === "pointing-down" && (
          <g>
            <path d="M 100 175 Q 100 188 100 196" stroke="#1e3a8a" strokeWidth="6" fill="none" strokeLinecap="round" />
            <circle cx="100" cy="196" r="5" fill="#bfdbfe" stroke="#1e3a8a" strokeWidth="2" />
          </g>
        )}
        {pose === "celebrating" && (
          <g>
            {/* Both arms up, little sparkles */}
            <path d="M 60 110 Q 45 90 38 70" stroke="#1e3a8a" strokeWidth="6" fill="none" strokeLinecap="round" />
            <path d="M 140 110 Q 155 90 162 70" stroke="#1e3a8a" strokeWidth="6" fill="none" strokeLinecap="round" />
            <circle cx="38" cy="68" r="5" fill="#bfdbfe" stroke="#1e3a8a" strokeWidth="2" />
            <circle cx="162" cy="68" r="5" fill="#bfdbfe" stroke="#1e3a8a" strokeWidth="2" />
            <g fill="#fbbf24">
              <path d="M 30 50 l 2 -8 l 2 8 l 8 2 l -8 2 l -2 8 l -2 -8 l -8 -2 z" />
              <path d="M 168 44 l 1.5 -6 l 1.5 6 l 6 1.5 l -6 1.5 l -1.5 6 l -1.5 -6 l -6 -1.5 z" />
            </g>
          </g>
        )}
        {pose === "thinking" && (
          <g>
            {/* Hand on chin */}
            <path d="M 110 130 Q 120 130 124 120" stroke="#1e3a8a" strokeWidth="6" fill="none" strokeLinecap="round" />
            <circle cx="124" cy="118" r="5" fill="#bfdbfe" stroke="#1e3a8a" strokeWidth="2" />
            {/* Thought bubble */}
            <circle cx="158" cy="40" r="4" fill="white" stroke="#1e3a8a" strokeWidth="1.5" opacity="0.85" />
            <circle cx="170" cy="28" r="6" fill="white" stroke="#1e3a8a" strokeWidth="1.5" opacity="0.85" />
            <circle cx="182" cy="14" r="9" fill="white" stroke="#1e3a8a" strokeWidth="1.5" opacity="0.85" />
          </g>
        )}
      </svg>
    </div>
  );
}

function mouthPathFor(pose: DocFlaskPose): string {
  switch (pose) {
    case "celebrating":
      return "M 86 102 Q 100 118 114 102 Q 110 110 100 110 Q 90 110 86 102 Z";
    case "thinking":
      return "M 90 105 Q 100 102 110 108";
    case "pointing-right":
    case "pointing-down":
    case "idle":
    default:
      return "M 86 102 Q 100 112 114 102";
  }
}

function eyeOffsetFor(pose: DocFlaskPose): { x: number; y: number } {
  switch (pose) {
    case "pointing-right":   return { x: 1.5,  y: 0    };
    case "pointing-down":    return { x: 0,    y: 2    };
    case "thinking":         return { x: -1,   y: -1   };
    case "celebrating":      return { x: 0,    y: -1.5 };
    case "idle":
    default:                 return { x: 0,    y: 0    };
  }
}
