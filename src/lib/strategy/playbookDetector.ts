/**
 * Detects which playbooks are relevant based on thread text content.
 * Patterns derived from actual playbook `when_to_use` fields and `problem_type`.
 */
import { supabase } from '@/integrations/supabase/client';

export interface DetectedPlaybook {
  id: string;
  title: string;
  problem_type: string;
}

// Trigger patterns matched against accumulated thread text
const PLAYBOOK_TRIGGERS = [
  {
    pattern: /\b(adjust\b|appsflyer|apps flyer)/i,
    problem_type: 'competitive',
    title_hint: 'Adjust',
  },
  {
    pattern: /\b(appsflyer|apps flyer)/i,
    problem_type: 'competitive',
    title_hint: 'AppsFlyer',
  },
  {
    pattern: /\b(build (it )?internal|build themselves|engineering can|in.?house build|we can build|build in.?house)/i,
    problem_type: 'objection',
    title_hint: 'Engineering',
  },
  {
    pattern: /\b(usage (down|drop|declin|lower)|metric(s)? (drop|declin|down|lower)|qbr.*down|performance.*declin)/i,
    problem_type: 'usage',
    title_hint: 'QBR',
  },
  {
    pattern: /\b(champion.*quiet|gone dark|not respond|ghost(ing)?|haven'?t heard|silent|no reply|10 days)/i,
    problem_type: 'champion',
    title_hint: 'Champion',
  },
  {
    pattern: /\b(discount|30%|20%|price (reduc|cut|lower)|too expensive|negotiate (on )?price|cost too much)/i,
    problem_type: 'negotiation',
    title_hint: 'Discount',
  },
  {
    pattern: /\b(consolidat|single vendor|vendor rational|reduce vendor|cut vendor|parent.*vendor|corporate.*vendor)/i,
    problem_type: 'executive',
    title_hint: 'Consolidation',
  },
];

/**
 * Returns detected playbook triggers based on text content.
 * Avoids duplicates by problem_type.
 */
export function detectPlaybookTriggers(text: string): Array<{ problem_type: string; title_hint: string }> {
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  const results: Array<{ problem_type: string; title_hint: string }> = [];

  for (const trigger of PLAYBOOK_TRIGGERS) {
    if (trigger.pattern.test(lower) && !seen.has(trigger.problem_type)) {
      seen.add(trigger.problem_type);
      results.push({ problem_type: trigger.problem_type, title_hint: trigger.title_hint });
    }
  }

  return results;
}

/**
 * Fetches matching playbooks from DB for the detected trigger types.
 */
export async function fetchDetectedPlaybooks(
  triggers: Array<{ problem_type: string; title_hint: string }>,
  userId: string,
): Promise<DetectedPlaybook[]> {
  if (triggers.length === 0 || !userId) return [];

  const problemTypes = [...new Set(triggers.map((t) => t.problem_type))];

  const { data } = await (supabase as any)
    .from('playbooks')
    .select('id, title, problem_type')
    .eq('user_id', userId)
    .in('problem_type', problemTypes);

  return (data ?? []) as DetectedPlaybook[];
}

/**
 * Fetches a playbook's full content for injection into globalInstructions.
 */
export async function fetchPlaybookForInjection(playbookId: string): Promise<string> {
  const { data } = await (supabase as any)
    .from('playbooks')
    .select('title, problem_type, when_to_use, talk_tracks, tactic_steps, key_questions, traps, anti_patterns, success_criteria')
    .eq('id', playbookId)
    .single();

  if (!data) return '';

  const parts: string[] = [
    `## Loaded Playbook: ${data.title}`,
    `When to use: ${data.when_to_use ?? ''}`,
  ];

  if (data.talk_tracks?.length) {
    parts.push(`Talk tracks:\n${(data.talk_tracks as string[]).map((t: string) => `- ${t}`).join('\n')}`);
  }
  if (data.tactic_steps?.length) {
    parts.push(`Tactic steps:\n${(data.tactic_steps as string[]).map((s: string) => `- ${s}`).join('\n')}`);
  }
  if (data.key_questions?.length) {
    parts.push(`Key questions:\n${(data.key_questions as string[]).map((q: string) => `- ${q}`).join('\n')}`);
  }
  if (data.traps?.length) {
    parts.push(`Traps:\n${(data.traps as string[]).map((t: string) => `- ${t}`).join('\n')}`);
  }
  if (data.success_criteria) {
    parts.push(`Success criteria: ${data.success_criteria}`);
  }

  return parts.join('\n\n');
}
