/**
 * Context-Aware KI Retrieval with explainability metadata.
 *
 * Returns not just KI text but also:
 * - top matched themes/chapters
 * - relevance breakdown (high/medium/low counts)
 * - top frameworks referenced
 * - retrieval reasoning summary
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

export interface KIExplainability {
  topThemes: string[];
  topFrameworks: string[];
  relevanceBreakdown: { high: number; medium: number; low: number };
  retrievalReasoning: string;
  totalAvailable: number;
}

export interface KIRetrievalResult {
  text: string;
  count: number;
  items: RetrievedKI[];
  explainability: KIExplainability;
}

const DEPTH_LIMITS: Record<string, number> = {
  shallow: 10,
  standard: 25,
  deep: 40,
};

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

const CHAPTER_LABELS: Record<string, string> = {
  discovery: 'Discovery',
  qualification: 'Qualification',
  objection_handling: 'Objection Handling',
  rapport_building: 'Rapport Building',
  executive_selling: 'Executive Selling',
  value_proposition: 'Value Proposition',
  competitive_positioning: 'Competitive Intel',
  follow_up: 'Follow-Up',
  closing: 'Closing',
  next_steps: 'Next Steps',
  strategy: 'Strategy',
  prospecting: 'Prospecting',
  outreach: 'Outreach',
  demo: 'Demo',
};

export async function retrieveContextualKIs(ctx: KIRetrievalContext): Promise<KIRetrievalResult> {
  const limit = DEPTH_LIMITS[ctx.depth] || 25;
  const allItems: RetrievedKI[] = [];
  const reasoningParts: string[] = [];

  // Get total available count
  let totalAvailable = 0;
  try {
    const { count } = await supabase
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .eq('active', true);
    totalAvailable = count || 0;
  } catch {}

  try {
    // 1. Template-targeted KIs (highest relevance)
    const targetChapters = ctx.templateOutputType
      ? OUTPUT_TYPE_CHAPTERS[ctx.templateOutputType] || []
      : [];

    if (targetChapters.length > 0) {
      const chapterLabels = targetChapters.map(c => CHAPTER_LABELS[c] || c).join(', ');
      reasoningParts.push(`Matched ${chapterLabels} chapters to template`);

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
      let acctIndustry: string | null = null;
      if (ctx.accountId) {
        const { data: acct } = await supabase
          .from('accounts')
          .select('industry, notes')
          .eq('id', ctx.accountId)
          .single();
        acctIndustry = acct?.industry || null;
        if (acctIndustry) {
          reasoningParts.push(`Pulled competitive intel for ${acctIndustry} industry`);
        }
      }

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
        const newItems = (compKIs as any[]).filter(ki => !existingIds.has(ki.id));
        if (newItems.length > 0) {
          reasoningParts.push(`Added ${newItems.length} competitive KIs`);
        }
        allItems.push(...newItems.map(ki => ({ ...ki, relevance: 'medium' as const })));
      }
    }

    // 3. Free text keyword matching
    if (ctx.freeText && ctx.freeText.length > 3) {
      const keywords = ctx.freeText.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
      if (keywords.length > 0) {
        const primaryKeyword = keywords.sort((a, b) => b.length - a.length)[0];
        reasoningParts.push(`Keyword matched on "${primaryKeyword}"`);

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
            ...(data as any[]).filter(ki => !existingIds.has(ki.id)).map(ki => ({ ...ki, relevance: 'medium' as const }))
          );
        }
      }
    }

    // 4. Fill remaining slots
    const remaining = limit - allItems.length;
    if (remaining > 0) {
      const existingIds = allItems.map(i => i.id);
      const { data } = await supabase
        .from(TABLE)
        .select('id, title, tactic_summary, chapter, competitor_name, framework, how_to_execute, when_to_use, example_usage')
        .eq('user_id', ctx.userId)
        .eq('active', true)
        .order('confidence_score', { ascending: false })
        .limit(remaining + existingIds.length);

      if (data) {
        const idSet = new Set(existingIds);
        const fillers = (data as any[]).filter(ki => !idSet.has(ki.id)).slice(0, remaining);
        if (fillers.length > 0) reasoningParts.push(`Filled ${fillers.length} high-confidence general KIs`);
        allItems.push(...fillers.map(ki => ({ ...ki, relevance: 'low' as const })));
      }
    }

    const finalItems = allItems.slice(0, limit);

    // Build explainability
    const chapterCounts = new Map<string, number>();
    const frameworkSet = new Set<string>();
    let high = 0, medium = 0, low = 0;

    for (const ki of finalItems) {
      if (ki.chapter) chapterCounts.set(ki.chapter, (chapterCounts.get(ki.chapter) || 0) + 1);
      if (ki.framework) frameworkSet.add(ki.framework);
      if (ki.relevance === 'high') high++;
      else if (ki.relevance === 'medium') medium++;
      else low++;
    }

    const topThemes = [...chapterCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([ch]) => CHAPTER_LABELS[ch] || ch);

    const topFrameworks = [...frameworkSet].slice(0, 4);
    const retrievalReasoning = reasoningParts.join(' → ') || 'General high-confidence selection';

    // Format for prompt
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
      total: finalItems.length, high, medium, low,
      themes: topThemes,
    });

    return {
      text,
      count: finalItems.length,
      items: finalItems,
      explainability: {
        topThemes,
        topFrameworks,
        relevanceBreakdown: { high, medium, low },
        retrievalReasoning,
        totalAvailable,
      },
    };
  } catch (err) {
    log.error('KI retrieval failed', { error: err });
    return {
      text: '', count: 0, items: [],
      explainability: {
        topThemes: [], topFrameworks: [],
        relevanceBreakdown: { high: 0, medium: 0, low: 0 },
        retrievalReasoning: 'Retrieval failed',
        totalAvailable,
      },
    };
  }
}
