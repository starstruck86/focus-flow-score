/**
 * useCommandExecution — orchestrates template execution with context-aware KI retrieval.
 * Now returns KI explainability metadata and captures feedback signals.
 */
import { useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ParsedCommand, TemplateMetadata, ExecutionResult } from '@/lib/commandTypes';
import { parseOutputBlocks } from '@/lib/commandTypes';
import { retrieveContextualKIs } from '@/lib/contextAwareKIRetrieval';
import type { KIExplainability } from '@/lib/contextAwareKIRetrieval';
import { useCommandFeedback } from '@/hooks/useCommandFeedback';

// ─── Built-in templates with full metadata ───

export const BUILT_IN_TEMPLATES: TemplateMetadata[] = [
  {
    id: 'discovery-prep',
    name: 'Discovery Prep',
    description: 'Structured plan with objectives, questions, risks, and stakeholder hypotheses',
    output_type: 'discovery_prep',
    recommended_context_types: ['account', 'opportunity', 'persona'],
    preferred_ki_depth: 'deep',
    is_pinned: false,
    is_favorite: false,
    times_used: 0,
    last_used_at: null,
    source: 'built_in',
    output_sections: ['Objectives', 'Key Questions', 'Risks', 'Stakeholder Hypotheses', 'Recommended Angle'],
    systemPrompt: `Create a comprehensive discovery call preparation. Output these exact sections with ## headings:

## Objectives
What must we learn or confirm by the end of this call.

## Key Questions
Organized by theme: Current State, Pain & Impact, Decision Process, Vision. Include follow-up probes.

## Risks
Red flags to watch for. Signals the deal may stall.

## Stakeholder Hypotheses
Who's involved, what they care about, and how to approach each.

## Recommended Angle
The strategic approach for this specific call based on context.`,
  },
  {
    id: 'exec-brief',
    name: 'Executive Brief',
    description: 'Concise executive summary with strategic context and recommendations',
    output_type: 'exec_brief',
    recommended_context_types: ['account', 'opportunity', 'competitor'],
    preferred_ki_depth: 'standard',
    is_pinned: false,
    is_favorite: false,
    times_used: 0,
    last_used_at: null,
    source: 'built_in',
    output_sections: ['Situation Summary', 'Strategic Context', 'Our Position', 'Key Risks', 'Recommendations', 'Talking Points'],
    systemPrompt: `Create a concise executive briefing document. Output these exact sections with ## headings:

## Situation Summary
2-3 sentences on where things stand.

## Strategic Context
What's happening in their world that creates urgency.

## Our Position
Where we stand competitively and relationally.

## Key Risks
Top 2-3 things that could derail this.

## Recommendations
Specific actions to take, ordered by priority.

## Talking Points
3-5 things to say in the next conversation.`,
  },
  {
    id: 'follow-up-email',
    name: 'Follow-Up Email',
    description: 'Professional follow-up email with clear next steps',
    output_type: 'follow_up_email',
    recommended_context_types: ['account'],
    preferred_ki_depth: 'shallow',
    is_pinned: false,
    is_favorite: false,
    times_used: 0,
    last_used_at: null,
    source: 'built_in',
    output_sections: ['Subject', 'Body', 'CTA'],
    systemPrompt: `Write a professional follow-up email. 

Start with "Subject: <subject line>" on the first line, then a blank line.

Then output these sections with ## headings:

## Body
Brief, genuine opener (1 sentence). Key takeaways from the conversation (3-5 bullets, framed in THEIR priorities). Under 200 words.

## CTA
Clear closing with specific call to action and agreed next steps with owners and dates.

Tone: Executive-level, concise. Every sentence earns its place.`,
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    description: 'Strategic brainstorm with creative angles and action items',
    output_type: 'brainstorm',
    recommended_context_types: ['account', 'opportunity'],
    preferred_ki_depth: 'deep',
    is_pinned: false,
    is_favorite: false,
    times_used: 0,
    last_used_at: null,
    source: 'built_in',
    output_sections: ['Problem Statement', 'Key Angles', 'Quick Wins', 'Bold Moves', 'Recommended Next Steps'],
    systemPrompt: `Run a strategic brainstorm session. Output these sections with ## headings:

## Problem Statement
Restate the challenge in one clear sentence.

## Key Angles
5-7 distinct strategic approaches or ideas, each with the idea, why it could work, and key risk.

## Quick Wins
2-3 things that can be done immediately.

## Bold Moves
1-2 unconventional or high-risk/high-reward plays.

## Recommended Next Steps
Prioritized actions to pursue.`,
  },
];

export function useCommandExecution() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { capture } = useCommandFeedback();
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [lastKIExplainability, setLastKIExplainability] = useState<KIExplainability | null>(null);

  // Load accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ['cmd-accounts', user?.id],
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

  // Load opportunities
  const { data: opportunities = [] } = useQuery({
    queryKey: ['cmd-opportunities', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from('opportunities')
        .select('id, name, account_id')
        .eq('user_id', user!.id)
        .order('name');
      const accountMap = new Map(accounts.map(a => [a.id, a.name]));
      return (data || []).map(o => ({
        ...o,
        account_name: o.account_id ? accountMap.get(o.account_id) : undefined,
      }));
    },
  });

  // Load user-saved templates
  const { data: savedTemplates = [] } = useQuery({
    queryKey: ['cmd-saved-templates', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from('execution_templates' as any)
        .select('id, title, body, output_type, is_pinned, is_favorite, times_used, last_used_at')
        .eq('user_id', user!.id)
        .eq('status', 'active')
        .order('is_pinned', { ascending: false })
        .order('times_used', { ascending: false })
        .limit(50);
      return (data || []).map((t: any): TemplateMetadata => ({
        id: t.id,
        name: t.title,
        description: t.output_type?.replace(/_/g, ' ') || 'Custom',
        output_type: t.output_type || 'custom',
        recommended_context_types: [],
        preferred_ki_depth: 'standard',
        is_pinned: t.is_pinned ?? false,
        is_favorite: t.is_favorite ?? false,
        times_used: t.times_used ?? 0,
        last_used_at: t.last_used_at,
        source: 'saved',
        output_sections: [],
        systemPrompt: t.body || '',
      }));
    },
  });

  // Load saved shortcuts
  const { data: savedShortcuts = [] } = useQuery({
    queryKey: ['cmd-shortcuts', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from('command_shortcuts' as any)
        .select('*')
        .eq('user_id', user!.id)
        .order('is_pinned', { ascending: false })
        .order('times_used', { ascending: false })
        .limit(20);
      return data || [];
    },
  });

  // Merge built-in + saved templates, pinned first
  const allTemplates: TemplateMetadata[] = [
    ...BUILT_IN_TEMPLATES,
    ...savedTemplates,
  ].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    return (b.times_used || 0) - (a.times_used || 0);
  });

  const execute = useCallback(async (command: ParsedCommand, useKIs: boolean) => {
    if (!user) return;

    setIsGenerating(true);
    setResult(null);
    setLastKIExplainability(null);

    try {
      const template = allTemplates.find(
        t => t.id === command.template?.id || t.name === command.template?.name
      );

      const actionPrompt = template?.systemPrompt || '';
      const templateLabel = template?.name || command.template?.name || 'Custom';
      const depth = template?.preferred_ki_depth || 'standard';

      // Context-aware KI retrieval with explainability
      let kiContext = '';
      let kiCount = 0;
      if (useKIs) {
        const kis = await retrieveContextualKIs({
          userId: user.id,
          templateOutputType: template?.output_type,
          accountId: command.account?.id,
          accountName: command.account?.name,
          freeText: command.freeText,
          depth,
        });
        kiContext = kis.text;
        kiCount = kis.count;
        setLastKIExplainability(kis.explainability);
      }

      const resourceContext = kiContext
        ? `\n--- ACTIVE KNOWLEDGE (${kiCount} items, context-matched) ---\n${kiContext}\n--- END KNOWLEDGE ---\nUse this knowledge to ground your output. Reference specific tactics, frameworks, and strategies where relevant.`
        : '';

      const { data, error } = await supabase.functions.invoke('generate-execution-draft', {
        body: {
          actionId: command.template?.id || 'custom',
          actionLabel: templateLabel,
          actionPrompt,
          accountName: command.account?.name,
          contextText: command.freeText || undefined,
          resourceContext: resourceContext || undefined,
        },
      });

      if (error) throw error;

      const rawOutput = data?.content || '';
      const blocks = parseOutputBlocks(rawOutput);

      const sources: string[] = [];
      if (kiCount > 0) sources.push(`${kiCount} KIs (context-matched)`);
      if (command.account) sources.push(`Account: ${command.account.name}`);
      if (command.opportunity) sources.push(`Opportunity: ${command.opportunity.name}`);
      sources.push('AI Generation');

      setResult({
        output: rawOutput,
        blocks,
        subjectLine: data?.subject_line || '',
        sources,
        kiCount,
        templateId: command.template?.id || null,
      });

      // Track template usage
      if (template?.source === 'saved' && template.id) {
        supabase
          .from('execution_templates' as any)
          .update({ times_used: (template.times_used || 0) + 1, last_used_at: new Date().toISOString() } as any)
          .eq('id', template.id)
          .then(() => qc.invalidateQueries({ queryKey: ['cmd-saved-templates'] }));
      }

      toast.success('Output generated');
    } catch (err) {
      console.error('Command execution error:', err);
      toast.error('Generation failed — please try again');
    } finally {
      setIsGenerating(false);
    }
  }, [user, allTemplates, qc]);

  const createAccount = useCallback(async (name: string): Promise<{ id: string; name: string } | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('accounts')
      .insert({ name, user_id: user.id })
      .select('id, name')
      .single();
    if (error) { toast.error('Failed to create account'); return null; }
    qc.invalidateQueries({ queryKey: ['cmd-accounts'] });
    toast.success(`Account "${name}" created`);
    return data;
  }, [user, qc]);

  const createOpportunity = useCallback(async (name: string, accountId?: string): Promise<{ id: string; name: string } | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('opportunities')
      .insert({ name, user_id: user.id, account_id: accountId || null } as any)
      .select('id, name')
      .single();
    if (error) { toast.error('Failed to create opportunity'); return null; }
    qc.invalidateQueries({ queryKey: ['cmd-opportunities'] });
    toast.success(`Opportunity "${name}" created`);
    return data;
  }, [user, qc]);

  const saveAsTemplate = useCallback(async (name: string, content: string) => {
    if (!user) return;
    try {
      await supabase.from('execution_templates' as any).insert({
        user_id: user.id, title: name, body: content,
        output_type: 'custom', template_origin: 'promoted_from_output',
        created_by_user: true, status: 'active', times_used: 0,
      } as any);
      qc.invalidateQueries({ queryKey: ['cmd-saved-templates'] });
      capture('saved_template', { templateName: name });
      toast.success(`Template "${name}" saved`);
    } catch { toast.error('Failed to save template'); }
  }, [user, qc, capture]);

  const saveShortcut = useCallback(async (command: ParsedCommand, label?: string) => {
    if (!user) return;
    const shortcutLabel = label || [
      command.template?.name,
      command.account?.name ? `@${command.account.name}` : null,
    ].filter(Boolean).join(' ') || command.rawText.slice(0, 40);

    try {
      await supabase.from('command_shortcuts' as any).insert({
        user_id: user.id,
        label: shortcutLabel,
        raw_command: command.rawText,
        template_id: command.template?.id || null,
        template_name: command.template?.name || null,
        account_id: command.account?.id || null,
        account_name: command.account?.name || null,
        opportunity_id: command.opportunity?.id || null,
        opportunity_name: command.opportunity?.name || null,
        free_text: command.freeText || null,
      } as any);
      qc.invalidateQueries({ queryKey: ['cmd-shortcuts'] });
      toast.success('Shortcut saved');
    } catch { toast.error('Failed to save shortcut'); }
  }, [user, qc]);

  const pinShortcut = useCallback(async (id: string, pinned: boolean) => {
    await supabase.from('command_shortcuts' as any)
      .update({ is_pinned: pinned } as any)
      .eq('id', id);
    qc.invalidateQueries({ queryKey: ['cmd-shortcuts'] });
  }, [qc]);

  return {
    accounts,
    opportunities,
    allTemplates,
    savedShortcuts,
    isGenerating,
    result,
    lastKIExplainability,
    execute,
    createAccount,
    createOpportunity,
    saveAsTemplate,
    saveShortcut,
    pinShortcut,
    capture,
  };
}
