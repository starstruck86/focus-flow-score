
# ST5 — Real Account Projects (plan)

## 1. What "Projects" looks like today

**Nav** (`StrategyNavSidebar.tsx`): `projects` is one of seven flat surfaces, icon `FolderKanban`, label "Projects".

**Shell** (`StrategyShell.tsx`): `activeSurface === 'projects'` only affects the composer placeholder ("Describe the project — Strategy will scope it…"). Per-surface drafts, pending-thread binding, threads sidebar etc. treat it like any other surface.

**SurfacePanel** (`SurfacePanel.tsx` lines 483-489, 1366-1474): when `surface === 'projects'`, renders `<ProjectsList>` which:
- Reads `getPinnedThreadIds()` from `src/lib/strategy/pinnedThreads.ts` (localStorage key `sv-pinned-threads`).
- Filters the in-memory `threads` array by pinned IDs.
- Empty state: "Star a thread in the Work rail to promote it as a Project."

So "Project" today literally means "a starred thread." There is no aggregation, no account family, no cross-thread memory, no custom instructions. It's a glorified bookmark folder.

**Data already in place** (confirmed in DB):
- 7 accounts populated with `account_family` (Comcast/NBCUniversal: 4 rows; Disney: 2 rows; A&E Networks: 1 row standalone).
- `parent_account_id` gives the hierarchy inside a family.
- `strategy_threads.linked_account_id`, `account_signals.linked_account_id`, `account_strategy_memory` (per account) all exist.

## 2. Schema recommendation — do NOT create a new "projects" table

Per Rule 2 (architecture before optimization): a `projects` table would duplicate what `account_family` already does. Every account already has a family string; a family IS the project. Adding a parallel table means:
- Sync drift risk (a project row out of step with `accounts.account_family`).
- Extra join on every read.
- Manual step to "create a project" — friction with no upside, since the family is implicit.

**Recommended:** treat each distinct `accounts.account_family` value (where `deleted_at IS NULL`) as a Project. Project id = the family string (or the root account's id — see Q1 below).

**One small new table is justified** — for per-project state that doesn't belong on `accounts`:

```sql
create table public.account_project_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_family text not null,           -- the join key
  custom_instructions text default '',    -- per-project guidance for Strategy
  pinned boolean default false,           -- show in sidebar Projects list
  order_index bigint,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, account_family)
);
```
Plus the standard GRANT + RLS-by-user_id block we used for `strategy_custom_pills` in ST3. This holds *only* user-scoped settings; the project's *identity* lives on `accounts`.

## 3. How a Project resolves its member accounts

Use **both** — but `account_family` is authoritative:

- Primary: `WHERE account_family = $1 AND deleted_at IS NULL`. Simple, fast, indexed (add index if missing).
- Secondary (display only): `parent_account_id` to render the tree inside the project (Comcast → NBCUniversal → Peacock/NBC News), reusing the M1 OrgTree component.

Walking the parent tree at query time is unnecessary because the seed/import already normalizes `account_family` across the tree. If a future account is added without `account_family`, fall back to walking `parent_account_id` to the root and reading its family — done in one helper, not in every query.

Project member account ids → fan out to:
- Threads: `strategy_threads WHERE linked_account_id IN (...)`
- Signals: `account_signals WHERE linked_account_id IN (...)`
- Memory: `account_strategy_memory WHERE account_id IN (...)`

## 4. UI shape

Two-level: Projects index → Project detail, both inside the existing `SurfacePanel` `surface === 'projects'` slot. No new top-level routes.

```text
┌─ Projects (index) ─────────────────────────────────┐
│  Comcast/NBCUniversal       4 accts · 12 threads   │
│  Disney                     2 accts ·  3 threads   │
│  A&E Networks               1 acct  ·  0 threads   │
│  [+ uncategorized: 7 accounts without a family]   │
└────────────────────────────────────────────────────┘

Click a row →

┌─ Project: Comcast/NBCUniversal ────────────────────┐
│  ⟵ All projects                                    │
│                                                     │
│  Family tree (OrgTree mini)                         │
│    Comcast → NBC Universal → Peacock, NBC News      │
│                                                     │
│  Threads (12)                  [+ New thread]       │
│    • Peacock Q3 expansion · 2h                      │
│    • NBC News deep link audit · yesterday           │
│    …                                                │
│                                                     │
│  Recent signals (5)                                 │
│    • NBCU earnings: streaming +18% · 3d             │
│                                                     │
│  Cross-account memory (3)                           │
│    • Champion: Sarah K (NBCU) · last verified 1w    │
│                                                     │
│  Project instructions ▾  (editable, persisted)      │
└────────────────────────────────────────────────────┘
```

"+ New thread" creates a `strategy_thread` and pre-links it to the **root** account of the family (Comcast for Comcast/NBCUniversal). User can re-link to a child via the existing chip picker. Tagged with the existing per-surface `threadTags` mechanism so it falls back into the project's thread list.

Per-project custom instructions are loaded with the project view and injected into the system prompt for any thread opened from inside that project (same pattern as ST3 pill `instruction` field).

## 5. Files touched & blast radius

**New (low risk):**
- `supabase/migrations/<ts>_account_project_settings.sql` — single table per §2.
- `src/lib/strategy/accountProjects.ts` — query helpers (`listProjects`, `getProjectMembers`, `getProjectSettings`, `upsertProjectSettings`). Mirrors `customPills.ts` pattern.
- `src/components/strategy/v2/projects/ProjectsIndex.tsx` — index list.
- `src/components/strategy/v2/projects/ProjectView.tsx` — detail panel (threads + signals + memory + instructions).

**Edited (contained risk):**
- `src/components/strategy/v2/SurfacePanel.tsx` — replace the `surface === 'projects'` branch (lines 483-489) so it routes to ProjectsIndex / ProjectView based on a local `selectedFamily` state. The legacy `ProjectsList` + `ProjectsPlaceholder` (lines 1366-1474) get deleted.
- `src/lib/strategy/pinnedThreads.ts` — leave it. It's still used for Work-rail starring; not coupled to Projects anymore.

**Out of scope (do NOT touch this build):**
- `StrategyShell.tsx` per-surface draft logic, pending-thread binding, threads-sidebar, trust state. The Projects surface is a pure read-mostly panel that sits inside the existing `SurfacePanel` slot. The composer placeholder line for `'projects'` (Shell:1565-1566) stays as-is. New-thread-from-project uses the existing `createThread` path with a pre-set `linked_account_id`.
- `account_strategy_memory` schema. Read-only consumption.
- `strategy_threads` schema. Read-only consumption.

**Real blast radius:** confined to one branch in SurfacePanel + one new lib + one new table. The intricate Shell state machine is untouched because Projects already gets its own surface slot and we're not changing its lifecycle.

## 6. Time recommendation (~2 build days before July 13)

**Yes, ship it — but in two phases:**

**Phase A (1 day, before July 13):** table + index list + detail view (threads + family tree + signals). Cuts straight to the demo value — Corey can open NBCU and see everything Branch-adjacent in one view.

**Phase B (post-ramp, 0.5 day):** custom instructions injection into the thread system prompt, cross-account memory rollup, "+ New thread pre-linked to family root." These touch the send path and deserve their own audit per Rule 1.

Phase A is safe in 2 days because the existing surface slot already exists and no Shell state machine code is modified. Phase B touches the strategy-chat pipeline and that area gets a separate audit pass.

## Open questions before code

1. **Project identity key**: `account_family` (text) or the root account id (uuid)? Text is simpler and matches existing data; uuid is more refactor-safe if you rename a family. Lean text for v1.
2. **Accounts without an `account_family`** (currently 50+ rows): show them under "Uncategorized" or hide entirely? Lean show-uncategorized so nothing disappears.
3. **Phase A scope confirmation**: ship without custom instructions and without "+ New thread" wiring into the system prompt — those wait for Phase B?
