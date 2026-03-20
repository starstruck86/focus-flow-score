

# Show "Last Updated" on Mobile

## Problem
The timestamp has `hidden sm:inline`, making it invisible below 640px.

## Fix
**File: `src/components/Layout.tsx` (line 295)**

Remove `hidden sm:inline` and replace with `inline`. On mobile, shorten the text to just the relative time (e.g., "2m ago") to save space — it already does this via `formatDistanceToNow`. The span just needs to be visible.

To keep the header clean on small screens, keep the `text-[10px]` size and place it right after the compass icon (before the search bar expands).

### Single change
```
// Line 295: Change from
<span className="text-[10px] text-muted-foreground hidden sm:inline">

// To
<span className="text-[10px] text-muted-foreground">
```

One line change, no other files affected.

