/**
 * SkillSession Debug Panel — Dev-only visibility into the shared context loop.
 *
 * Shows resolved SkillSession, source of truth, mapped scenario, and scoring rubric.
 * Hidden in production unless ?debug=skill is present.
 */

import { useSearchParams } from 'react-router-dom';
import { useResolvedSkillSession } from '@/lib/learning/skillSessionResolver';
import { getTrainingContent } from '@/lib/learning/skillBuilderContent';
import { Bug } from 'lucide-react';

export function SkillSessionDebugPanel() {
  const [searchParams] = useSearchParams();
  const resolved = useResolvedSkillSession();
  const isDebug = searchParams.get('debug') === 'skill';

  if (!isDebug) return null;

  const content = resolved ? getTrainingContent(resolved.session.skillId) : null;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2 text-[11px] font-mono">
      <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
        <Bug className="h-3 w-3" />
        <span className="font-semibold">SkillSession Debug</span>
      </div>

      {!resolved ? (
        <p className="text-muted-foreground">No SkillSession resolved from route.</p>
      ) : (
        <div className="space-y-1.5">
          <Row label="Source" value={resolved.source} />
          <Row label="Skill" value={`${resolved.session.skillId} → ${resolved.session.skillName}`} />
          <Row label="Tier" value={`${resolved.session.currentTier} → ${resolved.session.targetTier}`} />
          <Row label="Level" value={String(resolved.session.currentLevel)} />
          <Row label="Focus Pattern" value={resolved.session.focusPattern ?? '—'} />
          <Row label="Scenario Type" value={resolved.session.scenarioType ?? '—'} />
          <Row label="Top Blocker" value={resolved.session.topBlocker ?? '—'} />
          {content && (
            <>
              <Row label="Scoring Dims" value={content.scoringDimensions.join(', ')} />
              <Row label="Training Content" value="✓ loaded" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-24">{label}:</span>
      <span className="text-foreground break-all">{value}</span>
    </div>
  );
}
