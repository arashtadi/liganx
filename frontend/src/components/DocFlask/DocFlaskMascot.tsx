/**
 * Doc Flask — modern animated mascot for the first-run tour.
 *
 * Layered animations, all running on transform + opacity only so they
 * stay smooth on Safari / Firefox / Chrome / Edge and never trigger
 * layout reflow. The character feels alive through:
 *
 *   - Spring-in entrance scale + fade
 *   - Idle float (4s sine bob)
 *   - Subtle breathing scale on the body (3s)
 *   - Cheek blush pulse
 *   - Bubbles rising in the flask body, three on staggered delays
 *   - Drifting sparkles around the head, randomized seed
 *   - Random blinks every 4–7 s (offset so two never sync)
 *   - Eye pupils track toward the active pose direction (modern touch)
 *   - Pose-specific arm gestures with a one-shot wave on entry
 *   - Soft floor shadow that scales with the float so the character
 *     reads as floating, not sliding
 *
 * Cross-browser hardening:
 *   - No <filter>, <mask>, or backdrop-filter
 *   - All animations transform/opacity, GPU-friendly
 *   - prefers-reduced-motion disables every loop except the static
 *     pose itself
 *   - SVG inline (no external assets, no CORS surprises)
 */

import { useEffect, useState } from "react";

export type DocFlaskPose = "idle" | "pointing-right" | "pointing-down" | "thinking" | "celebrating";

interface Props {
  pose?: DocFlaskPose;
  /** Pixel size of the bounding square. Default 110. */
  size?: number;
  /** When true, character does a brief wave + scale-up on mount.
   *  Useful for the welcome step's first appearance. */
  attentionBounce?: boolean;
  className?: string;
}

export default function DocFlaskMascot({
  pose = "idle",
  size = 110,
  attentionBounce = false,
  className = "",
}: Props) {
  // Random blinks on a 4–7s loop, with a small chance of a "double blink"
  // for personality. Disabled when reduced-motion is on.
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    let t1: number, t2: number, t3: number;
    function loop() {
      t1 = window.setTimeout(() => {
        setBlink(true);
        t2 = window.setTimeout(() => {
          setBlink(false);
          // 15 % chance of an immediate second blink — feels more organic
          if (Math.random() < 0.15) {
            t3 = window.setTimeout(() => {
              setBlink(true);
              t2 = window.setTimeout(() => { setBlink(false); loop(); }, 130);
            }, 150);
          } else {
            loop();
          }
        }, 140);
      }, 4000 + Math.random() * 3000);
    }
    loop();
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, []);

  const mouth = mouthPathFor(pose);
  const eyeOffset = eyeOffsetFor(pose);

  return (
    <div
      className={`doc-flask-root relative inline-block ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <style>{`
        .doc-flask-root { perspective: 600px; }

        @keyframes df-spring-in {
          0%   { transform: translateY(14px) scale(0.78); opacity: 0; }
          55%  { transform: translateY(-3px) scale(1.05); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes df-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
        @keyframes df-breathe {
          0%, 100% { transform: scaleY(1)   scaleX(1); }
          50%      { transform: scaleY(1.02) scaleX(0.99); }
        }
        @keyframes df-bubble {
          0%   { transform: translateY(0)   scale(1);   opacity: 0;  }
          15%  { opacity: 0.9; }
          85%  { opacity: 0.4; }
          100% { transform: translateY(-22px) scale(0.55); opacity: 0; }
        }
        @keyframes df-shadow-pulse {
          0%, 100% { transform: scaleX(1);   opacity: 0.18; }
          50%      { transform: scaleX(0.85); opacity: 0.10; }
        }
        @keyframes df-blush {
          0%, 100% { opacity: 0.6;  transform: scale(1);    }
          50%      { opacity: 0.85; transform: scale(1.08); }
        }
        @keyframes df-sparkle {
          0%   { transform: translateY(0) scale(0.5);  opacity: 0; }
          25%  { opacity: 0.9; }
          100% { transform: translateY(-32px) scale(1.05); opacity: 0; }
        }
        @keyframes df-wave {
          0%   { transform: rotate(0deg);   }
          15%  { transform: rotate(-22deg); }
          30%  { transform: rotate(14deg);  }
          45%  { transform: rotate(-16deg); }
          60%  { transform: rotate(8deg);   }
          75%  { transform: rotate(-4deg);  }
          100% { transform: rotate(0deg);   }
        }

        .df-stage      { animation: df-spring-in 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both,
                                    df-float     4s   ease-in-out infinite 0.55s; }
        .df-body       { animation: df-breathe   3s   ease-in-out infinite; transform-origin: 100px 175px; }
        .df-shadow     { animation: df-shadow-pulse 4s ease-in-out infinite; transform-origin: center; }
        .df-bubble     { animation: df-bubble    2.6s ease-in   infinite;  transform-box: fill-box; }
        .df-bubble.b2  { animation-delay: 0.85s; }
        .df-bubble.b3  { animation-delay: 1.7s;  }
        .df-blush      { animation: df-blush     3.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
        .df-blush.r    { animation-delay: 0.4s; }
        .df-sparkle    { animation: df-sparkle   3.8s ease-out  infinite;  transform-box: fill-box; }
        .df-sparkle.s2 { animation-delay: 1.2s; }
        .df-sparkle.s3 { animation-delay: 2.4s; }
        .df-arm-wave   { animation: df-wave      1.4s cubic-bezier(0.36, 0.07, 0.19, 0.97) 0.6s 2 both;
                         transform-origin: 145px 110px; transform-box: fill-box; }

        @media (prefers-reduced-motion: reduce) {
          .df-stage, .df-body, .df-shadow, .df-bubble, .df-blush,
          .df-sparkle, .df-arm-wave {
            animation: none;
          }
        }
      `}</style>

      <svg
        viewBox="0 0 200 210"
        width={size}
        height={size * (210 / 200)}
        role="img"
        className="df-stage"
        style={{ overflow: "visible" }}
      >
        <title>Doc Flask, your lab guide</title>
        <desc>A friendly cartoon Erlenmeyer flask with eyes, eyebrows, and a smile.</desc>

        <ellipse cx="100" cy="195" rx="46" ry="6" fill="#1e293b" className="df-shadow" />

        {pose !== "thinking" && (
          <g>
            <circle cx="42" cy="38" r="3" fill="#a5f3fc" className="df-sparkle" />
            <circle cx="158" cy="32" r="2.5" fill="#fcd34d" className="df-sparkle s2" />
            <circle cx="172" cy="68" r="2.2" fill="#f9a8d4" className="df-sparkle s3" />
          </g>
        )}

        <g className="df-body">
          <ellipse cx="100" cy="20" rx="16" ry="3.5" fill="#475569" />
          <rect x="86" y="14" width="28" height="10" rx="3" fill="#94a3b8" stroke="#334155" strokeWidth="1.2" />
          <rect x="89" y="22" width="22" height="6" fill="#64748b" />
          <ellipse cx="93" cy="18" rx="3" ry="1.5" fill="white" opacity="0.5" />

          <path
            d="M 89 28 L 89 70 L 50 158 Q 46 175 64 175 L 136 175 Q 154 175 150 158 L 111 70 L 111 28 Z"
            fill="#dbeafe"
            stroke="#1e40af"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d="M 92 30 L 92 68 L 56 154"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.55"
            fill="none"
          />

          <path
            d="M 56 144 Q 60 138 70 144 Q 80 150 90 144 Q 100 138 110 144 Q 120 150 130 144 Q 140 138 144 144 L 148 158 Q 152 175 134 175 L 66 175 Q 48 175 52 158 Z"
            fill="#3b82f6"
            opacity="0.32"
          />
          <path
            d="M 56 144 Q 60 138 70 144 Q 80 150 90 144 Q 100 138 110 144 Q 120 150 130 144 Q 140 138 144 144"
            stroke="#2563eb"
            strokeWidth="1.5"
            fill="none"
            opacity="0.7"
          />

          <circle cx="80" cy="160" r="2.8" fill="white" className="df-bubble" />
          <circle cx="100" cy="164" r="2.2" fill="white" className="df-bubble b2" />
          <circle cx="118" cy="158" r="2.5" fill="white" className="df-bubble b3" />

          {pose === "thinking" ? (
            <>
              <path d="M 70 56 Q 76 51 86 54" stroke="#0c1e44" strokeWidth="3.4" strokeLinecap="round" fill="none" />
              <path d="M 116 54 Q 124 56 122 60" stroke="#0c1e44" strokeWidth="3.4" strokeLinecap="round" fill="none" />
            </>
          ) : pose === "celebrating" ? (
            <>
              <path d="M 68 50 Q 78 42 88 48" stroke="#0c1e44" strokeWidth="3.4" strokeLinecap="round" fill="none" />
              <path d="M 112 48 Q 122 42 132 50" stroke="#0c1e44" strokeWidth="3.4" strokeLinecap="round" fill="none" />
            </>
          ) : (
            <>
              <path d="M 70 56 Q 80 49 90 56" stroke="#0c1e44" strokeWidth="3.4" strokeLinecap="round" fill="none" />
              <path d="M 110 56 Q 120 49 130 56" stroke="#0c1e44" strokeWidth="3.4" strokeLinecap="round" fill="none" />
            </>
          )}

          <g>
            <ellipse cx="80" cy={blink ? 70 : 70} rx="10" ry={blink ? 1 : 12} fill="white" stroke="#1e3a8a" strokeWidth="1.6" />
            <ellipse cx="120" cy={blink ? 70 : 70} rx="10" ry={blink ? 1 : 12} fill="white" stroke="#1e3a8a" strokeWidth="1.6" />
            {!blink && (
              <>
                <circle cx={80 + eyeOffset.x} cy={70 + eyeOffset.y} r="6" fill="#1e3a8a" />
                <circle cx={120 + eyeOffset.x} cy={70 + eyeOffset.y} r="6" fill="#1e3a8a" />
                <circle cx={80 + eyeOffset.x} cy={70 + eyeOffset.y} r="3.5" fill="#0c1e44" />
                <circle cx={120 + eyeOffset.x} cy={70 + eyeOffset.y} r="3.5" fill="#0c1e44" />
                <circle cx={82 + eyeOffset.x} cy={67 + eyeOffset.y} r="1.8" fill="white" />
                <circle cx={122 + eyeOffset.x} cy={67 + eyeOffset.y} r="1.8" fill="white" />
                <circle cx={78 + eyeOffset.x} cy={73 + eyeOffset.y} r="0.8" fill="white" opacity="0.7" />
                <circle cx={118 + eyeOffset.x} cy={73 + eyeOffset.y} r="0.8" fill="white" opacity="0.7" />
              </>
            )}
          </g>

          <path
            d={mouth}
            stroke="#0c1e44"
            strokeWidth="2.6"
            fill={pose === "celebrating" ? "#dc2626" : "none"}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {pose === "celebrating" && (
            <ellipse cx="100" cy="115" rx="6" ry="2.5" fill="#fca5a5" opacity="0.9" />
          )}

          <ellipse cx="64" cy="86" rx="8" ry="3.2" fill="#fbb6ce" className="df-blush" />
          <ellipse cx="136" cy="86" rx="8" ry="3.2" fill="#fbb6ce" className="df-blush r" />

          {pose === "pointing-right" && (
            <g>
              <path d="M 145 110 Q 170 102 188 96" stroke="#1e40af" strokeWidth="6.5" fill="none" strokeLinecap="round" />
              <circle cx="190" cy="94" r="7" fill="#dbeafe" stroke="#1e40af" strokeWidth="2.2" />
              <ellipse cx="188" cy="91" rx="2" ry="1" fill="white" opacity="0.7" />
            </g>
          )}
          {pose === "pointing-down" && (
            <g>
              <path d="M 100 175 Q 100 188 100 198" stroke="#1e40af" strokeWidth="6.5" fill="none" strokeLinecap="round" />
              <circle cx="100" cy="198" r="6" fill="#dbeafe" stroke="#1e40af" strokeWidth="2.2" />
            </g>
          )}
          {pose === "celebrating" && (
            <g>
              <path d="M 60 110 Q 42 88 35 65"  stroke="#1e40af" strokeWidth="6.5" fill="none" strokeLinecap="round" />
              <path d="M 140 110 Q 158 88 165 65" stroke="#1e40af" strokeWidth="6.5" fill="none" strokeLinecap="round" />
              <circle cx="35"  cy="63" r="6" fill="#dbeafe" stroke="#1e40af" strokeWidth="2.2" />
              <circle cx="165" cy="63" r="6" fill="#dbeafe" stroke="#1e40af" strokeWidth="2.2" />
              <g fill="#fbbf24">
                <path d="M 28 44 l 2 -8 l 2 8 l 8 2 l -8 2 l -2 8 l -2 -8 l -8 -2 z" />
                <path d="M 170 38 l 1.5 -6 l 1.5 6 l 6 1.5 l -6 1.5 l -1.5 6 l -1.5 -6 l -6 -1.5 z" />
                <circle cx="22" cy="100" r="2" />
                <circle cx="178" cy="105" r="2" />
              </g>
            </g>
          )}
          {pose === "thinking" && (
            <g>
              <path d="M 110 130 Q 122 130 126 118" stroke="#1e40af" strokeWidth="6.5" fill="none" strokeLinecap="round" />
              <circle cx="127" cy="116" r="6" fill="#dbeafe" stroke="#1e40af" strokeWidth="2.2" />
              <circle cx="158" cy="42" r="3.5" fill="white" stroke="#1e40af" strokeWidth="1.5" />
              <circle cx="170" cy="30" r="5" fill="white" stroke="#1e40af" strokeWidth="1.5" />
              <circle cx="184" cy="14" r="9" fill="white" stroke="#1e40af" strokeWidth="1.5" />
            </g>
          )}

          {pose === "idle" && attentionBounce && (
            <g className="df-arm-wave">
              <path d="M 145 110 Q 165 90 172 70" stroke="#1e40af" strokeWidth="6.5" fill="none" strokeLinecap="round" />
              <circle cx="172" cy="68" r="6" fill="#dbeafe" stroke="#1e40af" strokeWidth="2.2" />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}

function mouthPathFor(pose: DocFlaskPose): string {
  switch (pose) {
    case "celebrating":
      return "M 84 100 Q 100 122 116 100 Q 112 116 100 116 Q 88 116 84 100 Z";
    case "thinking":
      return "M 90 106 Q 100 102 110 110";
    case "pointing-right":
    case "pointing-down":
    case "idle":
    default:
      return "M 84 100 Q 100 114 116 100";
  }
}

function eyeOffsetFor(pose: DocFlaskPose): { x: number; y: number } {
  switch (pose) {
    case "pointing-right":   return { x: 2,   y: 0    };
    case "pointing-down":    return { x: 0,   y: 2.2  };
    case "thinking":         return { x: -1,  y: -1.5 };
    case "celebrating":      return { x: 0,   y: -1.5 };
    case "idle":
    default:                 return { x: 0,   y: 0    };
  }
}
