/**
 * App-Shell Layout Tokens
 * 
 * Single source of truth for all spacing/sizing constants that keep
 * fixed, sticky, and floating UI clear of the bottom navigation and
 * safe-area insets.
 * 
 * Usage in Tailwind classes:
 *   - Import the CSS custom-property names and use via `var(--…)`.
 *   - Or use the TW_* string constants directly in className templates.
 *
 * Usage in inline styles:
 *   - Import PX_* numeric constants for runtime calculations.
 */

// ── Physical sizes (pixels) ──────────────────────────────────────────
/** Height of each nav row in the two-row bottom nav */
export const PX_NAV_ROW_HEIGHT = 48; // h-12 = 3rem = 48px
/** Separator between nav rows */
export const PX_NAV_SEPARATOR = 1;
/** Vertical padding below the second row */
export const PX_NAV_BOTTOM_PAD = 4;
/** Total bottom nav chrome height WITHOUT safe-area */
export const PX_BOTTOM_NAV = PX_NAV_ROW_HEIGHT * 2 + PX_NAV_SEPARATOR + PX_NAV_BOTTOM_PAD; // 101px
/** Gap between FABs and the top of the nav bar */
export const PX_FAB_GAP = 12;
/** Clearance for floating actions above the nav */
export const PX_FAB_CLEARANCE = PX_BOTTOM_NAV + PX_FAB_GAP; // 113px
/** Sticky header height (compact) */
export const PX_HEADER_HEIGHT = 48;

// ── Tailwind-ready class fragments ──────────────────────────────────
// These use CSS calc() with env() so they respond to device safe-area.

/** Bottom padding for <main> content so it never hides behind nav */
export const TW_PAGE_BOTTOM_PAD = 'pb-[calc(6.5rem+env(safe-area-inset-bottom))]';

/** Bottom offset for floating action buttons */
export const TW_FAB_BOTTOM = 'bottom-[calc(7rem+env(safe-area-inset-bottom))]';

/** Bottom offset for the BackToToday button (slightly below FABs) */
export const TW_BACK_BOTTOM = 'bottom-[calc(6.75rem+env(safe-area-inset-bottom))]';

// ── CSS custom properties (set once on :root via index.css) ─────────
// --app-nav-height: total bottom nav height excl. safe-area
// --app-fab-clearance: nav + gap
// These are defined in index.css and consumed by the TW classes above.

// ── Tab / segmented-control standards ───────────────────────────────
/** 
 * Reusable Tailwind classes for scrollable tab rows on mobile.
 * Apply to <TabsList> to get consistent behavior.
 */
export const TW_TABS_LIST = 'flex w-full overflow-x-auto gap-1 p-1 scrollbar-none';

/**
 * Reusable Tailwind classes for each <TabsTrigger> in a scrollable row.
 */
export const TW_TAB_TRIGGER = 'flex-shrink-0 text-xs px-3 min-w-[44px] min-h-[36px]';
