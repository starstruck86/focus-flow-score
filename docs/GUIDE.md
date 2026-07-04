# Dynamic — App Guide (v3, working copy)

> This file is the in-repo mirror of the ratified Guide v3. Sections are stubbed
> and filled in as each P1 wave lands. Corrections stored here override any
> earlier phrasing in the source contract.

## §1 · Home / Dispatcher (Today)

- Today is the root surface. `/` redirects to `/today`.
- Moment-driven: briefing · pre-meeting · in-meeting · post-meeting ·
  deep-work · evening rep.
- **Briefing line (P1c correction):** the morning briefing is a **text
  briefing from my overnight digest; a playable version comes when an audio
  pipeline exists.** The contract must not claim audio playback until the
  pipeline is real.
- Sync pill reads `integration_runs` (source=`calendar`); resume pill reads
  `user_settings.last_surface_path`; streak chip reads `streak_summary`.
- Every tile has an honest empty state — no fake data, no infinite skeletons.

## §7 · Cron / background jobs

- **Podcast queue (P1c correction):** the podcast queue cron is
  **"podcast queue → resource ingestion."** It feeds the resource ingest
  pipeline; it does NOT auto-publish daily audio briefings.
- All other crons documented alongside their edge functions in
  `supabase/config.toml`.

## Route ledger

Every route has a named home; nothing uncontracted. Full assignment lives in
the ratified Drive contract (Appendix A). This doc summarizes as waves land.
