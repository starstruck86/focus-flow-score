# P1c-REAL — Plan (with security-gate resolution first)

## Stage 0 — Publish gate (BLOCKS everything until you pick)

The 5 edge-fn criticals from the prior wave are fixed and verified. Publish is still gated by **3 pre-existing criticals**, all outside P1a/b/c scope. Pick one:

**0a. Fix the 3 (recommended, ~S total, keeps posture clean):**
- `xss_export_docwrite` — add HTML-escape helper + DOMPurify pass in `src/components/prep/ExportMenu.tsx handlePdf()`. ~15 min.
- `approved_users_email_branch_exposure` — drop email branch from SELECT policy; email-match handled server-side at login (already have an approval check function). Migration + verify nobody currently relies on the email fallback path. ~10 min.
- `SUPA_security_definer_view` — identify the definer view via `pg_views`, flip to `security_invoker=true` if callers are authed, otherwise add explicit grants and keep. ~10 min.

**0b. Ignore + publish now:** mark all 3 with written justifications via `manage_security_finding`, publish, revisit in a hardening wave.

**0c. Publish without touching (not possible):** the publish tool hard-blocks on critical findings — cannot bypass.

Default if you don't specify: **0a**.

## Stage 1 — Publish current committed state
`preview_ui--publish` → report live URL + commit SHA + scan-clean line.

## Stage 2 — P1c-REAL atomic wave

### R1 — Layout embed API
Add `embedded?: boolean` prop to `src/components/Layout.tsx`. When true, suppress: header, `GlobalWeekStrip`, `ActivityRings`, `DayTimeline`, `Breadcrumbs`, `BottomNav`, `BackToToday`. Keep: Dave FAB mount point, safe-area padding, `--shell-nav-height` publisher (hub sets its own rail height). Zero behavior change when prop is absent — verified by rendering each of the 6 targets standalone first.

### R2 — Opt-in the 6 embedding targets
Add `embedded` prop pass-through (or read `useSearchParams().get('embedded')==='1'`) in each of the 6 page components:
Strategy, WeeklyOutreach, Deals, Renewals, Study, Dojo.

**Per-page verification table (fail → skip that page, leave it on its own route, report):**

| Page | Standalone (unchanged) | Embedded (no dup chrome) |
|---|---|---|
| Strategy | check | check |
| WeeklyOutreach | check | check |
| Deals | check | check |
| Renewals | check | check |
| Study | check | check |
| Dojo | check | check |

Method: mount each page twice in a scratch route, diff DOM structure; screenshot both via Playwright.

### R3 — Build /work and /train-hub

`src/pages/Work.tsx`: 4 URL-driven tabs (`?tab=desk|pipeline|territory|strategy`):
- Desk = thin composition (existing Dashboard quick-actions extracted)
- Pipeline = `<Deals embedded/>` + `<Renewals embedded/>` (sub-tabs or stacked)
- Territory = `<WeeklyOutreach embedded/>` + Whitespace-coming placeholder panel
- Strategy = `<Strategy embedded/>`

`src/pages/TrainHub.tsx`: tabs Study / Skills / Review — `<Study embedded/>`, Skills tab (Dojo entry card + Car Mode tile + belt/gate card), Review links tab.

Hub-level single header; amber accent on `/work*`, jade on `/train-hub*`.

### R4 — One rail
New `src/components/nav/PrimaryRail.tsx` with 3 items: Today / Work / Train + Dave FAB. Remove renders of `BottomNav` (both rows), `StrategyGlobalNavBar`, `BackToToday` from `Layout.tsx`. Active tint amber on `/work*`, jade on `/train-hub*`, neutral on `/today`.

### R5 — Flip route constants
`src/lib/routes.ts` (or wherever `ROUTES.work` / `ROUTES.train` live): point `work → '/work'`, `train → '/train-hub'`. Update `ROUTE_ALIASES` in `src/components/dave/tools/navigation.ts` accordingly. `/dashboard → /` still held.

### R6 — Acceptance
Print the Step-0 reachability table with NEW access path per destination. Verify:
- every old Dave voice target still resolves (from prior audit)
- tab deep links (`/work?tab=pipeline` etc.) work
- resume pill (`user_settings.last_surface_path`) lands inside hub tabs when path includes `?tab=`
- one nav system per route class
- `tsgo --noEmit` green
- **publish to production** → report live URL + commit SHA

### Rollback (per element, reversible)
- Layout embed prop: default-false; removing the prop pass in a target restores full chrome.
- New hubs: routes are additive; deleting `Work.tsx`/`TrainHub.tsx` + removing routes reverts.
- Rail: keep old `BottomNav`/`StrategyGlobalNavBar` files in tree (unimported) — restore by re-mounting.
- Route flip: revert 2 lines in `ROUTES` + 2 lines in `ROUTE_ALIASES`.

## Risk / skip discipline
Any page failing R2 verification stays on its old route, is NOT embedded in a hub, gets a note in the acceptance table (e.g. "Renewals: standalone only this wave"). Hubs still ship for the pages that pass.

## What I need from you
1. Stage 0 pick: **0a** (fix 3), **0b** (ignore 3), or leave default (0a).
2. Confirm PrimaryRail label preference: "Today / Work / Train" as spec'd (or different).
3. Confirm embed mechanism: `embedded` prop pass-through (cleaner) vs URL param (`?embedded=1`, works with plain `<iframe>`-free embedding but leaks into browser history). I recommend **prop**.

Answer these three and I run Stages 0→2 straight through with no further check-ins until the final acceptance report.
