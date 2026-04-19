/**
 * useStrategyHotkeys — keyboard verbs for the Strategy workspace.
 *
 * Phase 1:
 *   ⌘K / Ctrl+K  → toggle Switcher
 *   ⌘I / Ctrl+I  → toggle Inspector
 *   Esc          → close whichever summoned surface is open
 *   /            → focus composer (only if no input is already focused)
 *
 * Phase 2 (gesture layer):
 *   ⌘S / Ctrl+S  → save selection to primary scope
 *   ⌘⇧S          → save selection and choose destination
 *   ⌘⇧P          → promote actions for current selection
 *   ⌘. / Ctrl+.  → toggle PromotionsInbox
 *
 * The hook is presentation-agnostic — it only flips state and routes saves.
 */
import { useEffect } from 'react';

interface Opts {
  onToggleSwitcher: () => void;
  onToggleInspector: () => void;
  onToggleInbox: () => void;
  onSavePrimary: () => void;
  onSavePick: () => void;
  onPromote: () => void;
  onEscape: () => void;
  composerRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement>;
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
}

export function useStrategyHotkeys({
  onToggleSwitcher,
  onToggleInspector,
  onToggleInbox,
  onSavePrimary,
  onSavePick,
  onPromote,
  onEscape,
  composerRef,
}: Opts) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;

      // ⌘K / Ctrl+K — Switcher
      if (meta && !shift && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        onToggleSwitcher();
        return;
      }

      // ⌘I / Ctrl+I — Inspector
      if (meta && !shift && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        onToggleInspector();
        return;
      }

      // ⌘. / Ctrl+. — Promotions Inbox
      if (meta && !shift && e.key === '.') {
        e.preventDefault();
        onToggleInbox();
        return;
      }

      // ⌘⇧S — Save with scope picker
      if (meta && shift && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        onSavePick();
        return;
      }

      // ⌘S — Save to primary scope
      if (meta && !shift && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        onSavePrimary();
        return;
      }

      // ⌘⇧P — Promote actions
      if (meta && shift && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        onPromote();
        return;
      }

      // Esc
      if (e.key === 'Escape') {
        onEscape();
        return;
      }

      // "/" focuses composer if not already typing somewhere
      if (e.key === '/' && !meta && !isEditableTarget(e.target)) {
        e.preventDefault();
        composerRef.current?.focus();
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    onToggleSwitcher, onToggleInspector, onToggleInbox,
    onSavePrimary, onSavePick, onPromote, onEscape, composerRef,
  ]);
}
