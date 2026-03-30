/**
 * Prep Deal Mode — the primary execution surface.
 *
 * Sections:
 * 1. Context Input (account, stage, persona, competitor, drag-and-drop)
 * 2. Suggested Actions (button grid)
 * 3. Action Execution Panel (selected action + generate)
 * 4. Output (formatted, copyable)
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

export function PrepDealMode() {
  const { user } = useAuth();

  // Context state
  const [accountId, setAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [stage, setStage] = useState('');
  const [persona, setPersona] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [contextText, setContextText] = useState('');

  // Action state
  const [selectedAction, setSelectedAction] = useState<PrepAction | null>(null);

  // Output state
  const [output, setOutput] = useState('');
  const [subjectLine, setSubjectLine] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [sources, setSources] = useState<string[]>([]);

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

  const handleGenerate = useCallback(async () => {
    if (!selectedAction) return;
    setIsGenerating(true);
    setSources([]);
    setOutput('');
    setSubjectLine('');

    try {
      // Fetch relevant resources for context injection
      let resourceContext = '';
      if (user) {
        const { data: templates } = await supabase
          .from('execution_templates')
          .select('title, body')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('times_used', { ascending: false })
          .limit(3);

        const { data: knowledgeItems } = await supabase
          .from('knowledge_items')
          .select('title, tactic_summary, when_to_use')
          .eq('user_id', user.id)
          .eq('active', true)
          .limit(5);

        const parts: string[] = [];
        if (templates?.length) {
          parts.push('RELEVANT TEMPLATES:\n' + templates.map(t => `- ${t.title}: ${t.body.slice(0, 300)}`).join('\n'));
        }
        if (knowledgeItems?.length) {
          parts.push('RELEVANT KNOWLEDGE:\n' + knowledgeItems.map(k =>
            `- ${k.title}: ${k.tactic_summary || ''} ${k.when_to_use ? `(Use when: ${k.when_to_use})` : ''}`
          ).join('\n'));
        }
        resourceContext = parts.join('\n\n');
      }

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
  }, [selectedAction, accountName, stage, persona, competitor, contextText, user]);

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
        contextText={contextText}
        onContextTextChange={setContextText}
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
      />
    </div>
  );
}
