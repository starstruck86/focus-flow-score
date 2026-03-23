/**
 * Dave tools for Knowledge Intelligence Engine.
 *
 * Hybrid model: prefer persisted intelligence_units & knowledge_signals,
 * fall back to query-time computation from resource_digests.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ToolContext } from '../../toolTypes';
import {
  type NormalisedContent,
  type ExtractedInsight,
  type TrendSignal,
  type IdeaMaturity,
  type DecisionContext,
  bestAvailableDate,
  computeTrustScore,
  classifyMaturity,
  detectTrends,
  rankInsights,
  formatCitation,
  decideTopInsights,
  formatDecision,
  MATURITY_LABELS,
} from '@/lib/knowledgeIntelligence';
import {
  getIntelligenceUnits,
  getKnowledgeSignals,
  rowToExtractedInsight,
  rowToTrendSignal,
} from '@/data/intelligence';

// ── Helpers ─────────────────────────────────────────────────────

function normaliseResource(r: any): NormalisedContent {
  return {
    id: r.id,
    title: r.title || 'Untitled',
    type: r.resource_type || 'document',
    uploaded_at: r.created_at,
    source_created_at: r.source_created_at || null,
    source_published_at: r.source_published_at || null,
    date_confidence: r.source_published_at ? 'exact' : r.source_created_at ? 'inferred' : 'unknown',
    date_source: r.source_published_at ? 'metadata' : null,
    author_or_speaker: r.author_or_speaker || null,
    tags: r.tags || [],
    extraction_status: r.content_status === 'enriched' ? 'complete' : 'pending',
    trust_status: 'unscored',
  };
}

function insightsFromDigest(digest: any, resource: NormalisedContent): ExtractedInsight[] {
  const takeaways: string[] = digest.takeaways || [];
  return takeaways.map((text: string, i: number) => ({
    id: `${digest.resource_id}-t${i}`,
    text,
    category: (digest.use_cases?.[0] || 'general').toLowerCase(),
    provenance: {
      source_content_id: digest.resource_id,
      source_chunk_id: null,
      extracted_at: digest.created_at || new Date().toISOString(),
      extraction_version: '1.0',
      extraction_confidence: 0.8,
    },
    support_count: 1,
    source_diversity: 1,
    consistency_score: 0.7,
    idea_maturity: 'experimental' as IdeaMaturity,
    conflicts: [],
  }));
}

function crossReferenceInsights(allInsights: ExtractedInsight[]): ExtractedInsight[] {
  const seen = new Map<string, ExtractedInsight[]>();
  for (const ins of allInsights) {
    const key = ins.text.toLowerCase().trim().slice(0, 80);
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(ins);
  }
  const merged: ExtractedInsight[] = [];
  for (const [, group] of seen) {
    const primary = { ...group[0] };
    if (group.length > 1) {
      const uniqueSources = new Set(group.map(g => g.provenance.source_content_id));
      primary.support_count = group.length;
      primary.source_diversity = uniqueSources.size;
      primary.consistency_score = Math.min(1, 0.5 + group.length * 0.1);
    }
    merged.push(primary);
  }
  return merged;
}

// ── Hybrid fetch: stored units first, fallback to digest computation ──

async function fetchInsightsHybrid(
  userId: string,
  topic: string,
): Promise<{ insights: ExtractedInsight[]; sourceMap: Map<string, any>; fromStore: boolean }> {
  const sourceMap = new Map<string, any>();

  // 1. Try persisted intelligence_units
  try {
    const stored = await getIntelligenceUnits({ limit: 50 });
    const relevant = stored.filter(u =>
      u.text.toLowerCase().includes(topic.toLowerCase()) ||
      (u.category || '').toLowerCase().includes(topic.toLowerCase()),
    );
    if (relevant.length) {
      // Fetch resource metadata for sources
      const resourceIds = [...new Set(relevant.map(r => r.resource_id))];
      const { data: resources } = await supabase
        .from('resources')
        .select('id, title, resource_type, created_at, source_created_at, source_published_at, author_or_speaker')
        .eq('user_id', userId)
        .in('id', resourceIds);

      for (const res of resources || []) {
        const norm = normaliseResource(res);
        sourceMap.set(res.id, { title: res.title, author: norm.author_or_speaker, date: bestAvailableDate(norm) });
      }

      return { insights: relevant.map(rowToExtractedInsight), sourceMap, fromStore: true };
    }
  } catch {
    // Table may not exist yet or be empty — fall through
  }

  // 2. Fallback: compute from resource_digests
  const q = `%${topic}%`;
  const { data: digests } = await supabase
    .from('resource_digests')
    .select('*, resources:resource_id(id, title, resource_type, created_at, tags, source_created_at, source_published_at, author_or_speaker)')
    .eq('user_id', userId)
    .or(`takeaways.cs.{${topic}},summary.ilike.${q}`)
    .limit(10);

  if (!digests?.length) return { insights: [], sourceMap, fromStore: false };

  let allInsights: ExtractedInsight[] = [];
  for (const d of digests) {
    const res = (d as any).resources;
    if (!res) continue;
    const norm = normaliseResource(res);
    sourceMap.set(res.id, { title: res.title, author: norm.author_or_speaker, date: bestAvailableDate(norm) });
    const insights = insightsFromDigest(d, norm);
    const relevant = insights.filter(i => i.text.toLowerCase().includes(topic.toLowerCase()));
    allInsights.push(...(relevant.length ? relevant : insights.slice(0, 2)));
  }

  allInsights = crossReferenceInsights(allInsights);

  // Classify maturity
  for (const ins of allInsights) {
    const dates = [...sourceMap.values()].map(s => s.date).filter(Boolean);
    const years = dates.length >= 2
      ? (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      : 0;
    const recentRatio = dates.filter((d: string) => (Date.now() - new Date(d).getTime()) < 365.25 * 24 * 60 * 60 * 1000).length / Math.max(1, dates.length);
    ins.idea_maturity = classifyMaturity(ins.support_count, ins.consistency_score, years, recentRatio, 'unknown');
  }

  return { insights: allInsights, sourceMap, fromStore: false };
}

// ── Tool: cite_insight ──────────────────────────────────────────

export async function citeInsight(ctx: ToolContext, params: { topic: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const { insights, sourceMap } = await fetchInsightsHybrid(userId, params.topic);

  if (!insights.length) {
    const q = `%${params.topic}%`;
    const { data: resources } = await supabase
      .from('resources')
      .select('id')
      .eq('user_id', userId)
      .ilike('title', q)
      .limit(1);
    if (resources?.length) return `Found resources matching "${params.topic}" but no extracted insights yet. Run the operationalise flow first.`;
    return `No knowledge found matching "${params.topic}".`;
  }

  const ranked = rankInsights(insights, true).slice(0, 3);
  const parts: string[] = [`**Knowledge Intelligence: "${params.topic}"**\n`];

  for (const ins of ranked) {
    const trust = computeTrustScore(ins, sourceMap.get(ins.provenance.source_content_id)?.date || null);
    const sources = [sourceMap.get(ins.provenance.source_content_id)].filter(Boolean);
    parts.push(formatCitation({ insightText: ins.text, maturity: ins.idea_maturity, trustScore: trust, sources, conflicts: ins.conflicts }));
    parts.push('');
  }

  return parts.join('\n');
}

// ── Tool: knowledge_trends (hybrid) ─────────────────────────────

export async function knowledgeTrends(ctx: ToolContext, params: { category?: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  let signals: TrendSignal[] = [];

  // 1. Try persisted signals
  try {
    const stored = await getKnowledgeSignals({ theme: params.category, limit: 200 });
    if (stored.length) {
      signals = stored.map(rowToTrendSignal);
    }
  } catch { /* fall through */ }

  // 2. Fallback: compute from digests
  if (!signals.length) {
    const { data: digests } = await supabase
      .from('resource_digests')
      .select('*, resources:resource_id(id, title, resource_type, created_at, tags, source_created_at, source_published_at, author_or_speaker)')
      .eq('user_id', userId)
      .limit(50);

    if (!digests?.length) return 'No analysed resources to detect trends from.';

    for (const d of digests) {
      const res = (d as any).resources;
      if (!res) continue;
      const norm = normaliseResource(res);
      const date = bestAvailableDate(norm);
      for (const uc of (d.use_cases || [])) {
        if (params.category && !uc.toLowerCase().includes(params.category.toLowerCase())) continue;
        signals.push({ theme: uc, source_content_id: res.id, author_or_speaker: norm.author_or_speaker, timestamp: date, confidence: 0.7, relevance: 0.8 });
      }
    }
  }

  const trends = detectTrends(signals);
  if (!trends.length) return params.category
    ? `No trends detected for category "${params.category}".`
    : 'No trends detected across your knowledge base yet. Add more resources to build signal density.';

  const lines = ['**Detected Knowledge Trends:**\n'];
  for (const t of trends.slice(0, 5)) {
    const icon = t.strength === 'strong' ? '🔥' : t.strength === 'moderate' ? '📊' : '🌱';
    lines.push(`${icon} **${t.theme}** — ${t.strength} trend (${t.source_count} sources, ${t.unique_authors} authors)`);
    lines.push(`   Window: ${t.earliest.split('T')[0]} → ${t.latest.split('T')[0]}`);
  }

  return lines.join('\n');
}

// ── Tool: insight_reliability (hybrid) ──────────────────────────

export async function insightReliability(ctx: ToolContext, params: { claim: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  let supportCount = 0;
  let uniqueResources = 0;
  let consistency = 0.3;
  let bestDate: string | null = null;

  // 1. Try persisted units
  try {
    const stored = await getIntelligenceUnits({ limit: 100 });
    const matching = stored.filter(u => u.text.toLowerCase().includes(params.claim.toLowerCase()));
    if (matching.length) {
      supportCount = matching.reduce((s, m) => s + m.support_count, 0);
      uniqueResources = new Set(matching.map(m => m.resource_id)).size;
      consistency = matching.reduce((s, m) => s + m.consistency_score, 0) / matching.length;
      bestDate = matching[0]?.extracted_at || null;
    }
  } catch { /* fall through */ }

  // 2. Fallback if no stored matches
  if (supportCount === 0) {
    const q = `%${params.claim}%`;
    const { data: digests } = await supabase
      .from('resource_digests')
      .select('takeaways, summary, use_cases, resource_id, created_at')
      .eq('user_id', userId)
      .or(`summary.ilike.${q}`)
      .limit(20);

    const matching = (digests || []).filter(d => {
      const all = [...(d.takeaways || []), d.summary || ''].join(' ').toLowerCase();
      return all.includes(params.claim.toLowerCase());
    });

    supportCount = matching.length;
    uniqueResources = new Set(matching.map(m => m.resource_id)).size;
    consistency = supportCount >= 3 ? 0.8 : supportCount >= 2 ? 0.6 : 0.3;
    bestDate = matching[0]?.created_at || null;
  }

  const maturity = classifyMaturity(supportCount, consistency, 0, 0, 'unknown');
  const trust = computeTrustScore(
    { support_count: supportCount, source_diversity: uniqueResources, consistency_score: consistency, idea_maturity: maturity },
    bestDate,
  );

  const MATURITY_LABELS: Record<IdeaMaturity, string> = {
    principle: '🏛️ Established Principle',
    pattern: '🔄 Recognised Pattern',
    trend: '📈 Emerging Trend',
    experimental: '🧪 Experimental / Weak Signal',
  };

  const lines = [
    `**Reliability assessment for:** "${params.claim}"`,
    '',
    `**Classification:** ${MATURITY_LABELS[maturity]}`,
    `**Trust Score:** ${trust.overall}/100`,
    `**Supporting sources:** ${supportCount} (${uniqueResources} unique resources)`,
    `**Agreement level:** ${Math.round(consistency * 100)}%`,
    '',
  ];

  if (maturity === 'experimental') {
    lines.push('⚠️ This appears to be an isolated or weakly-supported claim. Use with caution and seek additional validation.');
  } else if (maturity === 'trend') {
    lines.push('📈 This is an emerging idea with growing support. Consider it directional but not yet proven.');
  } else if (maturity === 'pattern') {
    lines.push('🔄 Multiple sources support this with reasonable consistency. Reliable for tactical decisions.');
  } else {
    lines.push('🏛️ This is well-established across multiple sources over time. High confidence for strategic use.');
  }

  return lines.join('\n');
}
