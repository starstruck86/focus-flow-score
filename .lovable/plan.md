

## Goal
Make the hard-refresh button reliably load the latest deployed version on Safari (desktop + iOS), not just Chrome.

## Root causes being addressed
1. Safari's HTTP cache serves stale `index.html` even after `location.reload()`.
2. SW unregister + cache delete don't fully take effect before reload fires.
3. bfcache can restore an old page snapshot on next navigation.

## Approach

Update `src/components/GlobalRefreshButton.tsx` with a Safari-hardened reload sequence:

**Step 1 — Tear down SW and caches (already doing this)**
- `getRegistrations()` → `unregister()` all
- `caches.keys()` → `caches.delete()` all

**Step 2 — Wait for unregister to actually settle**
- Add a short `await new Promise(r => setTimeout(r, 150))` after unregister so Safari finishes tearing down the SW before navigation.

**Step 3 — Force a cache-busted navigation instead of `location.reload()`**
- Replace `window.location.reload()` with:
  ```ts
  const url = new URL(window.location.href);
  url.searchParams.set('_r', Date.now().toString());
  window.location.replace(url.toString());
  ```
- Why: `location.replace()` with a new query string forces Safari to treat it as a fresh navigation and bypasses both the HTTP cache for `index.html` and the bfcache. `location.reload()` does not reliably do this on Safari.

**Step 4 — Strip the cache-buster on arrival (cosmetic)**
- In `src/main.tsx` (or `App.tsx`), if `?_r=` is present in the URL on load, `history.replaceState` to remove it so the URL stays clean.

**Step 5 — Add a `pageshow` bfcache guard (optional but cheap)**
- In `src/main.tsx`, listen for `pageshow` with `event.persisted === true` and force a reload. This catches the case where the user navigates back to a bfcached old version of the app.
  ```ts
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) window.location.reload();
  });
  ```

## Files to change
- `src/components/GlobalRefreshButton.tsx` — replace reload sequence with the Safari-hardened version above.
- `src/main.tsx` — add `?_r=` strip + `pageshow` bfcache guard.
- `scripts/guard-no-hard-reload.sh` — already whitelists `GlobalRefreshButton`; add `main.tsx` if the pageshow guard trips the linter.

## Out of scope
- `AppFreshnessBar` (separate component, not the one the user is using)
- PWA / service worker config changes
- Server-side cache headers (would be the proper long-term fix but is infra, not app code)

## Acceptance
- On Safari desktop: clicking refresh loads the newly deployed version on the first try.
- On iOS Safari: same.
- On Chrome: no regression — still loads latest.
- URL stays clean after reload (no lingering `?_r=...`).

