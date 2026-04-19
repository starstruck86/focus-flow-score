/**
 * ContextInspector — ⌘I right-anchored floating sheet.
 *
 * Locked rules:
 *   - 380px wide, fixed to the right edge, sv-e1 elevation
 *   - **does not shift the canvas** — it overlays. No backdrop dim.
 *   - canvas underneath remains interactive (no overlay catcher)
 *   - title + 3 plain-text tabs (Memory / Uploads / Artifacts)
 *   - flat content — no cards, no icons, hover-only row affordances
 *   - Esc closes; ⌘I toggles
 *
 * Counts/badges: **none**. The unresolved-proposal count lives next to the ⌘I
 * glyph in the top bar, not inside this sheet.
 */
import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { StrategyMemoryEntry } from '@/hooks/strategy/useStrategyMemory';
import type { StrategyUpload } from '@/hooks/strategy/useStrategyUploads';
import type { StrategyArtifact } from '@/hooks/strategy/useStrategyArtifacts';
import { X } from 'lucide-react';

type Tab = 'memory' | 'uploads' | 'artifacts';

interface Props {
  open: boolean;
  onClose: () => void;
  entityName: string | null;
  entitySubline?: string | null;
  memories: StrategyMemoryEntry[];
  uploads: StrategyUpload[];
  artifacts: StrategyArtifact[];
}

export function ContextInspector({
  open, onClose, entityName, entitySubline, memories, uploads, artifacts,
}: Props) {
  const [tab, setTab] = useState<Tab>('memory');

  const items = useMemo(() => {
    if (tab === 'memory') return memories.map(m => ({ id: m.id, primary: m.content, secondary: null as string | null }));
    if (tab === 'uploads') return uploads.map(u => ({ id: u.id, primary: u.title || u.original_filename, secondary: null as string | null }));
    return artifacts.map(a => ({ id: a.id, primary: a.title, secondary: a.artifact_type }));
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
      {/* Title row */}
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

      {/* Tabs — plain text, no pills */}
      <div
        className="flex items-center gap-5 px-4"
        style={{ height: 36, borderBottom: '1px solid hsl(var(--sv-hairline))' }}
      >
        {(['memory', 'uploads', 'artifacts'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="text-[12px] capitalize"
            style={{
              color: tab === t ? 'hsl(var(--sv-ink))' : 'hsl(var(--sv-muted))',
              borderBottom: tab === t ? '1px solid hsl(var(--sv-ink))' : '1px solid transparent',
              paddingBottom: 6,
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Flat list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {items.length === 0 ? (
          <div className="text-[13px]" style={{ color: 'hsl(var(--sv-muted))' }}>
            {tab === 'memory' ? 'No memory yet.'
              : tab === 'uploads' ? 'No uploads yet.'
              : 'No artifacts yet.'}
          </div>
        ) : (
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {items.map(it => (
              <li
                key={it.id}
                className="text-[14px]"
                style={{ color: 'hsl(var(--sv-ink))', lineHeight: 1.5 }}
              >
                <div>{it.primary}</div>
                {it.secondary && (
                  <div className="text-[11px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
                    {it.secondary.replace(/_/g, ' ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>,
    document.body,
  );
}
