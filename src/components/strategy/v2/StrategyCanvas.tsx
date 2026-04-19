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
import { StrategyMessage } from './StrategyMessage';

interface Props {
  messages: StrategyMessageT[];
  isLoading: boolean;
  isSending: boolean;
}

export function StrategyCanvas({ messages, isLoading, isSending }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, isSending]);

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      style={{ background: 'hsl(var(--sv-paper))' }}
    >
      <div
        className="mx-auto px-6 pt-12 pb-32"
        style={{ maxWidth: 760 }}
      >
        {!isLoading && messages.length === 0 && !isSending && (
          <div
            className="select-none"
            style={{
              fontFamily: 'var(--sv-serif)',
              color: 'hsl(var(--sv-muted))',
              fontSize: 17,
              lineHeight: 1.5,
              paddingTop: '20vh',
            }}
          >
            What are you thinking about?
          </div>
        )}
        {messages.map((m, i) => (
          <div key={m.id} style={{ marginTop: i === 0 ? 0 : 32 }}>
            <StrategyMessage message={m} />
          </div>
        ))}
        {isSending && (
          <div style={{ marginTop: messages.length === 0 ? 0 : 32 }}>
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
            />
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
