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
  /** Phase 1.5: open the file picker (same as /upload). */
  onAttachFiles?: () => void;
  /**
   * Context-aware momentum hint shown beneath the composer.
   * Overrides the default static hint when provided. Pass null to hide it.
   * Examples: "Ask a follow-up · / to revise · ⌘S save"
   */
  momentumHint?: string | null;
}

export interface StrategyComposerHandle {
  focus: () => void;
  clearSlash: () => void;
  insertText: (text: string) => void;
  /** Read current draft text (used to preserve per-surface drafts). */
  getValue: () => string;
  /** Replace current draft text (used when switching surfaces). */
  setValue: (text: string) => void;
}

export const StrategyComposer = forwardRef<HTMLTextAreaElement, Props>(function StrategyComposer(
  { disabled, placeholder = 'Message…', serifPlaceholder = false, onSend, onSlashChange, onRectChange, onAttachFiles, momentumHint }, ref
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');

  useImperativeHandle(ref, () => {
    const ta = taRef.current as HTMLTextAreaElement & {
      clearSlash?: () => void;
      insertText?: (text: string) => void;
      getValue?: () => string;
      setValue?: (text: string) => void;
    };
    if (ta) {
      ta.clearSlash = () => {
        setValue('');
        onSlashChange?.(null);
      };
      // Replace any in-progress slash query with `text` and refocus.
      // Normalize trailing whitespace so library insertion leaves exactly
      // one trailing space — never zero, never two.
      ta.insertText = (text: string) => {
        const normalized = text.replace(/\s+$/, '') + ' ';
        setValue(normalized);
        onSlashChange?.(null);
        // Focus + place caret at end after React commits the new value.
        requestAnimationFrame(() => {
          const el = taRef.current;
          if (!el) return;
          el.focus();
          const end = el.value.length;
          try { el.setSelectionRange(end, end); } catch { /* ignore */ }
        });
      };
      // Per-surface draft persistence — read the live value without forcing
      // a re-render, and replace it silently when switching surfaces.
      ta.getValue = () => value;
      ta.setValue = (text: string) => {
        setValue(text);
        // Don't trigger slash mode for restored drafts.
        if (!text.startsWith('/')) onSlashChange?.(null);
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

  // Phase 1.6 — discoverability hints
  // Context hint (e.g. "Ask a follow-up · / to revise") wins over the
  // generic empty/typing copy when the parent supplies one.
  const hasContextHint = typeof momentumHint === 'string' && momentumHint.length > 0;
  const showEmptyHint = !hasContextHint && serifPlaceholder && !value;
  const showTypingHint = !hasContextHint && value.length > 0 && !value.startsWith('/');

  return (
    <div
      className="w-full px-6 pt-1 pb-[calc(env(safe-area-inset-bottom)+96px)] sm:pb-3"
      style={{
        background: 'hsl(var(--sv-paper))',
      }}
    >
      <div
        ref={wrapRef}
        className="mx-auto relative"
        style={{
          maxWidth: 860,
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
            paddingLeft: onAttachFiles ? 32 : 0,
            paddingRight: 40,
            maxHeight: 240,
            transition: 'padding-left 120ms ease',
          }}
        />
        {/* Attach affordance — ALWAYS visible while composing so users can add
            files mid-thought. Compact icon button (no text) once typing begins. */}
        {onAttachFiles && (
          <button
            type="button"
            onClick={onAttachFiles}
            disabled={disabled}
            className="absolute sv-hover-bg rounded-[4px] flex items-center justify-center"
            style={{
              left: 10,
              bottom: 10,
              width: 22,
              height: 22,
              color: 'hsl(var(--sv-muted))',
              opacity: 0.75,
            }}
            aria-label="Attach files"
            title="Attach files"
            data-testid="composer-attach"
          >
            <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 400 }}>+</span>
          </button>
        )}
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
      {/* Phase 1.6 — discoverability hint line. Three states: context | empty | typing. */}
      <div
        className="mx-auto px-[14px] text-[12px] leading-none"
        style={{
          maxWidth: 860,
          color: 'hsl(var(--sv-muted))',
          minHeight: 14,
          marginTop: 6,
          opacity: hasContextHint || showEmptyHint || showTypingHint ? 0.75 : 0,
          fontFamily: 'var(--sv-sans)',
        }}
        aria-hidden={!(hasContextHint || showEmptyHint || showTypingHint)}
      >
        {hasContextHint && <>{momentumHint}</>}
        {showEmptyHint && <>Type to start · / for actions · ⌘K to switch</>}
        {showTypingHint && <>⌘S save · / actions · ⌘K switch</>}
      </div>
    </div>
  );
});
