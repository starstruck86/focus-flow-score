/**
 * S-I3 v2: Auto Context Injection by Intelligence Head
 * - Uses spider_dimension to query full 27K KI library (not just branch_io)
 * - Defaults to 'sales' head when no head matched (not null/empty)
 * - Quality gate: char_length > 80 chars client-side
 * - Respects user_id (was broken — _userId was unused)
 * - Injects up to 6 KIs + relevant playbook context
 */
import { supabase } from '@/integrations/supabase/client';

export type IntelHead = 'product' | 'competitive' | 'sales' | 'market';

// Maps each head to the spider_dimensions that carry relevant KIs
const HEAD_TO_DIMENSIONS: Record<IntelHead, string[]> = {
  product:     ['product_knowledge'],
  competitive: ['competitive'],
  sales:       ['discovery', 'deal_control', 'expansion_strategy',
                 'stakeholder_navigation', 'objection_handling', 'messaging',
                 'internal_prospecting'],
  market:      ['expansion_strategy', 'competitive'],
};

const HEAD_LABELS: Record<IntelHead, string> = {
  product: 'Branch Product',
  competitive: 'Competitive',
  sales: 'Sales',
  market: 'Market',
};

// Competitive signals — check first (highest priority)
const COMPETITIVE_RE = /\b(adjust|appsflyer|apps flyer|kochava|singular|mmp competitor|vs adjust|vs appsflyer|compared to|how do we compare|competitor|competitive|beat adjust|alternative to branch|firebase|branch vs)\b/i;

// Market/timing signals
const MARKET_RE = /\b(industry trend|market trend|why now|timing|macro|privacy|ios 17|skadnetwork|skan|att|app tracking|market landscape|mobile market|why is this important|why does this matter)\b/i;

// Product signals
const PRODUCT_RE = /\b(how does branch|deep link|universal link|sdk|tracking link|attribution how|deferred|email-?to-?app|sms-?to-?app|web-?to-?app|qr code|aio|advanced privacy|universal ads|branch product|branch feature|technical|what is branch|what does branch do|install tracking|fingerprinting|probabilistic|people-?based)\b/i;

// Sales signals — broad, catches most AE questions
const SALES_RE = /\b(discovery|champion|economic buyer|qbr|business review|expansion|renewal|objection|pushback|pricing|discount|consolidat|multi.?thread|stakeholder|budget|decision maker|close|deal|how do i|what should i|next step|how to handle|overcome|talk track|pitch|positioning|value prop|open|opener|call|meeting|prep|outreach|reach out|message|email|follow.?up|check.?in|reactivate|executive|c.suite|vp|cmo|cto|cfo|qualify|priority|tier|account|territory|pipeline|whitespace|product gap|cross.?sell|champion|blocker|commit|forecast|urgency|handle|approach|strategy|narrative|angle|hypothesis|expand)\b/i;

export function classifyIntelHead(text: string): IntelHead {
  if (!text || text.trim().length < 8) return 'sales'; // default, never null
  const lower = text.toLowerCase();
  if (COMPETITIVE_RE.test(lower)) return 'competitive';
  if (MARKET_RE.test(lower)) return 'market';
  if (PRODUCT_RE.test(lower)) return 'product';
  if (SALES_RE.test(lower)) return 'sales';
  return 'sales'; // always return something useful — never null
}

/**
 * Fetches top KIs from the full knowledge_items library (all chapters)
 * filtered by spider_dimension. Applies quality gate (>80 chars).
 * Returns a compact injection block for globalInstructions.
 */
export async function buildHeadKIBlock(head: IntelHead, userId: string): Promise<string> {
  if (!userId) return '';

  const dimensions = HEAD_TO_DIMENSIONS[head];

  try {
    const { data, error } = await (supabase as any)
      .from('knowledge_items')
      .select('title, tactic_summary, spider_dimension, chapter, intelligence_type')
      .eq('user_id', userId)          // FIXED: was _userId (unused)
      .eq('active', true)
      .in('spider_dimension', dimensions)
      .order('confidence_score', { ascending: false, nullsFirst: false })
      .limit(40); // fetch more, filter client-side

    if (error || !data || data.length === 0) return '';

    // Quality gate: skip fragment KIs (extraction artifacts)
    const quality = (data as any[]).filter(
      (ki) => ki.tactic_summary && ki.tactic_summary.length > 80
    );

    if (quality.length === 0) return '';

    // Take top 6 quality KIs
    const top = quality.slice(0, 6);

    const lines = top.map((ki: any) =>
      `- [${ki.spider_dimension}] ${ki.title}: ${(ki.tactic_summary as string).slice(0, 120)}`
    );

    return `\n\n### ${HEAD_LABELS[head]} Intelligence (${top.length} KIs from your 27K library)\n${lines.join('\n')}`;

  } catch {
    return '';
  }
}

// Export head label for UI display
export { HEAD_LABELS };
