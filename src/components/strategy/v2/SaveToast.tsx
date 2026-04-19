/**
 * SaveToast — quiet inline confirmation for a save gesture.
 *
 * Locked Phase 2 brief:
 *   - one line, paper tone, sv-e1 elevation
 *   - Undo + Open as inline links
 *   - 8 second auto-dismiss (per brief)
 *   - human language only — never "proposal", "promoted", "confirmed"
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface SaveToastState {
  id: string;
  message: string;
  openPath: string | null;
  undo?: () => Promise<void>;
  /** When true, render in muted error tone but still as a calm one-liner. */
  isError?: boolean;
}

interface Props {
  toast: SaveToastState | null;
  onDismiss: () => void;
  onOpen: (path: string) => void;
}

export function SaveToast({ toast, onDismiss, onOpen }: Props) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="strategy-v2 sv-e1 sv-enter-fade"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 90,
        background: 'hsl(var(--sv-paper))',
        border: '1px solid hsl(var(--sv-hairline))',
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        maxWidth: 'calc(100vw - 48px)',
      }}
    >
      <span
        className="text-[13px]"
        style={{
          color: toast.isError ? 'hsl(var(--sv-muted))' : 'hsl(var(--sv-ink))',
          fontFamily: 'var(--sv-sans)',
        }}
      >
        {toast.message}
      </span>
      {toast.undo && !toast.isError && (
        <button
          onClick={async () => { await toast.undo!(); onDismiss(); }}
          className="text-[13px]"
          style={{
            background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
            color: 'hsl(var(--sv-muted))',
          }}
        >
          Undo
        </button>
      )}
      {toast.openPath && !toast.isError && (
        <button
          onClick={() => onOpen(toast.openPath!)}
          className="text-[13px]"
          style={{
            background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
            color: 'hsl(var(--sv-clay))',
          }}
        >
          Open
        </button>
      )}
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-[13px]"
        style={{
          background: 'transparent', border: 0, padding: '0 0 0 4px', cursor: 'pointer',
          color: 'hsl(var(--sv-muted))', opacity: 0.5,
        }}
      >
        ×
      </button>
    </div>,
    document.body,
  );
}
