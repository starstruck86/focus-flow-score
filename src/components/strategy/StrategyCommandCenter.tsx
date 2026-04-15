/**
 * StrategyCommandCenter — command-driven workspace embedded in the Strategy page.
 */
import { useState, useCallback } from 'react';
import { CommandBar } from '@/components/command/CommandBar';
import { CommandOutput } from '@/components/command/CommandOutput';
import { PreRunContext } from '@/components/command/PreRunContext';
import { useCommandExecution } from '@/hooks/useCommandExecution';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  PanelLeftOpen, Search, FileText, Mail, Zap,
  Clock, Pin, Bookmark, PlusCircle,
} from 'lucide-react';
import type { ParsedCommand, CommandToken } from '@/lib/commandTypes';
import { cn } from '@/lib/utils';

interface Props {
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
}

const STARTERS = [
  { label: 'Build prep doc', command: '+Discovery Prep @', icon: Search },
  { label: 'Draft exec summary', command: '+Executive Brief @', icon: FileText },
  { label: 'Write follow-up', command: '+Follow-Up Email @', icon: Mail },
  { label: 'Explore angles', command: '+Brainstorm @', icon: Zap },
] as const;

interface RecentItem {
  label: string;
  command: string;
}

export function StrategyCommandCenter({ sidebarCollapsed, onExpandSidebar }: Props) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const {
    accounts, opportunities, allTemplates, savedShortcuts,
    isGenerating, result, lastKIExplainability,
    execute, createAccount, createOpportunity,
    saveAsTemplate, saveShortcut, pinShortcut, capture,
  } = useCommandExecution();

  const [useKIs, setUseKIs] = useState(true);
  const [lastCommand, setLastCommand] = useState<ParsedCommand | null>(null);
  const [prefill, setPrefill] = useState('');
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const [activeTokens, setActiveTokens] = useState<CommandToken[]>([]);

  const { data: kiCount = 0 } = useQuery({
    queryKey: ['ki-count', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { count } = await supabase
        .from('knowledge_items' as any)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .eq('active', true);
      return count || 0;
    },
  });

  const addRecent = useCallback((command: ParsedCommand) => {
    const label = [
      command.template?.name,
      command.account?.name ? `@${command.account.name}` : null,
      command.opportunity?.name ? `$${command.opportunity.name}` : null,
    ].filter(Boolean).join(' ') || command.rawText.slice(0, 30);

    setRecents(prev => {
      const filtered = prev.filter(r => r.command !== command.rawText);
      return [{ label, command: command.rawText }, ...filtered].slice(0, 5);
    });
  }, []);

  const handleExecute = useCallback((command: ParsedCommand) => {
    setLastCommand(command);
    addRecent(command);
    execute(command, useKIs);
  }, [execute, useKIs, addRecent]);

  const handleRegenerate = useCallback(() => {
    if (lastCommand) {
      capture('regenerated', { templateName: lastCommand.template?.name });
      execute(lastCommand, useKIs);
    }
  }, [lastCommand, execute, useKIs, capture]);

  const handleSaveAsTemplate = useCallback((name: string) => {
    if (result?.output) saveAsTemplate(name, result.output);
  }, [result, saveAsTemplate]);

  const handleSaveShortcut = useCallback(() => {
    if (lastCommand) saveShortcut(lastCommand);
  }, [lastCommand, saveShortcut]);

  const handleStarter = useCallback((command: string) => {
    setPrefill(command);
  }, []);

  const handleShortcut = useCallback((shortcut: any) => {
    supabase.from('command_shortcuts' as any)
      .update({ times_used: (shortcut.times_used || 0) + 1, last_used_at: new Date().toISOString() } as any)
      .eq('id', shortcut.id)
      .then(() => {});
    capture('reused_shortcut', { templateName: shortcut.template_name });
    setPrefill(shortcut.raw_command);
  }, [capture]);

  const showEmpty = !result && !isGenerating;
  const pinnedShortcuts = (savedShortcuts as any[]).filter((s: any) => s.is_pinned);
  const savedNonPinned = (savedShortcuts as any[]).filter((s: any) => !s.is_pinned).slice(0, 5);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 h-10 border-b border-border/30 shrink-0">
        {sidebarCollapsed && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onExpandSidebar}>
            <PanelLeftOpen className="h-3.5 w-3.5 mr-1" /> Threads
          </Button>
        )}
        <span className="text-[11px] font-medium text-muted-foreground/60 tracking-wider uppercase">Strategy</span>
      </div>

      <ScrollArea className="flex-1">
        <div className={cn(
          'flex flex-col items-center px-4',
          isMobile ? 'pt-6 pb-4' : 'pt-8 pb-8'
        )}>
          {/* Header — only on empty */}
          {showEmpty && (
            <div className="text-center mb-3 animate-in fade-in-0 duration-300">
              <h1 className="text-base font-semibold text-foreground/90 mb-0.5">What do you need?</h1>
              {kiCount > 0 && (
                <p className="text-[11px] text-muted-foreground/50">
                  {kiCount.toLocaleString()} KIs powering every output
                </p>
              )}
            </div>
          )}

          {/* Command bar + context strip */}
          <div className={cn('w-full max-w-2xl', (result || isGenerating) && 'mb-4')}>
            <CommandBar
              accounts={accounts}
              opportunities={opportunities.map(o => ({ id: o.id, name: o.name, account_name: (o as any).account_name }))}
              templates={allTemplates}
              onExecute={handleExecute}
              onCreateAccount={createAccount}
              onCreateOpportunity={createOpportunity}
              isLoading={isGenerating}
              prefill={prefill}
              onPrefillConsumed={() => setPrefill('')}
              preserveAfterExecute
              onTokensChange={setActiveTokens}
            />
            <PreRunContext
              tokens={activeTokens}
              useKIs={useKIs}
              onToggleKIs={setUseKIs}
              kiCount={kiCount}
              lastKIExplainability={lastKIExplainability}
            />
          </div>

          {/* Empty state */}
          {showEmpty && (
            <div className="w-full max-w-2xl mt-2 animate-in fade-in-0 duration-200">
              {/* Pinned — go-to plays */}
              {pinnedShortcuts.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1.5 px-0.5 flex items-center gap-1">
                    <Pin className="h-2.5 w-2.5" /> Go-to plays
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {pinnedShortcuts.map((s: any) => (
                      <button
                        key={s.id}
                        onClick={() => handleShortcut(s)}
                        className="inline-flex items-center gap-1.5 text-[11px] text-foreground/80 hover:text-foreground px-2.5 py-1.5 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-all"
                      >
                        <Pin className="h-2.5 w-2.5 text-primary/60 shrink-0" />
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick start */}
              <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1.5 px-0.5">
                Quick start
              </p>
              <div className={cn('grid gap-1.5', isMobile ? 'grid-cols-1' : 'grid-cols-2')}>
                {STARTERS.map(s => (
                  <button
                    key={s.label}
                    onClick={() => handleStarter(s.command)}
                    className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-border/30 hover:border-border/60 bg-card/40 hover:bg-card transition-all text-left"
                  >
                    <s.icon className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-primary shrink-0 transition-colors" />
                    <span className="text-[12px] text-foreground/70 group-hover:text-foreground transition-colors">{s.label}</span>
                  </button>
                ))}
              </div>

              {/* Saved workflows */}
              {savedNonPinned.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1 px-0.5 flex items-center gap-1">
                    <Bookmark className="h-2.5 w-2.5" /> Saved workflows
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {savedNonPinned.map((s: any) => (
                      <button
                        key={s.id}
                        onClick={() => handleShortcut(s)}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground px-2 py-1 rounded-md hover:bg-muted/60 transition-colors truncate max-w-[200px]"
                      >
                        <Bookmark className="h-2.5 w-2.5 shrink-0 opacity-40" />
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Session recents */}
              {recents.length > 0 && (
                <div className="mt-2.5">
                  <p className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider mb-1 px-0.5 flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" /> Recent
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {recents.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => setPrefill(r.command)}
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-muted-foreground px-1.5 py-0.5 rounded hover:bg-muted/40 transition-colors truncate max-w-[180px]"
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Output area */}
          {(result || isGenerating) && (
            <div className="w-full max-w-2xl">
              {result && lastCommand && (
                <div className="flex items-center justify-end mb-1.5">
                  <button
                    onClick={handleSaveShortcut}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  >
                    <PlusCircle className="h-3 w-3" /> Save as shortcut
                  </button>
                </div>
              )}
              <CommandOutput
                output={result?.output || ''}
                blocks={result?.blocks || []}
                subjectLine={result?.subjectLine}
                sources={result?.sources || []}
                kiCount={result?.kiCount || 0}
                templateName={lastCommand?.template?.name}
                accountName={lastCommand?.account?.name}
                opportunityName={lastCommand?.opportunity?.name}
                outputType={lastCommand?.template?.id}
                isGenerating={isGenerating}
                onRegenerate={handleRegenerate}
                onSaveAsTemplate={handleSaveAsTemplate}
              />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
