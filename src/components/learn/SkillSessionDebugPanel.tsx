/**
 * SkillSession Debug Panel — Dev-only visibility into the shared context loop.
 *
 * Shows resolved SkillSession, source of truth, mapped scenario, scoring rubric,
 * full training loop trace, and server/client lever mismatch detection.
 * Hidden in production unless ?debug=skill is present.
 */

import { useSearchParams } from 'react-router-dom';
import { useResolvedSkillSession } from '@/lib/learning/skillSessionResolver';
import { getTrainingContent } from '@/lib/learning/skillBuilderContent';
import { SKILL_SCENARIO_CONSTRAINTS } from '@/lib/learning/skillScenarioSelector';
import { SKILL_RUBRICS } from '@/lib/dojo/skillRubric';
import { LEVER_TUNING } from '@/lib/dojo/leverConfig';
import { Bug, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

interface DebugPanelProps {
  /** Server-returned lever data for mismatch detection */
  serverLeverData?: {
    primaryCoachingLever?: string;
    weakestDimension?: string;
    biggestWeightedDrag?: string;
    whyPrimaryLeverWasChosen?: string;
    serverLeverScore?: number;
  } | null;
  /** Client-computed lever data for mismatch detection */
  clientLeverData?: {
    primaryLever?: string;
    weakestDimension?: string;
    biggestWeightedDrag?: string;
    whyChosen?: string;
    candidates?: Array<{ key: string; leverScore: number }>;
  } | null;
}

export function SkillSessionDebugPanel({ serverLeverData, clientLeverData }: DebugPanelProps = {}) {
  const [searchParams] = useSearchParams();
  const resolved = useResolvedSkillSession();
  const isDebug = searchParams.get('debug') === 'skill';
  const [expanded, setExpanded] = useState(true);

  if (!isDebug) return null;

  const content = resolved ? getTrainingContent(resolved.session.skillId) : null;
  const constraints = resolved ? SKILL_SCENARIO_CONSTRAINTS[resolved.session.skillId] : null;
  const rubric = resolved ? SKILL_RUBRICS[resolved.session.skillId] : null;

  // Detect server/client mismatch
  const hasMismatch = serverLeverData && clientLeverData
    && serverLeverData.primaryCoachingLever
    && clientLeverData.primaryLever
    && serverLeverData.primaryCoachingLever !== clientLeverData.primaryLever;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2 text-[11px] font-mono">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 w-full"
      >
        <Bug className="h-3 w-3" />
        <span className="font-semibold">Training Loop Trace</span>
        {hasMismatch && <AlertTriangle className="h-3 w-3 text-destructive ml-1" />}
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
                </Section>
              )}

              {/* Coaching Lever Trace */}
              <Section title="6. Coaching Lever Config">
                <Row label="Strat max bonus" value={String(LEVER_TUNING.strategicMaxBonus)} />
                <Row label="Opening max bonus" value={String(LEVER_TUNING.openingMaxBonus)} />
                <Row label="Bonus threshold" value={`Full at ≤${LEVER_TUNING.bonusActivationThreshold}, scaled to 8`} />
                <Row label="Severe miss" value={`≤${LEVER_TUNING.severeMissThreshold} → ${LEVER_TUNING.severeMissMultiplier}× weightedGap`} />
              </Section>

              {/* Server/Client Mismatch Detection */}
              {(serverLeverData || clientLeverData) && (
                <Section title="7. Lever Mismatch Detection">
                  {serverLeverData?.primaryCoachingLever && (
                    <Row label="Server lever" value={`${serverLeverData.primaryCoachingLever} (${serverLeverData.whyPrimaryLeverWasChosen || '—'})`} />
                  )}
                  {clientLeverData?.primaryLever && (
                    <Row label="Client lever" value={`${clientLeverData.primaryLever} (${clientLeverData.whyChosen || '—'})`} />
                  )}
                  {hasMismatch ? (
                    <div className="bg-destructive/10 border border-destructive/30 rounded px-2 py-1">
                      <p className="text-destructive font-bold text-[10px]">
                        ⚠ MISMATCH: Server chose "{serverLeverData?.primaryCoachingLever}" but client chose "{clientLeverData?.primaryLever}"
                      </p>
                      <p className="text-[9px] text-muted-foreground mt-0.5">
                        This indicates constants or logic divergence between edge function and leverConfig.ts
                      </p>
                    </div>
                  ) : serverLeverData?.primaryCoachingLever && clientLeverData?.primaryLever ? (
                    <Row label="Match" value="✓ Server and client agree" />
                  ) : (
                    <p className="text-[9px] text-muted-foreground">Score a rep to populate lever data.</p>
                  )}
                  {clientLeverData?.candidates && clientLeverData.candidates.length > 0 && (
                    <Row label="Candidates" value={clientLeverData.candidates.map(c => `${c.key}(${c.leverScore.toFixed(0)})`).join(', ')} />
                  )}
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
