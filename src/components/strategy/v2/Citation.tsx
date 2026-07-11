import { BookOpen, Brain, Building2, FileText, Globe, Swords } from 'lucide-react';
import type {
  StrategyCitationSource,
  StrategyCitations,
} from '@/types/strategy';

type SourceKind =
  | 'resource'
  | 'ki'
  | 'playbook'
  | 'competitive_intel'
  | 'vertical_brief'
  | 'web_source';

interface DisplaySource extends StrategyCitationSource {
  kind: SourceKind;
}

const SOURCE_META: Record<SourceKind, { label: string; Icon: typeof FileText }> = {
  resource: { label: 'Resource', Icon: FileText },
  ki: { label: 'Knowledge item', Icon: Brain },
  playbook: { label: 'Playbook', Icon: BookOpen },
  competitive_intel: { label: 'Competitive intel', Icon: Swords },
  vertical_brief: { label: 'Industry POV', Icon: Building2 },
  web_source: { label: 'Web source', Icon: Globe },
};

function safeWebUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function validSources(value: unknown, kind: SourceKind): DisplaySource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const { id, title, url, published_at } = candidate as Record<string, unknown>;
    if (typeof id !== 'string' || !id.trim() || typeof title !== 'string' || !title.trim()) return [];
    if (kind === 'web_source') {
      const safeUrl = safeWebUrl(url);
      if (!safeUrl || typeof published_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(published_at)) return [];
      return [{ id: id.trim(), title: title.trim(), url: safeUrl, published_at, kind }];
    }
    return [{ id: id.trim(), title: title.trim(), kind }];
  });
}

export function parseCitationSources(citations: StrategyCitations | null | undefined): DisplaySource[] {
  if (!citations || typeof citations !== 'object' || Array.isArray(citations)) return [];
  const sources = [
    ...validSources(citations.resources, 'resource'),
    ...validSources(citations.kis, 'ki'),
    ...validSources(citations.playbooks, 'playbook'),
    ...validSources(citations.competitive_intel, 'competitive_intel'),
    ...validSources(citations.vertical_briefs, 'vertical_brief'),
    ...validSources(citations.web_sources, 'web_source'),
  ];
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.kind}:${source.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function SourceBadge({ source }: { source: DisplaySource }) {
  const { label, Icon } = SOURCE_META[source.kind];
  const title = source.published_at
    ? `${label}: ${source.title} (${source.published_at})`
    : `${label}: ${source.title}`;
  const content = (
    <>
      <Icon size={11} aria-hidden="true" className="shrink-0" />
      <span className="sr-only">{label}: </span>
      <span className="truncate">{source.title}</span>
      {source.published_at && (
        <time dateTime={source.published_at} className="shrink-0 opacity-75">
          {source.published_at}
        </time>
      )}
    </>
  );
  const common = {
    'data-source-kind': source.kind,
    'data-source-id': source.id,
    title,
    className: 'inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4',
    style: {
      border: '1px solid hsl(var(--sv-hairline))',
      background: 'hsl(var(--sv-hover) / 0.55)',
      color: 'hsl(var(--sv-muted))',
      fontFamily: 'var(--sv-sans)',
    },
  };

  if (source.kind === 'web_source' && source.url) {
    return (
      <a
        {...common}
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
      >
        {content}
      </a>
    );
  }
  return (
    <span {...common}>
      {content}
    </span>
  );
}

export function Citation({ citations }: { citations: StrategyCitations | null | undefined }) {
  const sources = parseCitationSources(citations);
  if (sources.length === 0) return null;
  return (
    <aside aria-label="Sources" className="mt-3 flex flex-wrap items-center gap-1.5" style={{ fontFamily: 'var(--sv-sans)' }}>
      <span className="mr-0.5 text-[10px] font-medium uppercase tracking-[0.08em]" style={{ color: 'hsl(var(--sv-muted))' }}>
        Sources
      </span>
      {sources.map((source) => (
        <SourceBadge key={`${source.kind}:${source.id}`} source={source} />
      ))}
    </aside>
  );
}
