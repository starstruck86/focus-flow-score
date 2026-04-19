/**
 * StrategySwitcher — ⌘K overlay.
 *
 * Locked rules:
 *   - 560px wide, centered, sv-e1 elevation
 *   - input + flat ranked list (Recent / Pinned / Accounts·Opps when query matches)
 *   - no tabs, no filter chips, no icons
 *   - Arrow up/down, Enter, Esc
 *   - page behind dimmed to 60% via overlay (no blur)
 *   - **does not shift canvas layout** — overlay only
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { StrategyThread } from '@/types/strategy';

interface Props {
  open: boolean;
  threads: StrategyThread[];
  onClose: () => void;
  onSelectThread: (id: string) => void;
}

interface Row {
  id: string;
  title: string;
  group: 'pinned' | 'recent' | 'accounts' | 'opportunities';
  kind?: 'thread' | 'account' | 'opportunity';
  // For account/opp rows that the user picks → we open or create a thread
  entityId?: string;
}

export function StrategySwitcher({ open, threads, onClose, onSelectThread }: Props) {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [entities, setEntities] = useState<{ accounts: { id: string; name: string }[]; opportunities: { id: string; name: string }[] }>({ accounts: [], opportunities: [] });

  // Reset & focus on open
  useEffect(() => {
    if (open) {
      setQ('');
      setActiveIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Lazy-load entities when first opened
  useEffect(() => {
    if (!open || !user || entities.accounts.length || entities.opportunities.length) return;
    let cancelled = false;
    (async () => {
      const [accts, opps] = await Promise.all([
        supabase.from('accounts').select('id, name').eq('user_id', user.id).is('deleted_at', null).limit(60),
        supabase.from('opportunities').select('id, name').eq('user_id', user.id).limit(60),
      ]);
      if (cancelled) return;
      setEntities({
        accounts: (accts.data ?? []) as { id: string; name: string }[],
        opportunities: (opps.data ?? []) as { id: string; name: string }[],
      });
    })();
    return () => { cancelled = true; };
  }, [open, user, entities.accounts.length, entities.opportunities.length]);

  // Build the ranked list — universal: threads + accounts + opportunities
  // in one surface, both at rest (empty query) and on search.
  const rows = useMemo((): Row[] => {
    const needle = q.trim().toLowerCase();
    const sortedThreads = [...threads].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
    const pinned = sortedThreads.filter(t => t.is_pinned);
    const recent = sortedThreads.filter(t => !t.is_pinned);

    const list: Row[] = [];

    if (!needle) {
      // Default surface — recent threads first, then pinned, then a slice of
      // accounts and opportunities so the operator can see the universe at a glance.
      recent.slice(0, 6).forEach(t => list.push({ id: t.id, title: t.title, group: 'recent', kind: 'thread' }));
      pinned.slice(0, 4).forEach(t => list.push({ id: t.id, title: t.title, group: 'pinned', kind: 'thread' }));
      entities.accounts.slice(0, 5).forEach(a => list.push({
        id: `acct-${a.id}`, title: a.name, group: 'accounts', kind: 'account', entityId: a.id,
      }));
      entities.opportunities.slice(0, 5).forEach(o => list.push({
        id: `opp-${o.id}`, title: o.name, group: 'opportunities', kind: 'opportunity', entityId: o.id,
      }));
    } else {
      sortedThreads
        .filter(t => t.title.toLowerCase().includes(needle))
        .slice(0, 8)
        .forEach(t => list.push({
          id: t.id, title: t.title, group: t.is_pinned ? 'pinned' : 'recent', kind: 'thread',
        }));
      entities.accounts
        .filter(a => a.name.toLowerCase().includes(needle))
        .slice(0, 6)
        .forEach(a => list.push({ id: `acct-${a.id}`, title: a.name, group: 'accounts', kind: 'account', entityId: a.id }));
      entities.opportunities
        .filter(o => o.name.toLowerCase().includes(needle))
        .slice(0, 6)
        .forEach(o => list.push({ id: `opp-${o.id}`, title: o.name, group: 'opportunities', kind: 'opportunity', entityId: o.id }));
    }

    return list;
  }, [q, threads, entities]);

  // Group headings (rendered inline as muted labels)
  const grouped = useMemo(() => {
    const groups: { label: string; items: Row[] }[] = [];
    let cur: { label: string; items: Row[] } | null = null;
    const labelFor = (g: Row['group']) =>
      g === 'recent' ? 'Recent' : g === 'pinned' ? 'Pinned' : g === 'accounts' ? 'Accounts' : 'Opportunities';
    for (const r of rows) {
      if (!cur || cur.label !== labelFor(r.group)) {
        cur = { label: labelFor(r.group), items: [] };
        groups.push(cur);
      }
      cur.items.push(r);
    }
    return groups;
  }, [rows]);

  // Flat index for keyboard navigation
  const flat = rows;
  useEffect(() => { setActiveIdx(0); }, [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(flat.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = flat[activeIdx];
        if (!row) return;
        await pick(row);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flat, activeIdx, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (row: Row) => {
    if (row.kind === 'thread') {
      onSelectThread(row.id);
      onClose();
      return;
    }
    // Account / Opportunity selected → find existing linked thread, or create one
    if (!user || !row.entityId) return;
    const col = row.kind === 'account' ? 'linked_account_id' : 'linked_opportunity_id';
    const { data: existing } = await supabase
      .from('strategy_threads')
      .select('id')
      .eq('user_id', user.id)
      .eq(col, row.entityId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      onSelectThread(existing.id);
      onClose();
      return;
    }

    const insert: Record<string, unknown> = {
      user_id: user.id,
      title: row.title,
      lane: 'strategy',
      thread_type: row.kind === 'account' ? 'account_linked' : 'opportunity_linked',
      [col]: row.entityId,
    };
    const { data: created } = await supabase.from('strategy_threads').insert(insert as any).select('id').single();
    if (created?.id) {
      onSelectThread(created.id);
      onClose();
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="strategy-v2" style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'transparent', pointerEvents: 'none' }}>
      {/* No veil. Canvas remains 100% visible. Click-catcher is fully transparent. */}
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'transparent', pointerEvents: 'auto' }}
      />
      <div
        role="dialog"
        aria-label="Switcher"
        className="sv-e1 sv-enter-fade"
        style={{
          position: 'absolute',
          top: '14vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          borderRadius: 'var(--sv-radius-surface)',
          border: '1px solid hsl(var(--sv-hairline))',
          background: 'hsl(var(--sv-paper))',
          overflow: 'hidden',
          pointerEvents: 'auto',
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search threads, accounts, opportunities…"
          className="w-full h-11 px-4 bg-transparent border-0 outline-none focus:outline-none focus:ring-0 text-[14px]"
          style={{
            color: 'hsl(var(--sv-ink))',
            borderBottom: '1px solid hsl(var(--sv-hairline))',
            boxShadow: 'none',
          }}
          onFocus={e => { e.currentTarget.style.outline = 'none'; }}
        />
        <div style={{ maxHeight: '54vh', overflowY: 'auto' }}>
          {grouped.length === 0 && (
            <div className="px-4 py-3 text-[13px]" style={{ color: 'hsl(var(--sv-muted))' }}>
              No matches.
            </div>
          )}
          {grouped.map((g, gi) => {
            // compute starting flat index for this group for active highlight
            let baseIdx = 0;
            for (let k = 0; k < gi; k++) baseIdx += grouped[k].items.length;
            return (
              <div key={g.label} className="py-1">
                <div className="px-4 pt-2 pb-1 text-[11px]" style={{ color: 'hsl(var(--sv-muted))' }}>
                  {g.label}
                </div>
                {g.items.map((r, i) => {
                  const idx = baseIdx + i;
                  const active = idx === activeIdx;
                  const trail = r.kind === 'account' ? 'Account'
                    : r.kind === 'opportunity' ? 'Opportunity'
                    : null;
                  return (
                    <button
                      key={r.id}
                      onClick={() => pick(r)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className="w-full text-left px-4 py-1.5 flex items-center justify-between gap-3"
                      style={{
                        background: active ? 'hsl(var(--sv-hover))' : 'transparent',
                      }}
                    >
                      <span className="text-[14px] truncate" style={{ color: 'hsl(var(--sv-ink))' }}>
                        {r.title}
                      </span>
                      {trail && (
                        <span className="text-[11px] shrink-0" style={{ color: 'hsl(var(--sv-muted))' }}>
                          {trail}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
