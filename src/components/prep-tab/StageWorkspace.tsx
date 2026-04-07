/**
 * StageWorkspace — the main execution workspace for each deal lifecycle stage.
 * Contains: Context, Proactive Guidance, What Works, Recommended Actions, Best Assets, Execution, Output, Next Steps.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, FlaskConical } from 'lucide-react';
import { ContextInputSection } from './ContextInputSection';
import { WhatActuallyWorks } from './WhatActuallyWorks';
import { ActionExecutionPanel } from './ActionExecutionPanel';
import { PrepOutput } from './PrepOutput';
import { NextStepGuidance } from './NextStepGuidance';
import { fetchRankedResources, type RankedResource } from './resourceRanking';
import { StageResourcesSection } from './StageResourcesSection';
import { StagePlaybookSection } from './StagePlaybookSection';
import { FrameworkSectionsPanel } from './FrameworkSectionsPanel';
import { rankActions } from './actionRanking';
import { fetchActionizedAssets, buildTacticInjection, buildPromptInjection, trackActionizationFeedback, type ActionizedTactic, type ActionizedPrompt } from '@/lib/actionizationEngine';
import type { ContextItem } from './contextTypes';
import type { EvidenceData } from './EvidencePanel';
import type { StageConfig, StageAction } from './stageConfig';
import { cn } from '@/lib/utils';

interface Props {
  stage: StageConfig;
  onChangeStage: (stageId: string) => void;
}

export function StageWorkspace({ stage, onChangeStage }: Props) {
  const { user } = useAuth();

  // Context state
  const [accountId, setAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [persona, setPersona] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);

  // Action state
  const [selectedAction, setSelectedAction] = useState<StageAction | null>(null);

  // Output state
  const [output, setOutput] = useState('');
  const [subjectLine, setSubjectLine] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [evidence, setEvidence] = useState<EvidenceData | null>(null);

  // Ranked resources
  const [rankedTemplates, setRankedTemplates] = useState<RankedResource[]>([]);
  const [rankedExamples, setRankedExamples] = useState<RankedResource[]>([]);
  const [rankedKI, setRankedKI] = useState<RankedResource[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);

  // Accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-for-prep', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('user_id', user!.id)
        .is('deleted_at', null)
        .order('name');
      return data || [];
    },
  });

  const handleAccountChange = useCallback((id: string) => {
    setAccountId(id);
    setAccountName(accounts.find(a => a.id === id)?.name || '');
  }, [accounts]);

  // Load ranked assets when stage/context changes
  useEffect(() => {
    if (!user) return;
    loadAssets();
  }, [user, stage.id, persona, competitor]);

  async function loadAssets() {
    if (!user) return;
    setAssetsLoading(true);
    try {
      const ranked = await fetchRankedResources({
        userId: user.id,
        actionId: stage.actions[0]?.id || stage.id,
        stage: stage.id,
        persona: persona || undefined,
        competitor: competitor || undefined,
      });
      setRankedTemplates(ranked.templates);
      setRankedExamples(ranked.examples);
      setRankedKI(ranked.knowledgeItems);
    } catch {
      // silent
    } finally {
      setAssetsLoading(false);
    }
  }

  // Dynamically ranked actions
  const rankedStageActions = useMemo(() => {
    return rankActions(stage.actions, {
      persona,
      competitor,
      hasContext: contextItems.length > 0,
      templates: rankedTemplates,
      knowledgeItems: rankedKI,
    });
  }, [stage.actions, persona, competitor, contextItems.length, rankedTemplates, rankedKI]);

  const getContextText = useCallback(() => {
    return contextItems
      .filter(item => item.parseStatus === 'parsed')
      .map(item => item.type === 'image' ? `[Image: ${item.label}]` : item.content)
      .filter(Boolean)
      .join('\n\n');
  }, [contextItems]);

  const handleGenerate = useCallback(async () => {
    if (!selectedAction || !user) return;
    setIsGenerating(true);
    setSources([]);
    setOutput('');
    setSubjectLine('');
    setEvidence(null);

    try {
      const contextText = getContextText();

      // Fetch ranked resources AND actionized assets in parallel
      const [ranked, actionized] = await Promise.all([
        fetchRankedResources({
          userId: user.id,
          actionId: selectedAction.id,
          stage: stage.id,
          persona: persona || undefined,
          competitor: competitor || undefined,
          contextText: contextText || undefined,
        }),
        fetchActionizedAssets({
          userId: user.id,
          stage: stage.id,
          actionId: selectedAction.id,
          persona: persona || undefined,
          competitor: competitor || undefined,
        }),
      ]);

      // Build resource context
      const parts: string[] = [];
      if (ranked.templates.length) {
        parts.push('TEMPLATES:\n' + ranked.templates.map(t => `- ${t.title} (${t.reasons.join(', ')}):\n${t.body}`).join('\n\n'));
      }
      if (ranked.examples.length) {
        parts.push('EXAMPLES:\n' + ranked.examples.map(e => `- ${e.title} (${e.reasons.join(', ')}):\n${e.body}`).join('\n\n'));
      }
      if (ranked.knowledgeItems.length) {
        parts.push('KNOWLEDGE:\n' + ranked.knowledgeItems.map(k => `- ${k.title}: ${k.body}`).join('\n'));
      }

      // Build actionized injections
      const tacticInjection = buildTacticInjection(actionized.tactics);
      const promptInjection = buildPromptInjection(actionized.prompts);

      setEvidence({
        templates: ranked.templates,
        examples: ranked.examples,
        knowledgeItems: ranked.knowledgeItems,
        contextItems,
        tacticsInjected: actionized.tactics,
        promptsInjected: actionized.prompts,
      });

      const { data, error } = await supabase.functions.invoke('generate-execution-draft', {
        body: {
          actionId: selectedAction.id,
          actionLabel: selectedAction.label,
          actionPrompt: selectedAction.systemPrompt,
          accountName: accountName || undefined,
          stage: stage.id,
          persona: persona || undefined,
          competitor: competitor || undefined,
          contextText: contextText || undefined,
          resourceContext: parts.join('\n\n') || undefined,
          tacticInjection: tacticInjection || undefined,
          promptInjection: promptInjection || undefined,
        },
      });

      if (error) throw error;
      setOutput(data?.content || '');
      setSubjectLine(data?.subject_line || '');
      setSources(data?.sources || []);
      toast.success('Output generated');

      // Track feedback for actionization engine
      trackActionizationFeedback(user.id, {
        outputId: data?.id || 'generated',
        tacticsUsed: actionized.tactics.map(t => t.id),
        promptsUsed: actionized.prompts.map(p => p.id),
        templatesUsed: actionized.templates.map(t => t.id),
        action: 'used',
      });
    } catch (err) {
      console.error('Generation error:', err);
      toast.error('Generation failed — please try again');
    } finally {
      setIsGenerating(false);
    }
  }, [selectedAction, accountName, stage, persona, competitor, contextItems, user, getContextText]);

  const handleSelectActionById = (actionId: string) => {
    // Search current stage first, then all stages
    const action = stage.actions.find(a => a.id === actionId);
    if (action) setSelectedAction(action);
  };

  // Convert StageAction to PrepAction shape for ActionExecutionPanel
  const toPrepAction = (a: StageAction) => ({
    id: a.id,
    label: a.label,
    description: a.description,
    category: stage.id as any,
    icon: a.icon,
    systemPrompt: a.systemPrompt,
  });

  return (
    <div className="space-y-5">
      {/* Stage description */}
      <p className="text-xs text-muted-foreground">{stage.description}</p>

      {/* 1. Recommended Actions (dynamically ranked) — shown first */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recommended Actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {rankedStageActions.map((a, idx) => {
            const Icon = a.icon;
            const active = selectedAction?.id === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setSelectedAction(a)}
                className={cn(
                  'flex flex-col items-start gap-1.5 p-3 rounded-lg border text-left transition-all relative',
                  active
                    ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30'
                    : 'border-border hover:border-primary/40 hover:bg-accent/30'
                )}
              >
                {idx === 0 && (persona || competitor) && (
                  <Badge className="absolute -top-1.5 -right-1.5 text-[8px] px-1 py-0 h-3.5 bg-primary text-primary-foreground">
                    Best fit
                  </Badge>
                )}
                <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} />
                <span className={cn('text-xs font-medium leading-tight', active && 'text-primary')}>{a.label}</span>
                <span className="text-[10px] text-muted-foreground leading-snug line-clamp-2">{a.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Context */}
      <ContextInputSection
        accounts={accounts}
        accountId={accountId}
        onAccountChange={handleAccountChange}
        stage={stage.label}
        onStageChange={() => {}}
        persona={persona}
        onPersonaChange={setPersona}
        competitor={competitor}
        onCompetitorChange={setCompetitor}
        contextItems={contextItems}
        onContextItemsChange={setContextItems}
      />

      {/* Keystone & Supporting Resources */}
      <StageResourcesSection stageId={stage.id} stageLabel={stage.label} />

      {/* Framework-Driven Sections (Sales Operating System) */}
      <FrameworkSectionsPanel stageId={stage.id} stageLabel={stage.label} />

      {/* Stage Playbook (generated) */}
      <StagePlaybookSection stageId={stage.id} stageLabel={stage.label} />

      {/* 5. Execution */}
      {selectedAction && (
        <ActionExecutionPanel
          action={toPrepAction(selectedAction)}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          onClear={() => setSelectedAction(null)}
        />
      )}

      {/* 6. Output */}
      <PrepOutput
        output={output}
        onOutputChange={setOutput}
        subjectLine={subjectLine}
        onSubjectChange={setSubjectLine}
        sources={sources}
        isGenerating={isGenerating}
        onRegenerate={handleGenerate}
        evidence={evidence}
        actionLabel={selectedAction?.label || ''}
        accountName={accountName}
      />

      {/* 7. Supporting Evidence */}
      <EvidenceLayer stageId={stage.id} defaultTactics={stage.defaultTactics} persona={persona} competitor={competitor} />

      {/* 8. Next Step Guidance */}
      <NextStepGuidance
        nextSteps={stage.nextSteps}
        onSelectAction={handleSelectActionById}
        onChangeStage={onChangeStage}
        show={!!output}
      />
    </div>
  );
}

/** Collapsible secondary evidence wrapper around WhatActuallyWorks */
function EvidenceLayer({ stageId, defaultTactics, persona, competitor }: {
  stageId: string;
  defaultTactics: any[];
  persona?: string;
  competitor?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 px-3 rounded-lg border border-border hover:bg-accent/30 transition-colors">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Supporting Evidence</span>
        <span className="text-[10px] text-muted-foreground ml-1">Raw KIs &amp; tactics</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <WhatActuallyWorks
          stageId={stageId}
          defaultTactics={defaultTactics}
          persona={persona}
          competitor={competitor}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
