/**
 * Knowledge Intelligence Engine
 *
 * Unified provenance tracking, trust scoring, trend detection,
 * and idea-maturity classification for extracted insights.
 */

// ── 1. Normalised Content Model ─────────────────────────────────

export interface NormalisedContent {
  id: string;
  title: string;
  type: string;                        // e.g. 'video', 'article', 'book', 'podcast'
  uploaded_at: string;                  // ISO — when the user added it
  source_created_at: string | null;     // ISO — when the author created/recorded it
  source_published_at: string | null;   // ISO — public release date
  date_confidence: 'exact' | 'inferred' | 'unknown';
  date_source: string | null;          // e.g. 'youtube_metadata', 'user_input', 'scrape'
  author_or_speaker: string | null;
  tags: string[];
  extraction_status: 'pending' | 'partial' | 'complete' | 'failed';
  trust_status: 'unscored' | 'scored' | 'validated';
}

// ── 2. Provenance ───────────────────────────────────────────────

export interface InsightProvenance {
  source_content_id: string;
  source_chunk_id: string | null;
  extracted_at: string;               // ISO
  extraction_version: string;         // semver-ish, e.g. '1.0'
  extraction_confidence: number;      // 0-1
}

// ── 3. Extracted Insight ────────────────────────────────────────

export type IdeaMaturity = 'principle' | 'pattern' | 'trend' | 'experimental';

export interface ExtractedInsight {
  id: string;
  text: string;
  category: string;                   // e.g. 'discovery', 'objection_handling', 'closing'
  provenance: InsightProvenance;

  // Trust metrics (aggregated across all supporting sources)
  support_count: number;              // how many sources back this up
  source_diversity: number;           // unique authors / content types
  consistency_score: number;          // 0-1 — agreement level across sources

  idea_maturity: IdeaMaturity;

  // Conflicting perspectives kept intact
  conflicts: ConflictingView[];
}

export interface ConflictingView {
  insight_text: string;
  source_content_id: string;
  author_or_speaker: string | null;
  confidence: number;
}

// ── 4. Trend Signal ─────────────────────────────────────────────

export interface TrendSignal {
  theme: string;
  source_content_id: string;
  author_or_speaker: string | null;
  timestamp: string;                  // best-available date
  confidence: number;                 // 0-1
  relevance: number;                  // 0-1
}

export interface DetectedTrend {
  theme: string;
  signals: TrendSignal[];
  source_count: number;
  unique_authors: number;
  earliest: string;
  latest: string;
  strength: 'weak' | 'moderate' | 'strong';
}

// ── 5. Classification Logic ─────────────────────────────────────

export function classifyMaturity(
  supportCount: number,
  consistency: number,
  sourceSpanYears: number,
  recentSourceRatio: number,      // fraction of sources < 1 year old
  frequencyTrend: 'increasing' | 'stable' | 'decreasing' | 'unknown',
): IdeaMaturity {
  // Principle: battle-tested, multi-year, high agreement
  if (supportCount >= 5 && consistency >= 0.8 && sourceSpanYears >= 2) {
    return 'principle';
  }
  // Pattern: moderate evidence with some variation
  if (supportCount >= 3 && consistency >= 0.5) {
    return 'pattern';
  }
  // Trend: recent, growing frequency
  if (recentSourceRatio >= 0.6 && frequencyTrend === 'increasing') {
    return 'trend';
  }
  // Everything else is experimental
  return 'experimental';
}

// ── 6. Trust Scoring ────────────────────────────────────────────

export interface TrustScore {
  overall: number;              // 0-100
  recency: number;              // 0-100
  breadth: number;              // 0-100 (source diversity)
  depth: number;                // 0-100 (support count)
  agreement: number;            // 0-100 (consistency)
  maturity: IdeaMaturity;
}

export function computeTrustScore(
  insight: Pick<ExtractedInsight, 'support_count' | 'source_diversity' | 'consistency_score' | 'idea_maturity'>,
  bestSourceDate: string | null,
): TrustScore {
  const depth = Math.min(100, insight.support_count * 20);            // 5 sources = 100
  const breadth = Math.min(100, insight.source_diversity * 25);       // 4 unique = 100
  const agreement = Math.round(insight.consistency_score * 100);

  // Recency: decay over 3 years
  let recency = 50; // default for unknown
  if (bestSourceDate) {
    const ageMs = Date.now() - new Date(bestSourceDate).getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
    recency = Math.max(0, Math.round(100 - (ageYears / 3) * 100));
  }

  // Weighted composite — principles/patterns get a boost
  const maturityBoost =
    insight.idea_maturity === 'principle' ? 15 :
    insight.idea_maturity === 'pattern' ? 8 :
    insight.idea_maturity === 'trend' ? 0 : -10;

  const raw = (depth * 0.25) + (breadth * 0.2) + (agreement * 0.3) + (recency * 0.25);
  const overall = Math.max(0, Math.min(100, Math.round(raw + maturityBoost)));

  return { overall, recency, breadth, depth, agreement, maturity: insight.idea_maturity };
}

// ── 7. Trend Detection ──────────────────────────────────────────

const TREND_WINDOW_DAYS = 365;    // signals must fall within this window
const MIN_SIGNALS_FOR_TREND = 3;
const MIN_SOURCES_FOR_TREND = 2;  // at least 2 different content pieces

export function detectTrends(signals: TrendSignal[]): DetectedTrend[] {
  // Group by theme
  const groups = new Map<string, TrendSignal[]>();
  for (const s of signals) {
    const key = s.theme.toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const cutoff = Date.now() - TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const trends: DetectedTrend[] = [];

  for (const [theme, sigs] of groups) {
    // Filter to window
    const inWindow = sigs.filter(s => new Date(s.timestamp).getTime() >= cutoff);
    if (inWindow.length < MIN_SIGNALS_FOR_TREND) continue;

    const uniqueSources = new Set(inWindow.map(s => s.source_content_id));
    if (uniqueSources.size < MIN_SOURCES_FOR_TREND) continue;

    const uniqueAuthors = new Set(inWindow.map(s => s.author_or_speaker).filter(Boolean));
    const dates = inWindow.map(s => new Date(s.timestamp).getTime());

    const strength: DetectedTrend['strength'] =
      uniqueSources.size >= 5 && uniqueAuthors.size >= 3 ? 'strong' :
      uniqueSources.size >= 3 ? 'moderate' : 'weak';

    trends.push({
      theme,
      signals: inWindow,
      source_count: uniqueSources.size,
      unique_authors: uniqueAuthors.size,
      earliest: new Date(Math.min(...dates)).toISOString(),
      latest: new Date(Math.max(...dates)).toISOString(),
      strength,
    });
  }

  return trends.sort((a, b) => b.source_count - a.source_count);
}

// ── 8. Recency Weight ───────────────────────────────────────────

/**
 * Uses source_published_at > source_created_at > uploaded_at.
 * Returns the best-available date string.
 */
export function bestAvailableDate(content: NormalisedContent): string {
  return content.source_published_at || content.source_created_at || content.uploaded_at;
}

// ── 9. Decision Weighting Engine ────────────────────────────────

/**
 * Context that shapes which insights matter most right now.
 */
export interface DecisionContext {
  accountType?: string;          // e.g. 'new_logo', 'existing', 'renewal'
  industry?: string;
  dealStage?: string;            // e.g. 'Discovery', 'Demo', 'Negotiation'
  executionState?: string;       // e.g. 'prospecting', 'discovery', 'closing'
  activeSignals?: string[];      // themes/trends currently active
  topic?: string;                // the query topic for relevance matching
}

const MATURITY_WEIGHT: Record<IdeaMaturity, number> = {
  principle: 1.0,
  pattern: 0.75,
  trend: 0.5,
  experimental: 0.2,
};

// Stage-to-category relevance boosts
const STAGE_RELEVANCE: Record<string, string[]> = {
  prospecting: ['outbound', 'prospecting', 'icp', 'cold call', 'cadence'],
  discovery: ['discovery', 'qualification', 'meddicc', 'pain', 'questions'],
  demo: ['demo', 'presentation', 'value prop', 'storytelling'],
  negotiation: ['negotiation', 'pricing', 'objection', 'closing', 'commercial'],
  closing: ['closing', 'negotiation', 'urgency', 'commitment'],
  renewal: ['renewal', 'expansion', 'retention', 'churn', 'customer success'],
};

export interface ScoredInsight {
  insight: ExtractedInsight;
  score: number;
  breakdown: {
    maturity: number;
    trust: number;
    recency: number;
    relevance: number;
  };
  reasoning: string;
}

/**
 * Score a single insight against a decision context.
 */
export function scoreInsight(
  insight: ExtractedInsight,
  bestDate: string | null,
  context: DecisionContext,
): ScoredInsight {
  // 1. Maturity weight (0–1)
  const maturityScore = MATURITY_WEIGHT[insight.idea_maturity];

  // 2. Trust composite (0–1)
  const trustScore = Math.min(1,
    (Math.min(1, insight.support_count / 5) * 0.4) +
    (Math.min(1, insight.source_diversity / 4) * 0.3) +
    (insight.consistency_score * 0.3),
  );

  // 3. Recency (0–1), decays over 3 years
  let recencyScore = 0.5;
  if (bestDate) {
    const ageYears = (Date.now() - new Date(bestDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    recencyScore = Math.max(0, 1 - (ageYears / 3));
  }

  // 4. Contextual relevance (0–1)
  let relevanceScore = 0.3; // baseline
  const insightText = `${insight.text} ${insight.category || ''}`.toLowerCase();

  // Topic match
  if (context.topic && insightText.includes(context.topic.toLowerCase())) {
    relevanceScore += 0.3;
  }

  // Stage/execution relevance
  const stageKey = (context.executionState || context.dealStage || '').toLowerCase();
  const relevantTerms = STAGE_RELEVANCE[stageKey] || [];
  if (relevantTerms.some(term => insightText.includes(term))) {
    relevanceScore += 0.25;
  }

  // Active signal alignment
  if (context.activeSignals?.length) {
    const signalMatch = context.activeSignals.some(s => insightText.includes(s.toLowerCase()));
    if (signalMatch) relevanceScore += 0.15;
  }

  relevanceScore = Math.min(1, relevanceScore);

  // Composite: weighted sum
  const score =
    (maturityScore * 0.25) +
    (trustScore * 0.25) +
    (recencyScore * 0.2) +
    (relevanceScore * 0.3);

  // Build reasoning
  const reasons: string[] = [];
  if (maturityScore >= 0.75) reasons.push(`established ${insight.idea_maturity}`);
  if (trustScore >= 0.6) reasons.push(`backed by ${insight.support_count} sources`);
  if (recencyScore >= 0.7) reasons.push('recent');
  if (relevanceScore >= 0.5) reasons.push(`relevant to ${stageKey || context.topic || 'context'}`);
  if (reasons.length === 0) reasons.push('general relevance');

  return {
    insight,
    score,
    breakdown: { maturity: maturityScore, trust: trustScore, recency: recencyScore, relevance: relevanceScore },
    reasoning: reasons.join(', '),
  };
}

/**
 * Rank all insights, return top N with reasoning + deprioritisation notes.
 */
export interface DecisionResult {
  primary: ScoredInsight;
  alternative: ScoredInsight | null;
  deprioritised: { text: string; reason: string }[];
  totalConsidered: number;
}

export function decideTopInsights(
  insights: ExtractedInsight[],
  sourceMap: Map<string, { date: string | null }>,
  context: DecisionContext,
): DecisionResult | null {
  if (!insights.length) return null;

  const scored = insights.map(ins =>
    scoreInsight(ins, sourceMap.get(ins.provenance.source_content_id)?.date ?? null, context),
  ).sort((a, b) => b.score - a.score);

  const primary = scored[0];
  const alternative = scored.length > 1 && scored[1].score >= primary.score * 0.65
    ? scored[1] : null;

  const deprioritised = scored.slice(alternative ? 2 : 1, 5).map(s => ({
    text: s.insight.text.slice(0, 80),
    reason: s.score < primary.score * 0.5
      ? 'significantly lower relevance'
      : s.insight.idea_maturity === 'experimental'
        ? 'experimental — insufficient evidence'
        : 'lower priority in current context',
  }));

  return { primary, alternative, deprioritised, totalConsidered: scored.length };
}

/**
 * Derive execution guidance from an insight's content and context.
 */
interface ExecutionGuidance {
  expected_outcome: string;
  execution_hints: string[];
  when_not_to_use: string;
}

function deriveGuidance(insight: ExtractedInsight, context: DecisionContext): ExecutionGuidance {
  const text = insight.text.toLowerCase();
  const stage = (context.executionState || context.dealStage || '').toLowerCase();

  // Expected outcome based on maturity + category
  const outcomeByMaturity: Record<IdeaMaturity, string> = {
    principle: 'High-probability improvement — proven across multiple contexts',
    pattern: 'Likely positive impact — consistent results in similar situations',
    trend: 'Directional advantage — early adopters seeing results',
    experimental: 'Uncertain — worth testing in low-stakes situations first',
  };
  const expected_outcome = outcomeByMaturity[insight.idea_maturity];

  // Execution hints: derive from the insight text + stage
  const hints: string[] = [];
  if (text.includes('question') || text.includes('ask') || text.includes('discovery')) {
    hints.push('Open with this in the first 5 minutes of your next call');
    hints.push('Pair with a follow-up that quantifies the impact');
  } else if (text.includes('objection') || text.includes('concern') || text.includes('pushback')) {
    hints.push('Acknowledge the concern before redirecting');
    hints.push('Use a customer proof point to reinforce your response');
  } else if (text.includes('close') || text.includes('commit') || text.includes('next step')) {
    hints.push('Propose a specific next step with a date');
    hints.push('Confirm mutual agreement before ending the conversation');
  } else if (text.includes('email') || text.includes('outreach') || text.includes('cadence')) {
    hints.push('Lead with relevance — reference a trigger event or pain point');
    hints.push('Keep to 3 sentences max; end with a clear ask');
  } else {
    hints.push('Apply on your next relevant interaction');
    hints.push('Track whether it changes the conversation dynamic');
  }
  if (stage === 'discovery') hints.push('Validate findings with a second stakeholder');
  if (stage === 'negotiation') hints.push('Anchor before conceding on any terms');

  // When not to use: derive from maturity + context
  let when_not: string;
  if (insight.idea_maturity === 'experimental') {
    when_not = 'Avoid on high-stakes deals — test on lower-risk accounts first';
  } else if (text.includes('cold') || text.includes('outbound')) {
    when_not = 'Skip with warm inbound leads who already have context';
  } else if (text.includes('executive') || text.includes('c-level')) {
    when_not = 'Less effective with individual contributors or technical evaluators';
  } else if (text.includes('discount') || text.includes('pricing')) {
    when_not = 'Avoid early in the sales cycle before value is established';
  } else if (stage === 'prospecting') {
    when_not = 'Less effective once a deal is already in late-stage negotiation';
  } else {
    when_not = 'Reconsider if the buyer has already committed to a different approach';
  }

  return { expected_outcome, execution_hints: hints.slice(0, 3), when_not_to_use: when_not };
}

/**
 * Format a decision result for Dave's output, including execution guidance.
 */
export function formatDecision(result: DecisionResult, context: DecisionContext): string {
  const lines: string[] = [];
  const p = result.primary;

  lines.push('🎯 **Recommended Action**');
  lines.push(`**${p.insight.text}**`);
  lines.push(`_Why:_ ${p.reasoning} (score ${Math.round(p.score * 100)}/100)`);
  lines.push(`_Classification:_ ${MATURITY_LABELS[p.insight.idea_maturity]} · Trust ${Math.round(p.breakdown.trust * 100)}% · Recency ${Math.round(p.breakdown.recency * 100)}%`);

  // Execution guidance for primary
  const guidance = deriveGuidance(p.insight, context);
  lines.push(`_Expected outcome:_ ${guidance.expected_outcome}`);
  lines.push('_How to apply:_');
  for (const h of guidance.execution_hints) lines.push(`  → ${h}`);
  lines.push(`_When not to use:_ ${guidance.when_not_to_use}`);

  if (result.alternative) {
    const a = result.alternative;
    const altGuidance = deriveGuidance(a.insight, context);
    lines.push('');
    lines.push('💡 **Alternative**');
    lines.push(`${a.insight.text}`);
    lines.push(`_Why:_ ${a.reasoning} (score ${Math.round(a.score * 100)}/100)`);
    lines.push(`_Expected outcome:_ ${altGuidance.expected_outcome}`);
    lines.push(`_When not to use:_ ${altGuidance.when_not_to_use}`);
  }

  if (result.deprioritised.length) {
    lines.push('');
    lines.push(`_${result.deprioritised.length} other insight(s) deprioritised:_`);
    for (const d of result.deprioritised.slice(0, 3)) {
      lines.push(`  ↓ "${d.text}…" — ${d.reason}`);
    }
  }

  if (context.dealStage || context.executionState) {
    lines.push('');
    lines.push(`_Context: ${context.executionState || context.dealStage} · ${result.totalConsidered} insights evaluated_`);
  }

  return lines.join('\n');
}

// Keep backward-compatible rankInsights
export function rankInsights(insights: ExtractedInsight[], includeExperimental = false): ExtractedInsight[] {
  const filtered = includeExperimental
    ? insights
    : insights.filter(i => i.idea_maturity !== 'experimental');

  return [...filtered].sort((a, b) => {
    const wA = MATURITY_WEIGHT[a.idea_maturity] * a.consistency_score * Math.min(1, a.support_count / 5);
    const wB = MATURITY_WEIGHT[b.idea_maturity] * b.consistency_score * Math.min(1, b.support_count / 5);
    return wB - wA;
  });
}

// ── 10. Dave Citation Formatter ─────────────────────────────────

export interface CitationContext {
  insightText: string;
  maturity: IdeaMaturity;
  trustScore: TrustScore;
  sources: { title: string; author: string | null; date: string | null }[];
  conflicts: ConflictingView[];
}

export const MATURITY_LABELS: Record<IdeaMaturity, string> = {
  principle: '🏛️ Established Principle',
  pattern: '🔄 Recognised Pattern',
  trend: '📈 Emerging Trend',
  experimental: '🧪 Experimental Idea',
};

export function formatCitation(ctx: CitationContext): string {
  const lines: string[] = [];

  lines.push(`**${ctx.insightText}**`);
  lines.push('');
  lines.push(`**Classification:** ${MATURITY_LABELS[ctx.maturity]}`);
  lines.push(`**Trust Score:** ${ctx.trustScore.overall}/100 (depth ${ctx.trustScore.depth}, breadth ${ctx.trustScore.breadth}, agreement ${ctx.trustScore.agreement}, recency ${ctx.trustScore.recency})`);

  // Sources
  lines.push('');
  lines.push(`**Sources (${ctx.sources.length}):**`);
  for (const s of ctx.sources.slice(0, 5)) {
    const dateStr = s.date ? ` (${s.date.split('T')[0]})` : '';
    const authorStr = s.author ? ` — ${s.author}` : '';
    lines.push(`• "${s.title}"${authorStr}${dateStr}`);
  }
  if (ctx.sources.length > 5) lines.push(`  … and ${ctx.sources.length - 5} more`);

  // Conflicts
  if (ctx.conflicts.length) {
    lines.push('');
    lines.push('⚠️ **Conflicting perspectives exist:**');
    for (const c of ctx.conflicts.slice(0, 3)) {
      const who = c.author_or_speaker ? ` (${c.author_or_speaker})` : '';
      lines.push(`• "${c.insight_text}"${who}`);
    }
  }

  return lines.join('\n');
}
