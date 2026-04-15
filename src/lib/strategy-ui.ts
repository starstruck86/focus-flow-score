/**
 * Strategy Workspace — unified visual contract.
 *
 * Rules:
 * 1. No opacity below /70 on any interactive or readable text
 * 2. Surfaces use solid or near-solid backgrounds — no stacking translucent layers
 * 3. The composer is the center of gravity — largest, most prominent surface
 * 4. Document content uses a constrained reading width inside a wider workspace
 * 5. Sidebar is narrow and subordinate — never competes with center canvas
 */
export const STRATEGY_UI = {
  layout: {
    /** Outer frame — generous workspace */
    frame: 'w-full max-w-[90rem] mx-auto',
    /** Empty state / launchpad — centered, prominent */
    launchpad: 'w-full max-w-[52rem] mx-auto',
    /** Output workspace — wider than reading column */
    output: 'w-full max-w-[56rem] mx-auto',
    /** Document reading column — optimized line length */
    document: 'w-full max-w-[48rem]',
    /** Left sidebar */
    sidebar: 'w-[13rem]',
  },
  spacing: {
    /** Main canvas padding */
    canvas: 'px-6 sm:px-8 lg:px-10 pt-8 sm:pt-10 lg:pt-12 pb-28 sm:pb-32',
    /** Vertical rhythm between sections */
    section: 'space-y-6 sm:space-y-8',
  },
  surface: {
    /** Composer — the primary interactive surface */
    composer: 'rounded-2xl border border-border bg-card shadow-sm',
    /** Context strip below composer */
    context: 'rounded-xl border border-border/60 bg-muted/30',
    /** Document card — the output container */
    document: 'rounded-2xl border border-border bg-card shadow-sm',
    /** Sub-blocks inside documents (mini-blocks, callouts) */
    subBlock: 'rounded-lg border border-border/50 bg-muted/20',
    /** Sidebar surface */
    sidebar: 'bg-card',
  },
  text: {
    /** Primary — headings, titles, active controls */
    primary: 'text-foreground',
    /** Secondary — body text, descriptions, interactive labels */
    secondary: 'text-foreground/90',
    /** Tertiary — metadata, timestamps, supporting info */
    tertiary: 'text-muted-foreground',
    /** Quiet — supplementary hints */
    quiet: 'text-muted-foreground/70',
    /** Interactive — buttons, links, actions (must be clearly clickable) */
    interactive: 'text-foreground/90 hover:text-foreground',
    /** Disabled — only for truly disabled controls */
    disabled: 'text-muted-foreground/40',
  },
  labels: {
    /** Section labels */
    section: 'text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground',
    /** Micro labels */
    micro: 'text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground',
  },
} as const;
