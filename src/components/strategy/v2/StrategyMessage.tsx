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
    // Streaming placeholder — three soft dots in clay, no bubble
    return (
      <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: role === 'user' ? 40 : 0 }}>
        <span className="h-1 w-1 rounded-full animate-bounce" style={{ background: 'hsl(var(--sv-clay) / 0.5)', animationDelay: '0ms' }} />
        <span className="h-1 w-1 rounded-full animate-bounce" style={{ background: 'hsl(var(--sv-clay) / 0.5)', animationDelay: '120ms' }} />
        <span className="h-1 w-1 rounded-full animate-bounce" style={{ background: 'hsl(var(--sv-clay) / 0.5)', animationDelay: '240ms' }} />
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

  // Assistant — serif, flush left, full width
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
          p: ({ children }) => <p style={{ margin: 0 }}>{children}</p>,
          ul: ({ children }) => <ul style={{ margin: '0.55rem 0 0', paddingLeft: '1.2rem' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: '0.55rem 0 0', paddingLeft: '1.2rem' }}>{children}</ol>,
          li: ({ children }) => <li style={{ margin: '0.2rem 0' }}>{children}</li>,
          strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
          em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
          h1: ({ children }) => <h1 style={{ fontSize: '1.35rem', margin: '0 0 0.4rem', fontWeight: 700 }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ fontSize: '1.1rem', margin: '0.2rem 0 0.35rem', fontWeight: 700 }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ fontSize: '1rem', margin: '0.15rem 0 0.3rem', fontWeight: 650 }}>{children}</h3>,
          code: ({ children, ...rest }: any) => (
            <code
              {...rest}
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
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: '0.55rem 0 0',
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
