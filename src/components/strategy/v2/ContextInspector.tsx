/**
 * ContextInspector — ⌘I right-anchored floating sheet.
 *
 * Tabs: Memory / Uploads / Artifacts / Intelligence
 * Intelligence tab browses the full knowledge_items library and lets the
 * user manually inject KIs into the next send's globalInstructions.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StrategyMemoryEntry } from '@/hooks/strategy/useStrategyMemory';
import type { StrategyUpload } from '@/hooks/strategy/useStrategyUploads';
import type { StrategyArtifact } from '@/hooks/strategy/useStrategyArtifacts';
import { supabase } from '@/integrations/supabase/client';
import type { InjectedKI } from '@/lib/strategy/headClassifier';
import { X } from 'lucide-react';

export type { InjectedKI };

type Tab = 'memory' | 'uploads' | 'artifacts' | 'intelligence';

interface Props {
  open: boolean;
  onClose: () => void;
  entityName: string | null;
  entitySubline?: string | null;
  memories: StrategyMemoryEntry[];
  uploads: StrategyUpload[];
  artifacts: StrategyArtifact[];
  userId?: string;
  onInjectKI?: (ki: InjectedKI) => void;
  injectedKICount?: number;
}

const DIMENSION_ICONS: Record<string, string> = {
  discovery: '🔍', deal_control: '⚔️', expansion_strategy: '📈',
  stakeholder_navigation: '🏛️', objection_handling: '🛡️', messaging: '💬',
  competitive: '🎯', product_knowledge: '🌿', internal_prospecting: '📞',
};

const DIMENSION_FILTERS: { key: string | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'discovery,deal_control,expansion_strategy,stakeholder_navigation,objection_handling,messaging,internal_prospecting', label: '🔍 Sales' },
  { key: 'competitive', label: '🎯 Competitive' },
  { key: 'product_knowledge', label: '🌿 Product' },
];

function IntelligenceBrowser({ userId, onInjectKI }: {
  userId: string;
  onInjectKI?: (ki: InjectedKI) => void;
}) {
  const [search, setSearch] = useState('');
  const [dimension, setDimension] = useState<string | null>(null);
  const [kis, setKis] = useState<InjectedKI[]>([]);
  const [loading, setLoading] = useState(false);
  const [injectedIds, setInjectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      let query = (supabase as any)
        .from('knowledge_items')
        .select('id, title, tactic_summary, spider_dimension')
        .eq('user_id', userId)
        .eq('active', true)
        .order('confidence_score', { ascending: false, nullsFirst: false })
        .limit(40);

      if (search.trim()) {
        query = query.ilike('title', `%${search.trim()}%`);
      }
      if (dimension) {
        const dims = dimension.split(',');
        query = dims.length === 1
          ? query.eq('spider_dimension', dimension)
          : query.in('spider_dimension', dims);
      }

      const { data } = await query;
      const rows = (data ?? []) as InjectedKI[];
      // Quality gate client-side (mirror buildHeadKIBlock)
      const quality = rows.filter((ki) => ki.tactic_summary && ki.tactic_summary.length > 80).slice(0, 20);
      setKis(quality);
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [search, dimension, userId]);

  const handleInject = (ki: InjectedKI) => {
    setInjectedIds((prev) => new Set([...prev, ki.id]));
    onInjectKI?.(ki);
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search knowledge items…"
        className="w-full h-8 px-2.5 rounded-[6px] text-[12.5px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        style={{
          border: '1px solid hsl(var(--sv-hairline))',
          background: 'hsl(var(--sv-paper))',
          color: 'hsl(var(--sv-ink))',
        }}
      />

      <div className="flex flex-wrap gap-1.5">
        {DIMENSION_FILTERS.map((f) => {
          const active = dimension === f.key;
          return (
            <button
              key={String(f.key)}
              type="button"
              onClick={() => setDimension(f.key)}
              className="text-[10.5px] px-2 py-0.5 rounded-full"
              style={{
                border: '1px solid ' + (active ? 'hsl(var(--sv-clay) / 0.4)' : 'hsl(var(--sv-hairline))'),
                background: active ? 'hsl(var(--sv-clay) / 0.10)' : 'transparent',
                color: active ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-muted))',
                fontWeight: active ? 600 : 400,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-[12px] py-2" style={{ color: 'hsl(var(--sv-muted))' }}>Loading…</div>
      ) : kis.length === 0 ? (
        <div className="text-[12px] py-2" style={{ color: 'hsl(var(--sv-muted))' }}>No results.</div>
      ) : (
        <ul className="space-y-2">
          {kis.map((ki) => {
            const injected = injectedIds.has(ki.id);
            const icon = DIMENSION_ICONS[ki.spider_dimension] ?? '📖';
            return (
              <li
                key={ki.id}
                className="rounded-[6px] p-2"
                style={{
                  border: '1px solid hsl(var(--sv-hairline))',
                  background: injected ? 'hsl(var(--sv-clay) / 0.05)' : 'hsl(var(--sv-paper))',
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium leading-snug" style={{ color: 'hsl(var(--sv-ink))' }}>
                      {icon} {ki.title}
                    </div>
                    <div className="text-[10.5px] mt-0.5 leading-snug" style={{ color: 'hsl(var(--sv-muted))' }}>
                      {ki.tactic_summary.slice(0, 100)}…
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => !injected && handleInject(ki)}
                    disabled={injected}
                    className="shrink-0 text-[10.5px] px-2 py-0.5 rounded-[4px]"
                    style={{
                      background: injected ? 'hsl(var(--sv-clay) / 0.08)' : 'hsl(var(--sv-clay))',
                      color: injected ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-paper))',
                      fontWeight: 600,
                      cursor: injected ? 'default' : 'pointer',
                    }}
                  >
                    {injected ? 'Added ✓' : 'Inject'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ContextInspector({
  open, onClose, entityName, entitySubline, memories, uploads, artifacts,
  userId, onInjectKI, injectedKICount = 0,
}: Props) {
  const [tab, setTab] = useState<Tab>('memory');

  const items = useMemo(() => {
    if (tab === 'memory') return memories.map((m) => ({
      id: m.id,
      primary: m.content,
      secondary: (m.memory_type ?? null) as string | null,
    }));
    if (tab === 'uploads') return uploads.map((u) => ({ id: u.id, primary: u.file_name, secondary: u.summary as string | null }));
    if (tab === 'artifacts') return artifacts.map((a) => ({ id: a.id, primary: a.title, secondary: a.artifact_type as string | null }));
    return [];
  }, [tab, memories, uploads, artifacts]);


  if (!open) return null;

  return createPortal(
    <aside
      role="complementary"
      aria-label="Context inspector"
      className="strategy-v2 sv-e1 sv-enter-fade-right"
      style={{
        position: 'fixed',
        top: 56,
        right: 12,
        bottom: 12,
        width: 380,
        maxWidth: 'calc(100vw - 24px)',
        zIndex: 50,
        borderRadius: 'var(--sv-radius-surface)',
        border: '1px solid hsl(var(--sv-hairline))',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        className="flex items-center px-4"
        style={{ height: 44, borderBottom: '1px solid hsl(var(--sv-hairline))' }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium truncate" style={{ color: 'hsl(var(--sv-ink))' }}>
            {entityName ?? 'No linked entity'}
          </div>
          {entitySubline && (
            <div className="text-[11px] truncate" style={{ color: 'hsl(var(--sv-muted))' }}>
              {entitySubline}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-7 w-7 inline-flex items-center justify-center sv-hover-bg rounded-[4px]"
          style={{ color: 'hsl(var(--sv-muted))' }}
          aria-label="Close inspector"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      <div
        className="flex items-center gap-5 px-4"
        style={{ height: 36, borderBottom: '1px solid hsl(var(--sv-hairline))' }}
      >
        {(['memory', 'uploads', 'artifacts', 'intelligence'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="text-[12px] capitalize inline-flex items-center gap-1"
            style={{
              color: tab === t ? 'hsl(var(--sv-ink))' : 'hsl(var(--sv-muted))',
              borderBottom: tab === t ? '1px solid hsl(var(--sv-ink))' : '1px solid transparent',
              paddingBottom: 6,
              marginBottom: -1,
            }}
          >
            {t}
            {t === 'intelligence' && injectedKICount > 0 && (
              <span
                className="text-[10px] px-1.5 rounded-full"
                style={{
                  background: 'hsl(var(--sv-clay))',
                  color: 'hsl(var(--sv-paper))',
                  fontWeight: 600,
                }}
              >
                {injectedKICount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === 'intelligence' ? (
          <IntelligenceBrowser userId={userId ?? ''} onInjectKI={onInjectKI} />
        ) : items.length === 0 ? (
          <div className="text-[13px]" style={{ color: 'hsl(var(--sv-muted))' }}>
            {tab === 'memory'
              ? (entityName
                  ? `No memories for ${entityName} yet. They'll capture automatically as you work.`
                  : 'Link a thread to an account to see and capture memories.')
              : tab === 'uploads' ? 'No uploads yet.'
              : 'No artifacts yet.'}
          </div>
        ) : (
          <>
            {tab === 'memory' && entityName && (
              <div
                className="text-[11px] mb-3 pb-2"
                style={{ borderBottom: '1px solid hsl(var(--sv-hairline))', color: 'hsl(var(--sv-muted))' }}
              >
                {memories.length} {memories.length === 1 ? 'memory' : 'memories'} for {entityName}
              </div>
            )}
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {items.map((it) => (
                <li
                  key={it.id}
                  className="text-[14px]"
                  style={{ color: 'hsl(var(--sv-ink))', lineHeight: 1.5 }}
                >
                  {tab === 'memory' ? (
                    <div className="flex items-start gap-2">
                      {it.secondary && (
                        <span
                          className="shrink-0 text-[9.5px] px-1.5 py-0.5 rounded-full mt-0.5 uppercase tracking-wide"
                          style={{
                            background: 'hsl(var(--sv-clay) / 0.08)',
                            color: 'hsl(var(--sv-clay))',
                            fontWeight: 600,
                          }}
                        >
                          {it.secondary.replace(/_/g, ' ')}
                        </span>
                      )}
                      <span>{it.primary}</span>
                    </div>
                  ) : (
                    <>
                      <div>{it.primary}</div>
                      {it.secondary && (
                        <div className="text-[11px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
                          {it.secondary.replace(/_/g, ' ')}
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>,
    document.body,
  );
}

