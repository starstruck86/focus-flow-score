# Missing-Episode Audit: 30MPC, Outbound Squad, Live Better Sell Better

Read-only audit. Nothing was ingested, and no code or data was changed.

## Method

- Corpus side: `public.resources` grouped by `show_title` — `Armand Farrokh & Nick Cegelski` (398), `Outbound Squad` (283), `Kevin Dorsey` (219). 900 rows total, all with `source_published_at` populated.
- Public side: canonical RSS feeds resolved via the iTunes catalog.
  - 30MPC — `https://feeds.megaphone.fm/30mpc` (643 items, 2020-04-30 → 2026-08-20)
  - Outbound Squad — `https://feeds.megaphone.fm/HS5757379794` (431 items, 2020-02-28 → 2026-08-17)
  - Live Better Sell Better — `https://feeds.transistor.fm/live-better-sell-better` (239 items, 2020-06-13 → 2024-03-21, show ended)
- Match keys: 30MPC by episode number parsed from the title (`#NNN - ...`, the same format used in the corpus); Outbound Squad and LBSB by publish-date multiset (neither show numbers its episodes).
- Seller vs leadership split: keyword scoring over title + description (seller-execution terms vs manager/leader terms), with mixed episodes resolved toward the dominant side.

## Headline numbers

| Show | Public items | In corpus | Missing | Seller-relevant | Leadership-only (excluded) |
|---|---|---|---|---|---|
| 30 Minutes to President's Club | 643 | 398 | **279** | 226 | 53 |
| Outbound Squad | 431 | 283 | **148** | 110 | 38 |
| Live Better Sell Better | 239 | 219 | **23** | 11 | 12 |
| **Total** | 1,313 | 900 | **450** | **347** | **103** |

## 30MPC — composition of the 279 missing

| Segment | Count | Notes |
|---|---|---|
| Back catalog `#0`–`#190` | 190 | Corpus starts at `#191`. Dense seller execution: cold call clinics, discovery, negotiation playbooks, POCs, exec access. |
| Interior gaps | 7 | `#327, #345, #360, #366, #445, #512, #522` |
| New since corpus cutoff (`#564`–`#601`) | 35 | Corpus stops at `#563` (2026-04-09); feed runs to 2026-08-20. |
| Unnumbered specials/trailers/announcements | 47 | Includes ~30 "Bite-sized Tactics" (seller-grade), 5 episode trailers (duplicates of numbered eps), ~13 "Product Roadmap"/announcement items (no training value — drop). |

High-value recent examples: `#570 Cold Email Masterclass`, `#580/#582/#584 negotiation run`, `#590 Complete Discovery Call Playbook`, `#594 Perfect Outbound Sequence`, `#595 6 Ways You're Killing Your Own Discovery Calls`, `#600 "We're doing this in-house"`.

## Outbound Squad — 148 missing by year

2020: 47 · 2021: 48 · 2022: 5 · 2023: 8 · 2024: 10 · 2025: 7 · 2026: 23

Seller-relevant clusters: the 2021 "Skills Series" (KISS sequencing, REPLY method, deflating objections, cold-email troubleshooting), cold-call breakdown bonuses, 2024 live trainings (territory planning, objection handling, cold-calling masterclass, AE self-sourcing), and the entire 2026 tail (23 eps, corpus stops 2026-04-21). Excluded: the "Leaders Series" (11 eps), SDR-manager and coaching-culture episodes.

## Live Better Sell Better — 23 missing

Only 11 are seller-relevant (e.g. Mutual Action Plans with Mark Fershteyn, Morgan Ingram prospecting/video sets, Sam McKenna, Belal Batrawy, James Buckley). The other 12 are leadership/mindset-only (Rob Jeppsen, Ernest Owusu, enablement, culture, doubt/imposter-syndrome). Show is finite and complete at 239 — after this sweep the corpus can be declared closed for LBSB.

## Confidence and caveats

- **30MPC: high confidence.** Number-keyed matching is exact; only the 47 unnumbered items carry title-collision risk with existing corpus rows.
- **Outbound Squad / LBSB: medium-high.** Date-multiset matching can mis-attribute when two episodes share a date (LBSB has several same-day batches). Titles should be confirmed against corpus titles before ingest.
- The seller/leadership split is heuristic. Borderline items (e.g. `#593 Build an Unstoppable Sales Team`, multithreading trainings framed for managers) need a human pass.
- ~18 items across the three shows are trailers, roadmaps, or announcements with no training content and should be dropped regardless of classification.

## Proposed next step (not executed)

If you want to act on this, the ingestion sequence would be:

1. Title-level verification pass for Outbound Squad and LBSB (compare feed titles against corpus titles, not just dates) to convert medium confidence to exact.
2. Drop the trailer/roadmap/announcement class.
3. Ingest in three waves: (a) 30MPC `#564`–`#601` + 2026 Outbound Squad tail — freshest, highest execution density; (b) 30MPC `#0`–`#190` back catalog; (c) Outbound Squad 2020–21 Skills Series + LBSB's 11 seller episodes.
4. Route each ingested item through the existing extraction pipeline with `show_title` matching the current corpus values so downstream KI orchestration stays intact.

No ingestion, code change, or database write has been performed.
