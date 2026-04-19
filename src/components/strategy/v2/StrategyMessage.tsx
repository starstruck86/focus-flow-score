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
import type { StrategyMessage as StrategyMessageT } from '@/types/strategy';

interface Props {
  message: StrategyMessageT;
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

export function StrategyMessage({ message }: Props) {
  const text = extractText(message.content_json);
  const role = message.role;

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

  if (role === 'user') {
    return (
      <div
        data-strategy-selectable
        data-message-id={message.id}
        data-message-role="user"
        className="text-[15px] whitespace-pre-wrap break-words"
        style={{
          fontFamily: 'var(--sv-sans)',
          color: 'hsl(var(--sv-ink))',
          lineHeight: 1.65,
          marginLeft: 40,
          maxWidth: '85%',
        }}
      >
        {text}
      </div>
    );
  }

  // Assistant — serif, flush left, full width
  return (
    <div
      data-strategy-selectable
      data-message-id={message.id}
      data-message-role="assistant"
      className="text-[15px] whitespace-pre-wrap break-words"
      style={{
        fontFamily: 'var(--sv-serif)',
        color: 'hsl(var(--sv-ink))',
        lineHeight: 1.65,
      }}
    >
      {text}
    </div>
  );
}
