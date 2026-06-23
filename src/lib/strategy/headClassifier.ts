/**
 * S-I3: Auto Context Injection by Head
 * Classifies a user's Strategy question into the most relevant intelligence head,
 * and fetches a compact KI block to inject as globalInstructions.
 * Returns null/empty when the question is too generic to confidently classify.
 */
import { supabase } from '@/integrations/supabase/client';

export type IntelHead = 'product' | 'competitive' | 'sales' | 'market';

const PRODUCT_RE = /\b(how does branch|how do(es)? (it|branch) work|deep link|universal link|deep linking|sdk|tracking link|link click|attribution how|deferred|email-?to-?app|sms-?to-?app|web-?to-?app|qr code|aio|advanced privacy|universal ads|branch product|branch feature|technical|what is branch|what does branch do|install tracking|fingerprinting|probabilistic|people-?based)\b/i;

const COMPETITIVE_RE = /\b(adjust|appsflyer|apps flyer|kochava|singular|mmp competitor|vs adjust|vs appsflyer|compared to adjust|compared to appsflyer|how do we compare|competitor|competitive|beat adjust|beat appsflyer|why not adjust|why not appsflyer|alternative to branch)\b/i;

const MARKET_RE = /\b(industry trend|market trend|why now|timing|macro|privacy regulation|ios 17|skadnetwork|skan|att|app tracking transparency|market landscape|mobile market|why is this important|why does this matter|what is happening in)\b/i;

const SALES_RE = /\b(discovery|champion|economic buyer|qbr|business review|expansion|renewal|objection|pushback|pricing|discount|consolidat|multi.?thread|stakeholder|budget|decision maker|close|deal|how do i|what should i|next step|how to handle|handle the|overcome|talk track|pitch|positioning|value prop)\b/i;

export function classifyIntelHead(text: string): IntelHead | null {
  if (!text || text.trim().length < 8) return null;
  const lower = text.toLowerCase();
  if (COMPETITIVE_RE.test(lower)) return 'competitive';
  if (MARKET_RE.test(lower)) return 'market';
  if (PRODUCT_RE.test(lower)) return 'product';
  if (SALES_RE.test(lower)) return 'sales';
  return null;
}

/**
 * Fetches top KIs for a given intelligence head from knowledge_items.
 * Returns a compact injection block string ready to append to globalInstructions.
 * Returns empty string on error or no results.
 */
export async function buildHeadKIBlock(head: IntelHead, _userId: string): Promise<string> {
  try {
    const { data } = await (supabase as any)
      .from('knowledge_items')
      .select('title, tactic_summary, spider_dimension')
      .eq('chapter', 'branch_io')
      .eq('active', true)
      .eq('intelligence_type', head)
      .order('confidence_score', { ascending: false, nullsFirst: false })
      .limit(4);

    if (!data || data.length === 0) return '';

    const lines = data.map((ki: any) =>
      `- [${ki.spider_dimension ?? head}] ${ki.title}: ${(ki.tactic_summary ?? '').slice(0, 120)}`
    );

    return `\n\n### Auto-Injected Knowledge Items (${head} intelligence head)\nThe following Branch KIs are most relevant to this question:\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}
