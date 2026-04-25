/**
 * StrategyMessage — single message rendered without bubbles, borders, avatars,
 * or role labels. Role is communicated by:
 *
 *   Assistant → serif (Charter / Iowan / Georgia), flush-left, full canvas width
 *   User      → sans (Inter), indented 40px, max-width 85%
 *   System    → muted, italic, smaller — only used for workflow notices
 *
 * 32px gap to next message is owned by the parent stream.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { StrategyMessage as StrategyMessageT } from '@/types/strategy';
import { MessageActions } from './MessageActions';
import { getStrategyConfig } from '@/lib/strategy/strategyConfig';

/**
 * Strict-mode response shaper. Runs AFTER the model responds to guarantee:
 *  - bullet structure (≤3 bullets, no paragraphs)
 *  - exact closing line "→ NEXT MOVE: …"
 *
 * This is a pure presentation transform — backend prompt logic is untouched.
 * Only applied to plain assistant chat messages (not workflow updates,
 * artifacts, brainstorm, refine, or discovery prep — those have their own
 * structured renderers and message_types).
 */
function enforceStrictFormat(text: string): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return trimmed;

  const sentences = trimmed
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const bullets = Array.from({ length: 3 }).map((_, i) => {
    const s = sentences[i] || sentences[0] || trimmed;
    return `- ${s.replace(/^["']|["']$/g, '').trim()}`;
  });

  // CRITICAL: ReactMarkdown needs clean newline separation between list items
  // and a blank line before the closing line so it isn't absorbed into the list.
  let output = bullets.join('\n');
  output += '\n\n→ NEXT MOVE:';

  // Leading newline guarantees the first bullet starts a fresh block.
  return '\n' + output;
}

interface Props {
  message: StrategyMessageT;
  /** When provided on assistant messages, renders quick-iteration actions
   *  (Regenerate / Shorten / Expand / Improve) underneath the response. */
  onQuickAction?: (prompt: string) => void;
}

/** Strict text extractor — never renders raw provider/debug payloads. */
function extractText(contentJson: any): string {
  if (!contentJson) return '';
  for (const k of ['text', 'content', 'message', 'summary', 'executive_summary']) {
    const v = contentJson[k];
    if (typeof v === 'string' && v.trim()) {
      const t = v.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        try { JSON.parse(t); continue; } catch { /* not JSON, safe */ }
      }
      if (/^(openai|anthropic|perplexity|google)\//i.test(t)) continue;
      return v;
    }
  }
  return '';
}

export function StrategyMessage({ message, onQuickAction }: Props) {
  const rawText = extractText(message.content_json);
  const role = message.role;
  // Strict-mode shaping: only for plain assistant chat replies. Skip system,
  // tool, workflow updates, and any non-chat structured message_types so we
  // don't disturb Brainstorm / Refine / Discovery Prep / Artifact renderers.
  const isPlainChat =
    role === 'assistant' &&
    (!message.message_type || message.message_type === 'chat');
  const cfg = getStrategyConfig();
  const isStrictMode = isPlainChat && cfg.enabled && cfg.strictMode;
  const finalText = isStrictMode ? enforceStrictFormat(rawText) : rawText;

  // Temporary debug — verify Strict Mode is actually shaping output.
  if (isPlainChat && typeof window !== 'undefined') {
    // eslint-disable-next-line no-console
    console.log('[StrategyMessage] STRICT MODE ACTIVE:', isStrictMode);
    // eslint-disable-next-line no-console
    console.log('[StrategyMessage] ORIGINAL:', rawText);
    // eslint-disable-next-line no-console
    console.log('[StrategyMessage] FINAL:', finalText);
  }

  const text = finalText;
  const isUser = role === 'user';

  if (!text.trim()) {
    // Streaming placeholder — calm "Thinking…" label, no flashy animation.
    return (
      <div
        className="py-1 text-[14px]"
        style={{
          paddingLeft: role === 'user' ? 40 : 0,
          color: 'hsl(var(--sv-muted))',
          fontFamily: 'var(--sv-sans)',
          opacity: 0.6,
        }}
      >
        Thinking…
      </div>
    );
  }

  if (role === 'system' || role === 'tool' || message.message_type === 'workflow_update') {
    return (
      <div
        className="text-[12px] italic whitespace-pre-wrap break-words"
        style={{ color: 'hsl(var(--sv-muted))' }}
      >
        {text}
      </div>
    );
  }

  if (isUser) {
    return (
      <div
        data-strategy-selectable
        data-message-id={message.id}
        data-message-role="user"
        className="text-[15px] break-words flex justify-end"
        style={{
          fontFamily: 'var(--sv-sans)',
          color: 'hsl(var(--sv-ink))',
          lineHeight: 1.65,
        }}
      >
        <div
          className="rounded-[10px] px-3 py-2 max-w-[78%]"
          style={{
            background: 'hsl(var(--sv-hover) / 0.55)',
            border: '1px solid hsl(var(--sv-hairline))',
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p style={{ margin: 0 }}>{children}</p>,
              ul: ({ children }) => <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>{children}</ul>,
              ol: ({ children }) => <ol style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>{children}</ol>,
              li: ({ children }) => <li style={{ margin: '0.15rem 0' }}>{children}</li>,
              strong: ({ children }) => <strong style={{ fontWeight: 650 }}>{children}</strong>,
              em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
              code: ({ children, className }: any) => (
                <code
                  className={className}
                  style={{
                    fontFamily: 'var(--sv-sans)',
                    background: 'hsl(var(--sv-hover))',
                    borderRadius: 4,
                    padding: '0.1rem 0.3rem',
                  }}
                >
                  {children}
                </code>
              ),
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  // Assistant — serif, flush left, full width.
  // Calm Claude-style minimal renderer: subtle headers, tight bullets,
  // 1.65 line-height, no decorative chrome.
  return (
    <div
      data-strategy-selectable
      data-message-id={message.id}
      data-message-role="assistant"
      className="text-[15px] break-words"
      style={{
        fontFamily: 'var(--sv-serif)',
        color: 'hsl(var(--sv-ink))',
        lineHeight: 1.65,
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: '0 0 12px' }}>{children}</p>,
          ul: ({ children }) => <ul style={{ margin: '0 0 12px', paddingLeft: '1.25rem' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: '0 0 12px', paddingLeft: '1.4rem' }}>{children}</ol>,
          li: ({ children }) => <li style={{ margin: '0 0 4px' }}>{children}</li>,
          strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
          em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
          h1: ({ children }) => (
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '16px 0 6px', fontFamily: 'var(--sv-sans)' }}>
              {children}
            </h2>
          ),
          h2: ({ children }) => (
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '16px 0 6px', fontFamily: 'var(--sv-sans)' }}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '12px 0 4px', fontFamily: 'var(--sv-sans)' }}>
              {children}
            </h3>
          ),
          code: ({ children, className }: any) => (
            <code
              className={className}
              style={{
                fontFamily: 'var(--sv-sans)',
                background: 'hsl(var(--sv-hover))',
                borderRadius: 3,
                padding: '0.1rem 0.3rem',
                fontSize: '0.92em',
              }}
            >
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: '0 0 12px',
                paddingLeft: '0.75rem',
                borderLeft: '2px solid hsl(var(--sv-hairline))',
                color: 'hsl(var(--sv-muted))',
              }}
            >
              {children}
            </blockquote>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
      {onQuickAction && <MessageActions onAction={onQuickAction} />}
    </div>
  );
}
