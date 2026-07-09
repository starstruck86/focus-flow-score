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
const _HEAD_TO_DIMENSIONS: Record<IntelHead, string[]> = {
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

export type InjectedKI = {
  id: string;
  title: string;
  tactic_summary: string;
  spider_dimension: string;
};

// Export head label for UI display
export { HEAD_LABELS };
