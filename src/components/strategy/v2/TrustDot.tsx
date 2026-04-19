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
  const color =
    state === 'blocked' ? 'hsl(var(--sv-clay))'
    : state === 'warning' ? 'hsl(var(--sv-amber))'
    : 'transparent';

  return (
    <span
      aria-label={`Trust state: ${state}`}
      title={title ?? `Trust: ${state}`}
      style={{
        width: 6,
        height: 6,
        borderRadius: 999,
        background: color,
        border: state === 'safe' ? '1px solid hsl(var(--sv-hairline))' : 'none',
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}
