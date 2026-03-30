/**
 * Dave tool: active playbook knowledge retrieval
 *
 * Retrieves active knowledge items from the knowledge_items table
 * so Dave can reference real user-built knowledge during conversations.
 */

import type { ToolContext } from '../../toolTypes';
import { queryKnowledge, getDaveKnowledgeContext } from '@/lib/knowledgeRetrieval';

export async function getActivePlaybookKnowledge(
  ctx: ToolContext,
  params: { chapter?: string; competitor?: string; knowledgeType?: string },
) {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated.';

  const context = await getDaveKnowledgeContext({
    chapters: params.chapter ? [params.chapter] : undefined,
    competitor: params.competitor,
    maxItems: 15,
  });

  if (!context) {
    return 'No active knowledge items found. The user hasn\'t activated any knowledge items in their playbook yet. Suggest they visit the Learn tab to extract and activate knowledge from their resources.';
  }

  return context;
}

export async function getPlaybookKnowledgeForRoleplay(
  ctx: ToolContext,
  params: { chapter: string; competitor?: string },
) {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated.';

  const items = await queryKnowledge({
    chapters: [params.chapter],
    competitor: params.competitor,
    context: 'roleplay',
    activeOnly: true,
    maxItems: 10,
  });

  if (items.length === 0) {
    return `No active knowledge for ${params.chapter.replace(/_/g, ' ')} roleplay. The user needs to activate knowledge items first.`;
  }

  let output = `## Active Knowledge for ${params.chapter.replace(/_/g, ' ')} Practice\n\n`;

  for (const item of items) {
    output += `### ${item.title}\n`;
    if (item.tactic_summary) output += `**Tactic:** ${item.tactic_summary}\n`;
    if (item.when_to_use) output += `**When to use:** ${item.when_to_use}\n`;
    if (item.when_not_to_use) output += `**Anti-pattern:** ${item.when_not_to_use}\n`;
    if (item.example_usage) output += `**Example:** ${item.example_usage}\n`;
    output += '\n';
  }

  return output;
}
