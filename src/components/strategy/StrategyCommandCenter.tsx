/**
 * StrategyCommandCenter — unified workspace empty state.
 * Composer-dominant layout. No nested cards. Flat, confident, wide.
 */
import { useState, useCallback, useMemo } from 'react';
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

const DEMO_OUTPUT = `## Executive Summary

Franklin Park Conservatory is evaluating Acoustic's marketing automation platform as a replacement for their current Tessitura-native email tooling. This represents a mid-market arts & culture opportunity with strong product-market fit.

## Strategic Context

The Conservatory operates a complex multi-channel engagement model spanning memberships, events, education programs, and seasonal exhibitions. Their current stack relies heavily on Tessitura for CRM and ticketing, with limited marketing automation capabilities.

**Key Insight:** Their recent website redesign signals investment in digital experience — making this an ideal time to propose integrated lifecycle marketing.

## Stakeholder Hypotheses

- **Director of Marketing** — Primary champion. Frustrated with Tessitura's email limitations. Needs segmentation and automation.
- **IT Director** — Technical evaluator. Will care about Tessitura API integration and data security.
- **CFO** — Economic buyer. Will need ROI justification against current spend.

## Recommended Approach

1. **Lead with integration story** — Show how Acoustic connects to Tessitura without replacing it
2. **Quantify the gap** — Help them measure what they're losing with current tooling (open rates, conversion, time spent)
3. **Reference similar wins** — Use performing arts case studies from similar-sized organizations

## Key Risks

- Tessitura has a strong ecosystem lock-in; switching costs may be perceived as high
- Budget cycle timing — arts organizations often plan 12-18 months ahead
- Champion may not have direct budget authority

## Next Steps

1. Schedule technical discovery with IT Director to map Tessitura integration requirements
2. Prepare ROI calculator based on their current email volume and conversion rates
3. Identify 2-3 peer organizations using Acoustic for social proof
4. Draft a mutual action plan targeting their Q3 budget planning window`;

const DEMO_BLOCKS = [
  { heading: 'Executive Summary', content: 'Franklin Park Conservatory is evaluating Acoustic\'s marketing automation platform as a replacement for their current Tessitura-native email tooling. This represents a mid-market arts & culture opportunity with strong product-market fit.' },
  { heading: 'Strategic Context', content: 'The Conservatory operates a complex multi-channel engagement model spanning memberships, events, education programs, and seasonal exhibitions. Their current stack relies heavily on Tessitura for CRM and ticketing, with limited marketing automation capabilities.\n\n**Key Insight:** Their recent website redesign signals investment in digital experience — making this an ideal time to propose integrated lifecycle marketing.' },
  { heading: 'Stakeholder Hypotheses', content: '- **Director of Marketing** — Primary champion. Frustrated with Tessitura\'s email limitations. Needs segmentation and automation.\n- **IT Director** — Technical evaluator. Will care about Tessitura API integration and data security.\n- **CFO** — Economic buyer. Will need ROI justification against current spend.' },
  { heading: 'Recommended Approach', content: '1. **Lead with integration story** — Show how Acoustic connects to Tessitura without replacing it\n2. **Quantify the gap** — Help them measure what they\'re losing with current tooling\n3. **Reference similar wins** — Use performing arts case studies from similar-sized organizations' },
  { heading: 'Key Risks', content: '- Tessitura has a strong ecosystem lock-in; switching costs may be perceived as high\n- Budget cycle timing — arts organizations often plan 12-18 months ahead\n- Champion may not have direct budget authority' },
  { heading: 'Next Steps', content: '1. Schedule technical discovery with IT Director to map Tessitura integration requirements\n2. Prepare ROI calculator based on their current email volume and conversion rates\n3. Identify 2-3 peer organizations using Acoustic for social proof\n4. Draft a mutual action plan targeting their Q3 budget planning window' },
];

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

  const isDemoMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has('demo_output');
  }, []);
  const showEmpty = !result && !isGenerating && !isDemoMode;
  const pinnedShortcuts = (savedShortcuts as any[]).filter((s: any) => s.is_pinned);
  const savedNonPinned = (savedShortcuts as any[]).filter((s: any) => !s.is_pinned).slice(0, 5);

  const composer = (
    <div className={cn(STRATEGY_UI.surface.composer, 'p-4 sm:p-5')}>
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
      {/* Minimal top bar */}
      <div className="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
        {sidebarCollapsed && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-foreground/80 hover:text-foreground" onClick={onExpandSidebar}>
            <PanelLeftOpen className="h-3.5 w-3.5 mr-1.5" /> Threads
          </Button>
        )}
        <span className={cn(STRATEGY_UI.labels.section, 'ml-1 text-foreground/50')}>Strategy</span>
      </div>

      <ScrollArea className="flex-1">
        <div className={cn(STRATEGY_UI.spacing.canvas)}>
          {showEmpty ? (
            /* ── EMPTY STATE: Composer is the hero ── */
            <div className={cn(STRATEGY_UI.layout.launchpad)}>
              {/* Heading */}
              <div className="text-center mb-8 sm:mb-10">
                <h1 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight">
                  What do you need?
                </h1>
                <p className="mt-2.5 text-sm text-foreground/60">
                  {kiCount > 0
                    ? `${kiCount.toLocaleString()} knowledge items ready to ground your next run`
                    : 'Briefs, research, angles, and prep — powered by your knowledge base'}
                </p>
              </div>

              {/* Composer — the primary surface */}
              {composer}

              {/* Quick starts */}
              <div className="mt-8 space-y-6">
                {pinnedShortcuts.length > 0 && (
                  <div>
                    <p className={cn(STRATEGY_UI.labels.section, 'mb-3 flex items-center gap-1.5')}>
                      <Pin className="h-3 w-3" /> Go-to plays
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {pinnedShortcuts.map((s: any) => (
                        <button
                          key={s.id}
                          onClick={() => handleShortcut(s)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-primary/25 bg-primary/5 text-foreground hover:bg-primary/10 hover:border-primary/40 transition-colors"
                        >
                          <Pin className="h-3 w-3 text-primary shrink-0" />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className={cn(STRATEGY_UI.labels.section, 'mb-3')}>Quick start</p>
                  <div className={cn('grid gap-2.5', isMobile ? 'grid-cols-1' : 'grid-cols-2')}>
                    {STARTERS.map(s => (
                      <button
                        key={s.label}
                        onClick={() => handleStarter(s.command)}
                        className="group flex items-center gap-3 px-4 py-3.5 rounded-xl text-left border border-border hover:border-primary/30 bg-card hover:bg-card hover:shadow-sm transition-all"
                      >
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                          <s.icon className="h-4 w-4 text-primary" />
                        </div>
                        <span className="text-sm font-medium text-foreground">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {savedNonPinned.length > 0 && (
                  <div>
                    <p className={cn(STRATEGY_UI.labels.section, 'mb-2.5 flex items-center gap-1.5')}>
                      <Bookmark className="h-3 w-3" /> Saved
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {savedNonPinned.map((s: any) => (
                        <button
                          key={s.id}
                          onClick={() => handleShortcut(s)}
                          className="inline-flex items-center gap-1.5 text-xs text-foreground/80 hover:text-foreground px-2.5 py-1.5 rounded-md hover:bg-muted/50 transition-colors truncate max-w-[220px]"
                        >
                          <Bookmark className="h-3 w-3 shrink-0 text-muted-foreground" />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {recents.length > 0 && (
                  <div>
                    <p className={cn(STRATEGY_UI.labels.section, 'mb-2.5 flex items-center gap-1.5')}>
                      <Clock className="h-3 w-3" /> Recent
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {recents.map((r, i) => (
                        <button
                          key={i}
                          onClick={() => setPrefill(r.command)}
                          className="inline-flex items-center text-xs text-foreground/80 hover:text-foreground px-2.5 py-1.5 rounded-md hover:bg-muted/40 transition-colors truncate max-w-[220px]"
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
            /* ── OUTPUT STATE: Composer + document ── */
            <div className={cn(STRATEGY_UI.layout.output, STRATEGY_UI.spacing.section)}>
              {composer}

              {(result && lastCommand) && (
                <div className="flex items-center justify-end">
                  <button
                    onClick={handleSaveShortcut}
                    className="inline-flex items-center gap-1.5 text-xs text-foreground/80 hover:text-foreground transition-colors"
                  >
                    <PlusCircle className="h-3.5 w-3.5" /> Save as shortcut
                  </button>
                </div>
              )}

              <CommandOutput
                output={isDemoMode ? DEMO_OUTPUT : (result?.output || '')}
                blocks={isDemoMode ? DEMO_BLOCKS : (result?.blocks || [])}
                subjectLine={isDemoMode ? undefined : result?.subjectLine}
                sources={isDemoMode ? ['Enrichment Data', 'Account Intel', 'CRM History'] : (result?.sources || [])}
                kiCount={isDemoMode ? 847 : (result?.kiCount || 0)}
                templateName={isDemoMode ? 'Opportunity Strategy' : lastCommand?.template?.name}
                accountName={isDemoMode ? 'Franklin Park Conservatory' : lastCommand?.account?.name}
                opportunityName={isDemoMode ? 'Tessitura Replacement' : lastCommand?.opportunity?.name}
                outputType={isDemoMode ? 'opportunity_strategy' : lastCommand?.template?.id}
                playbookUsed={isDemoMode ? 'Enterprise Discovery' : result?.playbookUsed}
                isGenerating={isGenerating}
                onRegenerate={handleRegenerate}
                onSaveAsTemplate={handleSaveAsTemplate}
                onPromoteToTemplate={handlePromoteToTemplate}
              />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
