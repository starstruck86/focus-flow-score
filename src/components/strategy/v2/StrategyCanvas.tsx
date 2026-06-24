/**
 * StrategyCanvas — the message stream. No bubbles, no borders, no dividers.
 * Pure document. 32px between messages. max-w 760px centered. Auto-scrolls to
 * the bottom on new content.
 *
 * Empty state: nothing but the cursor in the composer (composer is owned by
 * StrategyShell, not by this component). The canvas itself stays blank.
 */
import { useEffect, useRef } from 'react';
import type { StrategyMessage as StrategyMessageT } from '@/types/strategy';
import type { StrategyGlobalInstructionsConfig } from '@/lib/strategy/strategyConfig';
import type { Citation } from '@/lib/strategy/headClassifier';
import { StrategyMessage } from './StrategyMessage';
import { StrategyEmptyState } from './StrategyEmptyState';

type IntelActivation = {
  head: string;
  headLabel: string;
  kiCount: number;
  accountLinked: boolean;
  accountName: string | null;
  triggeredAt: number;
  citations: Citation[];
};

interface Props {
  messages: StrategyMessageT[];
  isLoading: boolean;
  isSending: boolean;
  hideEmptyState?: boolean;
  /** Called when a user clicks an empty-state prompt chip. */
  onPickPrompt?: (prompt: string) => void;
  /** Called when the user clicks a quick-iteration action under an
   *  assistant response (Regenerate / Shorten / Expand / Improve). */
  onQuickAction?: (prompt: string) => void;
  /** Lifted strategy config (Strict Mode etc.) — passed down to messages
   *  so they all observe the same single source of truth from StrategyShell. */
  strategyConfig?: StrategyGlobalInstructionsConfig;
  /** Last intelligence activation — shown as a badge while assistant is responding. */
  lastIntelActivation?: IntelActivation | null;
}

function IntelActivationBadge({ activation }: { activation: IntelActivation }) {
  const HEAD_ICONS: Record<string, string> = {
    product: '🌿',
    competitive: '🎯',
    sales: '🔍',
    market: '📊',
  };
  const icon = HEAD_ICONS[activation.head] ?? '🧠';

  return (
    <div className="flex justify-center py-2">
      <div
        className="inline-flex items-center gap-2 text-[11px] px-3 py-1.5 rounded-full"
        style={{
          border: '1px solid hsl(var(--sv-hairline))',
          background: 'hsl(var(--sv-paper))',
          color: 'hsl(var(--sv-muted))',
        }}
      >
        <span>{icon}</span>
        <span style={{ color: 'hsl(var(--sv-ink))', fontWeight: 500 }}>
          {activation.headLabel} Intelligence
        </span>
        {activation.kiCount > 0 && (
          <>
            <span>·</span>
            <span>{activation.kiCount} KIs</span>
          </>
        )}
        <span>·</span>
        <span style={{ color: 'hsl(var(--sv-clay) / 0.7)' }}>Territory loaded</span>
        {activation.accountLinked && activation.accountName && (
          <>
            <span>·</span>
            <span style={{ color: 'hsl(var(--sv-clay))' }}>📍 {activation.accountName}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function StrategyCanvas({ messages, isLoading, isSending, hideEmptyState = false, onPickPrompt, onQuickAction, strategyConfig, lastIntelActivation }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, isSending]);

  const showEmptyState = !hideEmptyState && !isLoading && !isSending && messages.length === 0;

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      style={{
        background: 'hsl(var(--sv-paper))',
        // Ensure scrollIntoView leaves room for the sticky composer so the
        // last message never sits flush against (or under) the input.
        scrollPaddingBottom: 96,
      }}
    >
      <div
        className="mx-auto px-6 pt-2 pb-3 sm:pb-8"
        style={{ maxWidth: 860 }}
      >
        {showEmptyState && onPickPrompt && (
          <StrategyEmptyState onPickPrompt={onPickPrompt} />
        )}
        {messages.map((m, i) => {
          // Quick actions render only on the most recent assistant message,
          // and only when no response is currently streaming. Mirrors how
          // ChatGPT/Claude scope iteration controls to the latest turn.
          const isLastAssistant =
            !isSending &&
            m.role === 'assistant' &&
            i === messages.length - 1 &&
            !!onQuickAction;
          return (
            <div key={m.id} style={{ marginTop: i === 0 ? 0 : 14 }}>
              <StrategyMessage
                message={m}
                onQuickAction={isLastAssistant ? onQuickAction : undefined}
                strategyConfig={strategyConfig}
              />
            </div>
          );
        })}
        {lastIntelActivation && (
          <IntelActivationBadge activation={lastIntelActivation} />
        )}
        {isSending && (
          <div style={{ marginTop: messages.length === 0 ? 0 : 14 }}>
            <StrategyMessage
              message={{
                id: '__streaming__',
                thread_id: '',
                user_id: '',
                role: 'assistant',
                message_type: 'chat',
                content_json: { text: '' },
                citations_json: null,
                created_at: new Date().toISOString(),
              }}
              strategyConfig={strategyConfig}
            />
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
