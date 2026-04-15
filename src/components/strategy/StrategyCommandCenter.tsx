/**
 * StrategyCommandCenter — command-driven workspace with attachments,
 * playbook-aware KI retrieval, and promote-to-template flow.
 */
import { useState, useCallback } from 'react';
import { CommandBar } from '@/components/command/CommandBar';
import { CommandOutput } from '@/components/command/CommandOutput';
import { PreRunContext } from '@/components/command/PreRunContext';
import { ComposerAttachments } from '@/components/command/ComposerAttachments';
import type { Attachment } from '@/components/command/ComposerAttachments';
import { useCommandExecution } from '@/hooks/useCommandExecution';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { STRATEGY_UI } from '@/lib/strategy-ui';
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
    saveAsTemplate, saveShortcut, capture,
  } = useCommandExecution();

  const [useKIs, setUseKIs] = useState(true);
  const [lastCommand, setLastCommand] = useState<ParsedCommand | null>(null);
  const [prefill, setPrefill] = useState('');
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const [activeTokens, setActiveTokens] = useState<CommandToken[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

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

  const handleAddAttachments = useCallback((newAttachments: Attachment[]) => {
    setAttachments(prev => {
      const existingIds = new Set(prev.map(a => a.id));
      const unique = newAttachments.filter(a => !existingIds.has(a.id));
      return [...prev, ...unique];
    });
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

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
    const enrichedCommand: ParsedCommand = {
      ...command,
      attachments: attachments.map(att => ({
        id: att.id,
        type: att.type,
        name: att.name,
        url: att.url,
        mimeType: att.mimeType,
        size: att.size,
      })),
    };
    setLastCommand(enrichedCommand);
    addRecent(enrichedCommand);
    execute(enrichedCommand, useKIs);
  }, [execute, useKIs, addRecent, attachments]);

  const handleRegenerate = useCallback(() => {
    if (lastCommand) {
      capture('regenerated', { templateName: lastCommand.template?.name });
      execute(lastCommand, useKIs);
    }
  }, [lastCommand, execute, useKIs, capture]);

  const handleSaveAsTemplate = useCallback((name: string) => {
    if (result?.output) saveAsTemplate(name, result.output);
  }, [result, saveAsTemplate]);

  const handlePromoteToTemplate = useCallback(() => {
    if (result?.output) {
      const name = lastCommand?.template?.name ? `${lastCommand.template.name} (custom)` : 'Custom Framework';
      saveAsTemplate(name, result.output);
      capture('saved_template', { templateName: name });
    }
  }, [result, lastCommand, saveAsTemplate, capture]);

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

  const composer = (
    <div className={cn(STRATEGY_UI.surface.composer, 'p-3 sm:p-4 lg:p-5')}>
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
      <ComposerAttachments
        attachments={attachments}
        onAdd={handleAddAttachments}
        onRemove={handleRemoveAttachment}
        disabled={isGenerating}
      />
      <PreRunContext
        tokens={activeTokens}
        useKIs={useKIs}
        onToggleKIs={setUseKIs}
        kiCount={kiCount}
        lastKIExplainability={lastKIExplainability}
        attachmentCount={attachments.length}
      />
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="flex items-center gap-2 px-4 h-9 border-b border-border/40 shrink-0 bg-background/90">
        {sidebarCollapsed && (
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground" onClick={onExpandSidebar}>
            <PanelLeftOpen className="h-3 w-3 mr-1" /> Threads
          </Button>
        )}
        <span className={STRATEGY_UI.labels.micro}>Strategy</span>
      </div>

      <ScrollArea className="flex-1">
        <div className={cn(STRATEGY_UI.layout.frame, STRATEGY_UI.spacing.canvas)}>
          {showEmpty ? (
            <div className={cn(STRATEGY_UI.layout.launchpad, STRATEGY_UI.surface.launchpad, 'p-5 sm:p-6 lg:p-7 animate-in fade-in-0 duration-200')}>
              <div className="text-center mb-6 sm:mb-7">
                <h1 className="text-2xl sm:text-[2rem] font-semibold text-foreground tracking-tight">What do you need?</h1>
                <p className="mt-2 text-sm sm:text-[15px] text-foreground/75">
                  {kiCount > 0 ? `${kiCount.toLocaleString()} KIs ready to ground your next strategy run` : 'Command-first workspace for briefs, angles, and prep'}
                </p>
              </div>

              {composer}

              <div className="mt-5 sm:mt-6">
                {pinnedShortcuts.length > 0 && (
                  <div className="mb-6">
                    <p className={cn(STRATEGY_UI.labels.micro, 'mb-2.5 px-0.5 flex items-center gap-1')}>
                      <Pin className="h-2.5 w-2.5" /> Go-to plays
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {pinnedShortcuts.map((s: any) => (
                        <button
                          key={s.id}
                          onClick={() => handleShortcut(s)}
                          className={cn(
                            'inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-2 rounded-lg border transition-all duration-100',
                            'text-foreground/85 hover:text-foreground border-primary/20 bg-primary/[0.07] hover:bg-primary/[0.12] hover:border-primary/35'
                          )}
                        >
                          <Pin className="h-2.5 w-2.5 text-primary/70 shrink-0" />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className={cn(STRATEGY_UI.labels.micro, 'mb-2.5 px-0.5')}>Quick start</p>
                <div className={cn('grid gap-2.5', isMobile ? 'grid-cols-1' : 'grid-cols-2')}>
                  {STARTERS.map(s => (
                    <button
                      key={s.label}
                      onClick={() => handleStarter(s.command)}
                      className="group flex items-center gap-3 px-4 py-3.5 rounded-xl text-left border border-border/35 hover:border-border/55 bg-background/45 hover:bg-background/70 transition-all duration-100"
                    >
                      <s.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors duration-100" />
                      <span className="text-[13px] text-foreground/85 group-hover:text-foreground transition-colors duration-100">{s.label}</span>
                    </button>
                  ))}
                </div>

                {savedNonPinned.length > 0 && (
                  <div className="mt-6">
                    <p className={cn(STRATEGY_UI.labels.micro, 'mb-2 px-0.5 flex items-center gap-1')}>
                      <Bookmark className="h-2.5 w-2.5" /> Saved
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {savedNonPinned.map((s: any) => (
                        <button
                          key={s.id}
                          onClick={() => handleShortcut(s)}
                          className="inline-flex items-center gap-1.5 text-[11px] text-foreground/85 hover:text-foreground px-2.5 py-1.5 rounded-md hover:bg-muted/45 transition-all duration-100 truncate max-w-[220px]"
                        >
                          <Bookmark className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {recents.length > 0 && (
                  <div className="mt-5">
                    <p className={cn(STRATEGY_UI.labels.micro, 'mb-2 px-0.5 flex items-center gap-1')}>
                      <Clock className="h-2.5 w-2.5" /> Recent
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {recents.map((r, i) => (
                        <button
                          key={i}
                          onClick={() => setPrefill(r.command)}
                          className="inline-flex items-center text-[11px] text-foreground/80 hover:text-foreground px-2.5 py-1.5 rounded-md hover:bg-muted/35 transition-all duration-100 truncate max-w-[220px]"
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className={cn(STRATEGY_UI.layout.output, STRATEGY_UI.spacing.section)}>
              {composer}
              <div className="w-full">
                {result && lastCommand && (
                  <div className="flex items-center justify-end mb-2">
                    <button
                      onClick={handleSaveShortcut}
                      className="inline-flex items-center gap-1 text-[11px] text-foreground/80 hover:text-foreground transition-colors duration-100"
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
                  playbookUsed={result?.playbookUsed}
                  isGenerating={isGenerating}
                  onRegenerate={handleRegenerate}
                  onSaveAsTemplate={handleSaveAsTemplate}
                  onPromoteToTemplate={handlePromoteToTemplate}
                />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
