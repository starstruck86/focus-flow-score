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
  const text = extractText(message.content_json);
  const role = message.role;
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

  // Assistant — serif, flush left, full width. Claude-grade hierarchy:
  // 18px section headers, 15px body, 1.65 line-height, generous gaps
  // between sections, tight gaps between bullets. Optimised for scan.
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
          p: ({ children }) => (
            <p style={{ margin: '0 0 12px' }}>{children}</p>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: '0 0 12px', paddingLeft: '1.25rem' }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '0 0 12px', paddingLeft: '1.4rem' }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ margin: '0 0 6px', paddingLeft: '0.15rem' }}>{children}</li>
          ),
          strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
          em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
          h1: ({ children }) => (
            <h1
              style={{
                fontSize: '20px',
                lineHeight: 1.3,
                margin: '4px 0 10px',
                fontWeight: 700,
                fontFamily: 'var(--sv-sans)',
                letterSpacing: '-0.01em',
              }}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              style={{
                fontSize: '18px',
                lineHeight: 1.3,
                margin: '18px 0 8px',
                fontWeight: 600,
                fontFamily: 'var(--sv-sans)',
                letterSpacing: '-0.005em',
              }}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              style={{
                fontSize: '15px',
                lineHeight: 1.3,
                margin: '14px 0 6px',
                fontWeight: 600,
                fontFamily: 'var(--sv-sans)',
              }}
            >
              {children}
            </h3>
          ),
          hr: () => (
            <hr
              style={{
                margin: '16px 0',
                border: 0,
                borderTop: '1px solid hsl(var(--sv-hairline))',
              }}
            />
          ),
          code: ({ children, className }: any) => (
            <code
              className={className}
              style={{
                fontFamily: 'var(--sv-sans)',
                background: 'hsl(var(--sv-hover))',
                borderRadius: 4,
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
                margin: '12px 0',
                paddingLeft: '0.85rem',
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
