import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  PanelLeftOpen, PanelRightOpen, Search, Mail, Target, Map,
  FileText, Send, Paperclip, Upload, Loader2, Zap, Database,
  Building2, MessageSquare, ClipboardList, Link2, Link2Off,
} from 'lucide-react';
import { LinkThreadDialog } from './LinkThreadDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { STRATEGY_UI } from '@/lib/strategy-ui';
import { StrategyCommandCenter } from './StrategyCommandCenter';
import { useStrategyMessages } from '@/hooks/strategy/useStrategyMessages';
import { useStrategyUploads } from '@/hooks/strategy/useStrategyUploads';
import { StrategyMessageBubble } from './StrategyMessageBubble';
import { DiscoveryPrepPrompter } from './tasks/DiscoveryPrepPrompter';
import { TaskOutputViewer } from './tasks/TaskOutputViewer';
import { sanitizeTaskRunResult, useTaskExecution } from '@/hooks/strategy/useTaskExecution';
import type { StrategyThread } from '@/types/strategy';
import { useIsMobile } from '@/hooks/use-mobile';

const WORKFLOWS = [
  { key: 'deep_research', label: 'Research', icon: Search, description: 'Deep account & market research' },
  { key: 'email_evaluation', label: 'Evaluate', icon: Mail, description: 'Score and rewrite messaging' },
  { key: 'opportunity_strategy', label: 'Opp Strategy', icon: Target, description: 'Build deal strategy' },
  { key: 'territory_tiering', label: 'Tier', icon: Map, description: 'Tier & prioritize accounts' },
  { key: 'account_plan', label: 'Plan', icon: FileText, description: 'Build account plan' },
  { key: 'brainstorm', label: 'Brainstorm', icon: Zap, description: 'Creative strategy session' },
];

const DEPTH_OPTIONS = ['Fast', 'Standard', 'Deep'] as const;

interface Props {
  thread: StrategyThread | null;
  onUpdateThread: (id: string, updates: Partial<StrategyThread>) => void;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  rightRailCollapsed: boolean;
  onToggleRightRail: () => void;
  linkedContext?: any;
  onSaveMemory?: (type: string, content: string) => void;
  onWorkflowComplete?: () => void;
  onBranchThread?: (title: string, content: string) => void;
  onTransformOutput?: (sourceOutputId: string, targetArtifactType: string) => void;
  isTransforming?: boolean;
  /** Phase 3 — fired after a streamed assistant turn completes */
  onAssistantComplete?: (assistantText: string) => void;
}

function getSuggestedPrompts(thread: StrategyThread | null, linkedContext?: any) {
  const accountName = linkedContext?.account?.name;
  const oppName = linkedContext?.opportunity?.name;

  if (thread?.thread_type === 'account_linked' && accountName) {
    return [
      { text: `Research ${accountName} deeply`, icon: Search },
      { text: `Build an account plan for ${accountName}`, icon: FileText },
      { text: `What's the best approach for ${accountName}?`, icon: Zap },
      { text: `Evaluate my outreach to ${accountName}`, icon: Mail },
    ];
  }
  if (thread?.thread_type === 'opportunity_linked' && oppName) {
    return [
      { text: `Build deal strategy for ${oppName}`, icon: Target },
      { text: `Who is the champion in this deal?`, icon: Building2 },
      { text: `What are the risks in this opportunity?`, icon: FileText },
      { text: `Brainstorm closing approaches`, icon: Zap },
    ];
  }
  if (thread?.thread_type === 'territory_linked') {
    return [
      { text: `Tier my territory accounts`, icon: Map },
      { text: `Which accounts should I prioritize?`, icon: Target },
      { text: `Build a territory plan`, icon: FileText },
      { text: `Research market trends`, icon: Search },
    ];
  }
  return [
    { text: 'Research this account deeply', icon: Search },
    { text: 'Evaluate this email draft', icon: Mail },
    { text: 'Build an account plan', icon: FileText },
    { text: 'Brainstorm approach options', icon: Zap },
  ];
}

function getRecommendedWorkflows(thread: StrategyThread | null): string[] {
  if (thread?.thread_type === 'account_linked') return ['deep_research', 'account_plan', 'brainstorm'];
  if (thread?.thread_type === 'opportunity_linked') return ['opportunity_strategy', 'deep_research', 'email_evaluation'];
  if (thread?.thread_type === 'territory_linked') return ['territory_tiering', 'deep_research', 'brainstorm'];
  return [];
}

export function StrategyMainPanel({
  thread, onUpdateThread, sidebarCollapsed, onExpandSidebar,
  rightRailCollapsed, onToggleRightRail, linkedContext,
  onSaveMemory, onWorkflowComplete, onBranchThread,
  onTransformOutput, isTransforming,
}: Props) {
  const isMobile = useIsMobile();
  const { messages, sendMessage, runWorkflow, isLoading, isSending } = useStrategyMessages(thread?.id ?? null);
  const { uploads, uploadFiles, isUploading } = useStrategyUploads(thread?.id ?? null);
  const { isRunning: isTaskRunning, progressLabel: taskProgressLabel, result: taskResult, runDiscoveryPrep, applyRedline, rejectRedline, reset: resetTask } = useTaskExecution();
  const [input, setInput] = useState('');
  const [depth, setDepth] = useState<typeof DEPTH_OPTIONS[number]>('Standard');
  
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null);
  const [workflowSheetOpen, setWorkflowSheetOpen] = useState(false);
  const [taskPrompterOpen, setTaskPrompterOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const suggestedPrompts = useMemo(() => getSuggestedPrompts(thread, linkedContext), [thread?.id, linkedContext]);
  const recommendedWorkflows = useMemo(() => getRecommendedWorkflows(thread), [thread?.id]);
  const safeTaskResult = useMemo(() => sanitizeTaskRunResult(taskResult), [taskResult]);

  // Split workflows into visible (recommended) and overflow (rest)
  const visibleWorkflows = useMemo(() =>
    WORKFLOWS.filter(w => recommendedWorkflows.includes(w.key)).slice(0, 3),
    [recommendedWorkflows]
  );
  const overflowWorkflows = useMemo(() =>
    WORKFLOWS.filter(w => !recommendedWorkflows.includes(w.key)),
    [recommendedWorkflows]
  );


  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      const scrollContainer = el.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !thread || isSending) return;
    const text = input.trim();
    setInput('');
    await sendMessage(text, { depth });
  }, [input, thread, sendMessage, depth, isSending]);

  const handleWorkflow = useCallback(async (workflowType: string) => {
    if (!thread || activeWorkflow || isSending) return;
    setWorkflowSheetOpen(false);
    setActiveWorkflow(workflowType);
    try {
      const result = await runWorkflow(workflowType, { content: input.trim() || undefined });
      setInput('');
      if (result) onWorkflowComplete?.();
    } finally {
      setActiveWorkflow(null);
    }
  }, [thread, runWorkflow, input, onWorkflowComplete, activeWorkflow, isSending]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  }, [uploadFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) uploadFiles(e.target.files);
    e.target.value = '';
  }, [uploadFiles]);

  const handleSaveFromMessage = useCallback((content: string, type: string) => {
    onSaveMemory?.(type, content);
  }, [onSaveMemory]);

  const handleTransformOutput = useCallback((sourceOutputId: string, targetArtifactType: string) => {
    onTransformOutput?.(sourceOutputId, targetArtifactType);
  }, [onTransformOutput]);

  const handleBranchThread = useCallback((workflowType: string, structured: any) => {
    const summary = structured?.summary || structured?.executive_summary || '';
    if (onBranchThread) {
      onBranchThread(`Follow-up: ${workflowType.replace(/_/g, ' ')}`, summary);
    }
  }, [onBranchThread]);

  const handleSuggestedPrompt = useCallback((text: string) => {
    setInput(text);
  }, []);

  if (!thread) {
    return (
      <StrategyCommandCenter
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={onExpandSidebar}
      />
    );
  }

  // If a task result is showing, render the output viewer as a full overlay
  if (safeTaskResult) {
    return (
      <TaskOutputViewer
        result={safeTaskResult}
        onBack={resetTask}
        onApplyRedline={applyRedline}
        onRejectRedline={rejectRedline}
      />
    );
  }

  const hasLinkedObject = linkedContext?.account || linkedContext?.opportunity;
  const ThreadIcon = thread.thread_type === 'account_linked' ? Building2
    : thread.thread_type === 'opportunity_linked' ? Target
    : thread.thread_type === 'territory_linked' ? Map
    : MessageSquare;

  const activeWorkflowLabel = activeWorkflow
    ? WORKFLOWS.find(w => w.key === activeWorkflow)?.label ?? activeWorkflow.replace(/_/g, ' ')
    : null;

  return (
    <div
      className={cn('flex-1 flex flex-col min-w-0 min-h-0 bg-background relative', isDragOver && 'ring-2 ring-primary/30 ring-inset')}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect}
        accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.json,.xml,.html" />

      {/* ── HEADER — single row ── */}
      <div className="shrink-0 px-3 py-0.5 border-b border-border/8 flex items-center gap-1.5">
        {sidebarCollapsed && (
          <Button size="icon" variant="ghost" className="h-5 w-5 shrink-0 text-foreground/30" onClick={onExpandSidebar}>
            <PanelLeftOpen className="h-3 w-3" />
          </Button>
        )}
        <ThreadIcon className="h-2.5 w-2.5 text-primary/30 shrink-0" />
        <h1 className="text-[11px] font-semibold text-foreground/70 truncate min-w-0">{thread.title}</h1>

        {/* Linkage chip — explicit confirmed-mode signal. Click to open LinkThreadDialog. */}
        {(() => {
          const acctName = linkedContext?.account?.name as string | undefined;
          const oppName = linkedContext?.opportunity?.name as string | undefined;
          const isLinked = !!(thread.linked_account_id || thread.linked_opportunity_id);
          const label = acctName ?? oppName ?? (isLinked ? 'Linked' : 'Freeform');
          return (
            <button
              onClick={() => setLinkDialogOpen(true)}
              className={cn(
                'h-5 px-1.5 rounded-md flex items-center gap-1 text-[10px] font-medium border transition-colors shrink-0 max-w-[140px]',
                isLinked
                  ? 'border-primary/30 bg-primary/5 text-primary hover:bg-primary/10'
                  : 'border-dashed border-border/50 text-muted-foreground hover:border-border hover:text-foreground/70'
              )}
              title={isLinked ? `Linked to ${label} — click to change` : 'Freeform thread — click to link to an account or opportunity'}
            >
              {isLinked ? <Link2 className="h-2.5 w-2.5" /> : <Link2Off className="h-2.5 w-2.5" />}
              <span className="truncate">{label}</span>
            </button>
          );
        })()}

        <div className="flex-1" />

        {/* Workflow actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          {visibleWorkflows.map(w => {
            const isRunning = activeWorkflow === w.key;
            return (
              <button
                key={w.key}
                className={cn(
                  'h-6 px-2 shrink-0 rounded-md transition-all flex items-center gap-1 text-[10px] font-medium border',
                  'border-border/20 hover:bg-muted/30',
                  isRunning ? 'text-primary border-primary/30 bg-primary/5' : 'text-foreground/40 hover:text-foreground/60',
                  (isSending || !!activeWorkflow) && !isRunning && 'opacity-30 pointer-events-none'
                )}
                onClick={() => handleWorkflow(w.key)}
                title={w.description}
                disabled={isSending || !!activeWorkflow}
              >
                {isRunning ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <w.icon className="h-2.5 w-2.5" />}
                <span className={isMobile ? 'hidden sm:inline' : ''}>{w.label}</span>
              </button>
            );
          })}
          {overflowWorkflows.length > 0 && (
              <button
               className={cn(
                 'h-6 px-2 shrink-0 rounded-full transition-all flex items-center text-[10px] font-medium border',
                 'border-border/25 hover:bg-muted/25 text-muted-foreground/60 hover:text-foreground hover:border-border/45'
               )}
               onClick={() => setWorkflowSheetOpen(true)}
             >
               +{overflowWorkflows.length} more
             </button>
          )}
        </div>

        {!isMobile && !rightRailCollapsed && (
          <Button size="icon" variant="ghost" className="h-5 w-5 text-foreground/15 shrink-0" onClick={onToggleRightRail}>
            <PanelRightOpen className="h-2.5 w-2.5" />
          </Button>
        )}
      </div>

      {/* Running indicator — subtle line below header */}
      {(activeWorkflow || isUploading) && (
        <div className="shrink-0 px-3 py-px">
          {activeWorkflow && (
            <span className="text-[10px] text-muted-foreground/35 flex items-center gap-1">
              <Loader2 className="h-2 w-2 animate-spin text-primary/25" />
              Running {activeWorkflowLabel}…
            </span>
          )}
          {isUploading && (
            <span className="text-[10px] text-muted-foreground/30 flex items-center gap-1 animate-pulse">
              <Loader2 className="h-2 w-2 animate-spin" /> Uploading…
            </span>
          )}
        </div>
      )}

      {/* ── SCROLLABLE CONVERSATION ── */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="px-3 pt-1 pb-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-3 gap-1.5">
              <div className="h-7 w-7 rounded-lg bg-muted/30 flex items-center justify-center">
                <ThreadIcon className="h-3.5 w-3.5 text-foreground/25" />
              </div>
              <p className="text-[11px] font-medium text-foreground/70">
                {hasLinkedObject ? `Ready to strategize on ${linkedContext?.account?.name || linkedContext?.opportunity?.name}` : 'Ready to strategize'}
              </p>
              <p className="text-[10px] text-foreground/30 max-w-[240px] text-center leading-relaxed">
                Start a conversation, run a workflow, or drop files
              </p>
              <div className="flex flex-wrap justify-center gap-1 max-w-xs mt-0.5">
                {suggestedPrompts.map((sp, i) => (
                  <button
                    key={i}
                    className="h-5 text-[9px] px-1.5 gap-1 border border-border/20 hover:border-primary/20 hover:bg-primary/5 rounded transition-all flex items-center text-foreground/40 hover:text-foreground/60"
                    onClick={() => handleSuggestedPrompt(sp.text)}
                  >
                    <sp.icon className="h-2 w-2 text-primary/40" />
                    {sp.text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              {messages.map((m, i) => {
                const prevRole = i > 0 ? messages[i - 1].role : null;
                const roleSwitch = prevRole && prevRole !== m.role && prevRole !== 'system' && m.role !== 'system';
                return (
                  <div key={m.id}>
                    {roleSwitch && <div className="h-px bg-border/10 my-0.5" />}
                    <StrategyMessageBubble
                      message={m}
                      onSaveAsMemory={onSaveMemory ? handleSaveFromMessage : undefined}
                      onTransformOutput={handleTransformOutput}
                      onBranchThread={handleBranchThread}
                      isTransforming={isTransforming}
                    />
                  </div>
                );
              })}
              {isSending && !activeWorkflow && (
                <div className="flex justify-start mt-0.5">
                  <div className="max-w-[78%] w-fit self-start rounded-xl rounded-bl-sm px-3.5 py-2 bg-card/55 border border-border/25 flex items-center gap-1.5">
                    <div className="flex gap-0.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/30 animate-bounce [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/30 animate-bounce [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/30 animate-bounce [animation-delay:300ms]" />
                    </div>
                    <span className="text-[10px] text-muted-foreground/50">Thinking…</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-card border-2 border-dashed border-primary/30 rounded-2xl px-10 py-8 text-center shadow-lg">
            <Upload className="h-10 w-10 text-primary/60 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">Drop files to add context</p>
            <p className="text-[10px] text-foreground/50 mt-1">PDF, DOCX, CSV, text files supported</p>
          </div>
        </div>
      )}

      {/* ── TASK SHORTCUT ROW ── */}
      <div className="shrink-0 px-3 py-1 border-t border-border/8">
        <button
          className={cn(
            'flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[10px] font-medium transition-all',
            'border border-primary/20 bg-primary/5 hover:bg-primary/10 text-primary',
            'active:scale-[0.98]',
            (isSending || isTaskRunning) && 'opacity-50 pointer-events-none'
          )}
          onClick={() => setTaskPrompterOpen(true)}
          disabled={isSending || isTaskRunning}
        >
          {isTaskRunning ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Zap className="h-3 w-3" />
          )}
          {isTaskRunning ? (taskProgressLabel || 'Generating Prep Doc…') : 'Discovery Prep'}
        </button>
      </div>

      {/* ── COMPOSER — docked ── */}
      <div className="shrink-0 border-t border-border/15 bg-background/65 backdrop-blur-md px-3 pb-[calc(0.25rem+var(--shell-nav-height,0)*1px+env(safe-area-inset-bottom))] pt-1">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isSending ? 'Waiting…' : hasLinkedObject ? `Message about ${linkedContext?.account?.name || linkedContext?.opportunity?.name || 'this'}…` : 'Message…'}
            className={cn(
              'w-full border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none text-sm resize-none bg-transparent',
              isMobile ? 'min-h-[34px]' : 'min-h-[32px]'
            )}
            rows={1}
            disabled={isSending}
          />
          <div className="flex items-center justify-between px-0.5 pt-0.5">
            <div className="flex items-center gap-1.5">
              <div className="flex rounded overflow-hidden">
                {DEPTH_OPTIONS.map(d => (
                  <button
                    key={d}
                    type="button"
                    className={cn(
                      'px-2 py-0.5 text-[9px] font-medium transition-all rounded',
                      depth === d
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground/25 hover:text-foreground/40'
                    )}
                    onClick={() => setDepth(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <button
                className="h-5 w-5 flex items-center justify-center text-foreground/20 hover:text-foreground/40 transition-colors rounded"
                title="Attach file"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSending}
              >
                <Paperclip className="h-3 w-3" />
              </button>
            </div>
            <Button
              size="sm"
              className="h-6 gap-1 px-3 shrink-0 font-semibold rounded-md text-xs"
              onClick={handleSend}
              disabled={!input.trim() || isSending}
            >
              {isSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send
            </Button>
          </div>
      </div>

      {/* ── Workflow overflow sheet (mobile) ── */}
      <Sheet open={workflowSheetOpen} onOpenChange={setWorkflowSheetOpen}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[52vh] pt-3.5 pb-3">
          <SheetHeader className="pb-1">
            <SheetTitle className="text-[11px] font-semibold text-foreground/70">Workflows</SheetTitle>
            <SheetDescription className="text-[9px] text-foreground/30 -mt-1">
              Run a workflow on this thread
            </SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-1 pb-1">
            {WORKFLOWS.map(w => {
              const isRunning = activeWorkflow === w.key;
              const isRecommended = recommendedWorkflows.includes(w.key);
              return (
                <button
                  key={w.key}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1 rounded-lg border text-left transition-colors active:scale-[0.98]',
                    'border-border/25 bg-card/35 hover:bg-card/50 active:bg-card/60',
                    isRecommended && 'border-primary/15',
                    isRunning && 'border-primary/25 bg-primary/5',
                    (isSending || !!activeWorkflow) && 'opacity-50 pointer-events-none'
                  )}
                  onClick={() => handleWorkflow(w.key)}
                  disabled={isSending || !!activeWorkflow}
                >
                  {isRunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                  ) : (
                    <w.icon className={cn('h-3.5 w-3.5 shrink-0', isRecommended ? 'text-primary/60' : 'text-foreground/30')} />
                  )}
                  <div className="min-w-0">
                    <span className="text-[11px] font-medium text-foreground/75 block">{w.label}</span>
                    <span className="text-[9px] text-foreground/25 leading-tight block">{w.description}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Discovery Prep Prompter ── */}
      <DiscoveryPrepPrompter
        open={taskPrompterOpen}
        onOpenChange={setTaskPrompterOpen}
        onSubmit={async (inputs) => {
          setTaskPrompterOpen(false);
          await runDiscoveryPrep({ ...inputs, thread_id: thread?.id });
        }}
        isRunning={isTaskRunning}
        linkedContext={linkedContext}
      />

      {/* ── Link Thread Dialog — explicit account/opportunity linkage ── */}
      <LinkThreadDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        thread={thread}
        onApply={async (updates) => {
          await onUpdateThread(thread.id, updates);
        }}
      />
    </div>
  );
}

