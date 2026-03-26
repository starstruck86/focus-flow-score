import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Play, CheckCircle2, XCircle, AlertTriangle, ChevronDown, Clock, Shield, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trackedInvoke } from '@/lib/trackedInvoke';

interface ExtractionAttempt {
  method: string;
  duration_ms: number;
  chars_extracted: number;
  timeout_hit: boolean;
  auth_wall_detected: boolean;
  http_status: number | null;
  validation_result: 'pass' | 'fail' | 'partial';
  error_category: string | null;
  error_detail: string | null;
}

interface TestResult {
  url: string;
  category: string;
  expected_status: string;
  source_type: string;
  platform: string;
  final_status: string;
  method_used: string | null;
  methods_attempted: ExtractionAttempt[];
  attempt_count: number;
  completeness_score: number;
  confidence_score: number;
  extracted_text_length: number;
  validation_passed: boolean;
  failure_reason: string | null;
  recovery_hint: string | null;
  missing_fields: string[];
  status_matches_expected: boolean;
  duration_total_ms: number;
}

interface Summary {
  total_tested: number;
  enriched: number;
  partial: number;
  needs_auth: number;
  unsupported: number;
  failed: number;
  expected_match_rate: number;
  expected_matches: number;
  expected_mismatches: number;
  fallback_usage_rate: number;
  avg_attempts: number;
  avg_completeness: number;
  avg_confidence: number;
}

interface Gaps {
  misclassified: Array<{ url: string; category: string; expected: string; actual: string; reason: string | null }>;
  low_completeness: Array<{ url: string; score: number }>;
  single_attempt_tricky: Array<{ url: string; category: string; status: string }>;
  fallback_not_triggered: Array<{ url: string; category: string; status: string }>;
}

const STATUS_COLORS: Record<string, string> = {
  enriched: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  partial: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  needs_auth: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  unsupported: 'bg-muted text-muted-foreground border-border',
  failed: 'bg-destructive/20 text-destructive border-destructive/30',
};

const BUILT_IN_TESTS = [
  { url: 'https://community.circle.so/c/getting-started', category: 'auth_gated', expected_status: 'needs_auth' },
  { url: 'https://www.skool.com/community', category: 'auth_gated', expected_status: 'needs_auth' },
  { url: 'https://courses.teachable.com/courses/enrolled', category: 'auth_gated', expected_status: 'needs_auth' },
  { url: 'https://app.kajabi.com/products', category: 'auth_gated', expected_status: 'needs_auth' },
  { url: 'https://www.paulgraham.com/greatwork.html', category: 'static_webpage', expected_status: 'enriched' },
  { url: 'https://blog.hubspot.com/sales/sales-methodology', category: 'static_webpage', expected_status: 'enriched' },
  { url: 'https://example.com', category: 'weak_content', expected_status: 'partial' },
  { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', category: 'youtube', expected_status: 'enriched' },
  { url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', category: 'pdf', expected_status: 'enriched' },
];

export function EnrichmentValidator() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [gaps, setGaps] = useState<Gaps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const runTests = useCallback(async (testUrls?: typeof BUILT_IN_TESTS) => {
    setRunning(true);
    setError(null);
    setResults([]);
    setSummary(null);
    setGaps(null);

    const tests = testUrls || BUILT_IN_TESTS;
    const allResults: TestResult[] = [];

    // Run in small batches to avoid function timeout
    const batchSize = 3;
    for (let i = 0; i < tests.length; i += batchSize) {
      const batch = tests.slice(i, i + batchSize);
      setProgress(Math.round((i / tests.length) * 100));

      try {
        const { data, error: err } = await trackedInvoke<{ results?: TestResult[] }>('validate-enrichment', {
          body: { test_urls: batch },
          timeoutMs: 120_000,
        });

        if (err) {
          setError(err.message);
          break;
        }

        if (data?.results) {
          allResults.push(...data.results);
          setResults([...allResults]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
        break;
      }
    }

    // Compute summary from all results
    if (allResults.length > 0) {
      const enriched = allResults.filter(r => r.final_status === 'enriched');
      const partial = allResults.filter(r => r.final_status === 'partial');
      const needsAuth = allResults.filter(r => r.final_status === 'needs_auth');
      const unsupported = allResults.filter(r => r.final_status === 'unsupported');
      const failed = allResults.filter(r => r.final_status === 'failed');
      const expectedMatches = allResults.filter(r => r.status_matches_expected);

      setSummary({
        total_tested: allResults.length,
        enriched: enriched.length,
        partial: partial.length,
        needs_auth: needsAuth.length,
        unsupported: unsupported.length,
        failed: failed.length,
        expected_match_rate: Math.round((expectedMatches.length / allResults.length) * 100),
        expected_matches: expectedMatches.length,
        expected_mismatches: allResults.length - expectedMatches.length,
        fallback_usage_rate: Math.round((allResults.filter(r => r.attempt_count > 1).length / allResults.length) * 100),
        avg_attempts: Math.round((allResults.reduce((s, r) => s + r.attempt_count, 0) / allResults.length) * 100) / 100,
        avg_completeness: Math.round(allResults.reduce((s, r) => s + r.completeness_score, 0) / allResults.length),
        avg_confidence: Math.round(allResults.reduce((s, r) => s + r.confidence_score, 0) / allResults.length),
      });

      setGaps({
        misclassified: allResults.filter(r => !r.status_matches_expected)
          .map(r => ({ url: r.url, category: r.category, expected: r.expected_status, actual: r.final_status, reason: r.failure_reason })),
        low_completeness: allResults.filter(r => r.final_status === 'enriched' && r.completeness_score < 70)
          .map(r => ({ url: r.url, score: r.completeness_score })),
        single_attempt_tricky: allResults.filter(r => r.attempt_count === 1 && ['js_heavy', 'youtube', 'pdf'].includes(r.category) && r.final_status !== 'enriched')
          .map(r => ({ url: r.url, category: r.category, status: r.final_status })),
        fallback_not_triggered: allResults.filter(r => r.attempt_count <= 1 && r.final_status !== 'enriched' && r.final_status !== 'needs_auth' && r.final_status !== 'unsupported')
          .map(r => ({ url: r.url, category: r.category, status: r.final_status })),
      });
    }

    setProgress(100);
    setRunning(false);
  }, []);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <Button
          onClick={() => runTests()}
          disabled={running}
          size="sm"
          className="gap-1.5"
        >
          <Play className="h-3.5 w-3.5" />
          {running ? 'Running…' : `Run ${BUILT_IN_TESTS.length} Tests`}
        </Button>
        {running && <Progress value={progress} className="flex-1 h-2" />}
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Summary */}
      {summary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Trust Gate Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-emerald-500/10 rounded p-2 text-center">
                <div className="text-lg font-bold text-emerald-400">{summary.enriched}</div>
                <div className="text-muted-foreground">Enriched</div>
              </div>
              <div className="bg-amber-500/10 rounded p-2 text-center">
                <div className="text-lg font-bold text-amber-400">{summary.partial}</div>
                <div className="text-muted-foreground">Partial</div>
              </div>
              <div className="bg-orange-500/10 rounded p-2 text-center">
                <div className="text-lg font-bold text-orange-400">{summary.needs_auth}</div>
                <div className="text-muted-foreground">Needs Auth</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
              <div><span className="text-muted-foreground">Match rate:</span> {summary.expected_match_rate}%</div>
              <div><span className="text-muted-foreground">Fallback rate:</span> {summary.fallback_usage_rate}%</div>
              <div><span className="text-muted-foreground">Avg attempts:</span> {summary.avg_attempts}</div>
              <div><span className="text-muted-foreground">Avg completeness:</span> {summary.avg_completeness}</div>
              <div><span className="text-muted-foreground">Avg confidence:</span> {summary.avg_confidence}</div>
              <div><span className="text-muted-foreground">Failed:</span> {summary.failed}</div>
            </div>

            {summary.expected_mismatches > 0 && (
              <div className="text-xs text-amber-400 flex items-center gap-1.5 bg-amber-500/10 rounded px-2 py-1">
                <AlertTriangle className="h-3 w-3" />
                {summary.expected_mismatches} result(s) didn't match expected status
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Gaps */}
      {gaps && gaps.misclassified.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              Misclassified ({gaps.misclassified.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {gaps.misclassified.map((g, i) => (
              <div key={i} className="text-xs bg-amber-500/5 rounded px-2 py-1">
                <div className="font-mono truncate">{g.url}</div>
                <div className="text-muted-foreground">
                  Expected <Badge variant="outline" className="text-[9px] mx-1">{g.expected}</Badge>
                  got <Badge variant="outline" className="text-[9px] mx-1">{g.actual}</Badge>
                  {g.reason && <span className="ml-1">— {g.reason}</span>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Results list */}
      {results.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">
            Results ({results.length})
          </h3>
          {results.map((r, i) => (
            <TestResultRow key={i} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function TestResultRow({ result }: { result: TestResult }) {
  const matchIcon = result.status_matches_expected
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
    : <XCircle className="h-3.5 w-3.5 text-destructive" />;

  return (
    <Collapsible>
      <CollapsibleTrigger className="w-full text-left">
        <div className="flex items-center gap-2 bg-card border border-border rounded-md px-3 py-2 hover:bg-muted/50 transition-colors">
          {matchIcon}
          <Badge variant="outline" className={cn('text-[9px]', STATUS_COLORS[result.final_status])}>
            {result.final_status}
          </Badge>
          <span className="text-xs font-mono truncate flex-1">{result.url}</span>
          <Badge variant="outline" className="text-[9px]">{result.category}</Badge>
          {result.attempt_count > 1 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Zap className="h-2.5 w-2.5" />{result.attempt_count}
            </span>
          )}
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-5 mt-1 mb-2 space-y-2 text-xs bg-muted/30 rounded-md p-3 border border-border/50">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
            <div><span className="text-muted-foreground">Source type:</span> {result.source_type}</div>
            <div><span className="text-muted-foreground">Platform:</span> {result.platform}</div>
            <div><span className="text-muted-foreground">Method:</span> {result.method_used || '—'}</div>
            <div><span className="text-muted-foreground">Text length:</span> {result.extracted_text_length.toLocaleString()}</div>
            <div><span className="text-muted-foreground">Completeness:</span> {result.completeness_score}</div>
            <div><span className="text-muted-foreground">Confidence:</span> {result.confidence_score}</div>
            <div><span className="text-muted-foreground">Duration:</span> {result.duration_total_ms}ms</div>
            <div><span className="text-muted-foreground">Validated:</span> {result.validation_passed ? '✓' : '✗'}</div>
          </div>

          {result.failure_reason && (
            <div className="text-muted-foreground">
              <span className="text-destructive">Reason:</span> {result.failure_reason}
            </div>
          )}
          {result.recovery_hint && (
            <div className="text-muted-foreground">
              <span className="text-primary">Hint:</span> {result.recovery_hint}
            </div>
          )}

          {/* Attempt trace */}
          {result.methods_attempted.length > 0 && (
            <div className="space-y-1">
              <div className="text-muted-foreground font-semibold">Attempt Trace:</div>
              {result.methods_attempted.map((a, j) => (
                <div key={j} className="flex items-center gap-2 text-[10px] bg-background/50 rounded px-2 py-1">
                  {a.validation_result === 'pass'
                    ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                    : a.validation_result === 'partial'
                    ? <AlertTriangle className="h-2.5 w-2.5 text-amber-400 shrink-0" />
                    : <XCircle className="h-2.5 w-2.5 text-destructive shrink-0" />}
                  <span className="font-mono">{a.method}</span>
                  <span className="text-muted-foreground">{a.duration_ms}ms</span>
                  <span className="text-muted-foreground">{a.chars_extracted} chars</span>
                  {a.timeout_hit && <Badge variant="outline" className="text-[8px] border-orange-500/30 text-orange-400">timeout</Badge>}
                  {a.auth_wall_detected && <Badge variant="outline" className="text-[8px] border-red-500/30 text-red-400">auth wall</Badge>}
                  {a.error_category && <span className="text-destructive">{a.error_category}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
