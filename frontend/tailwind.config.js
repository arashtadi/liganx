/** @type {import('tailwindcss').Config} */
export default {
  // Class strategy: toggling .dark on <html> flips the whole UI. We persist the
  // user's choice to localStorage in a tiny pre-React script (see index.html)
  // so there's no flash-of-wrong-theme on first paint.
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // DeltaDock brand
        ink: {
          DEFAULT: "#0b1020",
          soft: "#1a2238",
        },
        delta: {
          50:  "#eef3ff",
          100: "#dce7ff",
          200: "#bccfff",
          300: "#8eaeff",
          400: "#5e85ff",
          500: "#3b6cf6",
          600: "#2752dd",
          700: "#1f3fb0",
          800: "#1c3589",
          900: "#0a1f5c",
        },
        accent: {
          // teal accent for highlights / Δ-score gain
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
        },
        // Full scales for gain/loss so `text-loss-700`, `border-loss/30`, etc.
        // actually work. Previously these were single hex values which Tailwind
        // can't combine with `/30` opacity or `text-` modifiers cleanly.
        gain: {
          50:  "#ecfdf5",
          100: "#d1fae5",
          300: "#6ee7b7",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          DEFAULT: "#10b981",
        },
        loss: {
          50:  "#fef2f2",
          100: "#fee2e2",
          300: "#fca5a5",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
          DEFAULT: "#ef4444",
        },
        neutral: "#9ca3af",
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', "ui-monospace", "monospace"],
      },
      backgroundImage: {
        "hero-grid":
          "radial-gradient(circle at 20% 0%, rgba(59,108,246,0.12), transparent 40%)," +
          "radial-gradient(circle at 80% 0%, rgba(20,184,166,0.10), transparent 40%)",
        "noise": "linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0))",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(11,16,32,0.04), 0 4px 16px -4px rgba(11,16,32,0.08)",
        glow: "0 0 0 1px rgba(59,108,246,0.2), 0 6px 24px -8px rgba(59,108,246,0.4)",
      },
      animation: {
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        "fade-in": "fade-in 200ms ease-out",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: 0.5 },
          "50%":      { opacity: 1   },
        },
        "fade-in": {
          from: { opacity: 0, transform: "translateY(4px)" },
          to:   { opacity: 1, transform: "translateY(0)"   },
        },
      },
    },
  },
  plugins: [],
};
