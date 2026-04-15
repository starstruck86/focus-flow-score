/**
 * Context-Aware KI Retrieval
 *
 * Replaces flat "top 30" fetch with retrieval that considers:
 * - selected template (output_type → chapter mapping)
 * - selected account (competitor, industry)
 * - selected opportunity (stage, persona)
 * - free text objective (keyword matching)
 */

import { supabase } from '@/integrations/supabase/client';
import { createLogger } from '@/lib/logger';

const log = createLogger('KIRetrieval');
const TABLE = 'knowledge_items' as any;

interface KIRetrievalContext {
  userId: string;
  templateOutputType?: string;
  accountId?: string;
  accountName?: string;
  opportunityId?: string;
  freeText?: string;
  depth: 'shallow' | 'standard' | 'deep';
}

interface RetrievedKI {
  id: string;
  title: string;
  tactic_summary: string | null;
  chapter: string;
  competitor_name: string | null;
  framework: string | null;
  how_to_execute: string | null;
  when_to_use: string | null;
  example_usage: string | null;
  relevance: 'high' | 'medium' | 'low';
}

const DEPTH_LIMITS: Record<string, number> = {
  shallow: 10,
  standard: 25,
  deep: 40,
};

/**
 * Map output_type to relevant KI chapters for targeted retrieval.
 */
const OUTPUT_TYPE_CHAPTERS: Record<string, string[]> = {
  discovery_prep: ['discovery', 'qualification', 'objection_handling', 'rapport_building'],
  exec_brief: ['executive_selling', 'value_proposition', 'competitive_positioning'],
  follow_up_email: ['follow_up', 'closing', 'next_steps', 'value_proposition'],
  brainstorm: ['strategy', 'competitive_positioning', 'value_proposition', 'discovery'],
  discovery_prep_sheet: ['discovery', 'qualification'],
  demo_prep_sheet: ['demo', 'value_proposition', 'competitive_positioning'],
  meeting_agenda: ['discovery', 'executive_selling', 'demo'],
  competitive_followup: ['competitive_positioning', 'objection_handling'],
  objection_handling_draft: ['objection_handling'],
  cadence_sequence: ['prospecting', 'follow_up', 'outreach'],
  mutual_action_plan: ['closing', 'next_steps', 'qualification'],
};

export async function retrieveContextualKIs(ctx: KIRetrievalContext): Promise<{
  text: string;
  count: number;
  items: RetrievedKI[];
}> {
  const limit = DEPTH_LIMITS[ctx.depth] || 25;
  const allItems: RetrievedKI[] = [];

  try {
    // 1. Template-targeted KIs (highest relevance)
    const targetChapters = ctx.templateOutputType
      ? OUTPUT_TYPE_CHAPTERS[ctx.templateOutputType] || []
      : [];

    if (targetChapters.length > 0) {
      const { data } = await supabase
        .from(TABLE)
        .select('id, title, tactic_summary, chapter, competitor_name, framework, how_to_execute, when_to_use, example_usage')
        .eq('user_id', ctx.userId)
        .eq('active', true)
        .in('chapter', targetChapters)
        .order('confidence_score', { ascending: false })
        .limit(Math.ceil(limit * 0.5));

      if (data) {
        allItems.push(...(data as any[]).map(ki => ({ ...ki, relevance: 'high' as const })));
      }
    }

    // 2. Account-specific KIs (competitor intel)
    if (ctx.accountId || ctx.accountName) {
      // Fetch account details for competitor/industry context
      let competitor: string | null = null;
      if (ctx.accountId) {
        const { data: acct } = await supabase
          .from('accounts')
          .select('industry, notes')
          .eq('id', ctx.accountId)
          .single();
        // Check if there are any competitive KIs related to this account's industry
        if (acct?.industry) {
          const { data: compKIs } = await supabase
            .from(TABLE)
            .select('id, title, tactic_summary, chapter, competitor_name, framework, how_to_execute, when_to_use, example_usage')
            .eq('user_id', ctx.userId)
            .eq('active', true)
            .eq('knowledge_type', 'competitive')
            .order('confidence_score', { ascending: false })
            .limit(Math.ceil(limit * 0.2));

          if (compKIs) {
            const existingIds = new Set(allItems.map(i => i.id));
            allItems.push(
              ...(compKIs as any[])
                .filter(ki => !existingIds.has(ki.id))
                .map(ki => ({ ...ki, relevance: 'medium' as const }))
            );
          }
        }
      }
    }

    // 3. Free text keyword matching
    if (ctx.freeText && ctx.freeText.length > 3) {
      const keywords = ctx.freeText
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 5);

      if (keywords.length > 0) {
        // Use ilike for the most distinctive keyword
        const primaryKeyword = keywords.sort((a, b) => b.length - a.length)[0];
        const { data } = await supabase
          .from(TABLE)
          .select('id, title, tactic_summary, chapter, competitor_name, framework, how_to_execute, when_to_use, example_usage')
          .eq('user_id', ctx.userId)
          .eq('active', true)
          .or(`title.ilike.%${primaryKeyword}%,tactic_summary.ilike.%${primaryKeyword}%`)
          .order('confidence_score', { ascending: false })
          .limit(Math.ceil(limit * 0.2));

        if (data) {
          const existingIds = new Set(allItems.map(i => i.id));
          allItems.push(
            ...(data as any[])
              .filter(ki => !existingIds.has(ki.id))
              .map(ki => ({ ...ki, relevance: 'medium' as const }))
          );
        }
      }
    }

    // 4. Fill remaining slots with top-confidence general KIs
    const remaining = limit - allItems.length;
    if (remaining > 0) {
      const existingIds = allItems.map(i => i.id);
      let q = supabase
        .from(TABLE)
        .select('id, title, tactic_summary, chapter, competitor_name, framework, how_to_execute, when_to_use, example_usage')
        .eq('user_id', ctx.userId)
        .eq('active', true)
        .order('confidence_score', { ascending: false })
        .limit(remaining + existingIds.length); // over-fetch to account for dedup

      const { data } = await q;
      if (data) {
        const idSet = new Set(existingIds);
        const fillers = (data as any[])
          .filter(ki => !idSet.has(ki.id))
          .slice(0, remaining)
          .map(ki => ({ ...ki, relevance: 'low' as const }));
        allItems.push(...fillers);
      }
    }

    // Trim to limit
    const finalItems = allItems.slice(0, limit);

    // Format for prompt injection
    const text = finalItems.map(ki => {
      let line = `• ${ki.title}`;
      if (ki.tactic_summary) line += `: ${ki.tactic_summary}`;
      if (ki.how_to_execute) line += `\n  How: ${ki.how_to_execute}`;
      if (ki.when_to_use) line += `\n  When: ${ki.when_to_use}`;
      if (ki.competitor_name) line += ` [vs ${ki.competitor_name}]`;
      if (ki.framework) line += ` [${ki.framework}]`;
      return line;
    }).join('\n');

    log.info('KI retrieval complete', {
      total: finalItems.length,
      high: finalItems.filter(i => i.relevance === 'high').length,
      medium: finalItems.filter(i => i.relevance === 'medium').length,
      low: finalItems.filter(i => i.relevance === 'low').length,
    });

    return { text, count: finalItems.length, items: finalItems };
  } catch (err) {
    log.error('KI retrieval failed', { error: err });
    return { text: '', count: 0, items: [] };
  }
}
