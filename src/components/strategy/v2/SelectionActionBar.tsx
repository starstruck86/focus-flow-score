/**
 * SelectionActionBar — floats adjacent to a live text selection.
 *
 * Locked Phase 2 brief:
 *   - 32px tall, 8px radius, sv-e1 elevation only
 *   - paper-tone background (matches canvas)
 *   - text-only buttons, 13px, no icons by default
 *   - max 4 visible actions + ⋯ overflow
 *   - never moves the canvas, never dims the page
 *   - click = immediate action (no modal, no confirmation)
 *   - selection remains visible while bar is up
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StrategySelection } from '@/hooks/strategy/useStrategySelection';

export type ActionKey = 'account' | 'opportunity' | 'research' | 'crm_contact' | 'pick_scope';

interface Props {
  selection: StrategySelection | null;
  /** True when current thread is linked to an opportunity. */
  hasOpportunity: boolean;
  /** True when current thread is linked to an account. */
  hasAccount: boolean;
  onAction: (key: ActionKey) => void;
  /** Called when the bar wants to be dismissed (e.g. external click). */
  onDismiss: () => void;
}

/** Estimate whether a selection looks person-like (for showing Promote → Contact). */
function looksPersonLike(text: string): boolean {
  const t = text.trim();
  if (t.length > 200) return false;
  // Two consecutive Capitalized tokens, e.g. "Matthew Pertgen"
  return /\b[A-Z][a-z]{1,}\s+[A-Z][a-z]{1,}/.test(t);
}

export function SelectionActionBar({ selection, hasOpportunity, hasAccount, onAction, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [showOverflow, setShowOverflow] = useState(false);

  // Position above the selection, clamped to viewport
  useEffect(() => {
    if (!selection) {
      setPos(null);
      setShowOverflow(false);
      return;
    }
    const r = selection.rect;
    const barWidth = ref.current?.offsetWidth ?? 360;
    const barHeight = 32;
    let top = r.top - barHeight - 10;
    let left = r.left + r.width / 2 - barWidth / 2;
    // Clamp horizontally
    const margin = 12;
    if (left < margin) left = margin;
    if (left + barWidth > window.innerWidth - margin) left = window.innerWidth - barWidth - margin;
    // If above doesn't fit, place below
    if (top < margin) top = r.bottom + 10;
    setPos({ top, left });
  }, [selection]);

  // Click outside dismisses (but clicking the bar itself does not)
  useEffect(() => {
    if (!selection) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && ref.current.contains(e.target as Node)) return;
      // Don't dismiss if click started inside a selectable region (user is reselecting)
      const target = e.target as HTMLElement;
      if (target.closest && target.closest('[data-strategy-selectable]')) return;
      onDismiss();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [selection, onDismiss]);

  const showPersonAction = useMemo(() => selection ? looksPersonLike(selection.text) : false, [selection]);

  if (!selection || !pos) return null;

  // Action ordering (max 4 visible + overflow):
  //   - if linked to opp: Save→Opp, Save→Account, Save as Research, [Promote→Contact?]
  //   - if linked to account only: Save→Account, Save as Research, [Promote→Contact?], pick scope
  //   - if freeform: Save as Research, pick scope
  const actions: { key: ActionKey; label: string; primary?: boolean }[] = [];
  if (hasOpportunity) {
    actions.push({ key: 'opportunity', label: 'Save → Opp', primary: true });
    actions.push({ key: 'account', label: 'Save → Account' });
  } else if (hasAccount) {
    actions.push({ key: 'account', label: 'Save → Account', primary: true });
  }
  actions.push({ key: 'research', label: 'Save as Research' });
  if (showPersonAction && hasAccount) {
    actions.push({ key: 'crm_contact', label: 'Promote → Contact' });
  }

  const visible = actions.slice(0, 4);
  const overflow = actions.slice(4);
  const canPickScope = !hasOpportunity || !hasAccount;

  return createPortal(
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selection actions"
      className="strategy-v2 sv-e1 sv-enter-fade"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 14px',
        borderRadius: 8,
        background: 'hsl(var(--sv-paper))',
        border: '1px solid hsl(var(--sv-hairline))',
        zIndex: 80,
        whiteSpace: 'nowrap',
      }}
    >
      {visible.map((a, i) => (
        <button
          key={a.key}
          onClick={() => onAction(a.key)}
          className="text-[13px]"
          style={{
            background: 'transparent',
            border: 0,
            padding: 0,
            color: a.primary ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-ink))',
            cursor: 'pointer',
            fontFamily: 'var(--sv-sans)',
            fontWeight: a.primary ? 500 : 400,
          }}
        >
          {a.label}
        </button>
      ))}
      {(overflow.length > 0 || canPickScope) && (
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowOverflow(o => !o)}
            aria-label="More actions"
            className="text-[13px]"
            style={{
              background: 'transparent',
              border: 0,
              padding: '0 2px',
              color: 'hsl(var(--sv-muted))',
              cursor: 'pointer',
              fontFamily: 'var(--sv-sans)',
            }}
          >
            ⋯
          </button>
          {showOverflow && (
            <div
              className="sv-e1"
              style={{
                position: 'absolute',
                top: 28,
                right: 0,
                background: 'hsl(var(--sv-paper))',
                border: '1px solid hsl(var(--sv-hairline))',
                borderRadius: 8,
                padding: '4px 0',
                minWidth: 180,
              }}
            >
              {overflow.map(a => (
                <button
                  key={a.key}
                  onClick={() => { setShowOverflow(false); onAction(a.key); }}
                  className="w-full text-left text-[13px] sv-hover-bg"
                  style={{
                    background: 'transparent',
                    border: 0,
                    padding: '6px 12px',
                    color: 'hsl(var(--sv-ink))',
                    cursor: 'pointer',
                    fontFamily: 'var(--sv-sans)',
                  }}
                >
                  {a.label}
                </button>
              ))}
              {canPickScope && (
                <button
                  onClick={() => { setShowOverflow(false); onAction('pick_scope'); }}
                  className="w-full text-left text-[13px] sv-hover-bg"
                  style={{
                    background: 'transparent',
                    border: 0,
                    padding: '6px 12px',
                    color: 'hsl(var(--sv-ink))',
                    cursor: 'pointer',
                    fontFamily: 'var(--sv-sans)',
                  }}
                >
                  Save to…
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
