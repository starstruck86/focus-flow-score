/**
 * StrategyShell — Phase 1 two-region shell.
 *
 *   ┌─ TopBar ────────────────────────────────┐  44px
 *   ├─ Canvas (messages) ─────────────────────┤  flex-1, scrolls
 *   └─ Composer (or BlockedComposer) ─────────┘  shrink-0
 *
 * Summoned surfaces (Switcher, Inspector) are rendered as portals — they do
 * NOT shift the canvas layout under any circumstance.
 *
 * All backend wiring (threads, messages, uploads, memory, artifacts, trust,
 * proposals) is preserved by passing through the existing hooks unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStrategyThreads } from '@/hooks/strategy/useStrategyThreads';
import { useStrategyMessages } from '@/hooks/strategy/useStrategyMessages';
import { useStrategyMemory } from '@/hooks/strategy/useStrategyMemory';
import { useStrategyUploads } from '@/hooks/strategy/useStrategyUploads';
import { useStrategyArtifacts } from '@/hooks/strategy/useStrategyArtifacts';
import { useStrategyProposals } from '@/hooks/strategy/useStrategyProposals';
import { useLinkedObjectContext } from '@/hooks/strategy/useLinkedObjectContext';
import { useThreadTrustState } from '@/hooks/strategy/useThreadTrustState';
import { useStrategyHotkeys } from '@/hooks/strategy/useStrategyHotkeys';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { StrategyThread } from '@/types/strategy';

import { StrategyTopBar } from './StrategyTopBar';
import { StrategyCanvas } from './StrategyCanvas';
import { StrategyComposer } from './StrategyComposer';
import { BlockedComposer } from './BlockedComposer';
import { StrategySwitcher } from './StrategySwitcher';
import { ContextInspector } from './ContextInspector';
import type { LinkPickerSelection } from './LinkPicker';

import '@/styles/strategy-v2.css';

export function StrategyShell() {
  const { user } = useAuth();

  const { threads, activeThread, setActiveThreadId, updateThread } = useStrategyThreads();
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

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
  const { uploads } = useStrategyUploads(threadId);
  const { artifacts } = useStrategyArtifacts(threadId);
  const { proposals } = useStrategyProposals(threadId);

  // Unresolved proposals = anything not in a terminal state ("promoted" or "rejected")
  const unresolvedProposalCount = useMemo(
    () => proposals.filter(p => p.status !== 'promoted' && p.status !== 'rejected').length,
    [proposals],
  );

  // Hotkeys
  useStrategyHotkeys({
    onToggleSwitcher: () => setSwitcherOpen(o => !o),
    onToggleInspector: () => setInspectorOpen(o => !o),
    onEscape: () => {
      if (switcherOpen) setSwitcherOpen(false);
      else if (inspectorOpen) setInspectorOpen(false);
    },
    composerRef,
  });

  // Auto-detect trust state when switching threads (debounced by useThreadTrustState's own logic)
  useEffect(() => {
    if (!threadId) return;
    runDetect().catch(() => { /* swallow */ });
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback((text: string) => {
    if (!threadId) {
      // Auto-create a freeform thread if none active
      (async () => {
        if (!user) return;
        const { data } = await supabase.from('strategy_threads').insert({
          user_id: user.id, title: 'Untitled thread', lane: 'strategy', thread_type: 'freeform',
        } as any).select().single();
        if (data?.id) {
          setActiveThreadId(data.id);
          // give state a tick before sending; useStrategyMessages will pick up the new threadId
          setTimeout(() => sendMessage(text), 0);
        }
      })();
      return;
    }
    sendMessage(text);
  }, [threadId, sendMessage, user, setActiveThreadId]);

  const handlePickEntity = useCallback(async (sel: LinkPickerSelection) => {
    if (!activeThread) return;
    const updates: Partial<StrategyThread> = sel.kind === 'freeform'
      ? { linked_account_id: null, linked_opportunity_id: null, thread_type: 'freeform' }
      : sel.kind === 'account'
        ? { linked_account_id: sel.id ?? null, linked_opportunity_id: null, thread_type: 'account_linked' }
        : { linked_account_id: null, linked_opportunity_id: sel.id ?? null, thread_type: 'opportunity_linked' };
    await updateThread(activeThread.id, updates);
    // Re-run trust detection with new linkage
    runDetect().catch(() => { /* swallow */ });
  }, [activeThread, updateThread, runDetect]);

  const handleClone = useCallback(async () => {
    // Detect the entity name the system thinks the thread is really about.
    const detectedName = conflicts.find(c => c.detected_account_name)?.detected_account_name ?? null;
    if (!user || !activeThread) return;

    // Try to resolve detected name → existing account
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

    // Create a clean clone — re-link to detected account if found, otherwise freeform
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

  return (
    <div
      className="strategy-v2 flex flex-col flex-1 min-h-0 w-full"
      style={{ background: 'hsl(var(--sv-paper))' }}
    >
      <StrategyTopBar
        title={activeThread?.title ?? 'Untitled thread'}
        onTitleChange={(next) => activeThread && updateThread(activeThread.id, { title: next })}
        entityName={entityName}
        entityKind={entityKind}
        trustState={trustState}
        unresolvedProposalCount={unresolvedProposalCount}
        onOpenSwitcher={() => setSwitcherOpen(true)}
        onOpenInspector={() => setInspectorOpen(true)}
        onPickEntity={handlePickEntity}
      />

      <StrategyCanvas
        messages={messages}
        isLoading={isLoading}
        isSending={isSending}
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
          disabled={isSending}
          placeholder={
            messages.length === 0
              ? 'What are you thinking about?'
              : entityName ? `Message about ${entityName}…` : 'Message…'
          }
          serifPlaceholder={messages.length === 0}
          onSend={handleSend}
        />
      )}

      {/* Summoned surfaces — portals, no layout shift */}
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
    </div>
  );
}
