/**
 * StrategyEmptyState — what the canvas shows for a new/empty thread.
 *
 * Replaces the giant blank canvas with a polished, opinionated invitation:
 *   - One serif headline ("Where would you like to start?")
 *   - A short helper sentence ("Strategy is your sales workspace…")
 *   - 4 example prompt chips that populate the composer when clicked
 *
 * Pure presentation. No data mutation. The parent (StrategyShell) wires the
 * `onPickPrompt` callback to set the composer text via the composer's imperative
 * `insertText` handle — exactly the same path /library uses, so we never bypass
 * the existing send pipeline.
 */
import { Compass, FileText, Search, Target } from 'lucide-react';

interface PromptChip {
  icon: React.ReactNode;
  label: string;
  prompt: string;
}

interface Props {
  onPickPrompt: (prompt: string) => void;
}

const CHIPS: PromptChip[] = [
  {
    icon: <FileText className="h-3.5 w-3.5" />,
    label: 'Discovery prep',
    prompt: 'Build a discovery prep document for ',
  },
  {
    icon: <Search className="h-3.5 w-3.5" />,
    label: 'Account research',
    prompt: 'Give me a strategic research brief on ',
  },
  {
    icon: <Target className="h-3.5 w-3.5" />,
    label: 'Deal review',
    prompt: 'Review the current state of my deal with ',
  },
  {
    icon: <Compass className="h-3.5 w-3.5" />,
    label: 'Whitespace plan',
    prompt: 'Map the whitespace and expansion plays for ',
  },
];

export function StrategyEmptyState({ onPickPrompt }: Props) {
  return (
    <div className="flex flex-col items-center text-center select-none pt-10 pb-12 px-6">
      <h1
        className="text-[28px] leading-[1.15] tracking-tight"
        style={{
          fontFamily: 'var(--sv-serif)',
          color: 'hsl(var(--sv-ink))',
          fontWeight: 500,
        }}
      >
        Where would you like to start?
      </h1>
      <p
        className="mt-3 text-[14px] max-w-[480px]"
        style={{ color: 'hsl(var(--sv-muted))', fontFamily: 'var(--sv-sans)' }}
      >
        Strategy is your sales workspace. Ask a question, draft a deep-work
        artifact, or pick one of the starting points below.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-2 max-w-[560px]">
        {CHIPS.map((chip) => (
          <button
            key={chip.label}
            onClick={() => onPickPrompt(chip.prompt)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[8px] text-[13px] transition-colors"
            style={{
              border: '1px solid hsl(var(--sv-hairline))',
              background: 'hsl(var(--sv-paper))',
              color: 'hsl(var(--sv-ink))',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-hover))'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-paper))'; }}
          >
            <span style={{ color: 'hsl(var(--sv-clay))' }}>{chip.icon}</span>
            <span>{chip.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
