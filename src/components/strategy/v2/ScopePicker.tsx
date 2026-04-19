/**
 * ScopePicker — minimal account/opportunity picker reused by ⌘⇧S and the
 * "Save to…" overflow. Same visual grammar as LinkPicker (Phase 1) so the
 * user feels the same surface.
 *
 * No labels like "Select target", no form chrome, no explanation text.
 * One click = done.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface ScopePick {
  kind: 'account' | 'opportunity';
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  /** Anchor rect in viewport coords (usually the selection rect). */
  anchorRect: DOMRect | null;
  onClose: () => void;
  onPick: (pick: ScopePick) => void;
}

interface Row {
  id: string;
  name: string;
  kind: 'account' | 'opportunity';
}

export function ScopePicker({ open, anchorRect, onClose, onPick }: Props) {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !anchorRect) return;
    // Place just below the anchor, clamped
    const w = 280;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 8;
    const margin = 12;
    if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin;
    if (left < margin) left = margin;
    if (top + 280 > window.innerHeight - margin) top = Math.max(margin, anchorRect.top - 280 - 8);
    setPos({ top, left });
  }, [open, anchorRect]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActiveIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

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

  const filtered = useMemo(() => {
    if (!q.trim()) return rows.slice(0, 12);
    const needle = q.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(needle)).slice(0, 12);
  }, [q, rows]);

  useEffect(() => { setActiveIdx(0); }, [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const r = filtered[activeIdx];
        if (r) onPick(r);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, activeIdx, onClose, onPick]);

  if (!open || !pos) return null;

  return createPortal(
    <div className="strategy-v2" style={{ position: 'fixed', inset: 0, zIndex: 85, background: 'transparent', pointerEvents: 'none' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'transparent', pointerEvents: 'auto' }} />
      <div
        role="dialog"
        aria-label="Save to"
        className="sv-e1 sv-enter-fade"
        style={{
          position: 'absolute',
          top: pos.top,
          left: pos.left,
          width: 280,
          background: 'hsl(var(--sv-paper))',
          border: '1px solid hsl(var(--sv-hairline))',
          borderRadius: 'var(--sv-radius-surface)',
          overflow: 'hidden',
          pointerEvents: 'auto',
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
        <div className="max-h-[260px] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-[12px]" style={{ color: 'hsl(var(--sv-muted))' }}>
              No matches.
            </div>
          )}
          {filtered.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}`}
              onClick={() => onPick(r)}
              onMouseEnter={() => setActiveIdx(i)}
              className="w-full text-left px-3 py-1.5 flex items-center justify-between gap-3"
              style={{ background: i === activeIdx ? 'hsl(var(--sv-hover))' : 'transparent' }}
            >
              <span className="text-[13px] truncate" style={{ color: 'hsl(var(--sv-ink))' }}>{r.name}</span>
              <span className="text-[11px] shrink-0" style={{ color: 'hsl(var(--sv-muted))' }}>
                {r.kind === 'account' ? 'Account' : 'Opportunity'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
