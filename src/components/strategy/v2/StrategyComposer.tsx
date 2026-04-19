/**
 * StrategyComposer — single-line growing composer.
 *
 * Locked rules:
 *   - hairline border, 6px radius, 56px tall when empty
 *   - one icon (send arrow) at 60% opacity in the corner
 *   - no toolbar, no chips, no model picker, no attach button
 *   - Enter sends; Shift+Enter inserts newline
 *   - max-w-760, lives at the bottom of the canvas region
 *
 * Phase 3 additions:
 *   - emits onSlashChange(query|null) when text begins with "/" — drives SlashMenu
 *   - exposes its bounding rect via onRectChange so SlashMenu can anchor
 *   - clearSlash() public method to wipe the slash query after a verb commits
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';

interface Props {
  disabled?: boolean;
  placeholder?: string;
  serifPlaceholder?: boolean;
  onSend: (text: string) => void;
  /** Called whenever the slash-query changes. null = no slash mode. */
  onSlashChange?: (query: string | null) => void;
  /** Called with the wrapper rect whenever it changes (for anchoring SlashMenu). */
  onRectChange?: (rect: DOMRect | null) => void;
}

export interface StrategyComposerHandle {
  focus: () => void;
  clearSlash: () => void;
}

export const StrategyComposer = forwardRef<HTMLTextAreaElement, Props>(function StrategyComposer(
  { disabled, placeholder = 'Message…', serifPlaceholder = false, onSend, onSlashChange, onRectChange }, ref
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');

  useImperativeHandle(ref, () => {
    const ta = taRef.current as HTMLTextAreaElement & { clearSlash?: () => void };
    if (ta) {
      ta.clearSlash = () => {
        setValue('');
        onSlashChange?.(null);
      };
    }
    return ta;
  });

  // Auto-resize the textarea up to a soft cap
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [value]);

  // Detect slash-mode (must start with "/", no embedded newlines, no inner spaces past slash word)
  useEffect(() => {
    if (value.startsWith('/') && !value.includes('\n')) {
      // The query is the first whitespace-bounded word (so "/upload extra" still treats "upload" as the query
      // but we keep the menu open until the user types Enter or Esc)
      onSlashChange?.(value);
    } else {
      onSlashChange?.(null);
    }
  }, [value, onSlashChange]);

  // Publish rect for anchoring
  const publishRect = useCallback(() => {
    if (!onRectChange) return;
    onRectChange(wrapRef.current?.getBoundingClientRect() ?? null);
  }, [onRectChange]);

  useLayoutEffect(() => { publishRect(); }, [publishRect, value]);
  useEffect(() => {
    if (!onRectChange) return;
    const onResize = () => publishRect();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [onRectChange, publishRect]);

  const handleSend = () => {
    const v = value.trim();
    if (!v || disabled) return;
    setValue('');
    onSlashChange?.(null);
    onSend(v);
  };

  return (
    <div
      className="w-full px-6 pb-8 pt-2"
      style={{
        background: 'hsl(var(--sv-paper))',
      }}
    >
      <div
        ref={wrapRef}
        className="mx-auto relative"
        style={{
          maxWidth: 760,
          minHeight: 56,
          background: 'hsl(var(--sv-paper))',
          display: 'flex',
          alignItems: 'flex-end',
          padding: '12px 14px',
        }}
      >
        <textarea
          ref={taRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            // Don't intercept Enter while slash-menu is open — SlashMenu handles it.
            if (e.key === 'Enter' && !e.shiftKey && !value.startsWith('/')) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          placeholder={placeholder}
          disabled={disabled}
          className={`flex-1 bg-transparent border-0 outline-none resize-none leading-[1.5] ${serifPlaceholder && !value ? 'text-[17px]' : 'text-[15px]'}`}
          style={{
            color: 'hsl(var(--sv-ink))',
            fontFamily: serifPlaceholder && !value ? 'var(--sv-serif)' : 'var(--sv-sans)',
            paddingRight: 40,
            maxHeight: 240,
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          className="absolute"
          style={{
            right: 10,
            bottom: 10,
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: value.trim() && !disabled ? 1 : 0.4,
            color: value.trim() && !disabled ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-muted))',
            transition: 'opacity 120ms ease, color 120ms ease',
          }}
          aria-label="Send"
          title="Send (Enter)"
        >
          <ArrowUp size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
});
