/**
 * SkillSession Debug Panel — Dev-only visibility into the shared context loop.
 *
 * Shows resolved SkillSession, source of truth, mapped scenario, scoring rubric,
 * and full training loop trace: skill → scenario → dimensions → scored → recommendation.
 * Hidden in production unless ?debug=skill is present.
 */

import { useSearchParams } from 'react-router-dom';
import { useResolvedSkillSession } from '@/lib/learning/skillSessionResolver';
import { getTrainingContent } from '@/lib/learning/skillBuilderContent';
import { SKILL_SCENARIO_CONSTRAINTS } from '@/lib/learning/skillScenarioSelector';
import { SKILL_RUBRICS } from '@/lib/dojo/skillRubric';
import { Bug, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export function SkillSessionDebugPanel() {
  const [searchParams] = useSearchParams();
  const resolved = useResolvedSkillSession();
  const isDebug = searchParams.get('debug') === 'skill';
  const [expanded, setExpanded] = useState(true);

  if (!isDebug) return null;

  const content = resolved ? getTrainingContent(resolved.session.skillId) : null;
  const constraints = resolved ? SKILL_SCENARIO_CONSTRAINTS[resolved.session.skillId] : null;
  const rubric = resolved ? SKILL_RUBRICS[resolved.session.skillId] : null;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2 text-[11px] font-mono">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 w-full"
      >
        <Bug className="h-3 w-3" />
        <span className="font-semibold">Training Loop Trace</span>
        {expanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
      </button>

      {expanded && (
        <>
          {!resolved ? (
            <p className="text-muted-foreground">No SkillSession resolved from route.</p>
          ) : (
            <div className="space-y-3">
              {/* Session context */}
              <Section title="1. Skill Context">
                <Row label="Source" value={resolved.source} />
                <Row label="Skill" value={`${resolved.session.skillId} → ${resolved.session.skillName}`} />
                <Row label="Tier" value={`${resolved.session.currentTier} → ${resolved.session.targetTier}`} />
                <Row label="Level" value={String(resolved.session.currentLevel)} />
                <Row label="Focus Pattern" value={resolved.session.focusPattern ?? '—'} />
                <Row label="Top Blocker" value={resolved.session.topBlocker ?? '—'} />
                <Row label="Scenario Type" value={resolved.session.scenarioType ?? '—'} />
              </Section>

              {/* Scenario constraints */}
              {constraints && (
                <Section title="2. Scenario Constraints">
                  <Row label="Styles" value={constraints.styles.join(', ')} />
                  <Row label="Answer Expect." value={constraints.answerExpectation} />
                  <Row label="Pressure" value={constraints.pressureTraits.join(', ')} />
                </Section>
              )}

              {/* Taught dimensions */}
              {content && (
                <Section title="3. Taught → Scored Dimensions">
                  <Row label="Taught" value={content.scoringDimensions.join(', ')} />
                  <Row label="Aligned" value="✓ Same dimensions used in dojo-score edge function" />
                </Section>
              )}

              {/* Loop trace */}
              <Section title="4. Loop Trace">
                <Row label="Learn" value={`Selected skill: ${resolved.session.skillName}`} />
                <Row label="Skill Builder" value={content ? '✓ Content loaded' : '✗ No content'} />
                <Row label="Dojo" value={`Scenario filtered by ${resolved.session.skillId}`} />
                <Row label="Scoring" value={content ? `Dimensions: ${content.scoringDimensions.length}` : 'Default rubric'} />
                <Row label="Next Action" value="Weakest dimension → recommended focus" />
              </Section>

              {/* Canonical rubric */}
              {rubric && (
                <Section title="5. Canonical Rubric">
                  <Row label="Dimensions" value={rubric.dimensions.map(d => `${d.key}(${d.weight}%)`).join(', ')} />
                  <Row label="Retryable" value={rubric.retryableDimensions.join(', ')} />
                  <Row label="Failures" value={rubric.commonFailures.join(', ')} />
                  <Row label="Level" value={`Dev: ${rubric.levelExpectations.developing.substring(0, 40)}...`} />
                  <p className="text-[9px] text-muted-foreground mt-1">
                    Per-dimension trace (reason, evidence, targetFor7, targetFor9) visible in ExplainableScoreCard after scoring.
                  </p>
                </Section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-28">{label}:</span>
      <span className="text-foreground break-all">{value}</span>
    </div>
  );
}
