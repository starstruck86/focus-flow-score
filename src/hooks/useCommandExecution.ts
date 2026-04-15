/**
 * useCommandExecution — orchestrates template execution with KI integration.
 */
import { useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ParsedCommand } from '@/components/command/CommandBar';

// Built-in templates
export interface BuiltInTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    id: 'discovery-prep',
    name: 'Discovery Prep',
    description: 'Structured plan with objectives, questions, risks, and stakeholder hypotheses',
    systemPrompt: `Create a comprehensive discovery call preparation. Output these exact sections:

## Objectives
What must we learn or confirm by the end of this call.

## Key Questions
Organized by theme: Current State, Pain & Impact, Decision Process, Vision. Include follow-up probes.

## Risks
Red flags to watch for. Signals the deal may stall.

## Stakeholder Hypotheses
Who's involved, what they care about, and how to approach each.

## Competitive Landmines
If a competitor is in play: questions that expose weaknesses without bashing.

## Desired Outcome
What success looks like at the end of this call.`,
  },
  {
    id: 'exec-brief',
    name: 'Executive Brief',
    description: 'Concise executive summary with strategic context and recommendations',
    systemPrompt: `Create a concise executive briefing document. Output these exact sections:

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
    systemPrompt: `Write a professional follow-up email. Start with "Subject: <subject line>" on the first line.

Structure:
1. Brief, genuine opener (1 sentence)
2. Key takeaways from the conversation (3-5 bullets, framed in THEIR priorities)
3. Agreed next steps (numbered, with owners and dates)
4. Clear closing with specific call to action

Tone: Executive-level, concise. Every sentence earns its place. Under 200 words for the body.`,
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    description: 'Strategic brainstorm with creative angles and action items',
    systemPrompt: `Run a strategic brainstorm session. Output these sections:

## Problem Statement
Restate the challenge in one clear sentence.

## Key Angles
5-7 distinct strategic approaches or ideas, each with:
- The idea (1 sentence)
- Why it could work
- Key risk or assumption

## Quick Wins
2-3 things that can be done immediately.

## Bold Moves
1-2 unconventional or high-risk/high-reward plays.

## Recommended Next Steps
Prioritized actions to pursue.`,
  },
];

interface ExecutionResult {
  output: string;
  subjectLine: string;
  sources: string[];
  kiCount: number;
}

export function useCommandExecution() {
  const { user } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);

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
      // Join account names
      const accountMap = new Map(accounts.map(a => [a.id, a.name]));
      return (data || []).map(o => ({
        ...o,
        account_name: o.account_id ? accountMap.get(o.account_id) : undefined,
      }));
    },
  });

  // Load user-saved templates from execution_templates
  const { data: savedTemplates = [] } = useQuery({
    queryKey: ['cmd-saved-templates', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from('execution_templates' as any)
        .select('id, title, body, output_type')
        .eq('user_id', user!.id)
        .eq('status', 'active')
        .order('times_used', { ascending: false })
        .limit(50);
      return (data || []).map((t: any) => ({
        id: t.id,
        name: t.title,
        description: t.output_type,
        body: t.body,
      }));
    },
  });

  // Merge built-in + saved templates for autocomplete
  const allTemplates = [
    ...BUILT_IN_TEMPLATES.map(t => ({ id: t.id, name: t.name, description: t.description })),
    ...savedTemplates.map((t: any) => ({ id: t.id, name: t.name, description: t.description })),
  ];

  // Fetch relevant KIs for the context
  const fetchKIs = useCallback(async (
    accountName?: string,
    templateId?: string,
  ): Promise<{ text: string; count: number }> => {
    if (!user) return { text: '', count: 0 };

    try {
      let q = supabase
        .from('knowledge_items' as any)
        .select('title, tactic_summary, chapter, competitor_name, framework, how_to_execute, when_to_use, example_usage')
        .eq('user_id', user.id)
        .eq('active', true)
        .order('confidence_score', { ascending: false })
        .limit(30);

      const { data, error } = await q;
      if (error || !data?.length) return { text: '', count: 0 };

      const items = data as any[];
      const kiText = items.map((ki: any) => {
        let line = `• ${ki.title}`;
        if (ki.tactic_summary) line += `: ${ki.tactic_summary}`;
        if (ki.how_to_execute) line += `\n  How: ${ki.how_to_execute}`;
        if (ki.when_to_use) line += `\n  When: ${ki.when_to_use}`;
        if (ki.competitor_name) line += ` [vs ${ki.competitor_name}]`;
        if (ki.framework) line += ` [${ki.framework}]`;
        return line;
      }).join('\n');

      return { text: kiText, count: items.length };
    } catch {
      return { text: '', count: 0 };
    }
  }, [user]);

  const execute = useCallback(async (command: ParsedCommand, useKIs: boolean) => {
    if (!user) return;

    setIsGenerating(true);
    setResult(null);

    try {
      // Resolve template
      const builtIn = BUILT_IN_TEMPLATES.find(t => t.id === command.template?.id || t.name === command.template?.name);
      const saved = savedTemplates.find((t: any) => t.id === command.template?.id || t.name === command.template?.name);

      const actionPrompt = builtIn?.systemPrompt || (saved as any)?.body || '';
      const templateLabel = builtIn?.name || (saved as any)?.name || command.template?.name || 'Custom';

      // Fetch KIs if enabled
      let kiContext = '';
      let kiCount = 0;
      if (useKIs) {
        const kis = await fetchKIs(command.account?.name, command.template?.id);
        kiContext = kis.text;
        kiCount = kis.count;
      }

      // Build resource context from KIs
      const resourceContext = kiContext
        ? `\n--- ACTIVE KNOWLEDGE (${kiCount} items from user's library) ---\n${kiContext}\n--- END KNOWLEDGE ---\nUse this knowledge to ground your output. Reference specific tactics, frameworks, and strategies where relevant.`
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

      const sources: string[] = [];
      if (kiCount > 0) sources.push(`${kiCount} Knowledge Items`);
      if (command.account) sources.push(`Account: ${command.account.name}`);
      if (command.opportunity) sources.push(`Opportunity: ${command.opportunity.name}`);
      sources.push('AI Generation');

      setResult({
        output: data?.content || '',
        subjectLine: data?.subject_line || '',
        sources,
        kiCount,
      });

      toast.success('Output generated');
    } catch (err) {
      console.error('Command execution error:', err);
      toast.error('Generation failed — please try again');
    } finally {
      setIsGenerating(false);
    }
  }, [user, savedTemplates, fetchKIs]);

  const saveAsTemplate = useCallback(async (name: string, content: string) => {
    if (!user) return;
    try {
      await supabase.from('execution_templates' as any).insert({
        user_id: user.id,
        title: name,
        body: content,
        output_type: 'custom',
        template_origin: 'user_saved',
        created_by_user: true,
        status: 'active',
      } as any);
      toast.success(`Template "${name}" saved`);
    } catch {
      toast.error('Failed to save template');
    }
  }, [user]);

  return {
    accounts,
    opportunities,
    allTemplates,
    isGenerating,
    result,
    execute,
    saveAsTemplate,
  };
}
