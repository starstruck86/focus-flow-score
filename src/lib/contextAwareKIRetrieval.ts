/**
 * Context-Aware KI Retrieval with playbook-first orchestration and explainability.
 *
 * Strategy:
 * 1. Find best-fit strategic playbook (grouped KI chapters)
 * 2. Pull supporting tactical KIs
 * 3. Add framework items
 * 4. Return explainability metadata
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
  /** Name of the playbook/strategy group used, if any */
  playbookUsed?: string;
  /** Indicates layered retrieval: playbook → tactical → general */
  retrievalLayers: string[];
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

// Playbook definitions — organized strategic knowledge groups
const PLAYBOOK_DEFINITIONS: Record<string, {
  name: string;
  chapters: string[];
  description: string;
}> = {
  discovery_prep: {
    name: 'Discovery Playbook',
    chapters: ['discovery', 'qualification', 'objection_handling', 'rapport_building'],
    description: 'Structured discovery approach with qualification framework',
  },
  exec_brief: {
    name: 'Executive Engagement Playbook',
    chapters: ['executive_selling', 'value_proposition', 'competitive_positioning'],
    description: 'C-level positioning and value articulation',
  },
  follow_up_email: {
    name: 'Follow-Up & Closing Playbook',
    chapters: ['follow_up', 'closing', 'next_steps', 'value_proposition'],
    description: 'Post-meeting momentum and next-step management',
  },
  brainstorm: {
    name: 'Strategic Angles Playbook',
    chapters: ['strategy', 'competitive_positioning', 'value_proposition', 'discovery'],
    description: 'Creative strategy and competitive differentiation',
  },
  discovery_prep_sheet: {
    name: 'Discovery Playbook',
    chapters: ['discovery', 'qualification'],
    description: 'Focused discovery questioning framework',
  },
  demo_prep_sheet: {
    name: 'Demo Excellence Playbook',
    chapters: ['demo', 'value_proposition', 'competitive_positioning'],
    description: 'Demo preparation with value anchoring',
  },
  competitive_followup: {
    name: 'Competitive Intelligence Playbook',
    chapters: ['competitive_positioning', 'objection_handling'],
    description: 'Competitive displacement and objection handling',
  },
  objection_handling_draft: {
    name: 'Objection Handling Playbook',
    chapters: ['objection_handling'],
    description: 'Objection patterns and resolution tactics',
  },
  cadence_sequence: {
    name: 'Prospecting Playbook',
    chapters: ['prospecting', 'follow_up', 'outreach'],
    description: 'Multi-touch prospecting sequences',
  },
  mutual_action_plan: {
    name: 'Deal Closing Playbook',
    chapters: ['closing', 'next_steps', 'qualification'],
    description: 'Structured close plan with mutual commitments',
  },
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
  const retrievalLayers: string[] = [];

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

  // Resolve playbook
  const playbook = ctx.templateOutputType
    ? PLAYBOOK_DEFINITIONS[ctx.templateOutputType]
    : undefined;
  const playbookName = playbook?.name;

  try {
    // Layer 1: Playbook-matched KIs (highest relevance — organized strategic knowledge)
    if (playbook && playbook.chapters.length > 0) {
      const chapterLabels = playbook.chapters.map(c => CHAPTER_LABELS[c] || c).join(', ');
      reasoningParts.push(`Activated ${playbook.name}: ${chapterLabels}`);
      retrievalLayers.push(`Playbook: ${playbook.name}`);

      const { data } = await supabase
        .from(TABLE)
        .select('id, title, tactic_summary, chapter, competitor_name, framework, how_to_execute, when_to_use, example_usage')
        .eq('user_id', ctx.userId)
        .eq('active', true)
        .in('chapter', playbook.chapters)
        .order('confidence_score', { ascending: false })
        .limit(Math.ceil(limit * 0.5));

      if (data) {
        allItems.push(...(data as any[]).map(ki => ({ ...ki, relevance: 'high' as const })));
      }
    }

    // Layer 2: Account-specific competitive intelligence
    if (ctx.accountId || ctx.accountName) {
      retrievalLayers.push('Competitive intel');

      if (ctx.accountId) {
        const { data: acct } = await supabase
          .from('accounts')
          .select('industry')
          .eq('id', ctx.accountId)
          .single();
        if (acct?.industry) {
          reasoningParts.push(`Industry context: ${acct.industry}`);
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
          reasoningParts.push(`${newItems.length} competitive tactics`);
        }
        allItems.push(...newItems.map(ki => ({ ...ki, relevance: 'medium' as const })));
      }
    }

    // Layer 3: Free text keyword matching (tactical support)
    if (ctx.freeText && ctx.freeText.length > 3) {
      const keywords = ctx.freeText.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
      if (keywords.length > 0) {
        const primaryKeyword = keywords.sort((a, b) => b.length - a.length)[0];
        reasoningParts.push(`Keyword: "${primaryKeyword}"`);
        retrievalLayers.push('Keyword match');

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

    // Layer 4: Fill remaining with high-confidence general KIs
    const remaining = limit - allItems.length;
    if (remaining > 0) {
      retrievalLayers.push('Supporting tactics');
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
        if (fillers.length > 0) reasoningParts.push(`${fillers.length} supporting tactics`);
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

    // Format for prompt — organized by relevance tier
    const highItems = finalItems.filter(ki => ki.relevance === 'high');
    const medItems = finalItems.filter(ki => ki.relevance === 'medium');
    const lowItems = finalItems.filter(ki => ki.relevance === 'low');

    const formatKI = (ki: RetrievedKI) => {
      let line = `• ${ki.title}`;
      if (ki.tactic_summary) line += `: ${ki.tactic_summary}`;
      if (ki.how_to_execute) line += `\n  How: ${ki.how_to_execute}`;
      if (ki.when_to_use) line += `\n  When: ${ki.when_to_use}`;
      if (ki.competitor_name) line += ` [vs ${ki.competitor_name}]`;
      if (ki.framework) line += ` [${ki.framework}]`;
      return line;
    };

    let text = '';
    if (highItems.length > 0) {
      text += `[Strategic Playbook — ${playbookName || 'Core'}]\n`;
      text += highItems.map(formatKI).join('\n');
    }
    if (medItems.length > 0) {
      text += `\n\n[Supporting Tactics]\n`;
      text += medItems.map(formatKI).join('\n');
    }
    if (lowItems.length > 0) {
      text += `\n\n[Additional Context]\n`;
      text += lowItems.map(formatKI).join('\n');
    }

    log.info('KI retrieval complete', {
      total: finalItems.length, high, medium, low,
      playbook: playbookName,
      themes: topThemes,
    });

    return {
      text: text.trim(),
      count: finalItems.length,
      items: finalItems,
      explainability: {
        topThemes,
        topFrameworks,
        relevanceBreakdown: { high, medium, low },
        retrievalReasoning,
        totalAvailable,
        playbookUsed: playbookName,
        retrievalLayers,
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
        retrievalLayers: [],
      },
    };
  }
}
