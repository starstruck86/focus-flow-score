/**
 * Prep Deal Mode — the primary execution surface.
 *
 * Sections:
 * 1. Context Input (account, stage, persona, competitor, context items)
 * 2. Suggested Actions (button grid)
 * 3. Action Execution Panel (selected action + generate)
 * 4. Output (formatted, copyable, with evidence + save)
 */

import { useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ContextInputSection } from './ContextInputSection';
import { ActionGrid, type PrepAction } from './ActionGrid';
import { ActionExecutionPanel } from './ActionExecutionPanel';
import { PrepOutput } from './PrepOutput';
import { fetchRankedResources, type RankedResource } from './resourceRanking';
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
  }, [accounts]);

  // Combine context items into text for the prompt
  const getContextText = useCallback(() => {
    return contextItems
      .map(item => {
        if (item.type === 'image') return `[Image attached: ${item.label}]`;
        return item.content;
      })
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
          accountName: accountName || undefined,
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
  }, [selectedAction, accountName, stage, persona, competitor, contextItems, user, getContextText]);

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

      {/* Section 3: Execute */}
      {selectedAction && (
        <ActionExecutionPanel
          action={selectedAction}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          onClear={() => setSelectedAction(null)}
        />
      )}

      {/* Section 4: Output */}
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
    </div>
  );
}
