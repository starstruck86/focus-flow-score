/**
 * Dave Audio Audit Panel — Internal diagnostic UI.
 * Runs the failure-mode audit and displays results.
 */

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Shield } from 'lucide-react';
import { runFullAudioFailureAudit, type AudioFailureAuditResult } from '@/lib/daveAudioFailureAudit';

export default function DaveAudioAuditPanel() {
  const [results, setResults] = useState<AudioFailureAuditResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const runAudit = useCallback(async () => {
    setRunning(true);
    try {
      const r = await runFullAudioFailureAudit();
      setResults(r);
    } finally {
      setRunning(false);
    }
  }, []);

  const passed = results?.filter(r => r.passed) ?? [];
  const failed = results?.filter(r => !r.passed) ?? [];
  const highSeverityFails = failed.filter(r => r.severity === 'high');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Dave Audio OS — Failure Audit</h3>
        </div>
        <Button size="sm" onClick={runAudit} disabled={running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
          {running ? 'Running…' : 'Run Audit'}
        </Button>
      </div>

      {results && (
        <>
          {/* Summary */}
          <div className="flex gap-2">
            <Badge variant="outline" className="text-green-600 border-green-600/30">
              <CheckCircle2 className="h-3 w-3 mr-1" /> {passed.length} passed
            </Badge>
            <Badge variant="outline" className="text-destructive border-destructive/30">
              <XCircle className="h-3 w-3 mr-1" /> {failed.length} failed
            </Badge>
            {highSeverityFails.length > 0 && (
              <Badge variant="destructive">
                <AlertTriangle className="h-3 w-3 mr-1" /> {highSeverityFails.length} high severity
              </Badge>
            )}
          </div>

          {/* Failed cases first */}
          {failed.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-destructive">Failed</p>
              {failed.map(r => (
                <div key={r.caseId} className="flex items-start gap-2 rounded-md bg-destructive/5 border border-destructive/20 px-3 py-2">
                  <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">{r.label}</p>
                    <p className="text-[10px] text-muted-foreground">{r.surface} · {r.severity}</p>
                    {r.notes && <p className="text-[10px] text-destructive mt-0.5">{r.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Passed cases */}
          {passed.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-green-600">Passed</p>
              {passed.map(r => (
                <div key={r.caseId} className="flex items-center gap-2 px-3 py-1.5">
                  <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                  <p className="text-xs text-muted-foreground">{r.label}</p>
                  <Badge variant="outline" className="text-[9px] ml-auto">{r.surface}</Badge>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
