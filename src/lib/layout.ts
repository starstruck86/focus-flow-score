/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  APP-SHELL LAYOUT CONTRACT                                          ║
 * ║  Single source of truth for all shell spacing, clearance, and       ║
 * ║  safe-area handling in the Quota CoPilot app.                       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * SHELL INVARIANTS (must always hold):
 * 1. No fixed/floating UI overlaps the bottom nav.
 * 2. No scrollable content is hidden behind fixed UI.
 * 3. Horizontal tab rows scroll instead of compressing on narrow screens.
 * 4. All interactive controls meet the 44px minimum tap target.
 * 5. Sticky headers and bottom nav don't create unpredictable
 *    usable-height loss — viewport calcs use the same constants.
 * 6. New pages follow this contract without one-off spacing fixes.
 *
 * HOW TO USE:
 * ─────────────────────────────────────────────────────────────────────
 * In Tailwind classes:
 *   import { SHELL } from '@/lib/layout';
 *   <main className={SHELL.main.bottomPad}>…</main>
 *   <button className={`fixed ${SHELL.fab.bottom} right-4`}>…</button>
 *
 * In CSS / inline styles:
 *   Use the CSS custom properties defined in index.css:
 *   var(--shell-nav-height), var(--shell-fab-clearance), etc.
 *
 * In JS runtime calculations:
 *   import { PX } from '@/lib/layout';
 *   const availableHeight = windowHeight - PX.HEADER - PX.BOTTOM_NAV;
 */

// ═══════════════════════════════════════════════════════════════════════
// PIXEL CONSTANTS — physical sizes, no safe-area
// ═══════════════════════════════════════════════════════════════════════

export const PX = {
  /** Height of one nav row (h-12 = 3rem = 48px) */
  NAV_ROW: 48,
  /** Separator line between the two nav rows */
  NAV_SEPARATOR: 1,
  /** Bottom padding inside the nav container */
  NAV_PAD: 4,
  /** Total bottom nav height = 2×48 + 1 + 4 = 101px (excl. safe-area) */
  get BOTTOM_NAV() { return this.NAV_ROW * 2 + this.NAV_SEPARATOR + this.NAV_PAD; }, // 101
  /** Gap between FABs and the top edge of the nav */
  FAB_GAP: 12,
  /** Total FAB clearance = nav + gap = 113px (excl. safe-area) */
  get FAB_CLEARANCE() { return this.BOTTOM_NAV + this.FAB_GAP; }, // 113
  /** Compact sticky header height */
  HEADER: 48,
  /** Minimum mobile tap target (WCAG / Apple HIG) */
  TAP_TARGET: 44,
} as const;

// Keep legacy named exports for backward compat during migration
export const PX_NAV_ROW_HEIGHT = PX.NAV_ROW;
export const PX_NAV_SEPARATOR = PX.NAV_SEPARATOR;
export const PX_NAV_BOTTOM_PAD = PX.NAV_PAD;
export const PX_BOTTOM_NAV = 101; // PX.BOTTOM_NAV
export const PX_FAB_GAP = PX.FAB_GAP;
export const PX_FAB_CLEARANCE = 113; // PX.FAB_CLEARANCE
export const PX_HEADER_HEIGHT = PX.HEADER;

// ═══════════════════════════════════════════════════════════════════════
// TAILWIND CLASS FRAGMENTS — use in className strings
// ═══════════════════════════════════════════════════════════════════════
// All bottom offsets use CSS calc() + env(safe-area-inset-bottom) so
// they adapt to notched devices automatically.

/**
 * Structured shell tokens organized by concern.
 * Preferred API — use SHELL.main.bottomPad, SHELL.fab.bottom, etc.
 */
export const SHELL = {
  /** Main scrollable content area */
  main: {
    /** Bottom padding to clear the bottom nav + safe-area */
    bottomPad: 'pb-[calc(var(--shell-nav-height)*1px+env(safe-area-inset-bottom))]',
  },
  /** Floating action buttons */
  fab: {
    /** Bottom offset to sit above nav + gap + safe-area */
    bottom: 'bottom-[calc(var(--shell-fab-clearance)*1px+env(safe-area-inset-bottom))]',
  },
  /** Secondary floating controls (e.g. BackToToday) */
  secondaryFab: {
    /** Slightly lower than primary FABs */
    bottom: 'bottom-[calc((var(--shell-fab-clearance)-4)*1px+env(safe-area-inset-bottom))]',
  },
  /** Top safe-area handling */
  top: {
    /** Padding for the app root to respect notch/dynamic-island */
    safeArea: 'pt-[env(safe-area-inset-top)]',
  },
  /** Sticky header */
  header: {
    /** Height class for the compact header */
    height: 'h-12',
    /** Offset for content below a sticky header */
    offset: 'top-12',
  },
  /** Tab rows / segmented controls */
  tabs: {
    /** TabsList: horizontal scroll, no visible scrollbar */
    list: 'flex w-full overflow-x-auto gap-1 p-1 scrollbar-none',
    /** TabsTrigger: non-shrinkable, minimum tap target */
    trigger: 'flex-shrink-0 text-xs px-3 min-w-[44px] min-h-[36px]',
    /** TabsTrigger with icon: adds icon gap */
    triggerWithIcon: 'flex-shrink-0 text-xs px-3 min-w-[44px] min-h-[36px] gap-1',
  },
  /** Viewport-height calculations for boards/tables */
  viewport: {
    /**
     * Returns a max-height calc string for a scrollable container
     * that accounts for header, nav, and a custom top offset.
     * @param topOffsetRem - additional space consumed above (e.g. page title + tabs)
     */
    maxHeight: (topOffsetRem: number = 12) =>
      `max-h-[calc(100vh-${topOffsetRem}rem-var(--shell-nav-height)*1px-env(safe-area-inset-bottom))]`,
  },
} as const;

// ── Legacy flat exports (used by already-migrated components) ──────
// These will be removed once Stage 2 migration is complete.
export const TW_PAGE_BOTTOM_PAD = SHELL.main.bottomPad;
export const TW_FAB_BOTTOM = SHELL.fab.bottom;
export const TW_BACK_BOTTOM = SHELL.secondaryFab.bottom;
export const TW_TABS_LIST = SHELL.tabs.list;
export const TW_TAB_TRIGGER = SHELL.tabs.trigger;

