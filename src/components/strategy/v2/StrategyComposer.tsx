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
import { ArrowUp, Sparkles } from 'lucide-react';

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
  /** Easy Prompt: called when the user taps the Expand affordance. Receives current draft, returns expanded text (or original). */
  onExpandPrompt?: (draft: string) => Promise<string>;
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
  { disabled, placeholder = 'Message…', serifPlaceholder = false, onSend, onSlashChange, onRectChange, onAttachFiles, momentumHint, onExpandPrompt }, ref
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  const [expanding, setExpanding] = useState(false);
  const [preExpandValue, setPreExpandValue] = useState<string | null>(null);

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
      ta.insertText = (text: string) => {
        const normalized = text.replace(/\s+$/, '') + ' ';
        setValue(normalized);
        onSlashChange?.(null);
        requestAnimationFrame(() => {
          const el = taRef.current;
          if (!el) return;
          el.focus();
          const end = el.value.length;
          try { el.setSelectionRange(end, end); } catch { /* ignore */ }
        });
      };
      ta.getValue = () => value;
      ta.setValue = (text: string) => {
        setValue(text);
        if (!text.startsWith('/')) onSlashChange?.(null);
      };
    }
    return ta;
  });

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    if (!value) {
      el.style.height = '24px';
      return;
    }
    el.style.height = 'auto';
    el.style.height = Math.min(Math.max(el.scrollHeight, 24), 120) + 'px';
  }, [value, serifPlaceholder]);

  useEffect(() => {
    if (value.startsWith('/') && !value.includes('\n')) {
      onSlashChange?.(value);
    } else {
      onSlashChange?.(null);
    }
  }, [value, onSlashChange]);

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
    setPreExpandValue(null);
    onSlashChange?.(null);
    onSend(v);
  };

  const handleExpand = useCallback(async () => {
    const draft = value.trim();
    if (!draft || expanding || disabled || !onExpandPrompt) return;
    setExpanding(true);
    const snapshot = value;
    try {
      const expanded = await onExpandPrompt(draft);
      if (expanded && expanded.trim() && expanded.trim() !== draft) {
        setPreExpandValue(snapshot);
        setValue(expanded);
        requestAnimationFrame(() => {
          const el = taRef.current;
          if (el) { el.focus(); const end = el.value.length; try { el.setSelectionRange(end, end); } catch { /* ignore */ } }
        });
      }
    } finally {
      setExpanding(false);
    }
  }, [value, expanding, disabled, onExpandPrompt]);

  const handleUndoExpand = useCallback(() => {
    if (preExpandValue === null) return;
    setValue(preExpandValue);
    setPreExpandValue(null);
    requestAnimationFrame(() => taRef.current?.focus());
  }, [preExpandValue]);

  const hasContextHint = typeof momentumHint === 'string' && momentumHint.length > 0;
  const showEmptyHint = !hasContextHint && serifPlaceholder && !value;
  const showTypingHint = !hasContextHint && value.length > 0 && !value.startsWith('/');

  const showExpand = !!onExpandPrompt && value.trim().split(/\s+/).filter(Boolean).length >= 3 && !value.startsWith('/');

  return (
    <div
      className="w-full px-4 sm:px-6 pt-1 pb-[calc(env(safe-area-inset-bottom)+8px)] sm:pb-3 sticky bottom-0 z-30 sm:static shrink-0"
      style={{
        background: 'hsl(var(--sv-paper))',
        borderTop: '1px solid hsl(var(--sv-hairline))',
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
          padding: '10px 12px',
        }}
      >
        <textarea
          ref={taRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !value.startsWith('/')) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck
          inputMode="text"
          enterKeyHint="send"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className={`flex-1 bg-transparent border-0 outline-none resize-none leading-[1.5] ${serifPlaceholder && !value ? 'text-[15px] sm:text-[17px]' : 'text-[15px]'}`}
          style={{
            color: 'hsl(var(--sv-ink))',
            fontFamily: serifPlaceholder && !value ? 'var(--sv-serif)' : 'var(--sv-sans)',
            paddingLeft: onAttachFiles ? 32 : 0,
            paddingRight: showExpand ? 130 : 40,
            maxHeight: 120,
            overflowY: 'auto',
            transition: 'padding-left 120ms ease, padding-right 120ms ease',
          }}
        />
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
        {showExpand && (
          <button
            type="button"
            onClick={handleExpand}
            disabled={expanding || disabled}
            className="absolute sv-hover-bg rounded-[4px] flex items-center justify-center gap-1 px-1.5"
            style={{
              right: 44,
              bottom: 10,
              height: 22,
              color: 'hsl(var(--sv-clay))',
              opacity: expanding ? 0.5 : 0.85,
              fontSize: 11,
              fontFamily: 'var(--sv-sans)',
            }}
            aria-label="Expand prompt"
            title="Expand into a full Branch instruction"
            data-testid="composer-expand"
          >
            <Sparkles size={13} strokeWidth={1.75} className={expanding ? 'animate-pulse' : ''} />
            {expanding ? 'Expanding…' : 'Expand'}
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
      <div
        className="mx-auto px-[14px] text-[12px] leading-none"
        style={{
          maxWidth: 860,
          color: 'hsl(var(--sv-muted))',
          minHeight: 14,
          marginTop: 6,
          opacity: (preExpandValue !== null || hasContextHint || showEmptyHint || showTypingHint) ? 0.75 : 0,
          fontFamily: 'var(--sv-sans)',
        }}
        aria-hidden={!(preExpandValue !== null || hasContextHint || showEmptyHint || showTypingHint)}
      >
        {preExpandValue !== null ? (
          <span>
            Expanded ·{' '}
            <button
              type="button"
              onClick={handleUndoExpand}
              className="underline"
              style={{ color: 'hsl(var(--sv-clay))' }}
            >
              Undo
            </button>
            {' '}· edit freely, then Enter to send
          </span>
        ) : (
          <>
            {hasContextHint && <>{momentumHint}</>}
            {showEmptyHint && <>Type to start · / for actions · ⌘K to switch</>}
            {showTypingHint && <>⌘S save · / actions · ⌘K switch</>}
          </>
        )}
      </div>
    </div>
  );
});
