/**
 * Prep Deal Mode — the primary execution surface.
 *
 * Sections:
 * 1. Context Input (account, stage, persona, competitor, context items)
 * 2. Suggested Actions (button grid)
 * 3. Context Confirmation (auto-detected signals + confirm/edit)
 * 4. Action Execution Panel (selected action + generate)
 * 5. Output (formatted, copyable, with evidence + save)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ContextInputSection } from './ContextInputSection';
import { ActionGrid, type PrepAction } from './ActionGrid';
import { ActionExecutionPanel } from './ActionExecutionPanel';
import { ContextConfirmationPanel } from './ContextConfirmationPanel';
import { PrepOutput } from './PrepOutput';
import { fetchRankedResources } from './resourceRanking';
import { buildPrepContext, type PrepContext } from './buildPrepContext';
import type { ContextItem } from './contextTypes';
import type { EvidenceData } from './EvidencePanel';

export function PrepDealMode() {
  const { user } = useAuth();

  // Context state
  const [accountId, setAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [stage, setStage] = useState('');
  const [persona, setPersona] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);

  // Action state
  const [selectedAction, setSelectedAction] = useState<PrepAction | null>(null);

  // Auto-context state
  const [prepContext, setPrepContext] = useState<PrepContext | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [contextDismissed, setContextDismissed] = useState(false);
  const lastContextAccountRef = useRef('');

  // Output state
  const [output, setOutput] = useState('');
  const [subjectLine, setSubjectLine] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [evidence, setEvidence] = useState<EvidenceData | null>(null);

  // Accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-for-prep', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('user_id', user!.id)
        .order('name');
      return data || [];
    },
  });

  const handleAccountChange = useCallback((id: string) => {
    setAccountId(id);
    setAccountName(accounts.find(a => a.id === id)?.name || '');
    setContextDismissed(false);
  }, [accounts]);

  // Auto-build context when account + action are both set
  useEffect(() => {
    if (!accountId || !selectedAction || !user) {
      setPrepContext(null);
      setShowConfirmation(false);
      return;
    }
    // Don't re-fetch if same account
    if (lastContextAccountRef.current === accountId && prepContext) {
      if (!contextDismissed) setShowConfirmation(true);
      return;
    }

    let cancelled = false;
    setIsLoadingContext(true);

    buildPrepContext(accountId, user.id).then(ctx => {
      if (cancelled) return;
      setPrepContext(ctx);
      lastContextAccountRef.current = accountId;
      setIsLoadingContext(false);
      if (ctx.signals.length > 0 && !contextDismissed) {
        setShowConfirmation(true);
      }
    }).catch(() => {
      if (!cancelled) setIsLoadingContext(false);
    });

    return () => { cancelled = true; };
  }, [accountId, selectedAction, user]);

  // Combine manual context items + auto-context into text for the prompt
  const getContextText = useCallback(() => {
    const manualParts = contextItems
      .map(item => {
        if (item.type === 'image') return `[Image attached: ${item.label}]`;
        return item.content;
      })
      .filter(Boolean);

    // Prepend auto-context block if available
    const parts: string[] = [];
    if (prepContext?.contextBlock) {
      parts.push(prepContext.contextBlock);
    }
    parts.push(...manualParts);

    return parts.join('\n\n');
  }, [contextItems, prepContext]);

  const handleGenerate = useCallback(async () => {
    if (!selectedAction || !user) return;
    setIsGenerating(true);
    setSources([]);
    setOutput('');
    setSubjectLine('');
    setEvidence(null);
    setShowConfirmation(false);

    try {
      const contextText = getContextText();

      // Fetch relevance-ranked resources
      const ranked = await fetchRankedResources({
        userId: user.id,
        actionId: selectedAction.id,
        stage: stage || undefined,
        persona: persona || undefined,
        competitor: competitor || undefined,
        contextText: contextText || undefined,
      });

      // Build resource context string for the prompt
      const resourceParts: string[] = [];
      if (ranked.templates.length) {
        resourceParts.push('TEMPLATES:\n' + ranked.templates.map(t =>
          `- ${t.title} (${t.reasons.join(', ')}):\n${t.body}`
        ).join('\n\n'));
      }
      if (ranked.examples.length) {
        resourceParts.push('EXAMPLES:\n' + ranked.examples.map(e =>
          `- ${e.title} (${e.reasons.join(', ')}):\n${e.body}`
        ).join('\n\n'));
      }
      if (ranked.knowledgeItems.length) {
        resourceParts.push('KNOWLEDGE:\n' + ranked.knowledgeItems.map(k =>
          `- ${k.title}: ${k.body}`
        ).join('\n'));
      }
      const resourceContext = resourceParts.join('\n\n');

      // Store evidence for display
      setEvidence({
        templates: ranked.templates,
        examples: ranked.examples,
        knowledgeItems: ranked.knowledgeItems,
        contextItems,
      });

      const { data, error } = await supabase.functions.invoke('generate-execution-draft', {
        body: {
          actionId: selectedAction.id,
          actionLabel: selectedAction.label,
          actionPrompt: selectedAction.systemPrompt,
          accountName: prepContext?.account?.name || accountName || undefined,
          stage: stage || undefined,
          persona: persona || undefined,
          competitor: competitor || undefined,
          contextText: contextText || undefined,
          resourceContext: resourceContext || undefined,
        },
      });

      if (error) throw error;

      setOutput(data?.content || '');
      setSubjectLine(data?.subject_line || '');
      setSources(data?.sources || []);
      toast.success('Output generated');
    } catch (err) {
      console.error('Generation error:', err);
      toast.error('Generation failed — please try again');
    } finally {
      setIsGenerating(false);
    }
  }, [selectedAction, accountName, stage, persona, competitor, contextItems, user, getContextText, prepContext]);

  const handleEditContext = useCallback(() => {
    setShowConfirmation(false);
    setContextDismissed(true);
    // Scroll to context section so user can edit fields
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="space-y-5">
      {/* Section 1: Context */}
      <ContextInputSection
        accounts={accounts}
        accountId={accountId}
        onAccountChange={handleAccountChange}
        stage={stage}
        onStageChange={setStage}
        persona={persona}
        onPersonaChange={setPersona}
        competitor={competitor}
        onCompetitorChange={setCompetitor}
        contextItems={contextItems}
        onContextItemsChange={setContextItems}
      />

      {/* Section 2: Actions */}
      <ActionGrid
        selectedAction={selectedAction}
        onSelectAction={setSelectedAction}
      />

      {/* Section 3: Context Confirmation */}
      {selectedAction && showConfirmation && prepContext && !isLoadingContext && (
        <ContextConfirmationPanel
          signals={prepContext.signals}
          onConfirm={handleGenerate}
          onEdit={handleEditContext}
          isGenerating={isGenerating}
          actionLabel={selectedAction.label}
        />
      )}

      {/* Section 4: Execute (shown when confirmation dismissed or no auto-context) */}
      {selectedAction && !showConfirmation && (
        <ActionExecutionPanel
          action={selectedAction}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          onClear={() => setSelectedAction(null)}
        />
      )}

      {/* Section 5: Output */}
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
        accountName={prepContext?.account?.name || accountName}
      />
    </div>
  );
}
