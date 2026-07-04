# Dynamic — App Guide (v3)

_Written in Corey's voice. This is the in-repo mirror of the ratified Guide v3.
It is the source of truth the app renders inside Settings → "How Dynamic works."
Corrections stored here override any earlier phrasing._

---

## §0 · Why Dynamic exists

I'm a Strategic Account Executive at Branch. I carry a $1.4M expansion quota
across 14 enterprise accounts — media, entertainment, travel, retail, financial
services. Dynamic is the operating system I run my week on. It is not a CRM,
not a note-taker, not another dashboard. It is the surface that tells me the
next right move, keeps my accounts warm, and makes sure the reps I need are
happening — on real conversations, not vanity metrics.

The rules the app follows:

0. **The visual theme is a swappable engagement-layer skin** (current: Branch);
   the career layer carries no employer identity — themes are data, not
   identity (see `src/lib/theme.ts`).
1. **Honest empties over fake data.** If a tile has nothing to show, it says
   so. No zombie skeletons, no placeholder charts.
2. **One nav system per route class.** Today, Work, Train, Strategy, Admin —
   each has one home and one way in.
3. **Embed, don't rewrite.** Deals, Renewals, Outreach, Study, Dojo, Strategy
   live inside hubs; they are not standalone destinations from the rail.
4. **Moment-driven.** Today changes shape based on where I am in the day, not
   based on tabs I clicked.

---

## §1 · Home / Dispatcher (Today)

Today is the root surface. `/` redirects to `/today`.

### Moments

Today branches on time-of-day + calendar signal:

- **Briefing** (before first meeting) — the morning briefing is a **text
  briefing from my overnight digest; a playable version comes when an audio
  pipeline exists.** The contract must not claim audio playback until the
  pipeline is real.
- **Pre-meeting** (≤ 30 min to next event) — prep pill, brief link, one-tap
  meeting mode.
- **In-meeting** (event window active) — meeting mode surfaced; other tiles
  fade.
- **Post-meeting** (event ended within last 45 min) — post-call log CTA.
- **Deep-work** (no meeting within 90 min, work hours) — Work hub CTA.
- **Evening rep** (after 4pm ET, no active meeting) — Train hub CTA + review.
- **Off-hours** — quiet mode.

### Chrome

- **StreakChip** reads `streak_summary`. Silent if never computed.
- **Sync pill** reads `integration_runs` (source=`calendar`). Fresh (<10m),
  Stale (10–60m), Missing (>60m or never).
- **Resume pill** reads `user_settings.last_surface_path`. Skipped if unset or
  pointing at Today itself.
- **Settings gear** in the header → `/settings`.
- **BostonClock** — my working timezone.

### Empty states

Every tile has an honest empty state. Zero calendar events shows "No events
scheduled." Zero tasks shows "Nothing pinned for today." No fabricated
placeholder rows, ever.

---

## §2 · Work hub

`/work` is the Work hub. Four tabs, URL-driven state, amber accent:

- **Desk** — my inbox for the day: signals, at-risk accounts, prep queue.
- **Pipeline** — embedded `Deals` view (chromeless).
- **Territory** — embedded `Renewals` + territory setup entry.
- **Strategy** — links out to `/strategy` (standalone workspace; its shell is
  path-coupled and stays outside the embed for now).

Weekly outreach lives inside Desk as an embedded view.

The Work rail on this route class is the PrimaryRail: **Today · Work · Train**.

---

## §3 · Train hub

`/train-hub` is the Train hub. Three tabs, jade accent:

- **Study** — embedded `Study` (Learn was consolidated into Study;
  `/learn` → `/study` redirect).
- **Skills** — gate exams + skills ladder, with a live **Corpus coverage**
  card underneath so I can see the factory backlog at a glance.
- **Review** — weekly review + progress tiles + Dojo entry.

My corpus is a **growing spine**, not a finished library. Today that spine
is ~478 certified concepts and ~253 gates sitting on top of a KI library of
~35k raw items. Coverage is the work: KIs get promoted into concepts,
concepts get teach scripts, drills, decks, and gates. Study, Car Mode,
Flash, and Dojo are the four formats that consume this spine — each one
fills in as the content factory runs. The Corpus coverage card on the
Skills tab is the honest readout of that progress; it reads live from
`knowledge_items`, `curriculum_concepts`, `ki_curriculum`,
`flashcard_decks`/`flashcards`, `curriculum_gates`, and `user_band_gate`.
Where a denominator is unknowable (KIs → concepts has no fixed target)
I show raw counts, not invented percentages.

Dojo, Flash, Sharpen, Grind, Car Mode, and Game film remain mounted at
their old paths and are reachable from inside Train. They do not appear
on the rail.

**Game film** (call grading) lives at `/grade`. The legacy `/coach` URL
redirects to `/grade` so bookmarks and deep links keep working. "Coach" is
reserved for the future copilot vocabulary; the grader is Game film.

---

## §4 · Strategy

`/strategy` is a standalone workspace. It runs the discovery-prep,
skill-plan, and thread-scoped tools. Its settings live at `/strategy/settings`
and are linked from the app-wide Settings page. Strategy has its own
navigation shell (`StrategyGlobalNavBar`) that is only mounted on
`/strategy*` routes.

Ratified doctrines that govern Strategy:

- **Resource awareness** — the model queries `resources` for exact titles,
  entity links, and category backstop; forced admit-absence when no match.
- **Citation audit** — server-side auditor downgrades fabricated
  `RESOURCE[…]` and informal template references into `⚠ UNVERIFIED`.
- **Synthesis mode** — pre-gen short-circuit when <2 hits; mandatory
  five-section output; post-gen guard for flat weights / generic scaffolding.
- **Retrieval expansion** — deterministic business→sales vocabulary bridge
  applied to every skill plan.
- **Scorer hardening (Phase 3.5B)** — locked gates for causality and
  business impact; flat baseline capped at 4.

---

## §5 · Navigation contract

- **PrimaryRail** — Today · Work · Train. Rendered on `/today`, `/work`,
  `/work/*`, `/train-hub`, `/train-hub/*`.
- **StrategyGlobalNavBar** — only on `/strategy*`.
- **BottomNav** (legacy dual-row) — only rendered on non-hub routes as the
  fallback until every consumer of the old rows has been migrated.
- **BackToToday FAB** — appears anywhere outside `/today` and returns me
  home in one tap.
- **Dave FAB** — always available except in embedded/car/meeting modes.
- **Gear in Today header** — the one always-visible route to `/settings`.

Admin/QA surfaces are NOT reachable from any visible nav. They are reachable
only from **Settings → Admin & QA drawer**. Routes stay mounted; the LINKS
are the thing we remove.

---

## §6 · Settings

`/settings` is a single stacked page with these rows, in order:

1. **How Dynamic works** → renders this document in-app.
2. **Territory setup** → `/settings/territory`.
3. **Integrations** → live status.
    - **Calendar** — green if `integration_runs` has a recent
      (`source='calendar'`, `status='success'`) row.
    - **Voice** — reads live evidence from `dave-health-check` (authed): shows
      "Connected · ElevenLabs key valid" when the health call returns a valid
      token, "Configured · unverified" when the key is set but token gen
      hasn't been confirmed, and a red state only if the health call actually
      fails. Dave voice is operational; the key is set.
4. **Notifications & nudges** — existing prefs if any; honest placeholder if
   none.
5. **Strategy pills & contracts** → `/strategy/settings`.
6. **Data & backups** — static row describing the n8n weekly backup. No fake
   status.
7. **Admin & QA** — expandable drawer listing every admin/QA route from the
   ledger. Each row is a plain link.

Everything not in this list that used to live on the old Settings page
(imports, appearance, conversion benchmarks, knowledge export, Dave health,
etc.) has been preserved and moved to `/settings/legacy` under a "Advanced /
legacy tools" row inside Settings, so nothing is deleted.

---

## §7 · Cron / background jobs

- **Podcast queue** — the podcast queue cron is **"podcast queue → resource
  ingestion."** It feeds the resource ingest pipeline; it does NOT auto-publish
  daily audio briefings. Any language claiming otherwise is stale and should
  be corrected on sight.
- **Daily digest** (6 AM ET) — assembles the overnight digest that Today
  reads as the text briefing.
- **Schedule daily plan** (5 AM ET) — writes the day's time blocks.
- **Strategy task reaper** (every minute) — cleans up abandoned strategy
  task_runs.
- **Sync calendar** — pulled on Today mount + when stale (>10m).

All crons are guarded with either `x-cron-secret` (cron-only), JWT
(client-only), or both (dual-mode). Anon POSTs to any of these functions are
rejected.

---

## §8 · Design tokens

Non-negotiable palette for the Today shell and everything embedded in it:

Colors are consumed as CSS variables (see `src/index.css` brand token layer);
the values below reflect the active theme (Branch). Swap themes in one line via
`src/lib/theme.ts → ACTIVE_THEME`.

- `--brand-ink` `#0F172B` — page background (Branch slate-950)
- `--brand-panel` `#1D293D` — cards
- `--brand-line` `#314258` — borders
- `--brand-text` `#F8FAFC` — primary text
- `--brand-muted` `#90A1B9` — secondary text
- `--brand-work` — the active theme's Work accent (currently Branch purple
  `#8E51FF`, with `#7F22FE` for solid fills)
- `--brand-train` — the active theme's Train accent (currently Branch teal
  `#00D5BE`)
- `--brand-urgent` `#FF2056` (action coral), `--brand-warn` `#FF6900` (stale/
  sync), `--brand-celebrate` `#FDC700` (yellow) — reserved for wayfinding.

One accent per screen. Color is wayfinding: purple means Work, teal means
Train. Money-good stays green; money-bad stays red — semantic status colors
override brand tokens where meaning matters.

Fonts: system font stack. No serifs. No generic marketing gradients.
Mobile-first. Every screen must respect safe-area insets top and bottom.

---

## §9 · Product boundaries (co-existence rules)

- **Game film** (`/grade`) owns real-call analysis and transcript grading.
  Dojo does not analyze real calls.
- **Dojo** owns practice and simulations. Game film does not run simulations.
- **Study/Learn** owns the KI corpus and structured knowledge.
  Neither Game film nor Dojo owns the KI corpus; they both consume it.
- **Strategy** owns thread-scoped reasoning + discovery prep. It is not a
  chat wrapper; every artifact it produces is grounded in resources or
  admits absence.
- **Modules must embed inside workflows** (Work / Train / Today). Nothing on
  the rail is a standalone destination if a hub can hold it.

---

## §10 · Data contracts I rely on

- **`resources`** — every knowledge item, transcript, and library asset.
  Deterministic routing prefers text over parsed media.
- **`active_accounts`** — mandatory soft-delete filter. Never read from
  `accounts` directly.
- **`daily_assignments`** — SSOT for Dojo + Learn daily state.
- **`canonical_resource_status`** — the single source for resource counts.
- **`streak_summary`** — the chip in the Today header.
- **`user_settings.last_surface_path`** — the resume pill target.
- **`integration_runs`** — sync-pill source of truth. Rows are inserted by
  every integration function on completion (success or failure).

---

_Last aligned: P1d (Guide + Settings + Admin drawer close-out)._
