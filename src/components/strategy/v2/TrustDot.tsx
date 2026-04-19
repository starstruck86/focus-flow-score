/**
 * TrustDot — 6px non-fill dot that lives inside the EntityChip.
 * The presence of color IS the warning. There is no text, no badge, no count.
 *
 *   safe    → hairline ring only (no fill, no color)
 *   warning → solid amber `hsl(var(--sv-amber))`
 *   blocked → solid clay  `hsl(var(--sv-clay))`
 */
import type { TrustState } from '@/hooks/strategy/useThreadTrustState';

interface Props {
  state: TrustState;
  title?: string;
}

export function TrustDot({ state, title }: Props) {
  // Three distinct, calm marks — distinguishable at a glance, no fill noise.
  //   safe    → quiet neutral hairline ring (no fill)
  //   warning → solid amber dot
  //   blocked → hollow clay ring (1.5px), visibly different shape from warning
  const isBlocked = state === 'blocked';
  const isWarning = state === 'warning';

  return (
    <span
      aria-label={`Trust state: ${state}`}
      title={title ?? `Trust: ${state}`}
      style={{
        width: isBlocked ? 8 : 6,
        height: isBlocked ? 8 : 6,
        borderRadius: 999,
        background: isWarning ? 'hsl(var(--sv-amber))' : 'transparent',
        border: isBlocked
          ? '1.5px solid hsl(var(--sv-clay))'
          : isWarning
            ? 'none'
            : '1px solid hsl(var(--sv-hairline))',
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}
