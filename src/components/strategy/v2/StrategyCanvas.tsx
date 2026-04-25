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
import { StrategyMessage } from './StrategyMessage';
import { StrategyEmptyState } from './StrategyEmptyState';

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
}

export function StrategyCanvas({ messages, isLoading, isSending, hideEmptyState = false, onPickPrompt, onQuickAction, strategyConfig }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, isSending]);

  const showEmptyState = !hideEmptyState && !isLoading && !isSending && messages.length === 0;

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      style={{ background: 'hsl(var(--sv-paper))' }}
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
