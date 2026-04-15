import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  PanelLeftOpen, PanelRightOpen, Search, Mail, Target, Map,
  FileText, Pin, Send, Paperclip, Upload, Loader2, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useStrategyMessages } from '@/hooks/strategy/useStrategyMessages';
import { useStrategyUploads } from '@/hooks/strategy/useStrategyUploads';
import { StrategyMessageBubble } from './StrategyMessageBubble';
import type { StrategyThread, StrategyLane } from '@/types/strategy';
import { LANES } from '@/types/strategy';

const WORKFLOWS = [
  { key: 'deep_research', label: 'Deep Research', icon: Search },
  { key: 'email_evaluation', label: 'Evaluate Email', icon: Mail },
  { key: 'opportunity_strategy', label: 'Opp Strategy', icon: Target },
  { key: 'territory_tiering', label: 'Tier Accounts', icon: Map },
  { key: 'account_plan', label: 'Account Plan', icon: FileText },
  { key: 'brainstorm', label: 'Brainstorm', icon: Zap },
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
}

export function StrategyMainPanel({
  thread, onUpdateThread, sidebarCollapsed, onExpandSidebar,
  rightRailCollapsed, onToggleRightRail, linkedContext,
}: Props) {
  const { messages, sendMessage, runWorkflow, isLoading, isSending } = useStrategyMessages(thread?.id ?? null);
  const { uploads, uploadFiles, isUploading } = useStrategyUploads(thread?.id ?? null);
  const [input, setInput] = useState('');
  const [depth, setDepth] = useState<typeof DEPTH_OPTIONS[number]>('Standard');
  const [activeLane, setActiveLane] = useState<string>(thread?.lane ?? 'research');
  const [isDragOver, setIsDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      const scrollContainer = el.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, [messages.length]);

  const uploadContext = useMemo(() =>
    uploads.filter(u => u.parsed_text).map(u => ({
      file_name: u.file_name,
      parsed_text: u.parsed_text,
      summary: u.summary,
    })),
  [uploads]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !thread) return;
    const text = input.trim();
    setInput('');
    await sendMessage(text, {
      linkedContext,
      uploadedResources: uploadContext,
      depth,
    });
  }, [input, thread, sendMessage, linkedContext, uploadContext, depth]);

  const handleWorkflow = useCallback(async (workflowType: string) => {
    if (!thread) return;
    await runWorkflow(workflowType, {
      content: input.trim() || undefined,
      linkedContext,
      uploadedResources: uploadContext,
    });
    setInput('');
  }, [thread, runWorkflow, input, linkedContext, uploadContext]);

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

  if (!thread) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          {sidebarCollapsed && (
            <Button size="sm" variant="ghost" className="mb-4" onClick={onExpandSidebar}>
              <PanelLeftOpen className="h-4 w-4 mr-1" /> Show Threads
            </Button>
          )}
          <p className="text-muted-foreground text-sm">Select or create a thread to begin.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn('flex-1 flex flex-col min-w-0 bg-background', isDragOver && 'ring-2 ring-primary/40 ring-inset')}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />

      {/* Top Bar */}
      <div className="border-b border-border px-4 py-2 flex items-center gap-2 shrink-0">
        {sidebarCollapsed && (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onExpandSidebar}>
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        )}
        <h1 className="text-sm font-semibold truncate flex-1">{thread.title}</h1>
        {isUploading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onToggleRightRail}>
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </div>

      {/* Scope Card */}
      <div className="px-4 pt-3 shrink-0">
        <Card className="bg-muted/30">
          <CardContent className="p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  {thread.thread_type.replace('_', ' ')} · {thread.lane}
                </p>
                {linkedContext?.account && (
                  <Badge variant="outline" className="text-[10px]">{linkedContext.account.name}</Badge>
                )}
                {linkedContext?.opportunity && (
                  <Badge variant="outline" className="text-[10px]">{linkedContext.opportunity.name}</Badge>
                )}
              </div>
              {thread.summary && (
                <p className="text-xs mt-1 text-foreground/80 line-clamp-2">{thread.summary}</p>
              )}
            </div>
            {/* Workflow Actions */}
            <div className="flex flex-wrap gap-1 mt-2">
              {WORKFLOWS.map(w => (
                <Button
                  key={w.key}
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] px-2 gap-1"
                  disabled={isSending}
                  onClick={() => handleWorkflow(w.key)}
                >
                  <w.icon className="h-3 w-3" /> {w.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lane Tabs */}
      <div className="px-4 pt-2 shrink-0">
        <Tabs value={activeLane} onValueChange={setActiveLane}>
          <TabsList className="h-8">
            {LANES.map(l => (
              <TabsTrigger key={l.value} value={l.value} className="text-xs px-3 h-6">
                {l.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Conversation Area */}
      <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef}>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <p className="text-sm text-muted-foreground">Start a conversation or run a workflow.</p>
            <p className="text-xs text-muted-foreground/60">
              Drop files here to add context. Use workflow buttons above for structured analysis.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map(m => (
              <StrategyMessageBubble key={m.id} message={m} />
            ))}
            {isSending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="text-xs text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Upload indicator */}
      {isDragOver && (
        <div className="absolute inset-0 bg-primary/5 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-card border-2 border-dashed border-primary/40 rounded-xl px-8 py-6 text-center">
            <Upload className="h-8 w-8 text-primary mx-auto mb-2" />
            <p className="text-sm font-medium">Drop files here</p>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isSending ? 'Waiting for response…' : 'Type your message…'}
              className="min-h-[40px] max-h-[120px] pr-20 text-sm resize-none"
              rows={1}
              disabled={isSending}
            />
            <div className="absolute right-2 bottom-1.5 flex items-center gap-1">
              <Button
                size="icon" variant="ghost" className="h-6 w-6"
                title="Attach file"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSending}
              >
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-0.5">
              {DEPTH_OPTIONS.map(d => (
                <Badge
                  key={d}
                  variant={depth === d ? 'default' : 'outline'}
                  className="cursor-pointer text-[9px] px-1.5 py-0"
                  onClick={() => setDepth(d)}
                >
                  {d}
                </Badge>
              ))}
            </div>
            <Button size="sm" className="h-8 gap-1" onClick={handleSend} disabled={!input.trim() || isSending}>
              {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
