/**
 * V6 Multi-Thread Live QA Runner — Developer-only page.
 * Sends V6 fixtures through the real dojo-score and validates multiThread output.
 */
import { useState, useCallback, useMemo } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { ArrowLeft, Play, Loader2, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { V6_FIXTURES, getFixturesByGroup, type V6Fixture, type V6FixtureGroup } from '@/lib/dojo/v6/qaFixtures';
import { runDeterministicSuite } from '@/lib/dojo/v6/qaHarness';
import { runLiveFixture, computeBatchSummary, type V6LiveRunResult, type V6BatchSummary } from '@/lib/dojo/v6/qaRunner';

const GROUPS: { key: V6FixtureGroup; label: string }[] = [
  { key: 'no_activation', label: 'No Activation' },
  { key: 'light_activation', label: 'Light Activation' },
  { key: 'strong_orchestration', label: 'Strong Orchestration' },
  { key: 'weak_orchestration', label: 'Weak Orchestration' },
  { key: 'ambiguous', label: 'Ambiguous' },
  { key: 'simulation', label: 'Simulation' },
];

export default function DojoV6QA() {
  const navigate = useNavigate();
  const [results, setResults] = useState<Map<string, V6LiveRunResult>>(new Map());
  const [running, setRunning] = useState<string | 'all' | 'group' | null>(null);
  const [runningGroup, setRunningGroup] = useState<V6FixtureGroup | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Deterministic suite
  const deterministic = useMemo(() => runDeterministicSuite(), []);

  // Batch summary
  const summary = useMemo<V6BatchSummary | null>(() => {
    if (results.size === 0) return null;
    return computeBatchSummary(Array.from(results.values()));
  }, [results]);

  const runOne = useCallback(async (fixture: V6Fixture) => {
    setRunning(fixture.id);
    const result = await runLiveFixture(fixture);
    setResults(prev => new Map(prev).set(fixture.id, result));
    setRunning(null);
  }, []);

  const runGroup = useCallback(async (group: V6FixtureGroup) => {
    setRunning('group');
    setRunningGroup(group);
    const fixtures = getFixturesByGroup(group);
    for (const f of fixtures) {
      const result = await runLiveFixture(f);
      setResults(prev => new Map(prev).set(f.id, result));
    }
    setRunning(null);
    setRunningGroup(null);
  }, []);

  const runAll = useCallback(async () => {
    setRunning('all');
    for (const f of V6_FIXTURES) {
      const result = await runLiveFixture(f);
      setResults(prev => new Map(prev).set(f.id, result));
    }
    setRunning(null);
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <Layout>
      <div className={cn(SHELL, 'py-6 space-y-6')}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/dojo/qa')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-semibold text-foreground">V6 Multi-Thread QA Runner</h1>
              <p className="text-sm text-muted-foreground">Live scorer validation against V6 fixtures</p>
            </div>
          </div>
          <Button onClick={runAll} disabled={running !== null} size="sm">
            {running === 'all' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
            Run All ({V6_FIXTURES.length})
          </Button>
        </div>

        {/* Deterministic Suite Summary */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-semibold text-foreground">Deterministic Tests</h2>
              <Badge variant={deterministic.summary.failed === 0 ? 'default' : 'destructive'}>
                {deterministic.summary.passed}/{deterministic.summary.total} passed
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">Selector + normalizer tests (no AI calls)</p>
          </CardContent>
        </Card>

        {/* Batch Summary */}
        {summary && (
          <Card>
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">Live Scorer Summary</h2>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                <SummaryCell label="Total" value={summary.total} />
                <SummaryCell label="Passed" value={summary.passed} color={summary.passed === summary.total ? 'text-green-600' : undefined} />
                <SummaryCell label="Failed" value={summary.failed} color={summary.failed > 0 ? 'text-red-600' : undefined} />
                <SummaryCell label="Errors" value={summary.errors} color={summary.errors > 0 ? 'text-red-600' : undefined} />
                <SummaryCell label="False +" value={summary.falsePositives} color={summary.falsePositives > 0 ? 'text-red-600' : undefined} />
                <SummaryCell label="False −" value={summary.falseNegatives} color={summary.falseNegatives > 0 ? 'text-amber-600' : undefined} />
                <SummaryCell label="Momentum ✗" value={summary.momentumMismatches} color={summary.momentumMismatches > 0 ? 'text-amber-600' : undefined} />
                <SummaryCell label="Weak Notes" value={summary.weakCoachingNotes} color={summary.weakCoachingNotes > 0 ? 'text-amber-600' : undefined} />
                <SummaryCell label="Hallucinations" value={summary.hallucinations} color={summary.hallucinations > 0 ? 'text-red-600' : undefined} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Fixture Groups */}
        {GROUPS.map(({ key, label }) => {
          const fixtures = getFixturesByGroup(key);
          const groupResults = fixtures.map(f => results.get(f.id)).filter(Boolean) as V6LiveRunResult[];
          const allPassed = groupResults.length === fixtures.length && groupResults.every(r => r.passed);
          const anyFailed = groupResults.some(r => !r.passed);

          return (
            <Card key={key}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-foreground">{label}</h2>
                    <Badge variant="outline" className="text-xs">{fixtures.length} fixtures</Badge>
                    {groupResults.length > 0 && (
                      allPassed
                        ? <Badge variant="default" className="text-xs">All Passed</Badge>
                        : anyFailed
                          ? <Badge variant="destructive" className="text-xs">{groupResults.filter(r => !r.passed).length} Failed</Badge>
                          : null
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runGroup(key)}
                    disabled={running !== null}
                  >
                    {running === 'group' && runningGroup === key
                      ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      : <Play className="h-3 w-3 mr-1" />
                    }
                    Run Group
                  </Button>
                </div>

                <div className="space-y-2">
                  {fixtures.map(fixture => {
                    const result = results.get(fixture.id);
                    const isExpanded = expanded.has(fixture.id);
                    const isRunning = running === fixture.id;

                    return (
                      <FixtureRow
                        key={fixture.id}
                        fixture={fixture}
                        result={result}
                        isExpanded={isExpanded}
                        isRunning={isRunning}
                        disabled={running !== null}
                        onRun={() => runOne(fixture)}
                        onToggle={() => toggleExpand(fixture.id)}
                      />
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </Layout>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function SummaryCell({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center">
      <div className={cn('text-lg font-semibold', color || 'text-foreground')}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function FixtureRow({
  fixture, result, isExpanded, isRunning, disabled, onRun, onToggle,
}: {
  fixture: V6Fixture;
  result?: V6LiveRunResult;
  isExpanded: boolean;
  isRunning: boolean;
  disabled: boolean;
  onRun: () => void;
  onToggle: () => void;
}) {
  const StatusIcon = result
    ? result.passed ? CheckCircle2 : result.error ? AlertTriangle : XCircle
    : null;
  const statusColor = result
    ? result.passed ? 'text-green-600' : result.error ? 'text-amber-600' : 'text-red-600'
    : '';

  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {StatusIcon && <StatusIcon className={cn('h-4 w-4 shrink-0', statusColor)} />}
          <span className="text-sm text-foreground truncate">{fixture.label}</span>
          {result && (
            <span className="text-xs text-muted-foreground shrink-0">
              {result.durationMs}ms
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {result && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle}>
              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRun} disabled={disabled}>
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {isExpanded && result && (
        <div className="mt-3 space-y-3 border-t pt-3">
          {/* Test results */}
          <div className="space-y-1">
            {result.tests.map((t, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {t.passed
                  ? <CheckCircle2 className="h-3 w-3 text-green-600 mt-0.5 shrink-0" />
                  : <XCircle className="h-3 w-3 text-red-600 mt-0.5 shrink-0" />
                }
                <div>
                  <span className="font-medium text-foreground">{t.name}:</span>{' '}
                  <span className="text-muted-foreground">{t.detail}</span>
                </div>
              </div>
            ))}
          </div>

          {/* MultiThread details */}
          {result.rawMultiThread && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-foreground">Multi-Thread Assessment</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <LabelValue label="Momentum" value={result.rawMultiThread.dealMomentum} />
                <LabelValue label="Alignment" value={String(result.rawMultiThread.alignmentScore)} />
                <LabelValue label="Champion" value={String(result.rawMultiThread.championStrengthScore)} />
                <LabelValue label="Political" value={String(result.rawMultiThread.politicalAwarenessScore)} />
              </div>
              <LabelValue label="Detected" value={result.rawMultiThread.stakeholdersDetected.join(', ') || '—'} />
              <LabelValue label="Addressed" value={result.rawMultiThread.stakeholdersAddressed.join(', ') || '—'} />
              {result.rawMultiThread.breakdown?.missedStakeholders?.length ? (
                <LabelValue label="Missed" value={result.rawMultiThread.breakdown.missedStakeholders.join(', ')} />
              ) : null}
              <LabelValue label="Coaching Note" value={result.rawMultiThread.coachingNote || '—'} />
            </div>
          )}

          {/* Expected vs Actual */}
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-foreground">Expected</h4>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>Activate: {fixture.expected.shouldActivate ? 'Yes' : 'No'} | Actual: {result.rawMultiThread ? 'Yes' : 'No'}</div>
              {fixture.expected.expectedMomentum && (
                <div>Momentum: {fixture.expected.expectedMomentum} | Actual: {result.rawMultiThread?.dealMomentum ?? '—'}</div>
              )}
              {fixture.expected.expectMissedStakeholders !== undefined && (
                <div>Missed stakeholders: {fixture.expected.expectMissedStakeholders ? 'Yes' : 'No'} | Actual: {(result.rawMultiThread?.breakdown?.missedStakeholders?.length ?? 0) > 0 ? 'Yes' : 'No'}</div>
              )}
            </div>
          </div>

          {/* Raw output */}
          {result.rawScorerOutput && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Raw Scorer Output</summary>
              <pre className="mt-1 p-2 bg-muted/50 rounded text-xs overflow-x-auto max-h-64 overflow-y-auto">
                {JSON.stringify(result.rawScorerOutput, null, 2)}
              </pre>
            </details>
          )}

          {result.error && (
            <div className="text-xs text-red-600 bg-red-500/10 rounded p-2">{result.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

function LabelValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}:</span>{' '}
      <span className="text-foreground">{value}</span>
    </div>
  );
}
