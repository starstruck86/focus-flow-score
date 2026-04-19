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
 * Phase 3 (keyboard spine):
 *   ⌘L           → open Link Picker (link / relink thread)
 *   ⌘B           → branch from selection if any, else from current thread
 *   ⌘⇧O          → open linked Account
 *   ⌘⇧D          → open linked Opportunity
 *   ⌘⇧N          → new thread
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
  onOpenLinkPicker: () => void;
  onBranch: () => void;
  onOpenLinkedAccount: () => void;
  onOpenLinkedOpportunity: () => void;
  onNewThread: () => void;
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
  onOpenLinkPicker,
  onBranch,
  onOpenLinkedAccount,
  onOpenLinkedOpportunity,
  onNewThread,
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

      // ⌘L — Link Picker
      if (meta && !shift && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        onOpenLinkPicker();
        return;
      }

      // ⌘B — Branch
      if (meta && !shift && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        onBranch();
        return;
      }

      // ⌘⇧O — Open linked Account
      if (meta && shift && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        onOpenLinkedAccount();
        return;
      }

      // ⌘⇧D — Open linked Opportunity
      if (meta && shift && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        onOpenLinkedOpportunity();
        return;
      }

      // ⌘⇧N — New thread
      if (meta && shift && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        onNewThread();
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
    onSavePrimary, onSavePick, onPromote,
    onOpenLinkPicker, onBranch, onOpenLinkedAccount, onOpenLinkedOpportunity, onNewThread,
    onEscape, composerRef,
  ]);
}
