import { useState } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TestResult {
  test: string;
  category?: string;
  passed: boolean;
  provider?: string;
  model?: string;
  fallback?: boolean;
  latency_ms?: number;
  details?: string;
  error?: string;
}

interface SmokeTestResponse {
  status: 'ok' | 'partial_failure' | 'failed';
  total_ms: number;
  provider_health?: Record<string, boolean>;
  infra_tests?: TestResult[];
  e2e_tests?: TestResult[];
  summary?: {
    infra_passed: number;
    infra_failed: number;
    e2e_passed: number;
    e2e_failed: number;
  };
}

export default function SmokeTest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SmokeTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Toggles
  const [skipInfra, setSkipInfra] = useState(false);
  const [skipE2e, setSkipE2e] = useState(false);
  const [disableCleanup, setDisableCleanup] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await authenticatedFetch({
        functionName: 'strategy-smoke-test',
        body: {
          skip_infra: skipInfra,
          skip_e2e: skipE2e,
          cleanup: !disableCleanup,
        },
        retry: false,
        timeoutMs: 120_000,
        componentName: 'SmokeTest',
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
      }
      const data: SmokeTestResponse = await resp.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const statusColor = result?.status === 'ok'
    ? 'bg-green-600/15 text-green-400 border-green-600/30'
    : result?.status === 'partial_failure'
      ? 'bg-yellow-600/15 text-yellow-400 border-yellow-600/30'
      : 'bg-red-600/15 text-red-400 border-red-600/30';

  const allTests = [
    ...(result?.infra_tests ?? []).map(t => ({ ...t, category: t.category ?? 'infra' })),
    ...(result?.e2e_tests ?? []).map(t => ({ ...t, category: t.category ?? 'e2e' })),
  ];

  return (
    <div className="min-h-screen bg-background p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Strategy Smoke Test</h1>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={run} disabled={loading} size="lg">
          {loading ? <><Loader2 className="animate-spin mr-2" /> Running…</> : 'Run Smoke Test'}
        </Button>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={skipInfra} onChange={e => setSkipInfra(e.target.checked)} />
          Skip Infra
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={skipE2e} onChange={e => setSkipE2e(e.target.checked)} />
          Skip E2E
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={disableCleanup} onChange={e => setDisableCleanup(e.target.checked)} />
          Disable Cleanup
        </label>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-md border bg-red-600/15 text-red-400 border-red-600/30 text-sm">
          {error}
        </div>
      )}

      {/* Result banner */}
      {result && (
        <div className={cn('p-4 rounded-md border flex items-center gap-3', statusColor)}>
          {result.status === 'ok' ? <CheckCircle2 className="size-5" /> : result.status === 'partial_failure' ? <AlertTriangle className="size-5" /> : <XCircle className="size-5" />}
          <div>
            <span className="font-semibold uppercase">{result.status}</span>
            <span className="ml-3 text-sm opacity-80">{result.total_ms}ms</span>
          </div>
        </div>
      )}

      {/* Summary */}
      {result?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Infra Passed" value={result.summary.infra_passed} ok />
          <Stat label="Infra Failed" value={result.summary.infra_failed} ok={result.summary.infra_failed === 0} />
          <Stat label="E2E Passed" value={result.summary.e2e_passed} ok />
          <Stat label="E2E Failed" value={result.summary.e2e_failed} ok={result.summary.e2e_failed === 0} />
        </div>
      )}

      {/* Provider health */}
      {result?.provider_health && (
        <div className="flex gap-3 text-sm">
          {Object.entries(result.provider_health).map(([p, ok]) => (
            <span key={p} className={cn('px-3 py-1 rounded-full border', ok ? 'border-green-600/30 text-green-400' : 'border-red-600/30 text-red-400')}>
              {p}: {ok ? '✅' : '❌'}
            </span>
          ))}
        </div>
      )}

      {/* Results table */}
      {allTests.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Test</TableHead>
                <TableHead>Cat</TableHead>
                <TableHead>Pass</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Fallback</TableHead>
                <TableHead>ms</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allTests.map((t, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{t.test}</TableCell>
                  <TableCell className="text-xs">{t.category}</TableCell>
                  <TableCell>{t.passed ? '✅' : '❌'}</TableCell>
                  <TableCell className="text-xs">{t.provider ?? '—'}</TableCell>
                  <TableCell className="text-xs max-w-[120px] truncate">{t.model ?? '—'}</TableCell>
                  <TableCell className="text-xs">{t.fallback != null ? String(t.fallback) : '—'}</TableCell>
                  <TableCell className="text-xs">{t.latency_ms ?? '—'}</TableCell>
                  <TableCell className="text-xs text-red-400 max-w-[200px] truncate">{t.error ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: number; ok: boolean }) {
  return (
    <div className={cn('p-3 rounded-md border text-center', ok ? 'border-green-600/20' : 'border-red-600/20')}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}
