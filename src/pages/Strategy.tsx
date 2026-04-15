/**
 * Strategy Workspace — durable strategic operating system.
 * Three-column layout: thread sidebar, main working area, right rail.
 */
import { useState, useMemo } from 'react';
import { StrategyThreadSidebar } from '@/components/strategy/StrategyThreadSidebar';
import { StrategyMainPanel } from '@/components/strategy/StrategyMainPanel';
import { StrategyRightRail } from '@/components/strategy/StrategyRightRail';
import { useStrategyThreads } from '@/hooks/strategy/useStrategyThreads';
import { useStrategyUploads } from '@/hooks/strategy/useStrategyUploads';
import { useStrategyMemory } from '@/hooks/strategy/useStrategyMemory';
import { useStrategyOutputs } from '@/hooks/strategy/useStrategyOutputs';
import { useLinkedObjectContext } from '@/hooks/strategy/useLinkedObjectContext';
import { SHELL } from '@/lib/layout';

export default function Strategy() {
  const {
    threads,
    activeThread,
    setActiveThreadId,
    createThread,
    updateThread,
    isLoading,
  } = useStrategyThreads();

  const [laneFilter, setLaneFilter] = useState<string>('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);

  // Linked object context hydration
  const { linkedContext } = useLinkedObjectContext(activeThread);

  // Determine memory object type/id from active thread
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
  const { outputs } = useStrategyOutputs(activeThread?.id ?? null);

  return (
    <div
      className="flex h-screen bg-background overflow-hidden"
      style={{ paddingTop: SHELL.top.safeArea }}
    >
      {/* Left Sidebar */}
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

      {/* Main Panel */}
      <StrategyMainPanel
        thread={activeThread}
        onUpdateThread={updateThread}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={() => setSidebarCollapsed(false)}
        rightRailCollapsed={rightRailCollapsed}
        onToggleRightRail={() => setRightRailCollapsed(r => !r)}
        linkedContext={linkedContext}
      />

      {/* Right Rail */}
      {!rightRailCollapsed && activeThread && (
        <StrategyRightRail
          thread={activeThread}
          onCollapse={() => setRightRailCollapsed(true)}
          linkedContext={linkedContext}
          memories={memories}
          uploads={uploads}
          outputs={outputs}
          onSaveMemory={saveMemory}
        />
      )}
    </div>
  );
}
