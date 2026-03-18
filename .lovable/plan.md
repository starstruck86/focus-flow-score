

## Plan: App Version Timestamp

Add a build timestamp that's injected at build time via Vite's `define` config, then display it in the UI so you always know which version you're running.

### Changes

1. **`vite.config.ts`** — Add `define: { __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()) }` to inject the build time as a global constant.

2. **`src/vite-env.d.ts`** — Declare `__BUILD_TIMESTAMP__` as a global `string` constant for TypeScript.

3. **`src/components/Layout.tsx`** — Add a small "Last updated" timestamp next to the app title in the header bar, formatted as a relative time (e.g., "Updated 2m ago") with a tooltip showing the exact date/time. Uses `date-fns/formatDistanceToNow`.

4. **`src/pages/Settings.tsx`** — Add a "Build Info" row in Settings showing the full timestamp for reference.

Every new build/deploy will automatically stamp the current time — no manual versioning needed.

