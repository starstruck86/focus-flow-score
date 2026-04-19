/**
 * LinkPicker — popover anchored to the EntityChip. Lets the user re-link the
 * thread to an Account or Opportunity, or unlink to freeform.
 *
 * Locked rules:
 *   - no separate "relink" button anywhere; this is summoned from the chip
 *   - flat list, no tabs, no filter chips, no icons
 *   - 280px wide, sv-e1 elevation, anchored to chip with 4px gap
 *   - Esc to close
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface LinkPickerSelection {
  kind: 'account' | 'opportunity' | 'freeform';
  id?: string;
  name?: string;
}

interface Props {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement>;
  currentEntityKind: 'account' | 'opportunity' | null;
  onClose: () => void;
  onPick: (sel: LinkPickerSelection) => void;
}

interface Row {
  id: string;
  name: string;
  kind: 'account' | 'opportunity';
}

export function LinkPicker({ open, anchorRef, onClose, onPick }: Props) {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position anchored to the chip
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
  }, [open, anchorRef]);

  // Focus on open
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Load entities once when opened
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    (async () => {
      const [accts, opps] = await Promise.all([
        supabase.from('accounts').select('id, name').eq('user_id', user.id).is('deleted_at', null).order('name').limit(40),
        supabase.from('opportunities').select('id, name').eq('user_id', user.id).order('name').limit(40),
      ]);
      if (cancelled) return;
      const merged: Row[] = [
        ...((accts.data ?? []) as { id: string; name: string }[]).map(a => ({ id: a.id, name: a.name, kind: 'account' as const })),
        ...((opps.data ?? []) as { id: string; name: string }[]).map(o => ({ id: o.id, name: o.name, kind: 'opportunity' as const })),
      ];
      setRows(merged);
    })();
    return () => { cancelled = true; };
  }, [open, user]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows.slice(0, 12);
    const needle = q.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(needle)).slice(0, 12);
  }, [q, rows]);

  if (!open || !pos) return null;

  return createPortal(
    <>
      {/* invisible click-catcher to dismiss */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 60 }}
      />
      <div
        role="dialog"
        aria-label="Link thread to entity"
        className="sv-e1 sv-enter-fade strategy-v2"
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          width: 280,
          zIndex: 61,
          borderRadius: 'var(--sv-radius-surface)',
          border: '1px solid hsl(var(--sv-hairline))',
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search accounts, opportunities…"
          className="w-full h-9 px-3 bg-transparent border-0 outline-none text-[13px]"
          style={{
            borderBottom: '1px solid hsl(var(--sv-hairline))',
            color: 'hsl(var(--sv-ink))',
          }}
        />
        <div className="max-h-[280px] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-[12px]" style={{ color: 'hsl(var(--sv-muted))' }}>
              No matches.
            </div>
          )}
          {filtered.map(r => (
            <button
              key={`${r.kind}-${r.id}`}
              onClick={() => onPick({ kind: r.kind, id: r.id, name: r.name })}
              className="w-full text-left px-3 py-1.5 sv-hover-bg flex items-center justify-between gap-3"
            >
              <span className="text-[13px] truncate" style={{ color: 'hsl(var(--sv-ink))' }}>{r.name}</span>
              <span className="text-[11px] shrink-0" style={{ color: 'hsl(var(--sv-muted))' }}>
                {r.kind === 'account' ? 'Account' : 'Opportunity'}
              </span>
            </button>
          ))}
          <div style={{ borderTop: '1px solid hsl(var(--sv-hairline))', marginTop: 4 }} />
          <button
            onClick={() => onPick({ kind: 'freeform' })}
            className="w-full text-left px-3 py-1.5 sv-hover-bg text-[13px]"
            style={{ color: 'hsl(var(--sv-muted))' }}
          >
            Unlink — make freeform
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
