

# Test & Optimize: 6 Resource Intelligence Features

## Issues Found

### Critical Bug: `build-resource` Transform Mode
**Line 49** calls `await req.json()` a second time after the body was already consumed on line 14. In Deno, request bodies can only be read once — this will always return `{}`, meaning `sourceResourceId` and `targetType` are never extracted. The transform feature is completely broken.

**Fix**: Destructure `sourceResourceId` and `targetType` from the initial `req.json()` call on line 14.

### Bug: `useResourceSuggestions` Fires on Every Page Load
The suggestions query runs on every authenticated page load regardless of route — it calls an expensive edge function even when the user isn't on the Prep Hub. This wastes AI credits.

**Fix**: Make the query lazy — only fetch when explicitly triggered or when the ResourceManager mounts. Change `enabled` to accept an explicit boolean prop, or use `enabled: false` + `refetch()`.

### Bug: `AIGenerateDialog` State Leak
When the dialog closes and reopens without `sourceResourceId`, the previous `selectedResourceIds`, `prompt`, and `outputType` persist from the last session.

**Fix**: Reset state in the `useEffect` when `open` becomes true and source props are absent.

### Optimization: `SmartSuggestionsPanel` Missing Import
`Sparkles` is imported at the bottom of the file after it's used in JSX. This works in bundlers but is non-standard and fragile.

**Fix**: Move the `Sparkles` import to the top with the other lucide-react imports.

### Optimization: Suggestions Banner Dismiss Uses Index
Dismissing suggestions by array index is fragile — if `refetchSuggestions()` returns a different order, dismissed items reappear or wrong items hide.

**Fix**: Dismiss by a stable key (description hash or stringify).

---

## Changes

### 1. Fix `build-resource/index.ts` Transform Mode
- Line 14: Add `sourceResourceId`, `targetType` to the initial destructure
- Remove the duplicate `req.json()` call on line 49

### 2. Fix `SmartSuggestionsPanel.tsx` Import Order
- Move `Sparkles` import from bottom of file into the existing lucide-react import at top

### 3. Make `useResourceSuggestions` Lazy
- Add `enabled` parameter to the hook
- In `ResourceManager.tsx`, only enable when resources exist (to avoid wasting credits on empty libraries)

### 4. Fix `AIGenerateDialog` State Reset
- Clear `prompt`, `outputType`, and `selectedResourceIds` when dialog opens without initial values

### 5. Fix Suggestions Banner Dismiss Stability
- Change `dismissedSuggestions` from `Set<number>` to `Set<string>` using description as key

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/build-resource/index.ts` | Fix double `req.json()` — transform mode now works |
| `src/components/prep/SmartSuggestionsPanel.tsx` | Move Sparkles import to top |
| `src/hooks/useResources.ts` | Add `enabled` param to `useResourceSuggestions` |
| `src/components/prep/ResourceManager.tsx` | Pass enabled flag; fix dismiss-by-key |
| `src/components/prep/AIGenerateDialog.tsx` | Reset state on open |

