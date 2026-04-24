/**
 * StrategyShell — Phase 1+2+3 two-region shell.
 *
 *   ┌─ TopBar ────────────────────────────────┐  44px
 *   ├─ Canvas (messages) ─────────────────────┤  flex-1, scrolls
 *   └─ Composer (or BlockedComposer) ─────────┘  shrink-0
 *
 * Summoned surfaces (Switcher, Inspector, LinkPicker, ScopePicker,
 * PromotionsInbox, SelectionActionBar, SlashMenu, SaveToast) are rendered
 * as portals — they NEVER shift the canvas layout.
 *
 * Phase 3 keyboard spine wired here:
 *   ⌘K Switcher · ⌘I Inspector · ⌘. Inbox · ⌘L LinkPicker
 *   ⌘S save · ⌘⇧S pick scope · ⌘⇧P promote
 *   ⌘B branch (selection or thread) · ⌘⇧O open Account · ⌘⇧D open Opp
 *   ⌘⇧N new thread · / slash-menu in composer · Esc dismiss
 *
 * Dev-only proof hooks (no production effect):
 *   ?devOpen=switcher|linkpicker|inbox|inspector|slash
 *   ?devAction=newThread|branch|openAccount|openOpportunity|upload
 *   ?devSelect=<text>   (pre-existing)
 *
 * `?devAction=upload` synthesizes a small in-memory File and feeds it to the
 * real upload pipeline — bypassing the OS file picker (which browser automation
 * cannot drive) while still proving the post-upload product behavior.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useStrategyThreads } from '@/hooks/strategy/useStrategyThreads';
import { useStrategyMessages } from '@/hooks/strategy/useStrategyMessages';
import { useStrategyMemory } from '@/hooks/strategy/useStrategyMemory';
import { useStrategyUploads } from '@/hooks/strategy/useStrategyUploads';
import { useStrategyArtifacts } from '@/hooks/strategy/useStrategyArtifacts';
import { useStrategyProposals } from '@/hooks/strategy/useStrategyProposals';
import { useLinkedObjectContext } from '@/hooks/strategy/useLinkedObjectContext';
import { useThreadTrustState } from '@/hooks/strategy/useThreadTrustState';
import { useStrategyHotkeys } from '@/hooks/strategy/useStrategyHotkeys';
import { useStrategySelection } from '@/hooks/strategy/useStrategySelection';
import { useStrategySaveGesture, type SaveScope } from '@/hooks/strategy/useStrategySaveGesture';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { StrategyThread } from '@/types/strategy';

import { StrategyTopBar } from './StrategyTopBar';
import { StrategyCanvas } from './StrategyCanvas';
import { StrategyComposer } from './StrategyComposer';
import { BlockedComposer } from './BlockedComposer';
import { StrategySwitcher } from './StrategySwitcher';
import { ContextInspector } from './ContextInspector';
import { SelectionActionBar, type ActionKey } from './SelectionActionBar';
import { ScopePicker, type ScopePick } from './ScopePicker';
import { PromotionsInbox } from './PromotionsInbox';
import { SaveToast, type SaveToastState } from './SaveToast';
import { LinkPicker, type LinkPickerSelection } from './LinkPicker';
import { SlashMenu, type SlashVerb } from './SlashMenu';
import { LibraryPicker, type LibraryItem } from './LibraryPicker';
import { CanaryReviewDrawer } from '@/components/strategy/canary/CanaryReviewDrawer';
import { CanaryReviewPill } from '@/components/strategy/canary/CanaryReviewPill';
import { ValidationStatusDrawer } from '@/components/strategy/canary/ValidationStatusDrawer';
import { fetchLatestCanaryReview } from '@/lib/strategy/canary/repository';
import type { CanaryReviewRow } from '@/lib/strategy/canary/types';
import { useCanaryMode } from '@/lib/strategy/useCanaryMode';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { MoreHorizontal, PanelLeft } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { StrategyThreadsSidebar } from './StrategyThreadsSidebar';
import { StrategyNavSidebar, type StrategyMode } from './StrategyNavSidebar';
import { WorkflowFormSheet } from './workflows/WorkflowFormSheet';
import type { WorkflowDef } from './workflows/workflowRegistry';
import { PromoteToLibrarySheet, type PromotePayload } from './promote/PromoteToLibrarySheet';
import { StrategyGlobalNavBar } from './StrategyGlobalNavBar';
import { StrategyProgressPanel } from './StrategyProgressPanel';
import { ArtifactInlineCard } from './ArtifactInlineCard';
import { ArtifactWorkspace } from './ArtifactWorkspace';
import { useThreadTaskRuns } from '@/hooks/strategy/useThreadTaskRuns';

import '@/styles/strategy-v2.css';

const SIDEBAR_COLLAPSED_KEY = 'sv-sidebar-collapsed';

export function StrategyShell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Sidebar (left) — persisted collapse, mobile sheet
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Artifact workspace (right) — opened via inline card or completion event
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);

  // New nav sidebar — Mode hint state
  const [activeMode, setActiveMode] = useState<StrategyMode>(null);

  const {
    threads,
    activeThread,
    setActiveThreadId,
    updateThread,
    upsertThreadLocal,
    createThread,
  } = useStrategyThreads();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const slashFileInputRef = useRef<HTMLInputElement>(null);
  const queuedInitialMessageRef = useRef<string | null>(null);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const [pendingPick, setPendingPick] = useState<{ scope: SaveScope } | null>(null);
  const [toastState, setToastState] = useState<SaveToastState | null>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [composerRect, setComposerRect] = useState<DOMRect | null>(null);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  // Sidecar: resource IDs the user picked from /library this turn. Sent
  // out-of-band on the next sendMessage and cleared after. Never visible
  // in the composer (the composer only ever shows the human title).
  const [pendingResourceIds, setPendingResourceIds] = useState<string[]>([]);

  // ----- Cycle 1 Canary operator workflow -----
  const [canaryDrawerOpen, setCanaryDrawerOpen] = useState(false);
  const [canaryReadonly, setCanaryReadonly] = useState<CanaryReviewRow | null>(null);
  const [lastCanaryReview, setLastCanaryReview] = useState<CanaryReviewRow | null>(null);
  const [validationDrawerOpen, setValidationDrawerOpen] = useState(false);
  const { isCanary, localEnabled, setLocalEnabled, isAllowlisted } = useCanaryMode();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchLatestCanaryReview(user.id)
      .then((row) => { if (!cancelled) setLastCanaryReview(row); })
      .catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, [user]);

  const openCanaryReview = useCallback(() => {
    setCanaryReadonly(lastCanaryReview);
    setCanaryDrawerOpen(true);
  }, [lastCanaryReview]);

  const handleCanarySaved = useCallback((row: CanaryReviewRow) => {
    setLastCanaryReview(row);
  }, []);

  const threadId = activeThread?.id ?? null;

  const { messages, isLoading, isSending, sendMessage } = useStrategyMessages(threadId);
  const { linkedContext } = useLinkedObjectContext(activeThread);
  const { trustState, trustReason, conflicts, runDetect } = useThreadTrustState(threadId);

  const memoryObjectType = activeThread?.linked_account_id ? 'account' as const
    : activeThread?.linked_opportunity_id ? 'opportunity' as const
    : activeThread?.linked_territory_id ? 'territory' as const
    : null;
  const memoryObjectId = activeThread?.linked_account_id
    || activeThread?.linked_opportunity_id
    || activeThread?.linked_territory_id
    || null;

  const { memories } = useStrategyMemory(memoryObjectType, memoryObjectId);
  const { uploads, uploadFiles } = useStrategyUploads(threadId);
  const { artifacts } = useStrategyArtifacts(threadId);
  const { active: activeRun, latestCompleted } = useThreadTaskRuns(threadId);
  const { rows: allTaskRunsForThread } = useThreadTaskRuns(null); // no-op placeholder; per-thread indicators below

  // Track which run id was most recently observed in-flight, so we can show
  // "freshly completed" copy on the inline artifact card.
  const [recentlyCompletedRunId, setRecentlyCompletedRunId] = useState<string | null>(null);
  const prevActiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevActiveIdRef.current && !activeRun && latestCompleted?.row.id === prevActiveIdRef.current) {
      setRecentlyCompletedRunId(latestCompleted.row.id);
      setArtifactPanelOpen(true);
    }
    prevActiveIdRef.current = activeRun?.id ?? null;
  }, [activeRun, latestCompleted?.row.id]);

  const { proposals } = useStrategyProposals(threadId);

  // Phase 2 — selection + save gesture
  const { selection, clear: clearSelection } = useStrategySelection();
  const { save } = useStrategySaveGesture();

  const unresolvedProposalCount = useMemo(
    () => proposals.filter(p => p.status !== 'promoted' && p.status !== 'rejected').length,
    [proposals],
  );

  const showSaveToast = useCallback((t: SaveToastState) => setToastState(t), []);

  const performSave = useCallback(async (
    scope: SaveScope,
    overrides?: { targetAccountId?: string | null; targetOpportunityId?: string | null },
  ) => {
    if (!selection || !activeThread) return;
    const text = selection.text;
    const sourceMessageId = selection.sourceMessageId;
    const result = await save({
      selectionText: text,
      sourceMessageId,
      thread: activeThread,
      scope,
      targetAccountId: overrides?.targetAccountId,
      targetOpportunityId: overrides?.targetOpportunityId,
    });
    showSaveToast({
      id: crypto.randomUUID(),
      message: result.message,
      openPath: result.openPath,
      undo: result.undo,
      isError: !result.ok,
    });
    if (result.ok) clearSelection();
  }, [selection, activeThread, save, showSaveToast, clearSelection]);

  const handleSelectionAction = useCallback((key: ActionKey) => {
    if (key === 'pick_scope') {
      setPendingPick({ scope: 'account' });
      setScopePickerOpen(true);
      return;
    }
    performSave(key as SaveScope);
  }, [performSave]);

  const handleScopePick = useCallback(async (pick: ScopePick) => {
    setScopePickerOpen(false);
    if (!pendingPick) return;
    const overrides = pick.kind === 'account'
      ? { targetAccountId: pick.id, targetOpportunityId: null }
      : { targetAccountId: null, targetOpportunityId: pick.id };
    const scope: SaveScope = pick.kind === 'account' ? 'account' : 'opportunity';
    await performSave(scope, overrides);
    setPendingPick(null);
  }, [pendingPick, performSave]);

  // ---------- Phase 3 verbs ----------

  const handleNewThread = useCallback(async () => {
    if (!user || pendingThreadId || isCreatingThread) return;
    setIsCreatingThread(true);
    const newId = await createThread('Untitled thread', 'strategy', 'freeform');
    if (newId) {
      setPendingThreadId(newId);
      return;
    }
    setIsCreatingThread(false);
    toast.error('Failed to create thread');
  }, [user, pendingThreadId, isCreatingThread, createThread]);

  useEffect(() => {
    if (!pendingThreadId || activeThread?.id !== pendingThreadId) return;
    setPendingThreadId(null);
    setIsCreatingThread(false);
    const queued = queuedInitialMessageRef.current;
    queuedInitialMessageRef.current = null;
    requestAnimationFrame(() => composerRef.current?.focus());
    if (queued) {
      // Pull the sidecar IDs (if any) and clear synchronously so they
      // ride this send and only this send.
      const sidecar = pendingResourceIds.length > 0 ? pendingResourceIds : undefined;
      if (sidecar) setPendingResourceIds([]);
      requestAnimationFrame(() => sendMessage(queued, sidecar ? { pickedResourceIds: sidecar } : undefined));
    }
  }, [pendingThreadId, activeThread?.id, sendMessage, pendingResourceIds]);

  /** Branch from selection (if any) or current thread state. Provenance preserved via cloned_from_thread_id. */
  const handleBranch = useCallback(async () => {
    if (!user || !activeThread) return;
    const seedText = selection?.text ?? null;
    const baseTitle = activeThread.title || 'Thread';
    const newTitle = seedText
      ? `${baseTitle.slice(0, 40)} — branch`
      : `${baseTitle.slice(0, 40)} — branch`;

    const { data: newThread } = await supabase
      .from('strategy_threads')
      .insert({
        user_id: user.id,
        title: newTitle,
        lane: activeThread.lane,
        thread_type: activeThread.thread_type,
        linked_account_id: activeThread.linked_account_id,
        linked_opportunity_id: activeThread.linked_opportunity_id,
        cloned_from_thread_id: activeThread.id,
      } as any)
      .select()
      .single();

    if (newThread?.id) {
      // Always seed a provenance system message so the user can instantly tell
      // they are in a branch — even when no selection seeded the fork.
      const provenanceText = seedText
        ? `Branched from "${baseTitle}":\n\n> ${seedText}`
        : `Branched from "${baseTitle}". Original thread preserved.`;
      await (supabase as any).from('strategy_messages').insert({
        thread_id: newThread.id,
        user_id: user.id,
        role: 'system',
        message_type: 'chat',
        content_json: { text: provenanceText },
      });
      // Push into local state synchronously so activeThread resolves immediately
      // — otherwise topbar would briefly show fallback while threads list refetches.
      upsertThreadLocal(newThread as StrategyThread);
      setActiveThreadId(newThread.id);
      clearSelection();
    }
  }, [user, activeThread, selection, setActiveThreadId, clearSelection, upsertThreadLocal]);

  const handleOpenLinkedAccount = useCallback(() => {
    const id = activeThread?.linked_account_id;
    if (!id) {
      toast('No linked account on this thread');
      return;
    }
    navigate(`/accounts/${id}`);
  }, [activeThread, navigate]);

  const handleOpenLinkedOpportunity = useCallback(() => {
    const id = activeThread?.linked_opportunity_id;
    if (!id) {
      toast('No linked opportunity on this thread');
      return;
    }
    navigate(`/opportunities/${id}`);
  }, [activeThread, navigate]);

  // Slash verb routing
  const handleSlashPick = useCallback((verb: SlashVerb) => {
    if (verb === 'library') {
      // Don't clear slash — pivot the composer query to `/library ` so the
      // LibraryPicker takes over and the user can keep typing the search.
      setSlashQuery('/library ');
      const ta = composerRef.current as
        (HTMLTextAreaElement & { insertText?: (t: string) => void })
        | null;
      ta?.insertText?.('/library ');
      return;
    }

    setSlashQuery(null);
    const ta = composerRef.current as (HTMLTextAreaElement & { clearSlash?: () => void }) | null;
    ta?.clearSlash?.();

    switch (verb) {
      case 'link':
        setLinkPickerOpen(true);
        break;
      case 'branch':
        handleBranch();
        break;
      case 'promote-last': {
        // Pick the last assistant message and route through ⌘⇧P semantics
        const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
        if (!lastAssistant) {
          toast('No assistant message to save yet');
          break;
        }
        const text = (lastAssistant.content_json as any)?.text
          ?? (lastAssistant.content_json as any)?.content
          ?? '';
        if (!text) { toast('Nothing to save in the last message'); break; }
        // Save as research by default — safest scope
        save({
          selectionText: String(text).slice(0, 800),
          sourceMessageId: lastAssistant.id,
          thread: activeThread!,
          scope: 'research',
        }).then(result => {
          showSaveToast({
            id: crypto.randomUUID(),
            message: result.message,
            openPath: result.openPath,
            undo: result.undo,
            isError: !result.ok,
          });
        });
        break;
      }
      case 'upload':
        // Real flow: open the hidden file picker. The file selection handler
        // pushes through useStrategyUploads.uploadFile().
        slashFileInputRef.current?.click();
        break;
    }
  }, [handleBranch, messages, activeThread, save, showSaveToast]);

  // ---------- /library slash command ----------
  // Active whenever the slash query starts with `/library`. While active,
  // the regular SlashMenu is suppressed so only one surface is visible.
  const isLibraryQuery = !!slashQuery && /^\/library\b/i.test(slashQuery);

  const handleLibraryPick = useCallback((item: LibraryItem) => {
    // Insert ONLY the clean human-readable title into the composer.
    // The stable resource ID rides out-of-band in `pendingResourceIds`
    // and is sent as a sidecar on the next sendMessage. The backend
    // resolves IDs first, so grounding never depends on quoted-title
    // ILIKE coincidence.
    const token = `"${item.title}" `;
    const ta = composerRef.current as
      (HTMLTextAreaElement & { insertText?: (t: string) => void; clearSlash?: () => void })
      | null;
    if (ta?.insertText) {
      ta.insertText(token);
    } else {
      ta?.clearSlash?.();
    }
    setPendingResourceIds(prev => prev.includes(item.id) ? prev : [...prev, item.id]);
    setSlashQuery(null);
  }, []);

  // Hotkeys
  useStrategyHotkeys({
    onToggleSwitcher: () => setSwitcherOpen(o => !o),
    onToggleInspector: () => setInspectorOpen(o => !o),
    onToggleInbox: () => setInboxOpen(o => !o),
    onSavePrimary: () => {
      if (!selection || !activeThread) return;
      const primary: SaveScope = activeThread.linked_opportunity_id
        ? 'opportunity'
        : activeThread.linked_account_id ? 'account' : 'research';
      if (primary === 'research') {
        setPendingPick({ scope: 'account' });
        setScopePickerOpen(true);
        return;
      }
      performSave(primary);
    },
    onSavePick: () => {
      if (!selection) return;
      setPendingPick({ scope: 'account' });
      setScopePickerOpen(true);
    },
    onPromote: () => {
      if (!selection) return;
      performSave('crm_contact');
    },
    onOpenLinkPicker: () => setLinkPickerOpen(o => !o),
    onBranch: () => handleBranch(),
    onOpenLinkedAccount: () => handleOpenLinkedAccount(),
    onOpenLinkedOpportunity: () => handleOpenLinkedOpportunity(),
    onNewThread: () => handleNewThread(),
    onEscape: () => {
      if (slashQuery !== null) {
        setSlashQuery(null);
        const ta = composerRef.current as (HTMLTextAreaElement & { clearSlash?: () => void }) | null;
        ta?.clearSlash?.();
        return;
      }
      if (scopePickerOpen) { setScopePickerOpen(false); return; }
      if (linkPickerOpen) { setLinkPickerOpen(false); return; }
      if (inboxOpen) { setInboxOpen(false); return; }
      if (switcherOpen) { setSwitcherOpen(false); return; }
      if (inspectorOpen) { setInspectorOpen(false); return; }
      if (selection) { clearSelection(); return; }
    },
    composerRef,
  });

  // ---------- Dev-only proof hooks ----------
  // Supported params:
  //   ?devThread=<uuid>          switch to a specific thread first (use with devAction)
  //   ?devOpen=switcher|linkpicker|inbox|inspector|slash
  //   ?devAction=newThread|branch|openAccount|openOpportunity
  //
  // For devAction we wait until activeThread.id matches devThread (if provided)
  // before firing — this eliminates the race where the action ran against a
  // stale or unloaded thread.
  const devActionFiredRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const devThread = params.get('devThread');
    const devOpen = params.get('devOpen');
    const devAction = params.get('devAction');

    // If devThread is supplied and we're not on it yet, switch and wait for the
    // next render cycle to fire the rest. CRITICAL: stop snapping back once the
    // devAction has already fired — otherwise actions like branch (which switch
    // to a new thread id) would get clobbered.
    if (devThread && activeThread?.id !== devThread && !devActionFiredRef.current) {
      setActiveThreadId(devThread);
      return;
    }

    if (devOpen) {
      const t = setTimeout(() => {
        if (devOpen === 'switcher') setSwitcherOpen(true);
        else if (devOpen === 'inspector') setInspectorOpen(true);
        else if (devOpen === 'inbox') setInboxOpen(true);
        else if (devOpen === 'linkpicker') setLinkPickerOpen(true);
        else if (devOpen === 'slash') {
          composerRef.current?.focus();
          setSlashQuery('/');
          if (composerRef.current) {
            const ta = composerRef.current as HTMLTextAreaElement;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            setter?.call(ta, '/');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }, 200);
      return () => clearTimeout(t);
    }

    // devAction needs a hydrated thread — guard against the race.
    if (devAction && !devActionFiredRef.current) {
      // For newThread we don't need an existing thread.
      const needsThread = devAction !== 'newThread';
      if (needsThread && !activeThread) return;
      devActionFiredRef.current = true;
      const t = setTimeout(() => {
        if (devAction === 'newThread') handleNewThread();
        else if (devAction === 'branch') handleBranch();
        else if (devAction === 'openAccount') handleOpenLinkedAccount();
        else if (devAction === 'openOpportunity') handleOpenLinkedOpportunity();
        else if (devAction === 'upload') {
          // Dev-safe upload proof: synthesize a small File and feed it to the
          // real upload pipeline. Proves product behavior end-to-end without
          // requiring an OS file picker (which browser automation cannot drive).
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const body = `dev-upload proof @ ${stamp}\nThis file was synthesized via ?devAction=upload to prove post-upload product behavior.\n`;
          const file = new File([body], `dev-upload-${stamp}.txt`, { type: 'text/plain' });
          uploadFiles([file]);
          setInspectorOpen(true); // open inspector so the new upload row is visible
        }
      }, 250);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.id]);

  // Auto-detect trust state when switching threads
  useEffect(() => {
    if (!threadId) return;
    runDetect().catch(() => { /* swallow */ });
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback((text: string) => {
    if (pendingThreadId || isCreatingThread || isSending) return;
    // Snapshot + clear sidecar IDs synchronously so a second send can't
    // accidentally re-attach the same picked resource.
    const sidecar = pendingResourceIds.length > 0 ? pendingResourceIds : undefined;
    if (sidecar) setPendingResourceIds([]);
    if (!threadId) {
      (async () => {
        if (!user) return;
        setIsCreatingThread(true);
        const newId = await createThread('Untitled thread', 'strategy', 'freeform');
        if (newId) {
          queuedInitialMessageRef.current = text;
          // Re-stash so the queued send (after thread mounts) still sees them.
          if (sidecar) setPendingResourceIds(sidecar);
          setPendingThreadId(newId);
        } else {
          setIsCreatingThread(false);
          toast.error('Failed to create thread');
        }
      })();
      return;
    }
    sendMessage(text, sidecar ? { pickedResourceIds: sidecar } : undefined);
  }, [pendingThreadId, isCreatingThread, isSending, threadId, sendMessage, user, createThread, pendingResourceIds]);

  const handlePickEntity = useCallback(async (sel: LinkPickerSelection) => {
    setLinkPickerOpen(false);
    if (!activeThread) return;
    const updates: Partial<StrategyThread> = sel.kind === 'freeform'
      ? { linked_account_id: null, linked_opportunity_id: null, thread_type: 'freeform' }
      : sel.kind === 'account'
        ? { linked_account_id: sel.id ?? null, linked_opportunity_id: null, thread_type: 'account_linked' }
        : { linked_account_id: null, linked_opportunity_id: sel.id ?? null, thread_type: 'opportunity_linked' };
    await updateThread(activeThread.id, updates);
    runDetect().catch(() => { /* swallow */ });
  }, [activeThread, updateThread, runDetect]);

  const handleClone = useCallback(async () => {
    const detectedName = conflicts.find(c => c.detected_account_name)?.detected_account_name ?? null;
    if (!user || !activeThread) return;

    let targetAccountId: string | null = null;
    if (detectedName) {
      const { data: match } = await supabase
        .from('accounts')
        .select('id')
        .eq('user_id', user.id)
        .ilike('name', detectedName)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      targetAccountId = match?.id ?? null;
    }

    const { data: newThread } = await supabase.from('strategy_threads').insert({
      user_id: user.id,
      title: detectedName ? `${detectedName} — strategy` : `${activeThread.title} (clone)`,
      lane: activeThread.lane,
      thread_type: targetAccountId ? 'account_linked' : 'freeform',
      linked_account_id: targetAccountId,
      cloned_from_thread_id: activeThread.id,
    } as any).select().single();

    if (newThread?.id) {
      setActiveThreadId(newThread.id);
    }
  }, [conflicts, user, activeThread, setActiveThreadId]);

  const handleUnlink = useCallback(async () => {
    if (!activeThread) return;
    await updateThread(activeThread.id, {
      linked_account_id: null,
      linked_opportunity_id: null,
      thread_type: 'freeform',
    });
    runDetect().catch(() => { /* swallow */ });
  }, [activeThread, updateThread, runDetect]);

  const entityName = linkedContext?.account?.name ?? linkedContext?.opportunity?.name ?? null;
  const entityKind: 'account' | 'opportunity' | null = linkedContext?.account
    ? 'account'
    : linkedContext?.opportunity ? 'opportunity' : null;

  const detectedEntityName = conflicts.find(c => c.detected_account_name)?.detected_account_name ?? null;

  const entitySubline = useMemo(() => {
    if (linkedContext?.account?.industry) return linkedContext.account.industry;
    if (linkedContext?.opportunity?.stage) return linkedContext.opportunity.stage;
    return null;
  }, [linkedContext]);

  // Per-thread indicators for sidebar (in-flight + has-artifact)
  // We use the active thread's signals as a minimum; richer cross-thread
  // dots can be layered later without touching the engine.
  const runningThreadIds = useMemo(() => {
    const s = new Set<string>();
    if (activeRun && threadId) s.add(threadId);
    return s;
  }, [activeRun, threadId]);
  const artifactThreadIds = useMemo(() => {
    const s = new Set<string>();
    if (latestCompleted && threadId) s.add(threadId);
    return s;
  }, [latestCompleted, threadId]);

  // ---------- Workflow launcher (Modes pills · Library · Artifact templates) ----------
  // One model: pick a workflow → fill form → Run compiles a prompt → existing send path.
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowDef | null>(null);

  const handleLaunchWorkflow = useCallback((def: WorkflowDef) => {
    setActiveWorkflow(def);
  }, []);

  const handleRunWorkflow = useCallback((compiledPrompt: string) => {
    setActiveWorkflow(null);
    // Route through the same send path freeform typing uses.
    handleSend(compiledPrompt);
    requestAnimationFrame(() => composerRef.current?.focus());
  // handleSend declared later — safe at call-time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick a mode → set hint state, focus composer (does NOT gate input).
  const handlePickMode = useCallback((m: StrategyMode) => {
    setActiveMode(m);
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  const sidebarNode = (onAfterSelect?: () => void) => (
    <StrategyNavSidebar
      collapsed={sidebarCollapsed}
      onToggleCollapsed={toggleSidebar}
      activeMode={activeMode}
      onPickMode={handlePickMode}
      onLaunchWorkflow={handleLaunchWorkflow}
      threads={threads}
      activeThreadId={threadId}
      onSelectThread={(id) => setActiveThreadId(id)}
      onNewWork={() => handleNewThread()}
      runningThreadIds={runningThreadIds}
      artifactThreadIds={artifactThreadIds}
      onAfterSelect={onAfterSelect}
    />
  );

  const showArtifactPanel = artifactPanelOpen && latestCompleted && !isMobile;

  return (
    <div
      className="strategy-v2 flex flex-col flex-1 min-h-0 w-full"
      style={{ background: 'hsl(var(--sv-paper))' }}
    >
      {/* Compact global nav rail (desktop only) — replaces the dual-row
          BottomNav on /strategy so the workspace owns the vertical space. */}
      <StrategyGlobalNavBar />

      <div className="flex flex-1 min-h-0 w-full">
      {/* Desktop persistent sidebar */}
      {!isMobile && sidebarNode()}

      {/* Mobile sidebar drawer — lighter overlay (CSS override), intentional width (~85vw, max 320px) */}
      {isMobile && (
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent
            side="left"
            className="p-0 flex flex-col strategy-mobile-drawer [&>button]:hidden"
            style={{
              background: 'hsl(var(--sv-paper))',
              width: 'min(85vw, 320px)',
              boxShadow: '0 0 40px hsl(0 0% 0% / 0.12)',
            }}
          >
            <div className="flex flex-1 min-h-0">
              {sidebarNode(() => setMobileSidebarOpen(false))}
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Center column — chat */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <div className="flex items-center gap-1" style={{ borderBottom: '1px solid hsl(var(--sv-hairline))' }}>
          {isMobile && (
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="h-9 w-9 flex items-center justify-center sv-hover-bg shrink-0"
              style={{ color: 'hsl(var(--sv-muted))' }}
              aria-label="Open Strategy threads"
              data-testid="strategy-mobile-sidebar-trigger"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <StrategyTopBar
              title={activeThread?.title ?? 'Untitled thread'}
              onTitleChange={(next) => activeThread && updateThread(activeThread.id, { title: next })}
              entityName={entityName}
              trustState={trustState}
              unresolvedProposalCount={unresolvedProposalCount}
              onOpenSwitcher={() => setSwitcherOpen(true)}
              onOpenInspector={() => setInspectorOpen(true)}
              onChipClick={() => setLinkPickerOpen(true)}
              chipRef={chipRef}
              onNewThread={() => handleNewThread()}
            />
          </div>
        </div>

        {/* Cycle 1 — canary review pill */}
        <div className="shrink-0 w-full flex items-center justify-end gap-1 px-4 py-1" style={{ borderBottom: '1px solid hsl(var(--sv-hairline))' }}>
          <CanaryReviewPill lastReview={lastCanaryReview} onClick={openCanaryReview} />
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Strategy options">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs">Operator</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={isCanary}
                  disabled={isAllowlisted}
                  onCheckedChange={(checked) => setLocalEnabled(!!checked)}
                >
                  Canary mode
                  {isAllowlisted && <span className="ml-auto text-[10px] text-muted-foreground">allowlisted</span>}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setValidationDrawerOpen(true)}>
                  Validation status…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Live progress strip */}
        <StrategyProgressPanel active={activeRun} />

        {/* Inline artifact card — surfaces completed deep-work without dumping content */}
        {latestCompleted && (
          <div className="mx-auto w-full px-6 pt-3" style={{ maxWidth: 760 }}>
            <ArtifactInlineCard
              title={`Discovery Prep`}
              result={latestCompleted.result}
              freshlyCompleted={recentlyCompletedRunId === latestCompleted.row.id}
              onOpen={() => setArtifactPanelOpen(true)}
            />
          </div>
        )}

        <StrategyCanvas
          messages={messages}
          isLoading={isLoading}
          isSending={isSending}
          onPickPrompt={(prompt) => {
            const ta = composerRef.current as
              (HTMLTextAreaElement & { insertText?: (t: string) => void })
              | null;
            ta?.insertText?.(prompt);
            requestAnimationFrame(() => ta?.focus());
          }}
        />

      {trustState === 'blocked' ? (
        <BlockedComposer
          reason={trustReason}
          conflicts={conflicts}
          linkedEntityName={entityName}
          detectedEntityName={detectedEntityName}
          onClone={handleClone}
          onUnlink={handleUnlink}
        />
      ) : (
        <StrategyComposer
          ref={composerRef}
          disabled={isSending || !!pendingThreadId || isCreatingThread}
          placeholder={
            activeMode === 'brainstorm'
              ? 'Brainstorm anything — angles, ideas, half-formed thoughts…'
              : activeMode === 'deep_research'
                ? 'Ask anything, paste notes, or start with an account or company…'
                : activeMode === 'refine'
                  ? 'Paste a draft, an output, or a snippet to refine…'
                  : messages.length === 0
                    ? 'What are you thinking about?'
                    : entityName ? `Message about ${entityName}…` : 'Message…'
          }
          serifPlaceholder={messages.length === 0 && !activeMode}
          onSend={handleSend}
          onSlashChange={setSlashQuery}
          onRectChange={setComposerRect}
          onAttachFiles={() => slashFileInputRef.current?.click()}
          momentumHint={
            // Context-aware "what's next?" line under the composer.
            // Priority: streaming > artifact-just-landed > active mode > linked-entity > null
            isSending
              ? 'Strategy is thinking…'
              : (latestCompleted && artifactPanelOpen)
                ? 'Ask a follow-up to refine · / to revise · ⌘S to save'
                : activeMode === 'brainstorm'
                  ? 'Brainstorm mode · think out loud — Strategy will shape it later.'
                  : activeMode === 'deep_research'
                    ? 'Deep Research mode · ask anything, paste notes, or start with an account.'
                    : activeMode === 'refine'
                      ? 'Refine mode · paste a draft and Strategy will sharpen it.'
                      : entityName && messages.length > 0
                        ? `Grounded on ${entityName} · / for actions · ⌘S save`
                        : null
          }
        />
      )}
      </div>
      {/* End center column */}

      {/* Right-side artifact workspace (desktop only) */}
      {showArtifactPanel && latestCompleted && (
        <ArtifactWorkspace
          result={latestCompleted.result}
          onClose={() => setArtifactPanelOpen(false)}
        />
      )}

      {/* Mobile artifact sheet */}
      {isMobile && latestCompleted && (
        <Sheet open={artifactPanelOpen} onOpenChange={setArtifactPanelOpen}>
          <SheetContent side="right" className="p-0 w-full sm:w-[480px]">
            <ArtifactWorkspace
              result={latestCompleted.result}
              onClose={() => setArtifactPanelOpen(false)}
            />
          </SheetContent>
        </Sheet>
      )}

      <StrategySwitcher
        open={switcherOpen}
        threads={threads}
        onClose={() => setSwitcherOpen(false)}
        onSelectThread={(id) => setActiveThreadId(id)}
      />
      <ContextInspector
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        entityName={entityName}
        entitySubline={entitySubline}
        memories={memories}
        uploads={uploads}
        artifacts={artifacts}
      />
      <LinkPicker
        open={linkPickerOpen}
        anchorRef={chipRef}
        currentEntityKind={entityKind}
        onClose={() => setLinkPickerOpen(false)}
        onPick={handlePickEntity}
      />
      <SlashMenu
        query={isLibraryQuery ? null : slashQuery}
        anchorRect={composerRect}
        onPick={handleSlashPick}
        onClose={() => {
          setSlashQuery(null);
          const ta = composerRef.current as (HTMLTextAreaElement & { clearSlash?: () => void }) | null;
          ta?.clearSlash?.();
        }}
      />
      <LibraryPicker
        query={isLibraryQuery ? slashQuery : null}
        anchorRect={composerRect}
        onPick={handleLibraryPick}
        onClose={() => {
          setSlashQuery(null);
          const ta = composerRef.current as (HTMLTextAreaElement & { clearSlash?: () => void }) | null;
          ta?.clearSlash?.();
        }}
      />

      {/* Phase 2 — gesture surfaces */}
      <SelectionActionBar
        selection={scopePickerOpen ? null : selection}
        hasOpportunity={!!activeThread?.linked_opportunity_id}
        hasAccount={!!activeThread?.linked_account_id}
        onAction={handleSelectionAction}
        onDismiss={clearSelection}
      />
      <ScopePicker
        open={scopePickerOpen}
        anchorRect={selection?.rect ?? null}
        onClose={() => { setScopePickerOpen(false); setPendingPick(null); }}
        onPick={handleScopePick}
      />
      <PromotionsInbox
        open={inboxOpen}
        onClose={() => setInboxOpen(false)}
      />
      <SaveToast
        toast={toastState}
        onDismiss={() => setToastState(null)}
        onOpen={(path) => { setToastState(null); navigate(path); }}
      />

      {/* Hidden file picker driven by /upload slash verb */}
      <input
        ref={slashFileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length) uploadFiles(files);
          e.target.value = '';
        }}
      />
      {/* Cycle 1 canary operator drawer */}
      <CanaryReviewDrawer
        open={canaryDrawerOpen}
        onOpenChange={(o) => { setCanaryDrawerOpen(o); if (!o) setCanaryReadonly(null); }}
        readonlyReview={canaryReadonly}
        onSaved={handleCanarySaved}
      />
      {/* Workflow form — Click → Configure → Run for every Mode pill / Library workflow / Artifact template */}
      <WorkflowFormSheet
        workflow={activeWorkflow}
        onClose={() => setActiveWorkflow(null)}
        onRun={handleRunWorkflow}
      />
      {/* Validation status drawer (read-only) */}
      <ValidationStatusDrawer
        open={validationDrawerOpen}
        onOpenChange={setValidationDrawerOpen}
      />
      </div>
    </div>
  );
}
