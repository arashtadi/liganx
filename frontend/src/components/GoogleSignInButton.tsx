// Branded "Continue with Google" button. Uses Google's official multicolor
// G mark — the brand-recognition shortcut that turns OAuth from "another
// button" into "the obvious thing to click". Per Google's identity guidelines
// (https://developers.google.com/identity/branding-guidelines) the G mark
// must keep its four colors and shouldn't be tinted; the wording stays one
// of "Sign in with Google" / "Continue with Google" / "Sign up with Google".
//
// Shared by LoginPage and SignupPage so both flows look identical, and
// future OAuth providers (Microsoft, GitHub) can drop in alongside without
// each page reinventing the styling.

import type { ReactNode } from "react";
import { Spinner } from "./Icons";

interface Props {
  /** "Continue with Google" (default), "Sign in with Google", or
   *  "Sign up with Google". All three are Google-approved labels. */
  label?: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** Force fullWidth (default true). Pass false if the button is inline
   *  next to other content. */
  fullWidth?: boolean;
}

export default function GoogleSignInButton({
  label = "Continue with Google",
  onClick,
  busy = false,
  disabled = false,
  fullWidth = true,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={[
        "group inline-flex items-center justify-center gap-3",
        "rounded-lg border-2 px-4 py-3",
        "border-slate-300 hover:border-slate-400 active:border-slate-500",
        "bg-white hover:bg-slate-50 active:bg-slate-100",
        "text-slate-800 font-semibold text-[15px]",
        "shadow-sm hover:shadow-md transition-all",
        "dark:border-slate-600 dark:hover:border-slate-500 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-100",
        "disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none",
        fullWidth ? "w-full" : "",
      ].join(" ")}
    >
      {busy ? (
        <Spinner size={18} />
      ) : (
        <GoogleGMark />
      )}
      <span>{label}</span>
    </button>
  );
}

/** Google's official multicolor "G" mark.
 *  Coordinates copied verbatim from Google's identity branding kit. Don't
 *  retint or simplify — the four-color shape is the recognition signal. */
function GoogleGMark(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M17.64 9.20455c0-.63864-.05727-1.25182-.16364-1.84091H9v3.48136h4.84364c-.20864 1.125-.84273 2.07818-1.79727 2.71636v2.25818h2.90909c1.70182-1.56682 2.68273-3.87409 2.68273-6.61499z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.46727-.80591 5.95636-2.18045l-2.90909-2.25818c-.80591.54-1.83727.85909-3.04727.85909-2.34409 0-4.32818-1.58318-5.03591-3.71045H.96409v2.33182C2.44455 15.98318 5.48182 18 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.96409 10.71c-.18-.54-.28227-1.11682-.28227-1.71s.10227-1.17.28227-1.71V4.95818H.96409C.34909 6.17318 0 7.5475 0 9s.34909 2.82682.96409 4.04182l3-2.33182z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.57955c1.32136 0 2.50773.45409 3.44045 1.34591l2.58136-2.58136C13.46318.89182 11.42591 0 9 0 5.48182 0 2.44455 2.01682.96409 4.95818l3 2.33182C4.67182 5.16273 6.65591 3.57955 9 3.57955z"
        fill="#EA4335"
      />
    </svg>
  );
}
