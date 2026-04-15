/**
 * Strategy Workspace — durable strategic operating system.
 * Three-column layout: thread sidebar (drawer on mobile), main working area, right rail.
 */
import { useState, useCallback, useEffect } from 'react';
import { Layout } from '@/components/Layout';
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
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Drawer, DrawerContent, DrawerTrigger, DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { PanelLeftOpen } from 'lucide-react';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';

export default function Strategy() {
  const isMobile = useIsMobile();

  // Make Layout's <main> act as a flex container so Strategy fills it
  useEffect(() => {
    const main = document.querySelector('main[data-testid="main-content"]');
    if (!main) return;
    main.classList.add('!overflow-hidden', '!flex', '!flex-col');
    return () => {
      main.classList.remove('!overflow-hidden', '!flex', '!flex-col');
    };
  }, []);
  const {
    threads, activeThread, setActiveThreadId, createThread, createThreadWithOpts, updateThread, isLoading,
  } = useStrategyThreads();

  const [laneFilter, setLaneFilter] = useState<string>('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const { linkedContext } = useLinkedObjectContext(activeThread);

  const memoryObjectType = activeThread?.linked_account_id ? 'account' as const
    : activeThread?.linked_opportunity_id ? 'opportunity' as const
    : activeThread?.linked_territory_id ? 'territory' as const
    : null;
  const memoryObjectId = activeThread?.linked_account_id
    || activeThread?.linked_opportunity_id
    || activeThread?.linked_territory_id
    || null;

  const { memories, saveMemory, deleteMemory, togglePin, setConfidence, markIrrelevant } = useStrategyMemory(memoryObjectType, memoryObjectId);
  const { uploads, summarizeUpload } = useStrategyUploads(activeThread?.id ?? null);
  const { outputs, refetch: refetchOutputs } = useStrategyOutputs(activeThread?.id ?? null);
  const { artifacts, isTransforming, transformOutput, regenerateArtifact, refetch: refetchArtifacts } = useStrategyArtifacts(activeThread?.id ?? null);
  const { rollup, memorySuggestions, isLoading: isRollupLoading, triggerRollup, refetch: refetchRollup } = useStrategyRollups(activeThread?.id ?? null);

  const handleWorkflowComplete = useCallback(() => {
    refetchOutputs();
    refetchRollup();
    refetchArtifacts();
  }, [refetchOutputs, refetchRollup, refetchArtifacts]);

  const handleCreateThreadWithOpts = useCallback((opts: CreateThreadOpts) => {
    createThreadWithOpts(opts);
  }, [createThreadWithOpts]);

  const handleSelectThread = useCallback((id: string) => {
    setActiveThreadId(id);
    if (isMobile) setMobileDrawerOpen(false);
  }, [setActiveThreadId, isMobile]);

  const handleBranchThread = useCallback(async (title: string, content: string) => {
    const newThreadId = await createThread(title, 'strategy', 'freeform');
    if (newThreadId && content) {
      try {
        const { supabase } = await import('@/integrations/supabase/client');
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await (supabase as any).from('strategy_messages').insert({
            thread_id: newThreadId,
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

  const sidebarContent = (
    <StrategyThreadSidebar
      threads={threads}
      activeThreadId={activeThread?.id ?? null}
      onSelectThread={handleSelectThread}
      onOpenCreateDialog={() => setCreateDialogOpen(true)}
      laneFilter={laneFilter}
      onLaneFilterChange={setLaneFilter}
      onCollapse={() => isMobile ? setMobileDrawerOpen(false) : setSidebarCollapsed(true)}
      isLoading={isLoading}
    />
  );

  return (
    <Layout>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Desktop sidebar */}
        {!isMobile && !sidebarCollapsed && sidebarContent}

        {/* Mobile sidebar drawer */}
        {isMobile && (
          <Drawer open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen} direction="left">
            <DrawerContent className="h-full w-[280px] rounded-none border-r border-border fixed inset-y-0 left-0 right-auto">
              <VisuallyHidden.Root>
                <DrawerTitle>Thread Navigation</DrawerTitle>
              </VisuallyHidden.Root>
              {sidebarContent}
            </DrawerContent>
          </Drawer>
        )}

        <StrategyMainPanel
          thread={activeThread}
          onUpdateThread={updateThread}
          sidebarCollapsed={isMobile || sidebarCollapsed}
          onExpandSidebar={() => isMobile ? setMobileDrawerOpen(true) : setSidebarCollapsed(false)}
          rightRailCollapsed={rightRailCollapsed}
          onToggleRightRail={() => setRightRailCollapsed(r => !r)}
          linkedContext={linkedContext}
          onSaveMemory={memoryObjectType ? (type, content) => saveMemory(type, content) : undefined}
          onWorkflowComplete={handleWorkflowComplete}
          onBranchThread={handleBranchThread}
          onTransformOutput={handleTransformOutput}
          isTransforming={isTransforming}
        />

        {!isMobile && !rightRailCollapsed && activeThread && (
          <StrategyRightRail
            thread={activeThread}
            onCollapse={() => setRightRailCollapsed(true)}
            linkedContext={linkedContext}
            memories={memories}
            uploads={uploads}
            outputs={outputs}
            artifacts={artifacts}
            onSaveMemory={saveMemory}
            onDeleteMemory={deleteMemory}
            onTogglePin={togglePin}
            onSetConfidence={setConfidence}
            onMarkIrrelevant={markIrrelevant}
            rollup={rollup}
            memorySuggestions={memorySuggestions}
            isRollupLoading={isRollupLoading}
            onTriggerRollup={triggerRollup}
            onRegenerateArtifact={regenerateArtifact}
            isTransforming={isTransforming}
            onReprocessUpload={summarizeUpload}
          />
        )}

        <CreateThreadDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onCreateThread={handleCreateThreadWithOpts}
        />
      </div>
    </Layout>
  );
}