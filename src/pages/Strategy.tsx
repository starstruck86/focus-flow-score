/**
 * Strategy Workspace — durable strategic operating system.
 * Three-column layout: thread sidebar, main working area, right rail.
 */
import { useState, useCallback } from 'react';
import { StrategyThreadSidebar } from '@/components/strategy/StrategyThreadSidebar';
import { StrategyMainPanel } from '@/components/strategy/StrategyMainPanel';
import { StrategyRightRail } from '@/components/strategy/StrategyRightRail';
import { CreateThreadDialog } from '@/components/strategy/CreateThreadDialog';
import type { CreateThreadOpts } from '@/components/strategy/CreateThreadDialog';
import { useStrategyThreads } from '@/hooks/strategy/useStrategyThreads';
import { useStrategyUploads } from '@/hooks/strategy/useStrategyUploads';
import { useStrategyMemory } from '@/hooks/strategy/useStrategyMemory';
import { useStrategyOutputs } from '@/hooks/strategy/useStrategyOutputs';
import { useStrategyArtifacts } from '@/hooks/strategy/useStrategyArtifacts';
import { useLinkedObjectContext } from '@/hooks/strategy/useLinkedObjectContext';
import { useStrategyRollups } from '@/hooks/strategy/useStrategyRollups';
import { useStrategyMessages } from '@/hooks/strategy/useStrategyMessages';
import { SHELL } from '@/lib/layout';

export default function Strategy() {
  const {
    threads, activeThread, setActiveThreadId, createThread, createThreadWithOpts, updateThread, isLoading,
  } = useStrategyThreads();

  const [laneFilter, setLaneFilter] = useState<string>('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { linkedContext } = useLinkedObjectContext(activeThread);

  const memoryObjectType = activeThread?.linked_account_id ? 'account' as const
    : activeThread?.linked_opportunity_id ? 'opportunity' as const
    : activeThread?.linked_territory_id ? 'territory' as const
    : null;
  const memoryObjectId = activeThread?.linked_account_id
    || activeThread?.linked_opportunity_id
    || activeThread?.linked_territory_id
    || null;

  const { memories, saveMemory } = useStrategyMemory(memoryObjectType, memoryObjectId);
  const { uploads } = useStrategyUploads(activeThread?.id ?? null);
  const { outputs, refetch: refetchOutputs } = useStrategyOutputs(activeThread?.id ?? null);
  const { artifacts, isTransforming, transformOutput, regenerateArtifact, refetch: refetchArtifacts } = useStrategyArtifacts(activeThread?.id ?? null);
  const { rollup, memorySuggestions, isLoading: isRollupLoading, triggerRollup, refetch: refetchRollup } = useStrategyRollups(activeThread?.id ?? null);

  // Get sendMessage for branch seeding
  const { sendMessage: sendBranchMessage } = useStrategyMessages(null);

  const handleWorkflowComplete = useCallback(() => {
    refetchOutputs();
    refetchRollup();
    refetchArtifacts();
  }, [refetchOutputs, refetchRollup, refetchArtifacts]);

  const handleCreateThreadWithOpts = useCallback((opts: CreateThreadOpts) => {
    createThreadWithOpts(opts);
  }, [createThreadWithOpts]);

  const handleBranchThread = useCallback(async (title: string, content: string) => {
    // Create a new thread with context carried forward
    const newThread = await createThread(title, 'strategy', 'freeform');
    // The thread is created and auto-selected via setActiveThreadId in createThread
    // We'll insert a seed message via the edge function after thread creation
    if (newThread && content) {
      try {
        const { supabase } = await import('@/integrations/supabase/client');
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await (supabase as any).from('strategy_messages').insert({
            thread_id: newThread,
            user_id: user.id,
            role: 'system',
            message_type: 'system',
            content_json: {
              text: `This thread continues from a previous analysis.\n\n---\n\n${content}`,
            },
          });
        }
      } catch (e) {
        console.error('Failed to seed branch thread:', e);
      }
    }
  }, [createThread]);

  const handleTransformOutput = useCallback(async (sourceOutputId: string, targetArtifactType: string) => {
    const artifact = await transformOutput(sourceOutputId, targetArtifactType);
    if (artifact) {
      handleWorkflowComplete();
    }
  }, [transformOutput, handleWorkflowComplete]);

  return (
    <div
      className="flex h-screen bg-background overflow-hidden"
      style={{ paddingTop: SHELL.top.safeArea }}
    >
      {!sidebarCollapsed && (
        <StrategyThreadSidebar
          threads={threads}
          activeThreadId={activeThread?.id ?? null}
          onSelectThread={setActiveThreadId}
          onOpenCreateDialog={() => setCreateDialogOpen(true)}
          laneFilter={laneFilter}
          onLaneFilterChange={setLaneFilter}
          onCollapse={() => setSidebarCollapsed(true)}
          isLoading={isLoading}
        />
      )}

      <StrategyMainPanel
        thread={activeThread}
        onUpdateThread={updateThread}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={() => setSidebarCollapsed(false)}
        rightRailCollapsed={rightRailCollapsed}
        onToggleRightRail={() => setRightRailCollapsed(r => !r)}
        linkedContext={linkedContext}
        onSaveMemory={memoryObjectType ? (type, content) => saveMemory(type, content) : undefined}
        onWorkflowComplete={handleWorkflowComplete}
        onBranchThread={handleBranchThread}
        onTransformOutput={handleTransformOutput}
        isTransforming={isTransforming}
      />

      {!rightRailCollapsed && activeThread && (
        <StrategyRightRail
          thread={activeThread}
          onCollapse={() => setRightRailCollapsed(true)}
          linkedContext={linkedContext}
          memories={memories}
          uploads={uploads}
          outputs={outputs}
          artifacts={artifacts}
          onSaveMemory={saveMemory}
          rollup={rollup}
          memorySuggestions={memorySuggestions}
          isRollupLoading={isRollupLoading}
          onTriggerRollup={triggerRollup}
          onRegenerateArtifact={regenerateArtifact}
          isTransforming={isTransforming}
        />
      )}

      <CreateThreadDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateThread={handleCreateThreadWithOpts}
      />
    </div>
  );
}
