import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  PanelLeftOpen, PanelRightOpen, Search, Mail, Target, Map,
  FileText, Send, Paperclip, Upload, Loader2, Zap, Database,
  Building2, MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { STRATEGY_UI } from '@/lib/strategy-ui';
import { StrategyCommandCenter } from './StrategyCommandCenter';
import { useStrategyMessages } from '@/hooks/strategy/useStrategyMessages';
import { useStrategyUploads } from '@/hooks/strategy/useStrategyUploads';
import { StrategyMessageBubble } from './StrategyMessageBubble';
import type { StrategyThread, StrategyLane } from '@/types/strategy';
import { LANES } from '@/types/strategy';
import { toast } from 'sonner';

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
  const { messages, sendMessage, runWorkflow, isLoading, isSending } = useStrategyMessages(thread?.id ?? null);
  const { uploads, uploadFiles, isUploading } = useStrategyUploads(thread?.id ?? null);
  const [input, setInput] = useState('');
  const [depth, setDepth] = useState<typeof DEPTH_OPTIONS[number]>('Standard');
  const [activeLane, setActiveLane] = useState<string>(thread?.lane ?? 'research');
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const suggestedPrompts = useMemo(() => getSuggestedPrompts(thread, linkedContext), [thread?.id, linkedContext]);
  const recommendedWorkflows = useMemo(() => getRecommendedWorkflows(thread), [thread?.id]);

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

  return (
    <div
      className={cn('flex-1 flex flex-col min-w-0 bg-background relative', isDragOver && 'ring-2 ring-primary/30 ring-inset')}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect}
        accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.json,.xml,.html" />

      {/* Top Bar */}
      <div className="border-b border-border px-4 py-2.5 flex items-center gap-2 shrink-0">
        {sidebarCollapsed && (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onExpandSidebar}>
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        )}
        <ThreadIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <h1 className="text-sm font-semibold text-foreground truncate flex-1">{thread.title}</h1>
        {isUploading && (
          <Badge variant="secondary" className="text-[10px] gap-1 animate-pulse">
            <Loader2 className="h-3 w-3 animate-spin" /> Uploading
          </Badge>
        )}
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onToggleRightRail}>
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </div>

      {/* Scope Card */}
      <div className="px-4 pt-3 shrink-0">
        <Card className="border-border">
          <CardContent className="p-3 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px] font-medium">
                {thread.thread_type.replace(/_/g, ' ')}
              </Badge>
              <Badge variant="outline" className={cn('text-[10px]', getLaneColor(thread.lane))}>
                {thread.lane}
              </Badge>
              {linkedContext?.account && (
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Building2 className="h-2.5 w-2.5" />
                  {linkedContext.account.name}
                  {linkedContext.account.tier && <span className="text-muted-foreground">· {linkedContext.account.tier}</span>}
                </Badge>
              )}
              {linkedContext?.opportunity && (
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Target className="h-2.5 w-2.5" />
                  {linkedContext.opportunity.name}
                  {linkedContext.opportunity.stage && <span className="text-muted-foreground">· {linkedContext.opportunity.stage}</span>}
                </Badge>
              )}
            </div>
            {thread.summary && (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{thread.summary}</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {WORKFLOWS.map(w => {
                const isRunning = activeWorkflow === w.key;
                const isRecommended = recommendedWorkflows.includes(w.key);
                return (
                  <Button
                    key={w.key}
                    size="sm"
                    variant="outline"
                    className={cn(
                      'h-7 text-[10px] px-2.5 gap-1.5 transition-all',
                      isRunning && 'border-primary/40 bg-primary/5',
                      isRecommended && !isRunning && 'border-primary/20'
                    )}
                    disabled={isSending || !!activeWorkflow}
                    onClick={() => handleWorkflow(w.key)}
                    title={w.description}
                  >
                    {isRunning ? (
                      <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    ) : (
                      <w.icon className={cn('h-3 w-3', isRecommended && 'text-primary/70')} />
                    )}
                    {w.label}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Workflow Banner */}
      {activeWorkflow && (
        <div className="px-4 pt-2">
          <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-2 flex items-center gap-3">
            <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            </div>
            <div>
              <span className="text-xs font-medium text-primary">
                Running {activeWorkflow.replace(/_/g, ' ')}
              </span>
              <p className="text-[10px] text-muted-foreground">Retrieving context and generating structured output…</p>
            </div>
          </div>
        </div>
      )}

      {/* Lane Tabs */}
      <div className="px-4 pt-2.5 shrink-0">
        <Tabs value={activeLane} onValueChange={setActiveLane}>
          <TabsList className="h-8">
            {LANES.map(l => (
              <TabsTrigger key={l.value} value={l.value} className="text-xs px-3 h-6 data-[state=active]:bg-background">
                {l.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Conversation Area */}
      <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef}>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-6">
            <div className="h-14 w-14 rounded-2xl bg-muted/60 flex items-center justify-center">
              <ThreadIcon className="h-7 w-7 text-foreground/40" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-base font-semibold text-foreground">
                {hasLinkedObject ? `Ready to strategize on ${linkedContext?.account?.name || linkedContext?.opportunity?.name}` : 'Ready to strategize'}
              </p>
              <p className="text-sm text-foreground/60 max-w-[320px] leading-relaxed">
                Start a conversation, run a workflow above, or drop files to add context.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {suggestedPrompts.map((sp, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant="outline"
                  className="h-9 text-xs gap-2 border-border hover:border-primary/30 hover:bg-primary/5 transition-all"
                  onClick={() => handleSuggestedPrompt(sp.text)}
                >
                  <sp.icon className="h-3.5 w-3.5 text-primary/70" />
                  <span className="text-foreground/90">{sp.text}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map(m => (
              <StrategyMessageBubble
                key={m.id}
                message={m}
                onSaveAsMemory={onSaveMemory ? handleSaveFromMessage : undefined}
                onTransformOutput={handleTransformOutput}
                onBranchThread={handleBranchThread}
                isTransforming={isTransforming}
              />
            ))}
            {isSending && !activeWorkflow && (
              <div className="flex justify-start">
                <div className="bg-muted/60 rounded-lg px-3 py-2.5 flex items-center gap-2.5">
                  <div className="flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                  </div>
                  <span className="text-xs text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-card border-2 border-dashed border-primary/30 rounded-2xl px-10 py-8 text-center shadow-lg">
            <Upload className="h-10 w-10 text-primary/60 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">Drop files to add context</p>
            <p className="text-[10px] text-muted-foreground mt-1">PDF, DOCX, CSV, text files supported</p>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border p-3 pr-[4.5rem] sm:pr-3 shrink-0 bg-card/50">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isSending ? 'Waiting for response…' : hasLinkedObject ? `Ask about ${linkedContext?.account?.name || linkedContext?.opportunity?.name || 'this object'}…` : 'Type your message or paste content to analyze…'}
              className="min-h-[44px] max-h-[120px] pr-10 text-sm resize-none border-border focus-visible:ring-primary/20"
              rows={1}
              disabled={isSending}
            />
            <div className="absolute right-2 bottom-2">
              <Button
                size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground"
                title="Attach file"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSending}
              >
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex gap-0.5">
              {DEPTH_OPTIONS.map(d => (
                <Badge
                  key={d}
                  variant={depth === d ? 'default' : 'outline'}
                  className={cn(
                    'cursor-pointer text-[9px] px-1.5 py-0 transition-colors',
                    depth === d ? '' : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setDepth(d)}
                >
                  {d}
                </Badge>
              ))}
            </div>
            <Button
              size="sm"
              className="h-8 gap-1.5 px-4"
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
