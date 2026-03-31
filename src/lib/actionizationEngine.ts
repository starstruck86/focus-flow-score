/**
 * Actionization Engine — converts promoted resources into usable execution assets.
 *
 * After a resource is promoted (template / example / knowledge), this engine
 * automatically generates structured outputs:
 *   A) Execution Template — reusable structured output
 *   B) Prompt Module — thinking guidance, question sets, frameworks
 *   C) Tactic Injection — short rules injected into generation
 */

import { supabase } from '@/integrations/supabase/client';

// ── Types ──────────────────────────────────────────────────

export interface ActionizedTemplate {
  id: string;
  title: string;
  body: string;
  use_cases: string[];
  capabilities: string[];
  source_resource_id: string;
  confidence: number;
  editable: boolean;
}

export interface ActionizedPrompt {
  id: string;
  title: string;
  prompt_text: string;
  use_cases: string[];
  capabilities: string[];
  source_resource_id: string;
  confidence: number;
  editable: boolean;
}

export interface ActionizedTactic {
  id: string;
  statement: string;
  when_to_use: string;
  source_resource_id: string;
  source_title: string;
  confidence: number;
  capabilities: string[];
  usage_count: number;
}

export interface ActionizedOutputs {
  templates: ActionizedTemplate[];
  prompts: ActionizedPrompt[];
  tactics: ActionizedTactic[];
}

// ── Conversion rules ───────────────────────────────────────

const TEMPLATE_STRUCTURE_PATTERNS = [
  /subject\s*:/i, /dear\s/i, /hi\s\[/i,
  /step\s*\d/i, /agenda/i, /\[.*name.*\]/i,
  /\[.*company.*\]/i, /\{.*\}/,
];

const TACTIC_EXTRACTION_PATTERNS = [
  /always\s+(.{10,80})/gi,
  /never\s+(.{10,80})/gi,
  /best\s*practice[:\s]+(.{10,100})/gi,
  /key\s*insight[:\s]+(.{10,100})/gi,
  /rule[:\s]+(.{10,100})/gi,
  /tip[:\s]+(.{10,100})/gi,
  /when\s+.*?,\s+(.{10,100})/gi,
];

const CAPABILITY_KEYWORDS: Record<string, string[]> = {
  roi_framing: ['roi', 'return on', 'cost sav', 'business case', 'value'],
  executive_messaging: ['executive', 'cfo', 'cxo', 'vp ', 'c-suite'],
  objection_handling: ['objection', 'pushback', 'rebuttal', 'overcome'],
  champion_enablement: ['champion', 'internal sell', 'alignment', 'mobiliz'],
  discovery_questions: ['discovery', 'question', 'qualifying', 'pain'],
  pricing_strategy: ['pric', 'discount', 'negotiat', 'anchor'],
  procurement_support: ['procurement', 'legal', 'security', 'compliance'],
};

function detectCapabilities(text: string): string[] {
  const lower = text.toLowerCase();
  const caps: string[] = [];
  for (const [cap, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) caps.push(cap);
  }
  return caps;
}

function detectUseCases(text: string): string[] {
  const lower = text.toLowerCase();
  const useCases: string[] = [];
  const map: Record<string, string[]> = {
    'Discovery': ['discovery', 'qualifying', 'pain point'],
    'Demo': ['demo', 'presentation', 'walkthrough'],
    'Pricing / ROI': ['pricing', 'roi', 'business case'],
    'Outbound': ['outbound', 'cold', 'prospecting'],
    'Follow-up': ['follow-up', 'recap', 'after call'],
    'Competitive': ['competitor', 'versus', 'battlecard'],
    'Closing': ['closing', 'negotiat', 'contract'],
    'Executive': ['executive', 'cfo', 'cxo'],
    'Champion': ['champion', 'internal sell'],
    'Procurement': ['procurement', 'legal', 'security review'],
  };
  for (const [uc, keywords] of Object.entries(map)) {
    if (keywords.some(kw => lower.includes(kw))) useCases.push(uc);
  }
  return useCases;
}

// ── Extract tactics from text ──────────────────────────────

function extractTacticsFromText(text: string, sourceId: string, sourceTitle: string): ActionizedTactic[] {
  const tactics: ActionizedTactic[] = [];
  const seen = new Set<string>();

  for (const pattern of TACTIC_EXTRACTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const statement = match[1]?.trim().replace(/[.;,]+$/, '');
      if (!statement || statement.length < 15 || seen.has(statement.toLowerCase())) continue;
      seen.add(statement.toLowerCase());
      tactics.push({
        id: `tactic-${sourceId}-${seen.size}`,
        statement,
        when_to_use: '',
        source_resource_id: sourceId,
        source_title: sourceTitle,
        confidence: 0.6,
        capabilities: detectCapabilities(statement),
        usage_count: 0,
      });
    }
  }

  return tactics.slice(0, 5);
}

// ── Actionize a promoted template resource ──────────────────

function actionizeTemplate(resource: {
  id: string; title: string; content: string;
  tags?: string[]; template_category?: string;
}): ActionizedOutputs {
  const text = `${resource.title} ${resource.content}`;
  const capabilities = detectCapabilities(text);
  const useCases = detectUseCases(text);
  const isStructured = TEMPLATE_STRUCTURE_PATTERNS.some(p => p.test(resource.content));

  const templates: ActionizedTemplate[] = [];
  const prompts: ActionizedPrompt[] = [];
  const tactics = extractTacticsFromText(resource.content, resource.id, resource.title);

  if (isStructured) {
    templates.push({
      id: `at-${resource.id}`,
      title: resource.title,
      body: resource.content,
      use_cases: useCases,
      capabilities,
      source_resource_id: resource.id,
      confidence: 0.85,
      editable: true,
    });
  }

  // Generate a prompt module from the template's structure
  if (resource.content.length > 200) {
    prompts.push({
      id: `ap-${resource.id}`,
      title: `${resource.title} — Guidance`,
      prompt_text: `Use this structural approach:\n${resource.content.slice(0, 500)}`,
      use_cases: useCases,
      capabilities,
      source_resource_id: resource.id,
      confidence: 0.7,
      editable: true,
    });
  }

  return { templates, prompts, tactics };
}

// ── Actionize a promoted example ────────────────────────────

function actionizeExample(resource: {
  id: string; title: string; content: string;
  stage?: string; persona?: string; competitor?: string;
}): ActionizedOutputs {
  const text = `${resource.title} ${resource.content}`;
  const capabilities = detectCapabilities(text);
  const useCases = detectUseCases(text);
  const tactics = extractTacticsFromText(resource.content, resource.id, resource.title);

  // Examples become reference structures + tone/style guidance
  const prompts: ActionizedPrompt[] = [{
    id: `ap-ex-${resource.id}`,
    title: `Style: ${resource.title}`,
    prompt_text: `Match the tone, structure, and quality of this example:\n---\n${resource.content.slice(0, 800)}\n---\nKey qualities to replicate: professional structure, specific details, clear next steps.`,
    use_cases: useCases,
    capabilities,
    source_resource_id: resource.id,
    confidence: 0.75,
    editable: true,
  }];

  return { templates: [], prompts, tactics };
}

// ── Actionize promoted knowledge ────────────────────────────

function actionizeKnowledge(item: {
  id: string; title: string;
  tactic_summary?: string; when_to_use?: string; when_not_to_use?: string;
  chapter?: string; tags?: string[]; confidence_score?: number;
}): ActionizedOutputs {
  const text = `${item.title} ${item.tactic_summary || ''} ${item.when_to_use || ''}`;
  const capabilities = detectCapabilities(text);

  const tactics: ActionizedTactic[] = [];

  if (item.tactic_summary) {
    tactics.push({
      id: `at-ki-${item.id}`,
      statement: item.tactic_summary,
      when_to_use: item.when_to_use || '',
      source_resource_id: item.id,
      source_title: item.title,
      confidence: item.confidence_score || 0.6,
      capabilities,
      usage_count: 0,
    });
  }

  // Generate prompt injection from knowledge
  const prompts: ActionizedPrompt[] = [];
  if (item.tactic_summary || item.when_to_use) {
    prompts.push({
      id: `ap-ki-${item.id}`,
      title: `Tactic: ${item.title}`,
      prompt_text: [
        item.tactic_summary ? `Apply this tactic: ${item.tactic_summary}` : '',
        item.when_to_use ? `When to use: ${item.when_to_use}` : '',
        item.when_not_to_use ? `Avoid when: ${item.when_not_to_use}` : '',
      ].filter(Boolean).join('\n'),
      use_cases: item.chapter ? [item.chapter] : [],
      capabilities,
      source_resource_id: item.id,
      confidence: item.confidence_score || 0.6,
      editable: true,
    });
  }

  return { templates: [], prompts, tactics };
}

// ── Fetch and actionize all relevant assets for a context ───

export interface ActionizationContext {
  userId: string;
  stage: string;
  actionId: string;
  persona?: string;
  competitor?: string;
}

export async function fetchActionizedAssets(ctx: ActionizationContext): Promise<ActionizedOutputs> {
  const [tplRes, exRes, kiRes] = await Promise.all([
    supabase
      .from('execution_templates' as any)
      .select('id, title, body, output_type, stage, persona, competitor, tags, template_category, times_used')
      .eq('user_id', ctx.userId)
      .eq('status', 'active')
      .order('times_used', { ascending: false })
      .limit(15),
    supabase
      .from('execution_outputs')
      .select('id, title, content, output_type, stage, persona, competitor, times_reused')
      .eq('user_id', ctx.userId)
      .eq('is_strong_example', true)
      .order('times_reused', { ascending: false })
      .limit(10),
    supabase
      .from('knowledge_items')
      .select('id, title, tactic_summary, when_to_use, when_not_to_use, chapter, tags, confidence_score')
      .eq('user_id', ctx.userId)
      .eq('active', true)
      .order('confidence_score', { ascending: false })
      .limit(20),
  ]);

  const allTemplates: ActionizedTemplate[] = [];
  const allPrompts: ActionizedPrompt[] = [];
  const allTactics: ActionizedTactic[] = [];

  // Actionize templates
  for (const t of (tplRes.data || []) as any[]) {
    const out = actionizeTemplate({
      id: t.id, title: t.title, content: t.body,
      tags: t.tags, template_category: t.template_category,
    });
    allTemplates.push(...out.templates);
    allPrompts.push(...out.prompts);
    allTactics.push(...out.tactics);
  }

  // Actionize examples
  for (const e of (exRes.data || []) as any[]) {
    const out = actionizeExample({
      id: e.id, title: e.title, content: e.content,
      stage: e.stage, persona: e.persona, competitor: e.competitor,
    });
    allPrompts.push(...out.prompts);
    allTactics.push(...out.tactics);
  }

  // Actionize knowledge items
  for (const k of (kiRes.data || []) as any[]) {
    const out = actionizeKnowledge(k);
    allPrompts.push(...out.prompts);
    allTactics.push(...out.tactics);
  }

  // Score and rank by relevance to context
  const stageLC = ctx.stage.toLowerCase();
  const personaLC = ctx.persona?.toLowerCase() || '';
  const competitorLC = ctx.competitor?.toLowerCase() || '';

  function relevanceBoost(text: string): number {
    let boost = 0;
    const lower = text.toLowerCase();
    if (stageLC && lower.includes(stageLC)) boost += 2;
    if (personaLC && lower.includes(personaLC)) boost += 2;
    if (competitorLC && lower.includes(competitorLC)) boost += 3;
    return boost;
  }

  // Rank tactics
  const scoredTactics = allTactics.map(t => ({
    ...t,
    _score: t.confidence + relevanceBoost(`${t.statement} ${t.when_to_use}`) + (t.usage_count * 0.1),
  }));
  scoredTactics.sort((a, b) => b._score - a._score);

  // Rank prompts
  const scoredPrompts = allPrompts.map(p => ({
    ...p,
    _score: p.confidence + relevanceBoost(p.prompt_text),
  }));
  scoredPrompts.sort((a, b) => b._score - a._score);

  // Dedupe tactics by similar statement
  const seenTactics = new Set<string>();
  const dedupedTactics = scoredTactics.filter(t => {
    const key = t.statement.toLowerCase().slice(0, 40);
    if (seenTactics.has(key)) return false;
    seenTactics.add(key);
    return true;
  });

  return {
    templates: allTemplates.slice(0, 5),
    prompts: scoredPrompts.slice(0, 5),
    tactics: dedupedTactics.slice(0, 8),
  };
}

// ── Build tactic injection string for generation ────────────

export function buildTacticInjection(tactics: ActionizedTactic[]): string {
  if (tactics.length === 0) return '';
  const lines = tactics.map((t, i) =>
    `${i + 1}. ${t.statement}${t.when_to_use ? ` (When: ${t.when_to_use})` : ''}`
  );
  return `\n--- TACTICS TO APPLY ---\nApply these proven tactics in your output:\n${lines.join('\n')}\n--- END TACTICS ---`;
}

// ── Build prompt module injection ───────────────────────────

export function buildPromptInjection(prompts: ActionizedPrompt[]): string {
  if (prompts.length === 0) return '';
  const parts = prompts.map(p => p.prompt_text).join('\n\n');
  return `\n--- STYLE & APPROACH GUIDANCE ---\n${parts}\n--- END GUIDANCE ---`;
}

// ── Feedback tracking ───────────────────────────────────────

export interface ActionizationFeedback {
  outputId: string;
  tacticsUsed: string[];
  promptsUsed: string[];
  templatesUsed: string[];
  action: 'used' | 'edited' | 'saved_as_template' | 'saved_as_example';
}

export async function trackActionizationFeedback(
  userId: string,
  feedback: ActionizationFeedback
): Promise<void> {
  // Record usage to improve ranking over time
  // Increment times_used on templates that were used
  if (feedback.templatesUsed.length > 0) {
    for (const tplId of feedback.templatesUsed) {
      const cleanId = tplId.replace(/^at-/, '');
      await supabase
        .from('execution_templates' as any)
        .update({ last_used_at: new Date().toISOString() } as any)
        .eq('id', cleanId)
        .eq('user_id', userId);
    }
  }

  // Track in ai_feedback for analytics
  await supabase.from('ai_feedback').insert({
    user_id: userId,
    feature: 'actionization_engine',
    rating: feedback.action === 'saved_as_template' ? 5 : feedback.action === 'saved_as_example' ? 4 : 3,
    ai_suggestion_summary: JSON.stringify({
      tactics_count: feedback.tacticsUsed.length,
      prompts_count: feedback.promptsUsed.length,
      templates_count: feedback.templatesUsed.length,
      action: feedback.action,
    }),
  });
}
