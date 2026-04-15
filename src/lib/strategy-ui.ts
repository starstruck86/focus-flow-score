export const STRATEGY_UI = {
  layout: {
    frame: 'w-full max-w-[86rem] mx-auto',
    launchpad: 'w-full max-w-[68rem] mx-auto',
    output: 'w-full max-w-[74rem] mx-auto',
    document: 'w-full max-w-[50rem]',
    sidebar: 'w-56 xl:w-[14.5rem]',
  },
  spacing: {
    canvas: 'px-4 sm:px-6 lg:px-8 pt-10 sm:pt-12 lg:pt-14 pb-24 sm:pb-28 lg:pb-32',
    section: 'space-y-5 sm:space-y-6',
  },
  surface: {
    launchpad: 'rounded-[1.75rem] border border-border/35 bg-card/60 shadow-[0_18px_60px_hsl(var(--foreground)/0.08)] backdrop-blur-sm',
    composer: 'rounded-[1.25rem] border border-border/35 bg-card/75 shadow-[0_12px_36px_hsl(var(--foreground)/0.07)]',
    context: 'rounded-xl border border-border/25 bg-background/40',
    document: 'rounded-[1.5rem] border border-border/30 bg-card/70 shadow-[0_18px_60px_hsl(var(--foreground)/0.07)]',
    subBlock: 'rounded-xl border border-border/20 bg-background/35',
    sidebar: 'bg-background/85 backdrop-blur-sm',
  },
  text: {
    primary: 'text-foreground',
    secondary: 'text-foreground/85',
    tertiary: 'text-muted-foreground',
    quiet: 'text-muted-foreground/85',
    interactive: 'text-foreground/80 hover:text-foreground',
    disabled: 'text-muted-foreground/50',
  },
  labels: {
    section: 'text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground',
    micro: 'text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground',
  },
} as const;