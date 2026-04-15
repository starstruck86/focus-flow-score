/**
 * Strategy Workspace — durable strategic operating system.
 * Three-column layout: thread sidebar, main working area, right rail.
 */
import { useState, useCallback } from 'react';
import { StrategyThreadSidebar } from '@/components/strategy/StrategyThreadSidebar';
import { StrategyMainPanel } from '@/components/strategy/StrategyMainPanel';
import { StrategyRightRail } from '@/components/strategy/StrategyRightRail';
import { useStrategyThreads } from '@/hooks/strategy/useStrategyThreads';
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
      />

      {/* Right Rail */}
      {!rightRailCollapsed && activeThread && (
        <StrategyRightRail
          thread={activeThread}
          onCollapse={() => setRightRailCollapsed(true)}
        />
      )}
    </div>
  );
}
