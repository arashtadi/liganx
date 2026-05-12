// Vitest setup — runs once before every test file.
// Pulls in @testing-library/jest-dom matchers (`toBeInTheDocument`,
// `toHaveTextContent`, etc.) so they're available globally.
import "@testing-library/jest-dom/vitest";

// jsdom doesn't ship matchMedia, but our Tailwind dark-mode toggle
// reads it on mount. Stub it so component renders don't crash on
// `prefers-color-scheme`.
if (typeof window !== "undefined" && !window.matchMedia) {
  // @ts-expect-error — partial implementation, enough for tests.
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
