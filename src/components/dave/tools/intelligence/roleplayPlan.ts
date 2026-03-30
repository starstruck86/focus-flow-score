/**
 * Dave tool: explain_roleplay_plan
 *
 * Queries active knowledge_items and returns a structured roleplay plan
 * so Dave can explain what a practice session will cover before starting.
 */

import type { ToolContext } from '../../toolTypes';
import { queryKnowledge } from '@/lib/knowledgeRetrieval';

export interface RoleplayPlan {
  type: string;
  tactics: string[];
  focus_item?: string;
  test_areas: string[];
  anti_patterns: string[];
  context: {
    competitor?: string;
    product?: string;
  };
  grounding_count: number;
}

function buildPlan(
  chapter: string,
  items: Array<{
    id: string;
    title: string;
    tactic_summary: string | null;
    when_to_use: string | null;
    when_not_to_use: string | null;
    example_usage: string | null;
    competitor_name: string | null;
    product_area: string | null;
    knowledge_type: string;
  }>,
  focusItemId?: string,
): RoleplayPlan {
  const tactics = items
    .filter(i => i.tactic_summary)
    .map(i => i.tactic_summary!);

  const focusItem = focusItemId ? items.find(i => i.id === focusItemId) : undefined;

  // Test areas: what behaviours will be tested
  const testAreas: string[] = [];
  for (const item of items) {
    if (item.when_to_use) testAreas.push(`Can the rep recognise when to use: ${item.title}`);
  }
  if (focusItem) {
    testAreas.unshift(`Primary: execute "${focusItem.title}" under buyer pressure`);
  }
  if (items.some(i => i.knowledge_type === 'competitive')) {
    testAreas.push('Handle competitive displacement objections');
  }
  if (testAreas.length === 0) {
    testAreas.push('General execution quality for this chapter');
  }

  // Anti-patterns: what Dave will punish
  const antiPatterns = items
    .filter(i => i.when_not_to_use)
    .map(i => i.when_not_to_use!);
  if (antiPatterns.length === 0) {
    antiPatterns.push('Generic pitching without personalisation');
    antiPatterns.push('Talking past the buyer instead of listening');
  }

  const competitors = [...new Set(items.filter(i => i.competitor_name).map(i => i.competitor_name!))];
  const products = [...new Set(items.filter(i => i.product_area).map(i => i.product_area!))];

  return {
    type: chapter.replace(/_/g, ' '),
    tactics,
    focus_item: focusItem?.title,
    test_areas: testAreas.slice(0, 6),
    anti_patterns: antiPatterns.slice(0, 5),
    context: {
      competitor: competitors.length > 0 ? competitors.join(', ') : undefined,
      product: products.length > 0 ? products.join(', ') : undefined,
    },
    grounding_count: items.length,
  };
}

function formatPlanForDave(plan: RoleplayPlan): string {
  const lines: string[] = [];
  lines.push(`## 🎭 Roleplay Plan: ${plan.type.replace(/\b\w/g, c => c.toUpperCase())}`);
  lines.push('');
  lines.push(`**Grounded in ${plan.grounding_count} active knowledge items**`);
  if (plan.focus_item) {
    lines.push(`🎯 **Primary focus:** ${plan.focus_item}`);
  }
  lines.push('');

  if (plan.tactics.length > 0) {
    lines.push('### Tactics I\'ll test you on');
    for (const t of plan.tactics.slice(0, 6)) lines.push(`- ${t}`);
    lines.push('');
  }

  lines.push('### What I\'ll be evaluating');
  for (const t of plan.test_areas) lines.push(`- ${t}`);
  lines.push('');

  lines.push('### What I\'ll punish');
  for (const a of plan.anti_patterns) lines.push(`- ${a}`);
  lines.push('');

  if (plan.context.competitor) {
    lines.push(`⚔️ **Competitor context:** ${plan.context.competitor}`);
  }
  if (plan.context.product) {
    lines.push(`📦 **Product context:** ${plan.context.product}`);
  }

  lines.push('');
  lines.push('Say **"start"** when you\'re ready, or ask me to adjust the focus.');

  return lines.join('\n');
}

export async function explainRoleplayPlan(
  ctx: ToolContext,
  params: { chapter?: string; knowledgeItemId?: string; competitor?: string },
): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated.';

  const chapter = params.chapter || 'cold_calling';

  const items = await queryKnowledge({
    chapters: [chapter],
    competitor: params.competitor,
    context: 'roleplay',
    activeOnly: true,
    maxItems: 15,
  });

  if (items.length === 0) {
    return `No active knowledge items for ${chapter.replace(/_/g, ' ')}. Activate some knowledge items in the Learn tab first, then I can build a grounded roleplay.`;
  }

  const plan = buildPlan(chapter, items, params.knowledgeItemId);

  // Store plan for UI preview
  try {
    window.dispatchEvent(new CustomEvent('roleplay-plan-ready', { detail: plan }));
  } catch {}

  return formatPlanForDave(plan);
}

export { buildPlan, formatPlanForDave };
