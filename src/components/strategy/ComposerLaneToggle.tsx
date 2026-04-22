// ════════════════════════════════════════════════════════════════
// ComposerLaneToggle — 3-state segmented control for the strategy
// composer: Auto (default) / Quick / Deep.
//
// Controlled component. Emits 'auto' | 'quick' | 'deep'.
// ════════════════════════════════════════════════════════════════

import { cn } from '@/lib/utils';

export type LaneOverride = 'auto' | 'quick' | 'deep';

export interface ComposerLaneToggleProps {
  value: LaneOverride;
  onChange: (v: LaneOverride) => void;
  className?: string;
  disabled?: boolean;
}

const OPTIONS: { value: LaneOverride; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Let the router decide' },
  { value: 'quick', label: 'Quick', hint: 'Force fast direct answer' },
  { value: 'deep', label: 'Deep', hint: 'Force deep-work pipeline' },
];

export function ComposerLaneToggle({ value, onChange, className, disabled }: ComposerLaneToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Routing override"
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-background p-0.5 text-xs',
        disabled && 'opacity-60 pointer-events-none',
        className,
      )}
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.hint}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-sm px-2 py-1 font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
