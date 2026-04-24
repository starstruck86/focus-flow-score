/**
 * MessageActions — quick-iteration row shown under every assistant response.
 *
 * Pure UI: clicking an action injects a follow-up prompt into the composer
 * via onQuickAction(prompt). No backend changes — the existing send flow
 * handles the rest, so the user gets a fast iteration loop without typing.
 *
 * Visible actions: Regenerate · Shorten · Expand · Improve
 */
import { RotateCcw, Minimize2, Maximize2, Sparkles } from 'lucide-react';

interface Props {
  onAction: (prompt: string) => void;
}

const ACTIONS: { label: string; prompt: string; Icon: typeof RotateCcw }[] = [
  { label: 'Regenerate', prompt: 'Regenerate that response with a different angle.', Icon: RotateCcw },
  { label: 'Shorten',    prompt: 'Make that response shorter and tighter — keep only the essential points.', Icon: Minimize2 },
  { label: 'Expand',     prompt: 'Expand that response — go deeper on the key points with more specifics.', Icon: Maximize2 },
  { label: 'Improve',    prompt: 'Improve that response — make it sharper, more specific, more opinionated.', Icon: Sparkles },
];

export function MessageActions({ onAction }: Props) {
  return (
    <div
      className="flex flex-wrap items-center gap-1 mt-2 -ml-1.5"
      style={{ opacity: 0.85 }}
    >
      {ACTIONS.map(({ label, prompt, Icon }) => (
        <button
          key={label}
          type="button"
          onClick={() => onAction(prompt)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
          style={{
            color: 'hsl(var(--sv-muted))',
            background: 'transparent',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'hsl(var(--sv-hover))';
            (e.currentTarget as HTMLButtonElement).style.color = 'hsl(var(--sv-ink))';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'hsl(var(--sv-muted))';
          }}
        >
          <Icon className="size-3" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
