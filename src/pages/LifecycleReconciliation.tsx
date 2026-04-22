/**
 * Admin/debug page: full-library lifecycle reconciliation.
 *
 * NOT a user-facing surface — strictly an admin/observability tool for
 * verifying the canonical state resolver and surfacing remaining
 * invariant violations.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Loader2, Download, FileJson, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  buildLifecycleReconciliationReport,
  reportToCsv,
  type ReconciliationReport,
} from '@/lib/lifecycleReconciliationReport';

export default function LifecycleReconciliation() {
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [onlyViolations, setOnlyViolations] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await buildLifecycleReconciliationReport();
      setReport(r);
      toast.success(`Audited ${r.total_resources} resources`, {
        description: `${r.summary.invariant_violations_total} invariant violations · ${r.summary.audit_log_persisted} auto-heal events persisted`,
      });
    } catch (err: any) {
      toast.error('Reconciliation failed', { description: err?.message ?? String(err) });
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = () => {
    if (!report) return;
    const csv = reportToCsv(report);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifecycle-reconciliation-${new Date().toISOString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifecycle-reconciliation-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredRows = report?.rows.filter((r) => {
    if (onlyViolations && r.invariant_violations.length === 0) return false;
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      r.title.toLowerCase().includes(f) ||
      r.resource_id.toLowerCase().includes(f) ||
      r.canonical_state.toLowerCase().includes(f) ||
      r.blocked_reason.toLowerCase().includes(f)
    );
  }) ?? [];

  return (
    <div className="container mx-auto p-6 space-y-6 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Lifecycle Reconciliation</h1>
          <p className="text-sm text-muted-foreground">
            Single-source-of-truth audit for the resource lifecycle. KI truth wins.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={run} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Run Audit
          </Button>
          {report && (
            <>
              <Button variant="outline" onClick={downloadCsv}>
                <Download className="h-4 w-4 mr-2" /> CSV
              </Button>
              <Button variant="outline" onClick={downloadJson}>
                <FileJson className="h-4 w-4 mr-2" /> JSON
              </Button>
            </>
          )}
        </div>
      </div>

      {report && (
        <>
          <SummaryGrid report={report} />
          <PaginationHealthCard report={report} />
          <TopBlockedCard report={report} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">All resources ({filteredRows.length} of {report.rows.length})</CardTitle>
              <div className="flex items-center gap-2 pt-2">
                <Input
                  placeholder="Filter by title, id, state…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="max-w-md"
                />
                <Button
                  variant={onlyViolations ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setOnlyViolations(!onlyViolations)}
                >
                  Violations only
                </Button>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Blocked</TableHead>
                    <TableHead className="text-right">Content</TableHead>
                    <TableHead className="text-right">KI tot/act/ctx</TableHead>
                    <TableHead>Violations</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.slice(0, 500).map((r) => (
                    <TableRow key={r.resource_id}>
                      <TableCell className="font-mono text-xs max-w-xs truncate" title={r.title}>{r.title}</TableCell>
                      <TableCell><Badge variant="outline">{r.canonical_state}</Badge></TableCell>
                      <TableCell><Badge variant={r.blocked_reason === 'none' ? 'secondary' : 'destructive'}>{r.blocked_reason}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{r.content_length.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.ki_total}/{r.ki_active}/{r.ki_active_with_contexts}</TableCell>
                      <TableCell className="text-xs text-destructive">{r.invariant_violations.length > 0 ? `${r.invariant_violations.length}` : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filteredRows.length > 500 && (
                <p className="text-xs text-muted-foreground mt-2">Showing first 500 — download CSV/JSON for full data.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryGrid({ report }: { report: ReconciliationReport }) {
  const s = report.summary;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Canonical state — before vs after</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>State</TableHead><TableHead className="text-right">Before</TableHead><TableHead className="text-right">After</TableHead><TableHead className="text-right">Δ</TableHead></TableRow></TableHeader>
            <TableBody>
              {Object.keys(s.canonical_state_after).map((k) => {
                const before = (s.canonical_state_before as any)[k] ?? 0;
                const after = (s.canonical_state_after as any)[k] ?? 0;
                const delta = after - before;
                return (
                  <TableRow key={k}>
                    <TableCell className="font-mono text-xs">{k}</TableCell>
                    <TableCell className="text-right tabular-nums">{before}</TableCell>
                    <TableCell className="text-right tabular-nums">{after}</TableCell>
                    <TableCell className={`text-right tabular-nums ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-amber-600' : ''}`}>{delta > 0 ? `+${delta}` : delta}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Blocked reason — before vs after</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Reason</TableHead><TableHead className="text-right">Before</TableHead><TableHead className="text-right">After</TableHead><TableHead className="text-right">Δ</TableHead></TableRow></TableHeader>
            <TableBody>
              {Object.keys(s.blocked_reason_after).map((k) => {
                const before = (s.blocked_reason_before as any)[k] ?? 0;
                const after = (s.blocked_reason_after as any)[k] ?? 0;
                const delta = after - before;
                return (
                  <TableRow key={k}>
                    <TableCell className="font-mono text-xs">{k}</TableCell>
                    <TableCell className="text-right tabular-nums">{before}</TableCell>
                    <TableCell className="text-right tabular-nums">{after}</TableCell>
                    <TableCell className={`text-right tabular-nums ${delta < 0 ? 'text-emerald-600' : delta > 0 ? 'text-amber-600' : ''}`}>{delta > 0 ? `+${delta}` : delta}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardContent className="pt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Resources audited" value={report.total_resources} />
          <Stat label="Invariant violations" value={s.invariant_violations_total} tone={s.invariant_violations_total > 0 ? 'warn' : 'ok'} />
          <Stat label="Resources with violations" value={s.invariant_violations_unique_resources} tone={s.invariant_violations_unique_resources > 0 ? 'warn' : 'ok'} />
          <Stat label="Auto-heal events persisted" value={s.audit_log_persisted} />
        </CardContent>
      </Card>
    </div>
  );
}

function PaginationHealthCard({ report }: { report: ReconciliationReport }) {
  const h = report.ki_pagination_health;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          KI pagination health
          <Badge variant={h.status === 'ok' ? 'secondary' : 'destructive'}>{h.status}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Stat label="Server count" value={h.expected_total ?? '—'} />
        <Stat label="Fetched" value={h.fetched_total} />
        <Stat label="Pages" value={h.pages_fetched} />
        <Stat label="Delta" value={h.delta} tone={h.delta === 0 ? 'ok' : 'warn'} />
        {h.warnings.length > 0 && (
          <div className="col-span-full text-xs text-amber-600 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <ul className="space-y-1">{h.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TopBlockedCard({ report }: { report: ReconciliationReport }) {
  const top = report.summary.top_blocked;
  if (top.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Top remaining blocked resources</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Title</TableHead><TableHead>State</TableHead><TableHead>Reason</TableHead>
            <TableHead className="text-right">Content</TableHead><TableHead className="text-right">KI</TableHead>
            <TableHead>Why</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {top.map((r) => (
              <TableRow key={r.resource_id}>
                <TableCell className="text-xs max-w-xs truncate" title={r.title}>{r.title}</TableCell>
                <TableCell><Badge variant="outline">{r.canonical_state}</Badge></TableCell>
                <TableCell><Badge variant="destructive">{r.blocked_reason}</Badge></TableCell>
                <TableCell className="text-right tabular-nums">{r.content_length.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{r.ki_total}/{r.ki_active}/{r.ki_active_with_contexts}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.explanation}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'ok' | 'warn' }) {
  const toneClass = tone === 'warn' ? 'text-amber-600' : tone === 'ok' ? 'text-emerald-600' : '';
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
