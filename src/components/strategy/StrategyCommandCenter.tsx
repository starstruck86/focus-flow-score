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
      <div className="flex items-center gap-2 px-4 h-9 border-b border-border/15 shrink-0">
        {sidebarCollapsed && (
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] text-muted-foreground/40" onClick={onExpandSidebar}>
            <PanelLeftOpen className="h-3 w-3 mr-1" /> Threads
          </Button>
        )}
        <span className="text-[10px] font-medium text-muted-foreground/30 tracking-wider uppercase">Strategy</span>
      </div>

      <ScrollArea className="flex-1">
        <div className={cn(
          'flex flex-col items-center px-4',
          isMobile ? 'pt-8 pb-4' : 'pt-12 pb-8',
          showEmpty && 'justify-center'
        )}>
          {/* Header — only on empty */}
          {showEmpty && (
            <div className="text-center mb-4 animate-in fade-in-0 duration-200">
              <h1 className="text-sm font-medium text-foreground/60 tracking-tight">What do you need?</h1>
              {kiCount > 0 && (
                <p className="text-[10px] text-muted-foreground/25 mt-0.5">
                  {kiCount.toLocaleString()} KIs ready
                </p>
              )}
            </div>
          )}

          {/* Command bar + context strip */}
          <div className={cn('w-full max-w-2xl', (result || isGenerating) && 'mb-5')}>
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
            <div className="w-full max-w-2xl mt-5 animate-in fade-in-0 duration-150">
              {/* Pinned — go-to plays */}
              {pinnedShortcuts.length > 0 && (
                <div className="mb-4">
                  <p className="text-[9px] font-medium text-muted-foreground/25 uppercase tracking-[0.1em] mb-1.5 px-0.5 flex items-center gap-1">
                    <Pin className="h-2 w-2" /> Go-to plays
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {pinnedShortcuts.map((s: any) => (
                      <button
                        key={s.id}
                        onClick={() => handleShortcut(s)}
                        className={cn(
                          'inline-flex items-center gap-1 text-[11px] font-medium',
                          'text-foreground/60 hover:text-foreground/90',
                          'px-2 py-1 rounded-md border border-primary/10 bg-primary/[0.03]',
                          'hover:bg-primary/[0.06] hover:border-primary/20',
                          'transition-all duration-100'
                        )}
                      >
                        <Pin className="h-2 w-2 text-primary/40 shrink-0" />
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick start */}
              <p className="text-[9px] font-medium text-muted-foreground/25 uppercase tracking-[0.1em] mb-1.5 px-0.5">
                Quick start
              </p>
              <div className={cn('grid gap-1', isMobile ? 'grid-cols-1' : 'grid-cols-2')}>
                {STARTERS.map(s => (
                  <button
                    key={s.label}
                    onClick={() => handleStarter(s.command)}
                    className={cn(
                      'group flex items-center gap-2 px-2.5 py-2 rounded-lg text-left',
                      'border border-border/15 hover:border-border/30',
                      'bg-card/20 hover:bg-card/50',
                      'transition-all duration-100'
                    )}
                  >
                    <s.icon className="h-3 w-3 text-muted-foreground/20 group-hover:text-primary/60 shrink-0 transition-colors duration-100" />
                    <span className="text-[11px] text-foreground/40 group-hover:text-foreground/70 transition-colors duration-100">{s.label}</span>
                  </button>
                ))}
              </div>

              {/* Saved workflows */}
              {savedNonPinned.length > 0 && (
                <div className="mt-4">
                  <p className="text-[9px] font-medium text-muted-foreground/20 uppercase tracking-[0.1em] mb-1 px-0.5 flex items-center gap-1">
                    <Bookmark className="h-2 w-2" /> Saved
                  </p>
                  <div className="flex flex-wrap gap-0.5">
                    {savedNonPinned.map((s: any) => (
                      <button
                        key={s.id}
                        onClick={() => handleShortcut(s)}
                        className={cn(
                          'inline-flex items-center gap-1 text-[10px]',
                          'text-muted-foreground/35 hover:text-foreground/60',
                          'px-1.5 py-0.5 rounded-md hover:bg-muted/30',
                          'transition-all duration-100 truncate max-w-[180px]'
                        )}
                      >
                        <Bookmark className="h-2 w-2 shrink-0 opacity-25" />
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Session recents */}
              {recents.length > 0 && (
                <div className="mt-3">
                  <p className="text-[9px] font-medium text-muted-foreground/20 uppercase tracking-[0.1em] mb-1 px-0.5 flex items-center gap-1">
                    <Clock className="h-2 w-2" /> Recent
                  </p>
                  <div className="flex flex-wrap gap-0.5">
                    {recents.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => setPrefill(r.command)}
                        className="inline-flex items-center text-[10px] text-muted-foreground/25 hover:text-muted-foreground/50 px-1.5 py-0.5 rounded hover:bg-muted/20 transition-all duration-100 truncate max-w-[160px]"
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
                <div className="flex items-center justify-end mb-2">
                  <button
                    onClick={handleSaveShortcut}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/35 hover:text-muted-foreground/60 transition-colors duration-150"
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
