import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';
import type { SkillSection } from '@/lib/strategy/parseSkillSections';
import { parseSkillSections } from '@/lib/strategy/parseSkillSections';

interface Props {
  text: string;
  label: string;
  onQuickAction?: (prompt: string) => void;
}

function CopyButton({ content, label }: { content: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* swallow */
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-[4px] transition-colors"
      style={{
        color: copied ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-muted))',
        background: copied ? 'hsl(var(--sv-clay) / 0.08)' : 'transparent',
      }}
      title={label ? `Copy ${label}` : 'Copy'}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function SectionBlock({ section }: { section: SkillSection }) {
  return (
    <div className="px-4 py-3" style={{ borderTop: '1px solid hsl(var(--sv-hairline))' }}>
      <div className="flex items-center justify-between mb-1.5">
        {section.title ? (
          <span
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'hsl(var(--sv-muted))', fontFamily: 'var(--sv-sans)' }}
          >
            {section.title}
          </span>
        ) : <span />}
        <CopyButton content={section.content} label={section.title} />
      </div>
      <div
        className="text-[14px]"
        style={{
          fontFamily: 'var(--sv-serif)',
          color: 'hsl(var(--sv-ink))',
          lineHeight: 1.6,
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
            ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: '1.2rem' }}>{children}</ul>,
            ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: '1.4rem' }}>{children}</ol>,
            li: ({ children }) => <li style={{ margin: '0 0 3px' }}>{children}</li>,
            strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
          }}
        >
          {section.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export function SkillOutputCard({ text, label, onQuickAction }: Props) {
  const sections = parseSkillSections(text);

  return (
    <div
      className="rounded-[10px] overflow-hidden"
      style={{
        border: '1px solid hsl(var(--sv-hairline))',
        background: 'hsl(var(--sv-paper))',
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: '1px solid hsl(var(--sv-hairline))', background: 'hsl(var(--sv-hover) / 0.4)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold" style={{ color: 'hsl(var(--sv-ink))', fontFamily: 'var(--sv-sans)' }}>
            {label}
          </span>
          <span
            className="text-[9.5px] uppercase tracking-wider px-1.5 py-px rounded"
            style={{ background: 'hsl(var(--sv-clay) / 0.10)', color: 'hsl(var(--sv-clay))', fontWeight: 600 }}
          >
            Skill output · {sections.length} sections
          </span>
        </div>
        <CopyButton content={text} label="full output" />
      </div>

      {sections.map((section, i) => (
        <SectionBlock key={i} section={section} />
      ))}


      {onQuickAction && (
        <div
          className="px-4 py-2 flex flex-wrap gap-2"
          style={{ borderTop: '1px solid hsl(var(--sv-hairline))' }}
        >
          {['Expand this', 'Make it shorter', 'Add more detail', 'Tailor for exec audience'].map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => onQuickAction(action)}
              className="text-[11px] px-2 py-0.5 rounded-[4px]"
              style={{
                border: '1px solid hsl(var(--sv-hairline))',
                color: 'hsl(var(--sv-muted))',
              }}
            >
              {action}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
