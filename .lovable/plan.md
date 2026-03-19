

# Implement All Remaining Optimizations

## Overview
Four workstreams: mobile layout fixes, coach event wiring, transcript persistence, and FAB cleanup.

## Step 1: Fix viewport for iPhone safe areas
**File: `index.html`**
- Change viewport meta to include `viewport-fit=cover`

## Step 2: Optimize bottom nav touch targets
**File: `src/components/Layout.tsx`**
- BottomNav: Row 1 `h-11` → `h-12`, Row 2 `h-10` → `h-12`
- NavItem icons: `h-4 w-4` → `h-5 w-5`, text: `text-[10px]` → `text-[11px]`
- Add extra inner padding to nav: `pb-1` inside the max-w container
- Main content: `pb-28` → `pb-[calc(8rem+env(safe-area-inset-bottom))]`
- Root div: add `pt-[env(safe-area-inset-top)]` for standalone PWA mode

## Step 3: Update floating element offsets
**File: `src/components/BackToToday.tsx`**
- Change `bottom-[calc(6.5rem+env(safe-area-inset-bottom))]` → `bottom-[calc(7.5rem+env(safe-area-inset-bottom))]`

**File: `src/components/fab/GlobalFAB.tsx`**
- Change `bottom-[calc(6rem+env(safe-area-inset-bottom))]` → `bottom-[calc(7.5rem+env(safe-area-inset-bottom))]`
- Remove dead `voice-create-task` event listener (now handled by direct DB write in clientTools)

## Step 4: Wire coach voice events
**File: `src/pages/Coach.tsx`**
- Add `useEffect` with listeners for `voice-start-roleplay`, `voice-start-drill`, `voice-grade-call`
- `voice-start-roleplay`: switch to Mock Call tab and auto-start
- `voice-start-drill`: switch to Objection Drills tab
- `voice-grade-call`: switch to Grades tab and trigger grade on latest transcript

## Step 5: Transcript persistence
**Database migration**: Create `dave_transcripts` table with columns: `id`, `user_id`, `messages` (jsonb), `duration_seconds`, `created_at`. RLS policies for authenticated users (CRUD on own rows).

**File: `src/components/DaveConversationMode.tsx`**
- On `endConversation`, save the transcript array to `dave_transcripts` table if there are messages

## Files Modified
- `index.html`
- `src/components/Layout.tsx`
- `src/components/BackToToday.tsx`
- `src/components/fab/GlobalFAB.tsx`
- `src/pages/Coach.tsx`
- `src/components/DaveConversationMode.tsx`
- New migration for `dave_transcripts` table

