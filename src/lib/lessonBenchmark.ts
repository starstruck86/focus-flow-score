/**
 * Lesson Extraction Benchmark Harness
 *
 * Evaluation-only tool: runs extraction across multiple lessons,
 * captures pipeline metrics, classifies lesson archetypes,
 * and produces an aggregated benchmark report.
 *
 * Does NOT modify extraction logic — read-only evaluation.
 */

import { supabase } from '@/integrations/supabase/client';

// ── Lesson Archetypes ──────────────────────────────────────

export type LessonArchetype =
  | 'structured_framework'
  | 'tactical_walkthrough'
  | 'conversational_transcript'
  | 'interview_qa'
  | 'narrative_story'
  | 'mindset_principles';

const ARCHETYPE_LABELS: Record<LessonArchetype, string> = {
  structured_framework: 'Structured Framework',
  tactical_walkthrough: 'Tactical Walkthrough',
  conversational_transcript: 'Conversational Transcript',
  interview_qa: 'Interview / Q&A',
  narrative_story: 'Narrative / Story',
  mindset_principles: 'Mindset / Principles',
};

// ── Archetype classification heuristic ─────────────────────

function classifyArchetype(content: string, title: string): LessonArchetype {
  const lower = content.toLowerCase();
  const titleLower = title.toLowerCase();

  // Count structural signals
  const headerCount = (content.match(/^#{1,3}\s/gm) || []).length;
  const bulletCount = (content.match(/^[\s]*[-*•]\s/gm) || []).length;
  const numberedCount = (content.match(/^\s*\d+[.)]\s/gm) || []).length;
  const totalStructure = headerCount + bulletCount + numberedCount;

  // Speaker turn signals (conversational / interview)
  const speakerTurns = (content.match(/^[A-Z][a-z]+\s*:/gm) || []).length;
  const qaMarkers = (lower.match(/\b(question|answer|q:|a:|interviewer|interviewee|host|guest)\b/g) || []).length;

  // Framework signals
  const frameworkMarkers = (lower.match(/\b(framework|model|matrix|quadrant|tier|scoring|criteria|formula|equation|scale|spectrum|continuum|pyramid|funnel|methodology|system|process|step\s+\d|phase\s+\d|stage\s+\d|pillar|principle\s+\d|rule\s+\d|law\s+\d)\b/g) || []).length;

  // Mindset / principles signals
  const mindsetMarkers = (lower.match(/\b(mindset|belief|attitude|perspective|philosophy|mental model|paradigm|worldview|growth|abundance|scarcity|resilience|grit|discipline|habit|routine|ritual|intention|purpose|vision|values|character|integrity|authenticity)\b/g) || []).length;

  // Narrative signals
  const storyMarkers = (lower.match(/\b(story|once upon|years ago|i remember|let me tell you|back when|experience taught|lesson learned|true story|real example|case study|anecdote)\b/g) || []).length;

  // Tactical signals
  const tacticalMarkers = (lower.match(/\b(step by step|how to|walkthrough|tutorial|playbook|template|script|checklist|do this|try this|here's how|action item|implementation|execute|deploy|apply this)\b/g) || []).length;

  // Score each archetype
  const scores: Record<LessonArchetype, number> = {
    structured_framework: frameworkMarkers * 3 + headerCount * 0.5 + numberedCount * 0.3,
    tactical_walkthrough: tacticalMarkers * 3 + bulletCount * 0.3 + numberedCount * 0.5,
    conversational_transcript: speakerTurns * 2 + (speakerTurns > 5 ? 10 : 0),
    interview_qa: qaMarkers * 3 + speakerTurns * 1.5,
    narrative_story: storyMarkers * 3 + (totalStructure < 5 ? 3 : 0),
    mindset_principles: mindsetMarkers * 3 + (titleLower.match(/mindset|principle|belief|habit/) ? 5 : 0),
  };

  // Pick highest
  let best: LessonArchetype = 'structured_framework';
  let bestScore = -1;
  for (const [key, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = key as LessonArchetype;
    }
  }

  // Default for ambiguous content with structure
  if (bestScore < 3 && totalStructure > 10) return 'structured_framework';
  if (bestScore < 3) return 'tactical_walkthrough';

  return best;
}

// ── Per-Lesson Metrics ─────────────────────────────────────

export interface LessonBenchmarkMetrics {
  resourceId: string;
  title: string;
  lesson_archetype: LessonArchetype;
  archetype_label: string;

  // Core
  content_length: number;
  stage1_candidate_count: number;
  stage2_raw_count: number;
  validated_count: number;
  deduped_count: number;

  // Guardrails
  stage2_coverage_ratio: number;
  validation_pass_rate: number;
  dedup_loss_rate: number;
  flags: {
    enum_regression: boolean;
    expansion_regression: boolean;
    validation_regression: boolean;
    dedup_regression: boolean;
  };

  // Recovery
  recovery_triggered: boolean;
  recovery_missing_candidate_count: number;
  recovery_raw_count: number;
  recovery_lift: number;
  recovery_effective: boolean;
  recovery_material: boolean;

  // Challenger
  challenger_distribution: Record<string, number>;

  // Derived
  final_kis_per_1k_chars: number;

  // Meta
  outcome: string;
  error?: string;
}

// ── Aggregated Report ──────────────────────────────────────

export interface ArchetypeStats {
  count: number;
  avg_stage1_count: number;
  avg_stage2_count: number;
  avg_final_kis: number;
  avg_coverage_ratio: number;
  pct_expansion_regression: number;
  pct_recovery_triggered: number;
  avg_recovery_lift: number;
  avg_challenger_distribution: Record<string, number>;
}

export interface BenchmarkReport {
  lessons: LessonBenchmarkMetrics[];
  summary: {
    total_lessons: number;
    avg_kis_per_lesson: number;
    avg_coverage_ratio: number;
    pct_enum_regression: number;
    pct_expansion_regression: number;
    pct_validation_regression: number;
    pct_dedup_regression: number;
    pct_recovery_triggered: number;
    avg_kis_per_1k_chars: number;
  };
  by_archetype: Record<LessonArchetype, ArchetypeStats>;
  outliers: {
    lowest_kis: LessonBenchmarkMetrics[];
    lowest_coverage: LessonBenchmarkMetrics[];
    highest_dedup_loss: LessonBenchmarkMetrics[];
    repeated_guardrail_triggers: LessonBenchmarkMetrics[];
  };
  human_summary: string;
}

// ── Benchmark Runner ───────────────────────────────────────

export async function runLessonBenchmark(
  resourceIds: string[],
  onProgress?: (current: number, total: number, title: string) => void,
): Promise<BenchmarkReport> {
  const lessons: LessonBenchmarkMetrics[] = [];

  for (let i = 0; i < resourceIds.length; i++) {
    const resourceId = resourceIds[i];

    // Fetch resource content for archetype classification
    const { data: resource } = await supabase
      .from('resources')
      .select('id, title, content')
      .eq('id', resourceId)
      .single();

    const title = resource?.title || 'Unknown';
    onProgress?.(i + 1, resourceIds.length, title);

    // Classify archetype
    const archetype = classifyArchetype(resource?.content || '', title);

    // Run extraction (this calls the production pipeline — read-only eval via the response)
    try {
      const { data, error } = await supabase.functions.invoke('batch-extract-kis', {
        body: { resourceId },
      });

      if (error) {
        lessons.push(makeErrorMetrics(resourceId, title, archetype, error.message));
        continue;
      }

      const log = data?.log;
      const pLog = log?.lessonPipeline || {};
      const guardrails = pLog?.guardrails || {};

      const metrics: LessonBenchmarkMetrics = {
        resourceId,
        title,
        lesson_archetype: archetype,
        archetype_label: ARCHETYPE_LABELS[archetype],
        content_length: log?.contentLength || 0,
        stage1_candidate_count: pLog?.stage1 || 0,
        stage2_raw_count: pLog?.initial_stage2_raw_count || pLog?.stage2Raw || 0,
        validated_count: log?.validatedCount || 0,
        deduped_count: log?.dedupedCount || 0,
        stage2_coverage_ratio: guardrails?.stage2_coverage_ratio || 0,
        validation_pass_rate: guardrails?.validation_pass_rate || 0,
        dedup_loss_rate: guardrails?.dedup_loss_rate || 0,
        flags: guardrails?.flags || { enum_regression: false, expansion_regression: false, validation_regression: false, dedup_regression: false },
        recovery_triggered: pLog?.recovery_triggered || false,
        recovery_missing_candidate_count: pLog?.recovery_missing_candidate_count || 0,
        recovery_raw_count: pLog?.recovery_raw_count || 0,
        recovery_lift: pLog?.recovery_lift || 0,
        recovery_effective: pLog?.recovery_effective || false,
        recovery_material: pLog?.recovery_material || false,
        challenger_distribution: guardrails?.challenger_distribution || pLog?.challenger_distribution || {},
        final_kis_per_1k_chars: 0,
        outcome: log?.outcome || data?.error ? 'error' : 'success',
        error: data?.error,
      };

      // Derived
      if (metrics.content_length > 0 && metrics.deduped_count > 0) {
        metrics.final_kis_per_1k_chars = Math.round((metrics.deduped_count / (metrics.content_length / 1000)) * 100) / 100;
      }

      lessons.push(metrics);
    } catch (err: any) {
      lessons.push(makeErrorMetrics(resourceId, title, archetype, err.message));
    }
  }

  return buildReport(lessons);
}

function makeErrorMetrics(resourceId: string, title: string, archetype: LessonArchetype, error: string): LessonBenchmarkMetrics {
  return {
    resourceId, title, lesson_archetype: archetype, archetype_label: ARCHETYPE_LABELS[archetype],
    content_length: 0, stage1_candidate_count: 0, stage2_raw_count: 0, validated_count: 0, deduped_count: 0,
    stage2_coverage_ratio: 0, validation_pass_rate: 0, dedup_loss_rate: 0,
    flags: { enum_regression: false, expansion_regression: false, validation_regression: false, dedup_regression: false },
    recovery_triggered: false, recovery_missing_candidate_count: 0, recovery_raw_count: 0,
    recovery_lift: 0, recovery_effective: false, recovery_material: false,
    challenger_distribution: {}, final_kis_per_1k_chars: 0, outcome: 'error', error,
  };
}

// ── Report Builder ─────────────────────────────────────────

function buildReport(lessons: LessonBenchmarkMetrics[]): BenchmarkReport {
  const successful = lessons.filter(l => l.outcome === 'success');
  const n = successful.length || 1;

  // Overall summary
  const summary = {
    total_lessons: lessons.length,
    avg_kis_per_lesson: round(avg(successful, l => l.deduped_count)),
    avg_coverage_ratio: round(avg(successful, l => l.stage2_coverage_ratio)),
    pct_enum_regression: round(pct(successful, l => l.flags.enum_regression)),
    pct_expansion_regression: round(pct(successful, l => l.flags.expansion_regression)),
    pct_validation_regression: round(pct(successful, l => l.flags.validation_regression)),
    pct_dedup_regression: round(pct(successful, l => l.flags.dedup_regression)),
    pct_recovery_triggered: round(pct(successful, l => l.recovery_triggered)),
    avg_kis_per_1k_chars: round(avg(successful, l => l.final_kis_per_1k_chars)),
  };

  // By archetype
  const archetypes: LessonArchetype[] = [
    'structured_framework', 'tactical_walkthrough', 'conversational_transcript',
    'interview_qa', 'narrative_story', 'mindset_principles',
  ];
  const by_archetype = {} as Record<LessonArchetype, ArchetypeStats>;
  for (const arch of archetypes) {
    const group = successful.filter(l => l.lesson_archetype === arch);
    if (group.length === 0) continue;
    by_archetype[arch] = {
      count: group.length,
      avg_stage1_count: round(avg(group, l => l.stage1_candidate_count)),
      avg_stage2_count: round(avg(group, l => l.stage2_raw_count)),
      avg_final_kis: round(avg(group, l => l.deduped_count)),
      avg_coverage_ratio: round(avg(group, l => l.stage2_coverage_ratio)),
      pct_expansion_regression: round(pct(group, l => l.flags.expansion_regression)),
      pct_recovery_triggered: round(pct(group, l => l.recovery_triggered)),
      avg_recovery_lift: round(avg(group, l => l.recovery_lift)),
      avg_challenger_distribution: avgChallenger(group),
    };
  }

  // Outliers
  const sorted = [...successful];
  const outliers = {
    lowest_kis: [...sorted].sort((a, b) => a.deduped_count - b.deduped_count).slice(0, 3),
    lowest_coverage: [...sorted].sort((a, b) => a.stage2_coverage_ratio - b.stage2_coverage_ratio).slice(0, 3),
    highest_dedup_loss: [...sorted].sort((a, b) => b.dedup_loss_rate - a.dedup_loss_rate).slice(0, 3),
    repeated_guardrail_triggers: sorted.filter(l => {
      const flagCount = Object.values(l.flags).filter(Boolean).length;
      return flagCount >= 2;
    }),
  };

  // Human summary
  const lines: string[] = ['═══ LESSON BENCHMARK SUMMARY ═══', ''];
  lines.push(`Total lessons: ${summary.total_lessons} | Avg KIs/lesson: ${summary.avg_kis_per_lesson} | Avg coverage: ${(summary.avg_coverage_ratio * 100).toFixed(0)}%`);
  lines.push(`Recovery triggered: ${(summary.pct_recovery_triggered).toFixed(0)}% of lessons`);
  lines.push('');

  // Archetype ranking
  const ranked = Object.entries(by_archetype).sort(([, a], [, b]) => b.avg_final_kis - a.avg_final_kis);
  if (ranked.length > 0) {
    lines.push('BY ARCHETYPE (best → worst):');
    for (const [arch, stats] of ranked) {
      const label = ARCHETYPE_LABELS[arch as LessonArchetype];
      lines.push(`  ${label} (n=${stats.count}): ${stats.avg_final_kis} KIs avg | coverage ${(stats.avg_coverage_ratio * 100).toFixed(0)}% | recovery ${(stats.pct_recovery_triggered).toFixed(0)}%`);
    }
    lines.push('');
    lines.push(`Strongest: ${ARCHETYPE_LABELS[ranked[0][0] as LessonArchetype]}`);
    lines.push(`Weakest: ${ARCHETYPE_LABELS[ranked[ranked.length - 1][0] as LessonArchetype]}`);

    const needsRecovery = ranked.filter(([, s]) => s.pct_recovery_triggered > 50);
    if (needsRecovery.length > 0) {
      lines.push(`Recovery consistently needed for: ${needsRecovery.map(([a]) => ARCHETYPE_LABELS[a as LessonArchetype]).join(', ')}`);
    }

    const weakTypes = ranked.filter(([, s]) => s.avg_final_kis < 15);
    lines.push(weakTypes.length > 0
      ? `⚠️ May need specialized extraction modes for: ${weakTypes.map(([a]) => ARCHETYPE_LABELS[a as LessonArchetype]).join(', ')}`
      : '✅ All archetypes performing adequately — no specialized modes needed yet.');
  }

  return {
    lessons,
    summary,
    by_archetype,
    outliers,
    human_summary: lines.join('\n'),
  };
}

// ── Helpers ────────────────────────────────────────────────

function avg<T>(items: T[], fn: (item: T) => number): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, item) => sum + fn(item), 0) / items.length;
}

function pct<T>(items: T[], fn: (item: T) => boolean): number {
  if (items.length === 0) return 0;
  return (items.filter(fn).length / items.length) * 100;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function avgChallenger(group: LessonBenchmarkMetrics[]): Record<string, number> {
  if (group.length === 0) return {};
  const totals: Record<string, number> = { teach: 0, tailor: 0, take_control: 0 };
  for (const l of group) {
    for (const [k, v] of Object.entries(l.challenger_distribution)) {
      totals[k] = (totals[k] || 0) + (v as number);
    }
  }
  for (const k of Object.keys(totals)) {
    totals[k] = round(totals[k] / group.length);
  }
  return totals;
}
