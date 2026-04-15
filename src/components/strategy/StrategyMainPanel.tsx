import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  PanelLeftOpen, PanelRightOpen, Search, Mail, Target, Map,
  FileText, Send, Paperclip, Upload, Loader2, Zap, Database,
  Building2, MessageSquare,
} from 'lucide-react';
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
  const [input, setInput] = useState('');
  const [depth, setDepth] = useState<typeof DEPTH_OPTIONS[number]>('Standard');
  const [activeLane, setActiveLane] = useState<string>(thread?.lane ?? 'research');
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null);
  const [workflowSheetOpen, setWorkflowSheetOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const suggestedPrompts = useMemo(() => getSuggestedPrompts(thread, linkedContext), [thread?.id, linkedContext]);
  const recommendedWorkflows = useMemo(() => getRecommendedWorkflows(thread), [thread?.id]);

  // Split workflows into visible (recommended) and overflow (rest)
  const visibleWorkflows = useMemo(() =>
    isMobile ? WORKFLOWS.filter(w => recommendedWorkflows.includes(w.key)).slice(0, 3) : WORKFLOWS,
    [isMobile, recommendedWorkflows]
  );
  const overflowWorkflows = useMemo(() =>
    isMobile ? WORKFLOWS.filter(w => !recommendedWorkflows.includes(w.key)) : [],
    [isMobile, recommendedWorkflows]
  );

  useEffect(() => {
    if (thread?.lane) setActiveLane(thread.lane);
  }, [thread?.id]);

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

      {/* ── HEADER — single unified control surface ── */}
      <div className="shrink-0 bg-card/40 px-3 py-1.5 space-y-1">
        {/* Title row */}
        <div className="flex items-center gap-2">
          {sidebarCollapsed && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onExpandSidebar}>
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          )}
          <ThreadIcon className="h-3.5 w-3.5 text-primary/50 shrink-0" />
          <h1 className="text-sm font-semibold text-foreground truncate flex-1">{thread.title}</h1>
          {isUploading && (
            <Badge variant="secondary" className="text-[10px] gap-1 animate-pulse shrink-0">
              <Loader2 className="h-3 w-3 animate-spin" /> Uploading
            </Badge>
          )}
          {activeWorkflow && (
            <span className="text-[10px] text-primary/50 font-medium shrink-0 flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {activeWorkflowLabel}
            </span>
          )}
          {!isMobile && !rightRailCollapsed && (
            <Button size="icon" variant="ghost" className="h-6 w-6 text-foreground/25" onClick={onToggleRightRail}>
              <PanelRightOpen className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Workflow strip — same surface, no divider */}
        <div className="flex items-center gap-1">
          {!isMobile && (
            <>
              <span className="text-[10px] text-muted-foreground/50 font-medium shrink-0">
                {thread.lane}
              </span>
              {linkedContext?.account && (
                <span className="text-[10px] text-foreground/40 flex items-center gap-0.5 shrink-0">
                  <Building2 className="h-2.5 w-2.5" />
                  {linkedContext.account.name}
                </span>
              )}
              {linkedContext?.opportunity && (
                <span className="text-[10px] text-foreground/40 flex items-center gap-0.5 shrink-0">
                  <Target className="h-2.5 w-2.5" />
                  {linkedContext.opportunity.name}
                </span>
              )}
              <span className="text-foreground/10 mx-0.5 shrink-0">·</span>
            </>
          )}

          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            {visibleWorkflows.map(w => {
              const isRunning = activeWorkflow === w.key;
              const isRecommended = recommendedWorkflows.includes(w.key);
              return (
                <button
                  key={w.key}
                  className={cn(
                    'h-6 text-[10px] px-2 gap-1 shrink-0 rounded-md font-medium transition-all flex items-center',
                    'border border-transparent hover:border-border/40 hover:bg-muted/30',
                    isRunning && 'border-primary/30 bg-primary/5 text-primary',
                    isRecommended && !isRunning && 'text-foreground/60',
                    !isRecommended && !isRunning && 'text-foreground/40',
                    (isSending || !!activeWorkflow) && 'opacity-50 pointer-events-none'
                  )}
                  onClick={() => handleWorkflow(w.key)}
                  title={w.description}
                  disabled={isSending || !!activeWorkflow}
                >
                  {isRunning ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <w.icon className="h-3 w-3" />
                  )}
                  {w.label}
                </button>
              );
            })}

            {overflowWorkflows.length > 0 && (
              <button
                className="h-6 px-2.5 text-[10px] font-medium rounded-md transition-all shrink-0 flex items-center gap-1.5 bg-muted/30 hover:bg-muted/50 text-foreground/50 hover:text-foreground/70"
                onClick={() => setWorkflowSheetOpen(true)}
              >
                <Zap className="h-2.5 w-2.5" />
                Workflows
                <span className="bg-foreground/10 rounded px-1 py-px text-[9px]">{overflowWorkflows.length}</span>
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />

      {/* ── HEADER — unified control surface ── — ends above */}

      {/* ── SCROLLABLE CONVERSATION ── */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="px-3 py-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-4 gap-2">
              <div className="h-8 w-8 rounded-lg bg-muted/40 flex items-center justify-center">
                <ThreadIcon className="h-4 w-4 text-foreground/30" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-xs font-medium text-foreground/80">
                  {hasLinkedObject ? `Ready to strategize on ${linkedContext?.account?.name || linkedContext?.opportunity?.name}` : 'Ready to strategize'}
                </p>
                <p className="text-[11px] text-foreground/40 max-w-[260px] leading-relaxed">
                  Start a conversation, run a workflow, or drop files
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-1 max-w-xs">
                {suggestedPrompts.map((sp, i) => (
                  <button
                    key={i}
                    className="h-6 text-[10px] px-2 gap-1 border border-border/30 hover:border-primary/20 hover:bg-primary/5 rounded-md transition-all flex items-center text-foreground/50 hover:text-foreground/70"
                    onClick={() => handleSuggestedPrompt(sp.text)}
                  >
                    <sp.icon className="h-2.5 w-2.5 text-primary/50" />
                    {sp.text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {messages.map((m, i) => {
                const prevRole = i > 0 ? messages[i - 1].role : null;
                const roleSwitch = prevRole && prevRole !== m.role && prevRole !== 'system' && m.role !== 'system';
                return (
                  <div key={m.id}>
                    {roleSwitch && <div className="border-t border-border/15 my-1" />}
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
                <div className="flex justify-start">
                  <div className="bg-muted/40 rounded-lg px-3 py-2 flex items-center gap-2">
                    <div className="flex gap-0.5">
                      <span className="h-1 w-1 rounded-full bg-primary/40 animate-bounce [animation-delay:0ms]" />
                      <span className="h-1 w-1 rounded-full bg-primary/40 animate-bounce [animation-delay:150ms]" />
                      <span className="h-1 w-1 rounded-full bg-primary/40 animate-bounce [animation-delay:300ms]" />
                    </div>
                    <span className="text-[11px] text-foreground/40">Thinking…</span>
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

      {/* ── COMPOSER ── */}
      <div className="shrink-0 bg-card/50 px-3 pt-1.5 pb-[calc(0.25rem+var(--shell-nav-height,0)*1px+env(safe-area-inset-bottom))]">
        <div className="rounded-xl border border-border/50 bg-background shadow-sm overflow-hidden">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isSending ? 'Waiting…' : hasLinkedObject ? `Message about ${linkedContext?.account?.name || linkedContext?.opportunity?.name || 'this'}…` : 'Message…'}
            className={cn(
              'w-full border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none text-sm resize-none bg-transparent',
              isMobile ? 'min-h-[36px]' : 'min-h-[34px]'
            )}
            rows={1}
            disabled={isSending}
          />
          <div className="flex items-center justify-between px-2 py-1">
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg overflow-hidden bg-muted/30">
                {DEPTH_OPTIONS.map(d => (
                  <button
                    key={d}
                    type="button"
                    className={cn(
                      'px-2.5 py-0.5 text-[10px] font-medium transition-all rounded-md',
                      depth === d
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-foreground/30 hover:text-foreground/50'
                    )}
                    onClick={() => setDepth(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <button
                className="h-6 w-6 flex items-center justify-center text-foreground/25 hover:text-foreground/50 transition-colors rounded-md hover:bg-muted/30"
                title="Attach file"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSending}
              >
                <Paperclip className="h-3.5 w-3.5" />
              </button>
            </div>
            <Button
              size="sm"
              className="h-7 gap-1.5 px-4 shrink-0 font-semibold rounded-lg shadow-sm"
              onClick={handleSend}
              disabled={!input.trim() || isSending}
            >
              {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send
            </Button>
          </div>
        </div>
      </div>
      </div>

      {/* ── Workflow overflow sheet (mobile) ── */}
      <Sheet open={workflowSheetOpen} onOpenChange={setWorkflowSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[45vh]">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-sm">Workflows</SheetTitle>
            <SheetDescription className="text-[11px] text-foreground/50">
              Run a workflow on this thread
            </SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-2 pb-3">
            {WORKFLOWS.map(w => {
              const isRunning = activeWorkflow === w.key;
              const isRecommended = recommendedWorkflows.includes(w.key);
              return (
                <button
                  key={w.key}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-3 rounded-lg border text-left transition-colors',
                    'border-border/50 hover:bg-muted/30 active:bg-muted/50',
                    isRecommended && 'border-primary/25',
                    isRunning && 'border-primary/40 bg-primary/5',
                    (isSending || !!activeWorkflow) && 'opacity-50 pointer-events-none'
                  )}
                  onClick={() => handleWorkflow(w.key)}
                  disabled={isSending || !!activeWorkflow}
                >
                  {isRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                  ) : (
                    <w.icon className={cn('h-4 w-4 shrink-0', isRecommended ? 'text-primary' : 'text-foreground/40')} />
                  )}
                  <div className="min-w-0">
                    <span className="text-xs font-medium block">{w.label}</span>
                    <span className="text-[10px] text-foreground/35 leading-tight block">{w.description}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function getLaneColor(lane: string): string {
  const colors: Record<string, string> = {
    research: 'text-blue-400 border-blue-400/30',
    evaluate: 'text-amber-400 border-amber-400/30',
    build: 'text-green-400 border-green-400/30',
    strategy: 'text-purple-400 border-purple-400/30',
    brainstorm: 'text-pink-400 border-pink-400/30',
  };
  return colors[lane] || '';
}
