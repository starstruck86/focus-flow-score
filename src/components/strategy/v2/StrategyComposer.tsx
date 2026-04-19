/**
 * StrategyComposer — single-line growing composer.
 *
 * Locked rules:
 *   - hairline border, 6px radius, 56px tall when empty
 *   - one icon (send arrow) at 60% opacity in the corner
 *   - no toolbar, no chips, no model picker, no attach button
 *   - Enter sends; Shift+Enter inserts newline
 *   - max-w-760, lives at the bottom of the canvas region
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';

interface Props {
  disabled?: boolean;
  placeholder?: string;
  serifPlaceholder?: boolean;
  onSend: (text: string) => void;
}

export interface StrategyComposerHandle {
  focus: () => void;
}

export const StrategyComposer = forwardRef<HTMLTextAreaElement, Props>(function StrategyComposer(
  { disabled, placeholder = 'Message…', serifPlaceholder = false, onSend }, ref
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');

  useImperativeHandle(ref, () => taRef.current as HTMLTextAreaElement);

  // Auto-resize the textarea up to a soft cap
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [value]);

  const handleSend = () => {
    const v = value.trim();
    if (!v || disabled) return;
    setValue('');
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
        className="mx-auto relative"
        style={{
          maxWidth: 760,
          minHeight: 56,
          borderRadius: 'var(--sv-radius-composer)',
          border: '1px solid hsl(var(--sv-hairline))',
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
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 bg-transparent border-0 outline-none resize-none text-[15px] leading-[1.5]"
          style={{
            color: 'hsl(var(--sv-ink))',
            fontFamily: 'var(--sv-sans)',
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
