/**
 * Skill Builder Audit Page — Internal QA surface
 */

import { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, ClipboardCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { runSkillBuilderCoverageAudit, type CoverageAuditReport } from '@/lib/learning/skillBuilderCoverageAudit';
import { getSkillBuilderGapMap, type GapMapResult } from '@/lib/learning/skillBuilderGapMap';
import { auditSkillBuilderSequencing, type SequencingAuditResult } from '@/lib/learning/skillBuilderSequencingAudit';
import { buildSkillBuilderCurationPlan, type SkillBuilderCurationPlan } from '@/lib/learning/skillBuilderCurationPlan';
import { SkillBuilderCoverageCard } from '@/components/learn/SkillBuilderCoverageCard';
import { SkillBuilderGapCard } from '@/components/learn/SkillBuilderGapCard';
import { SkillBuilderCurationPlanCard } from '@/components/learn/SkillBuilderCurationPlanCard';

type AuditPhase = 'idle' | 'coverage' | 'sequencing' | 'done' | 'error';

export default function SkillBuilderAudit() {
  const { user } = useAuth();
  const [phase, setPhase] = useState<AuditPhase>('idle');
  const [coverageReport, setCoverageReport] = useState<CoverageAuditReport | null>(null);
  const [gapMap, setGapMap] = useState<GapMapResult | null>(null);
  const [seqResults, setSeqResults] = useState<SequencingAuditResult[] | null>(null);
  const [curationPlan, setCurationPlan] = useState<SkillBuilderCurationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAudit = async () => {
    if (!user) return;
    try {
      setPhase('coverage');
      const report = await runSkillBuilderCoverageAudit(user.id);
      setCoverageReport(report);
      const gapResult = getSkillBuilderGapMap(report);
      setGapMap(gapResult);

      setPhase('sequencing');
      const seq = await auditSkillBuilderSequencing(user.id);
      setSeqResults(seq);

      // Build curation plan from all audit data
      setCurationPlan(buildSkillBuilderCurationPlan(report, gapResult, seq));

      setPhase('done');
    } catch (err) {
      console.error('Audit failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPhase('error');
    }
  };

  return (
    <Layout>
      <div className={cn('px-4 pt-4 space-y-4', SHELL.main.bottomPad)}>
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          <p className="text-sm font-semibold text-foreground">Skill Builder Audit</p>
        </div>

        {phase === 'idle' && (
          <button
            onClick={runAudit}
            className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            Run Full Audit
          </button>
        )}

        {(phase === 'coverage' || phase === 'sequencing') && (
          <div className="flex items-center gap-2 py-8 justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {phase === 'coverage' ? 'Auditing coverage…' : 'Auditing sequencing…'}
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">{error}</p>
            <button onClick={() => setPhase('idle')} className="text-xs text-primary underline mt-2">Retry</button>
          </div>
        )}

        {phase === 'done' && coverageReport && gapMap && (
          <>
            {/* Curation Plan — most actionable, goes first */}
            {curationPlan && <SkillBuilderCurationPlanCard plan={curationPlan} />}

            {/* Coverage */}
            <SkillBuilderCoverageCard report={coverageReport} />

            {/* Gap map */}
            <SkillBuilderGapCard gaps={gapMap} />

            {/* Sequencing results */}
            {seqResults && seqResults.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <p className="text-sm font-semibold text-foreground">Sequencing Audit</p>
                <div className="space-y-2">
                  {seqResults.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 py-1.5 border-b border-border/50 last:border-0">
                      <VerdictIcon verdict={r.verdict} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[10px] font-medium capitalize">
                            {r.skill.replace(/_/g, ' ')}
                          </p>
                          <Badge variant="outline" className="text-[8px]">{r.durationMinutes}m</Badge>
                          <Badge
                            variant={r.verdict === 'strong' ? 'default' : r.verdict === 'acceptable' ? 'secondary' : 'destructive'}
                            className="text-[8px]"
                          >
                            {r.verdict}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {r.patternCount} patterns · levels: [{r.levelSpread.join(', ')}]
                        </p>
                        {r.issues.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {r.issues.map((issue, j) => (
                              <p key={j} className="text-[9px] text-amber-600">⚠ {issue}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* What to fix next */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <p className="text-sm font-semibold text-foreground">What to Fix Next</p>
              <RecommendationList report={coverageReport} gaps={gapMap} seq={seqResults} />
            </div>

            <button
              onClick={() => { setPhase('idle'); setCoverageReport(null); setGapMap(null); setSeqResults(null); setCurationPlan(null); }}
              className="w-full h-9 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground"
            >
              Re-run Audit
            </button>
          </>
        )}
      </div>
    </Layout>
  );
}

function VerdictIcon({ verdict }: { verdict: 'strong' | 'acceptable' | 'weak' }) {
  if (verdict === 'strong') return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />;
  if (verdict === 'acceptable') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />;
}

function RecommendationList({
  report, gaps, seq,
}: {
  report: CoverageAuditReport;
  gaps: GapMapResult;
  seq: SequencingAuditResult[] | null;
}) {
  const recommendations: string[] = [];

  // Skills not ready for 30/60
  for (const s of report.perSkill) {
    if (!s.hasEnoughFor30) recommendations.push(`Curate more KIs for ${s.skill.replace(/_/g, ' ')} to unlock 30-min sessions`);
    else if (!s.hasEnoughFor60) recommendations.push(`Expand ${s.skill.replace(/_/g, ' ')} depth for 60-min viability`);
  }

  // Thin but important patterns
  const thinCount = gaps.patternGaps.filter(g => g.reason.includes('only')).length;
  if (thinCount > 0) recommendations.push(`${thinCount} patterns have < 3 KIs — prioritize curation`);

  // Pressure gaps
  const pressureNeeded = gaps.patternGaps.filter(g => g.needsPressureVariants).length;
  if (pressureNeeded > 0) recommendations.push(`${pressureNeeded} patterns need pressure variants`);

  // Multi-thread gaps
  const mtNeeded = gaps.patternGaps.filter(g => g.needsMultiThreadVariants).length;
  if (mtNeeded > 0) recommendations.push(`${mtNeeded} patterns need multi-thread variants`);

  // Redundancy
  if (report.redundancyAlerts.length > 0) recommendations.push(`${report.redundancyAlerts.length} clusters have high redundancy — deduplicate`);

  // Sequencing issues
  const weakSeq = (seq ?? []).filter(s => s.verdict === 'weak');
  if (weakSeq.length > 0) recommendations.push(`${weakSeq.length} skill/duration combos have weak sequencing`);

  if (recommendations.length === 0) {
    return <p className="text-[10px] text-muted-foreground">No critical issues. System is healthy.</p>;
  }

  return (
    <ol className="space-y-1 list-decimal list-inside">
      {recommendations.map((r, i) => (
        <li key={i} className="text-[10px] text-muted-foreground">{r}</li>
      ))}
    </ol>
  );
}
