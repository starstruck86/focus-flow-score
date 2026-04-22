import "@testing-library/jest-dom";

// Vite define globals
(globalThis as any).__BUILD_TIMESTAMP__ = '2026-01-01T00:00:00.000Z';

// Guard against node-environment tests (no window).
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
