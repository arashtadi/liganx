/**
 * Inline SVG icon set — keeps us off icon-font deps.
 * All icons use currentColor so they respond to text color.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const LogoMark = ({ size = 28, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" {...rest}>
    <defs>
      <linearGradient id="dd-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop offset="0%"  stopColor="#3b6cf6" />
        <stop offset="100%" stopColor="#14b8a6" />
      </linearGradient>
    </defs>
    {/* Δ triangle with notched bottom for the "delta-score" double-meaning */}
    <path
      d="M16 4 L29 26 L3 26 Z"
      fill="url(#dd-grad)"
      stroke="none"
    />
    <path d="M11 21 L16 14 L21 21" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Home = (p: IconProps) => (
  <Svg {...p}><path d="M3 12 12 3l9 9" /><path d="M5 10v10h14V10" /></Svg>
);
export const Plus = (p: IconProps) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);
export const Close = (p: IconProps) => (
  <Svg {...p}><path d="M6 6l12 12M6 18L18 6" /></Svg>
);
export const Check = (p: IconProps) => (
  <Svg {...p}><path d="M5 12l4 4L19 7" /></Svg>
);
export const ArrowRight = (p: IconProps) => (
  <Svg {...p}><path d="M5 12h14M13 5l7 7-7 7" /></Svg>
);
export const Sparkles = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M5.5 18.5l2.8-2.8M15.7 8.3l2.8-2.8" />
  </Svg>
);
export const Beaker = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 3h6M10 3v7L4 19a2 2 0 0 0 1.7 3h12.6A2 2 0 0 0 20 19l-6-9V3" />
    <path d="M7.5 14h9" />
  </Svg>
);
export const Grid = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </Svg>
);
export const Library = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4h4v16H4zM10 4h4v16h-4zM16 4l3 1-2 15-3-1z" />
  </Svg>
);
export const Bolt = (p: IconProps) => (
  <Svg {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></Svg>
);
export const Code = (p: IconProps) => (
  <Svg {...p}><path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 4l-4 16" /></Svg>
);
export const Target = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </Svg>
);
export const Shield = (p: IconProps) => (
  <Svg {...p}><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" /></Svg>
);
export const Eye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const Download = (p: IconProps) => (
  <Svg {...p}><path d="M12 3v12m-5-5 5 5 5-5M5 21h14" /></Svg>
);
export const Spinner = ({ size = 16, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest} className={`animate-spin ${rest.className ?? ""}`}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
