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

// ── 9. Decision Weighting ───────────────────────────────────────

/**
 * Rank insights for decision-making.
 * Principles/patterns first, trends contextually, experimental last.
 */
const MATURITY_WEIGHT: Record<IdeaMaturity, number> = {
  principle: 1.0,
  pattern: 0.75,
  trend: 0.5,
  experimental: 0.2,
};

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

const MATURITY_LABELS: Record<IdeaMaturity, string> = {
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
