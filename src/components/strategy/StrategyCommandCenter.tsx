/**
 * StrategyCommandCenter — command-driven workspace embedded in the Strategy page.
 * This is the main canvas when no thread is active.
 */
import { useState, useCallback } from 'react';
import { CommandBar } from '@/components/command/CommandBar';
import { CommandOutput } from '@/components/command/CommandOutput';
import { ContextPreview } from '@/components/command/ContextPreview';
import { useCommandExecution } from '@/hooks/useCommandExecution';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { PanelLeftOpen, Search, FileText, Mail, Zap, Clock } from 'lucide-react';
import type { ParsedCommand } from '@/lib/commandTypes';

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
  type: 'template' | 'account' | 'command';
}

export function StrategyCommandCenter({ sidebarCollapsed, onExpandSidebar }: Props) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const {
    accounts,
    opportunities,
    allTemplates,
    isGenerating,
    result,
    execute,
    createAccount,
    createOpportunity,
    saveAsTemplate,
  } = useCommandExecution();

  const [useKIs, setUseKIs] = useState(true);
  const [lastCommand, setLastCommand] = useState<ParsedCommand | null>(null);
  const [prefill, setPrefill] = useState('');
  const [recents, setRecents] = useState<RecentItem[]>([]);

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
      return [{ label, command: command.rawText, type: 'command' as const }, ...filtered].slice(0, 5);
    });
  }, []);

  const handleExecute = useCallback((command: ParsedCommand) => {
    setLastCommand(command);
    addRecent(command);
    execute(command, useKIs);
  }, [execute, useKIs, addRecent]);

  const handleRegenerate = useCallback(() => {
    if (lastCommand) execute(lastCommand, useKIs);
  }, [lastCommand, execute, useKIs]);

  const handleSaveAsTemplate = useCallback((name: string) => {
    if (result?.output) saveAsTemplate(name, result.output);
  }, [result, saveAsTemplate]);

  const handleStarter = useCallback((command: string) => {
    setPrefill(command);
  }, []);

  const handleRecent = useCallback((command: string) => {
    setPrefill(command);
  }, []);

  const showEmpty = !result && !isGenerating;

  // Build intelligence stack line
  const stackParts: string[] = [];
  if (allTemplates.length > 0) stackParts.push('templates');
  if (lastCommand?.account || lastCommand?.opportunity) stackParts.push('linked context');
  if (useKIs && kiCount > 0) stackParts.push(`${kiCount.toLocaleString()} KIs`);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Compact toolbar */}
      <div className="flex items-center gap-2 px-4 h-10 border-b border-border/40 shrink-0">
        {sidebarCollapsed && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onExpandSidebar}>
            <PanelLeftOpen className="h-3.5 w-3.5 mr-1" /> Threads
          </Button>
        )}
        <span className="text-xs font-medium text-muted-foreground tracking-wide uppercase">Strategy</span>
      </div>

      <ScrollArea className="flex-1">
        <div className={`flex flex-col items-center px-4 ${isMobile ? 'pt-6 pb-4' : 'pt-12 pb-8'}`}>
          {/* Header — compact working-surface feel */}
          {showEmpty && (
            <div className="text-center mb-5 animate-in fade-in-0 slide-in-from-bottom-2 duration-400">
              <h1 className="text-lg font-semibold text-foreground mb-0.5">What do you need?</h1>
              <p className="text-xs text-muted-foreground">
                {kiCount > 0
                  ? `${kiCount.toLocaleString()} KIs powering every output`
                  : 'Type a command to get started'}
              </p>
            </div>
          )}

          {/* Command bar */}
          <div className={`w-full max-w-2xl ${result || isGenerating ? 'mb-5' : ''}`}>
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
            />

            <ContextPreview
              accountName={lastCommand?.account?.name}
              opportunityName={lastCommand?.opportunity?.name}
              templateName={lastCommand?.template?.name}
              useKIs={useKIs}
              onToggleKIs={setUseKIs}
              kiCount={kiCount}
            />

            {/* Intelligence stack line */}
            {stackParts.length > 0 && (
              <p className="text-[10px] text-muted-foreground/50 px-1 mt-1">
                Using {stackParts.join(', ')}
              </p>
            )}
          </div>

          {/* Starter commands — only when idle */}
          {showEmpty && (
            <div className={`w-full max-w-2xl mt-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-300 delay-100`}>
              <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2 px-0.5">
                Quick start
              </p>
              <div className={`grid ${isMobile ? 'grid-cols-1 gap-1.5' : 'grid-cols-2 gap-2'}`}>
                {STARTERS.map(s => (
                  <button
                    key={s.label}
                    onClick={() => handleStarter(s.command)}
                    className="group flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/40 bg-card/50 hover:bg-accent/40 hover:border-border transition-all text-left"
                  >
                    <s.icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-foreground/90 group-hover:text-foreground">{s.label}</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Lightweight recents */}
              {recents.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5 px-0.5">
                    Recent
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {recents.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => handleRecent(r.command)}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md bg-muted/60 hover:bg-muted transition-colors truncate max-w-[200px]"
                      >
                        <Clock className="h-2.5 w-2.5 shrink-0" />
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
              <CommandOutput
                output={result?.output || ''}
                blocks={result?.blocks || []}
                subjectLine={result?.subjectLine}
                sources={result?.sources || []}
                kiCount={result?.kiCount || 0}
                templateName={lastCommand?.template?.name}
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
