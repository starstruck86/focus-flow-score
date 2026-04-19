/**
 * PromotionsInbox — ⌘. summoned surface for unresolved proposals across threads.
 *
 * The ONLY place workflow UI is allowed in Strategy.
 *
 * Locked Phase 2 brief:
 *   - flat list, no cards, no chips, no icons
 *   - no timestamps, no per-item borders
 *   - keyboard navigable: ↑/↓ move, Enter = confirm, Backspace = reject, Esc = close
 *   - human language only — no "proposal", "promoted", "confirmed", "stage"
 *   - feels like Linear Inbox, not Salesforce queue
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface InboxItem {
  id: string;
  thread_id: string;
  proposal_type: string;
  payload_json: Record<string, unknown>;
  target_account_id: string | null;
  target_opportunity_id: string | null;
  /** Human-friendly title — e.g. "Add contact: Matthew Pertgen" */
  title: string;
  /** Short body extracted from payload */
  body: string;
  /** Friendly entity name (account or opp) */
  entityName: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function buildTitle(p: { proposal_type: string; payload_json: any }): { title: string; body: string } {
  const pl = p.payload_json ?? {};
  if (p.proposal_type === 'contact') {
    return { title: `Add contact: ${pl.name ?? 'Unknown'}`, body: pl.title ?? pl.notes ?? '' };
  }
  if (p.proposal_type.includes('intelligence') || p.proposal_type.includes('note')) {
    return { title: 'Save insight', body: pl.content ?? pl.note ?? pl.text ?? '' };
  }
  if (p.proposal_type === 'transcript') {
    return { title: 'Save transcript', body: pl.title ?? pl.summary ?? '' };
  }
  if (p.proposal_type.includes('artifact') || p.proposal_type.includes('resource')) {
    return { title: 'Save document', body: pl.title ?? pl.summary ?? '' };
  }
  return { title: 'Save item', body: typeof pl === 'string' ? pl : (pl.text ?? pl.content ?? '') };
}

export function PromotionsInbox({ open, onClose }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data: rows } = await (supabase as any)
      .from('strategy_promotion_proposals')
      .select('id, thread_id, proposal_type, payload_json, target_account_id, target_opportunity_id, status')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!rows) { setItems([]); return; }

    // Resolve entity names in a single pass
    const acctIds = Array.from(new Set(rows.map((r: any) => r.target_account_id).filter(Boolean)));
    const oppIds = Array.from(new Set(rows.map((r: any) => r.target_opportunity_id).filter(Boolean)));
    const [accts, opps] = await Promise.all([
      acctIds.length
        ? supabase.from('accounts').select('id, name').in('id', acctIds as string[])
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      oppIds.length
        ? supabase.from('opportunities').select('id, name').in('id', oppIds as string[])
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
    const acctMap = new Map(((accts.data ?? []) as any[]).map(a => [a.id, a.name]));
    const oppMap = new Map(((opps.data ?? []) as any[]).map(o => [o.id, o.name]));

    const built: InboxItem[] = rows.map((r: any) => {
      const { title, body } = buildTitle(r);
      const entityName = r.target_opportunity_id
        ? oppMap.get(r.target_opportunity_id) ?? null
        : r.target_account_id ? acctMap.get(r.target_account_id) ?? null : null;
      return {
        id: r.id,
        thread_id: r.thread_id,
        proposal_type: r.proposal_type,
        payload_json: r.payload_json ?? {},
        target_account_id: r.target_account_id,
        target_opportunity_id: r.target_opportunity_id,
        title,
        body,
        entityName,
      };
    });
    setItems(built);
    setActiveIdx(0);
  }, [user]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const confirm = useCallback(async (item: InboxItem) => {
    if (!user || busyId) return;
    setBusyId(item.id);
    // Class-aware confirm — derive from proposal type
    const promotionClass = item.proposal_type === 'contact'
      ? 'crm_contact'
      : 'shared_intelligence';
    const status = promotionClass === 'crm_contact'
      ? 'confirmed_crm_contact' : 'confirmed_shared_intelligence';

    await (supabase as any)
      .from('strategy_promotion_proposals')
      .update({
        status,
        confirmed_class: promotionClass,
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', item.id);

    try {
      await supabase.functions.invoke('strategy-promote-proposal', { body: { proposal_id: item.id } });
    } catch (e) {
      console.error('[inbox] promote failed', e);
    }
    setItems(prev => prev.filter(p => p.id !== item.id));
    setActiveIdx(i => Math.min(Math.max(i, 0), Math.max(0, items.length - 2)));
    setBusyId(null);
  }, [user, busyId, items.length]);

  const reject = useCallback(async (item: InboxItem) => {
    if (busyId) return;
    setBusyId(item.id);
    await (supabase as any)
      .from('strategy_promotion_proposals')
      .update({ status: 'rejected', rejected_reason: 'inbox_dismiss' })
      .eq('id', item.id);
    setItems(prev => prev.filter(p => p.id !== item.id));
    setActiveIdx(i => Math.min(Math.max(i, 0), Math.max(0, items.length - 2)));
    setBusyId(null);
  }, [busyId, items.length]);

  // Keyboard
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (items.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(items.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[activeIdx];
        if (it) confirm(it);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        const it = items[activeIdx];
        if (it) reject(it);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, activeIdx, confirm, reject, onClose]);

  // Subtle grouping: contacts vs insights
  const grouped = useMemo(() => {
    const contacts = items.filter(i => i.proposal_type === 'contact');
    const insights = items.filter(i => i.proposal_type !== 'contact');
    const groups: { label: string; items: InboxItem[] }[] = [];
    if (contacts.length) groups.push({ label: 'Add contact', items: contacts });
    if (insights.length) groups.push({ label: 'Save insight', items: insights });
    return groups;
  }, [items]);

  if (!open) return null;

  return createPortal(
    <div className="strategy-v2" style={{ position: 'fixed', inset: 0, zIndex: 75, background: 'transparent', pointerEvents: 'none' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'transparent', pointerEvents: 'auto' }} />
      <div
        role="dialog"
        aria-label="Pending"
        className="sv-e1 sv-enter-fade"
        style={{
          position: 'absolute',
          top: '12vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 520,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '70vh',
          background: 'hsl(var(--sv-paper))',
          border: '1px solid hsl(var(--sv-hairline))',
          borderRadius: 'var(--sv-radius-surface)',
          overflow: 'hidden',
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="px-5 pt-4 pb-2 text-[13px]" style={{ color: 'hsl(var(--sv-muted))' }}>
          Pending
        </div>
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {items.length === 0 && (
            <div className="px-5 py-6 text-[14px]" style={{ color: 'hsl(var(--sv-muted))', fontFamily: 'var(--sv-serif)' }}>
              Nothing waiting.
            </div>
          )}
          {grouped.map(g => (
            <div key={g.label} className="pb-2">
              <div className="px-5 pt-2 pb-1 text-[11px]" style={{ color: 'hsl(var(--sv-muted))' }}>
                {g.label}
              </div>
              {g.items.map(item => {
                const idx = items.indexOf(item);
                const active = idx === activeIdx;
                return (
                  <div
                    key={item.id}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className="px-5 py-2"
                    style={{
                      background: active ? 'hsl(var(--sv-hover))' : 'transparent',
                      cursor: 'default',
                    }}
                  >
                    <div className="text-[14px]" style={{ color: 'hsl(var(--sv-ink))', fontFamily: 'var(--sv-serif)' }}>
                      {item.proposal_type === 'contact'
                        ? (item.payload_json as any)?.name ?? item.title
                        : item.body || item.title}
                    </div>
                    {item.entityName && (
                      <div className="text-[12px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
                        {item.entityName}
                      </div>
                    )}
                    {active && (
                      <div className="mt-2 flex items-center gap-3 text-[12px]" style={{ color: 'hsl(var(--sv-muted))' }}>
                        <button
                          onClick={() => confirm(item)}
                          disabled={busyId === item.id}
                          style={{
                            background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
                            color: 'hsl(var(--sv-clay))',
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => reject(item)}
                          disabled={busyId === item.id}
                          style={{
                            background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
                            color: 'hsl(var(--sv-muted))',
                          }}
                        >
                          Reject
                        </button>
                        <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                          ↵ confirm · ⌫ reject
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
