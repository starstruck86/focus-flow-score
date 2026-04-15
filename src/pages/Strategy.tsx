/**
 * Strategy Workspace — durable strategic operating system.
 * Three-column layout: thread sidebar, main working area, right rail.
 */
import { useState, useCallback } from 'react';
import { StrategyThreadSidebar } from '@/components/strategy/StrategyThreadSidebar';
import { StrategyMainPanel } from '@/components/strategy/StrategyMainPanel';
import { StrategyRightRail } from '@/components/strategy/StrategyRightRail';
import { useStrategyThreads } from '@/hooks/strategy/useStrategyThreads';
import { useStrategyUploads } from '@/hooks/strategy/useStrategyUploads';
import { useStrategyMemory } from '@/hooks/strategy/useStrategyMemory';
import { useStrategyOutputs } from '@/hooks/strategy/useStrategyOutputs';
import { useLinkedObjectContext } from '@/hooks/strategy/useLinkedObjectContext';
import { useStrategyRollups } from '@/hooks/strategy/useStrategyRollups';
import { SHELL } from '@/lib/layout';

export default function Strategy() {
  const {
    threads, activeThread, setActiveThreadId, createThread, updateThread, isLoading,
  } = useStrategyThreads();

  const [laneFilter, setLaneFilter] = useState<string>('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);

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
  const { rollup, memorySuggestions, isLoading: isRollupLoading, triggerRollup, refetch: refetchRollup } = useStrategyRollups(activeThread?.id ?? null);

  const handleWorkflowComplete = useCallback(() => {
    refetchOutputs();
    refetchRollup();
  }, [refetchOutputs, refetchRollup]);

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
          onCreateThread={createThread}
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
      />

      {!rightRailCollapsed && activeThread && (
        <StrategyRightRail
          thread={activeThread}
          onCollapse={() => setRightRailCollapsed(true)}
          linkedContext={linkedContext}
          memories={memories}
          uploads={uploads}
          outputs={outputs}
          onSaveMemory={saveMemory}
          rollup={rollup}
          memorySuggestions={memorySuggestions}
          isRollupLoading={isRollupLoading}
          onTriggerRollup={triggerRollup}
        />
      )}
    </div>
  );
}
