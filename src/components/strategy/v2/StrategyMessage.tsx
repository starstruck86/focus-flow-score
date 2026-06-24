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
import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { StrategyMessage as StrategyMessageT } from '@/types/strategy';
import { MessageActions } from './MessageActions';
import type { StrategyGlobalInstructionsConfig } from '@/lib/strategy/strategyConfig';
import type { Citation } from '@/lib/strategy/headClassifier';

const DIMENSION_ICONS: Record<string, string> = {
  discovery: '🔍',
  deal_control: '⚔️',
  expansion_strategy: '📈',
  stakeholder_navigation: '🏛️',
  objection_handling: '🛡️',
  messaging: '💬',
  competitive: '🎯',
  product_knowledge: '🌿',
  internal_prospecting: '📞',
};

// CitationChip removed — inline stateful chips inside ReactMarkdown caused
// "Rendered more hooks than during the previous render". Citations are now
// surfaced exclusively via SourcesPanel at the bottom of each assistant turn.


function SourcesPanel({ citations }: { citations: Citation[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-3 pt-2" style={{ borderTop: '1px solid hsl(var(--sv-hairline))' }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1.5 text-[11px]"
        style={{ color: 'hsl(var(--sv-muted))' }}
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>Sources · {citations.length} knowledge items used</span>
      </button>
      {expanded && (
        <ul className="mt-2 space-y-1.5">
          {citations.map((c) => {
            const icon = DIMENSION_ICONS[c.spider_dimension] ?? '📖';
            return (
              <li key={c.key} className="flex items-start gap-2 text-[12px]">
                <span
                  className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-0.5"
                  style={{
                    background: 'hsl(var(--sv-clay) / 0.08)',
                    color: 'hsl(var(--sv-clay))',
                    fontFamily: 'var(--sv-sans)',
                  }}
                >
                  {c.key}
                </span>
                <span style={{ color: 'hsl(var(--sv-ink) / 0.8)' }}>
                  <span className="font-medium">{icon} {c.title}</span>
                  <span className="ml-1" style={{ color: 'hsl(var(--sv-muted))' }}>
                    — {c.tactic_summary.slice(0, 80)}…
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}


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
  const raw = (text ?? '').trim();
  if (!raw) return raw;

  // Strip existing bullet/list markers and stray quotes so we can re-normalize cleanly
  const cleaned = raw
    .replace(/^\s*[•*\-–—]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/["“”]/g, '')
    .trim();

  const sentences = cleaned
    .split(/\r?\n+|(?<=[.?!])\s+/)
    .map((s) => s.replace(/^[•*\-–—\s]+/, '').trim())
    .filter(Boolean);

  let bulletTexts: string[];
  if (sentences.length >= 3) {
    bulletTexts = sentences.slice(0, 3);
  } else {
    const base = sentences[0] || cleaned;
    bulletTexts = [
      base,
      'What specific outcomes are you trying to achieve?',
      "What's currently blocking progress?",
    ];
  }

  // HARD ENFORCE exactly 3 bullets, single bullet style
  bulletTexts = bulletTexts.slice(0, 3).map((s) => s.replace(/^[•*\-–—\s]+/, '').trim());

  const bullets = bulletTexts.map((s) => `• ${s}`);

  // Leading newline + blank line before NEXT MOVE so it isn't absorbed into the list
  return '\n' + bullets.join('\n') + '\n\n→ NEXT MOVE:';
}

/**
 * Strict-mode parser — extracts bullet lines and the closing NEXT MOVE line
 * from already-shaped text. Used to render structure directly, bypassing
 * any markdown parsing variability.
 */
function parseStrictOutput(text: string): { bullets: string[]; nextMove: string } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  let bullets = lines
    .filter((l) => /^[•\-*]\s+/.test(l))
    .map((l) => l.replace(/^[•\-*]\s+/, '').trim());

  // Fallback: if parser fails, recover bullets from raw sentences
  if (bullets.length === 0) {
    bullets = text
      .replace(/→\s*NEXT MOVE:?.*$/i, '')
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.replace(/^[•\-*\s]+/, '').trim())
      .filter(Boolean);
  }

  bullets = bullets.slice(0, 3);

  const nextMove = lines.find((l) => /→\s*NEXT MOVE/i.test(l)) || '→ NEXT MOVE:';
  return { bullets, nextMove };
}

interface Props {
  message: StrategyMessageT;
  /** When provided on assistant messages, renders quick-iteration actions
   *  (Regenerate / Shorten / Expand / Improve) underneath the response. */
  onQuickAction?: (prompt: string) => void;
  /** Lifted strategy config from StrategyShell — single source of truth
   *  for Strict Mode and other render overrides. We do NOT read
   *  getStrategyConfig() here; the parent owns the subscription. */
  strategyConfig?: StrategyGlobalInstructionsConfig;
  /** Citation manifest — when present on assistant messages, [K1]/[K2]/…
   *  tokens in the response render as inline citation chips and a Sources
   *  panel appears beneath the message. */
  citations?: Citation[] | null;
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

export function StrategyMessage({ message, onQuickAction, strategyConfig, citations }: Props) {
  const rawText = extractText(message.content_json);
  const role = message.role;
  // Strict-mode shaping is a render override that applies to ANY assistant
  // message, regardless of message_type or workflow lane. No type gating.
  //
  // strategyConfig is lifted to StrategyShell — that parent owns the
  // single subscription to localStorage. We do NOT call getStrategyConfig()
  // here; reading it directly was the source of stale config bugs.
  const isStrictMode =
    strategyConfig?.enabled === true && strategyConfig?.strictMode === true;
  const finalText = role === 'assistant' && isStrictMode ? enforceStrictFormat(rawText) : rawText;

  const text = finalText;
  const isUser = role === 'user';

  // Strict Mode bypass: render assistant structure FIRST, before any
  // empty-text, message-type, workflow, markdown, or user/system branching.
  // This must be the highest-priority render path for assistant messages.
  if (role === 'assistant' && isStrictMode && rawText.trim()) {
    const strictText = enforceStrictFormat(rawText);
    const { bullets, nextMove } = parseStrictOutput(strictText);
    return (
      <div
        data-strategy-selectable
        data-message-id={message.id}
        data-message-role="assistant"
        data-strict-mode="true"
        className="strategy-strict-message text-[15px] break-words"
        style={{
          fontFamily: 'var(--sv-serif)',
          color: 'hsl(var(--sv-ink))',
          lineHeight: 1.65,
        }}
      >
        <ul style={{ margin: '0 0 12px', paddingLeft: '1.25rem', listStyleType: 'disc' }}>
          {bullets.map((b, i) => (
            <li key={i} style={{ margin: '0 0 4px' }}>{b}</li>
          ))}
        </ul>
        <div
          style={{
            marginTop: 12,
            fontWeight: 600,
            fontFamily: 'var(--sv-sans)',
            color: 'hsl(var(--sv-ink))',
          }}
        >
          {nextMove}
        </div>
        {onQuickAction && <MessageActions onAction={onQuickAction} />}
      </div>
    );
  }

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

  const assistantText = text;

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
        {assistantText}
      </ReactMarkdown>
      {onQuickAction && <MessageActions onAction={onQuickAction} />}
      {citations && citations.length > 0 && <SourcesPanel citations={citations} />}
    </div>
  );
}
