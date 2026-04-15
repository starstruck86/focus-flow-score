/**
 * Command Page — the new primary interface.
 * Single command bar → instant execution → clean output.
 */
import { useState, useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { CommandBar, type ParsedCommand } from '@/components/command/CommandBar';
import { CommandOutput } from '@/components/command/CommandOutput';
import { ContextPreview } from '@/components/command/ContextPreview';
import { useCommandExecution } from '@/hooks/useCommandExecution';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export default function Command() {
  const { user } = useAuth();
  const {
    accounts,
    opportunities,
    allTemplates,
    isGenerating,
    result,
    execute,
    saveAsTemplate,
  } = useCommandExecution();

  const [useKIs, setUseKIs] = useState(true);
  const [lastCommand, setLastCommand] = useState<ParsedCommand | null>(null);

  // Get total KI count for display
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
    if (lastCommand) {
      execute(lastCommand, useKIs);
    }
  }, [lastCommand, execute, useKIs]);

  const handleSaveAsTemplate = useCallback((name: string) => {
    if (result?.output) {
      saveAsTemplate(name, result.output);
    }
  }, [result, saveAsTemplate]);

  return (
    <Layout>
      <div className="flex flex-col items-center justify-start min-h-[calc(100vh-200px)] px-4 pt-[10vh]">
        {/* Title — only show when no output */}
        {!result && !isGenerating && (
          <div className="text-center mb-8 animate-in fade-in-0 duration-500">
            <h1 className="text-2xl font-bold text-foreground mb-1">What do you need?</h1>
            <p className="text-sm text-muted-foreground">
              Type a command to get started. Your {kiCount.toLocaleString()} KIs power every output.
            </p>
          </div>
        )}

        {/* Command bar — always centered and prominent */}
        <div className={`w-full max-w-2xl transition-all duration-300 ${result || isGenerating ? 'mb-6' : ''}`}>
          <CommandBar
            accounts={accounts}
            opportunities={opportunities.map(o => ({ id: o.id, name: o.name, account_name: (o as any).account_name }))}
            templates={allTemplates}
            onExecute={handleExecute}
            isLoading={isGenerating}
          />

          {/* Context preview */}
          <ContextPreview
            accountName={lastCommand?.account?.name}
            opportunityName={lastCommand?.opportunity?.name}
            templateName={lastCommand?.template?.name}
            useKIs={useKIs}
            onToggleKIs={setUseKIs}
            kiCount={kiCount}
          />
        </div>

        {/* Output */}
        {(result || isGenerating) && (
          <div className="w-full max-w-2xl">
            <CommandOutput
              output={result?.output || ''}
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
    </Layout>
  );
}
