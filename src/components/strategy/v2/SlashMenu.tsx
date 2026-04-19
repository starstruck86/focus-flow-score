/**
 * SlashMenu — inline command verbs anchored above the composer.
 *
 * Locked Phase 3 brief:
 *   - opens when composer text begins with "/"
 *   - quiet flat list, no icons, no descriptions overflowing
 *   - keyboard-only by default: ↑/↓, Enter, Esc
 *   - 280px wide, sv-e1 elevation, anchored to the composer's top edge
 *   - selecting a verb fires onPick(verb) and clears the composer's slash query
 *   - composer remains focused throughout — never steals focus
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type SlashVerb =
  | 'upload'
  | 'branch'
  | 'link'
  | 'promote-last';

interface VerbDef {
  key: SlashVerb;
  label: string;
  shortcut: string;
}

const VERBS: VerbDef[] = [
  { key: 'upload',       label: 'Upload file',       shortcut: '⌘U' },
  { key: 'branch',       label: 'Branch thought',    shortcut: '⌘B' },
  { key: 'link',         label: 'Link to account',   shortcut: '⌘L' },
  { key: 'promote-last', label: 'Promote insight',   shortcut: '⌘S' },
];

interface Props {
  /** The current composer query — including leading slash, e.g. "/upl". */
  query: string | null;
  /** The composer's bounding rect; the menu anchors to its top edge. */
  anchorRect: DOMRect | null;
  onPick: (verb: SlashVerb) => void;
  onClose: () => void;
}

export function SlashMenu({ query, anchorRect, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return VERBS;
    const needle = query.replace(/^\//, '').toLowerCase().trim();
    if (!needle) return VERBS;
    return VERBS.filter(v => v.key.includes(needle) || v.label.toLowerCase().includes(needle.replace(/\s+/g, '')));
  }, [query]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  useEffect(() => {
    if (query === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const v = filtered[activeIdx];
        if (v) onPick(v.key);
      }
    };
    // Capture phase so we beat the composer's own Enter handler
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [query, filtered, activeIdx, onPick, onClose]);

  if (query === null || !anchorRect) return null;

  const top = anchorRect.top - 8; // 8px gap above composer
  const left = anchorRect.left + 24;
  const width = 320;

  return createPortal(
    <div className="strategy-v2" style={{ position: 'fixed', inset: 0, zIndex: 78, pointerEvents: 'none' }}>
      <div
        ref={ref}
        role="listbox"
        aria-label="Commands"
        className="sv-e1 sv-enter-fade"
        style={{
          position: 'absolute',
          top,
          left,
          transform: 'translateY(-100%)',
          width,
          maxHeight: 320,
          background: 'hsl(var(--sv-paper))',
          border: '1px solid hsl(var(--sv-hairline))',
          borderRadius: 'var(--sv-radius-surface)',
          overflow: 'hidden',
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="px-4 pt-2.5 pb-1 text-[11px]" style={{ color: 'hsl(var(--sv-muted))' }}>
          Commands
        </div>
        <div style={{ overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div className="px-4 py-2 text-[13px]" style={{ color: 'hsl(var(--sv-muted))' }}>
              No matches.
            </div>
          )}
          {filtered.map((v, i) => {
            const active = i === activeIdx;
            return (
              <button
                key={v.key}
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => { e.preventDefault(); onPick(v.key); }}
                className="w-full text-left px-4 py-1.5 flex items-center justify-between gap-3"
                style={{
                  background: active ? 'hsl(var(--sv-hover))' : 'transparent',
                  border: 0,
                  cursor: 'default',
                }}
              >
                <span className="text-[13px]" style={{ color: 'hsl(var(--sv-ink))', fontFamily: 'var(--sv-sans)' }}>
                  {v.label}
                </span>
                <span className="text-[11px] font-mono ml-3" style={{ color: 'hsl(var(--sv-muted))' }}>
                  {v.shortcut}
                </span>
              </button>
            );
          })}
        </div>
        <div
          className="px-4 py-1.5 text-[11px]"
          style={{
            color: 'hsl(var(--sv-muted))',
            borderTop: '1px solid hsl(var(--sv-hairline))',
          }}
        >
          ↑↓ navigate · ↵ run · esc close
        </div>
      </div>
    </div>,
    document.body,
  );
}
