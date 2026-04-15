import { useState, useRef, useCallback } from 'react';
import { PanelLeftOpen, PanelRightOpen, Search, Zap, Mail, Target, Map, FileText, Pin, Send, Paperclip, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useStrategyMessages } from '@/hooks/strategy/useStrategyMessages';
import { StrategyMessageBubble } from './StrategyMessageBubble';
import type { StrategyThread, StrategyLane } from '@/types/strategy';
import { LANES } from '@/types/strategy';

const QUICK_ACTIONS = [
  { label: 'Run Research', icon: Search },
  { label: 'Evaluate Email', icon: Mail },
  { label: 'Opp Strategy', icon: Target },
  { label: 'Tier Accounts', icon: Map },
  { label: 'Create Output', icon: FileText },
  { label: 'Pin Summary', icon: Pin },
];

const DEPTH_OPTIONS = ['Fast', 'Standard', 'Deep'] as const;

interface Props {
  thread: StrategyThread | null;
  onUpdateThread: (id: string, updates: Partial<StrategyThread>) => void;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  rightRailCollapsed: boolean;
  onToggleRightRail: () => void;
}

export function StrategyMainPanel({
  thread, onUpdateThread, sidebarCollapsed, onExpandSidebar,
  rightRailCollapsed, onToggleRightRail,
}: Props) {
  const { messages, sendMessage, isLoading } = useStrategyMessages(thread?.id ?? null);
  const [input, setInput] = useState('');
  const [depth, setDepth] = useState<typeof DEPTH_OPTIONS[number]>('Standard');
  const [activeLane, setActiveLane] = useState<string>(thread?.lane ?? 'research');
  const [isDragOver, setIsDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !thread) return;
    const text = input.trim();
    setInput('');
    await sendMessage(text);
  }, [input, thread, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    // File upload handling will be wired to storage later
  };

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
      {/* Top Bar */}
      <div className="border-b border-border px-4 py-2 flex items-center gap-2 shrink-0">
        {sidebarCollapsed && (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onExpandSidebar}>
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        )}
        <h1 className="text-sm font-semibold truncate flex-1">{thread.title}</h1>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onToggleRightRail}>
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </div>

      {/* Scope Card */}
      <div className="px-4 pt-3 shrink-0">
        <Card className="bg-muted/30">
          <CardContent className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {thread.thread_type.replace('_', ' ')} · {thread.lane}
                </p>
                {thread.summary && (
                  <p className="text-xs mt-1 text-foreground/80 line-clamp-2">{thread.summary}</p>
                )}
              </div>
            </div>
            {/* Quick Actions */}
            <div className="flex flex-wrap gap-1 mt-2">
              {QUICK_ACTIONS.map(a => (
                <Button key={a.label} size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1">
                  <a.icon className="h-3 w-3" /> {a.label}
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
          <p className="text-xs text-muted-foreground">Loading messages…</p>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-muted-foreground">Start a conversation or run a workflow.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map(m => (
              <StrategyMessageBubble key={m.id} message={m} />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Composer */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message…"
              className="min-h-[40px] max-h-[120px] pr-20 text-sm resize-none"
              rows={1}
            />
            <div className="absolute right-2 bottom-1.5 flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Attach file">
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Upload">
                <Upload className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {/* Depth selector */}
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
            <Button size="sm" className="h-8 gap-1" onClick={handleSend} disabled={!input.trim()}>
              <Send className="h-3.5 w-3.5" /> Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
