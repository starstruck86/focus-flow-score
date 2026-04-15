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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { PanelLeftOpen } from 'lucide-react';
import type { ParsedCommand } from '@/lib/commandTypes';

interface Props {
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
}

export function StrategyCommandCenter({ sidebarCollapsed, onExpandSidebar }: Props) {
  const { user } = useAuth();
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

  const handleExecute = useCallback((command: ParsedCommand) => {
    setLastCommand(command);
    execute(command, useKIs);
  }, [execute, useKIs]);

  const handleRegenerate = useCallback(() => {
    if (lastCommand) execute(lastCommand, useKIs);
  }, [lastCommand, execute, useKIs]);

  const handleSaveAsTemplate = useCallback((name: string) => {
    if (result?.output) saveAsTemplate(name, result.output);
  }, [result, saveAsTemplate]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
        {sidebarCollapsed && (
          <Button size="sm" variant="ghost" onClick={onExpandSidebar}>
            <PanelLeftOpen className="h-4 w-4 mr-1" /> Threads
          </Button>
        )}
        <span className="text-sm font-semibold text-foreground">Strategy Command Center</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center justify-start px-4 py-8">
          {!result && !isGenerating && (
            <div className="text-center mb-8 animate-in fade-in-0 duration-500">
              <h1 className="text-2xl font-bold text-foreground mb-1">What do you need?</h1>
              <p className="text-sm text-muted-foreground">
                Type a command to get started. Your {kiCount.toLocaleString()} KIs power every output.
              </p>
            </div>
          )}

          <div className={`w-full max-w-2xl transition-all duration-300 ${result || isGenerating ? 'mb-6' : ''}`}>
            <CommandBar
              accounts={accounts}
              opportunities={opportunities.map(o => ({ id: o.id, name: o.name, account_name: (o as any).account_name }))}
              templates={allTemplates}
              onExecute={handleExecute}
              onCreateAccount={createAccount}
              onCreateOpportunity={createOpportunity}
              isLoading={isGenerating}
            />

            <ContextPreview
              accountName={lastCommand?.account?.name}
              opportunityName={lastCommand?.opportunity?.name}
              templateName={lastCommand?.template?.name}
              useKIs={useKIs}
              onToggleKIs={setUseKIs}
              kiCount={kiCount}
            />
          </div>

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
