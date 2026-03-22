// Pipeline Hygiene Widget — flags stale deals, missing next steps, and risk
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { usePipelineHygiene, useRunHygieneScan } from '@/hooks/useCoachingEngine';
import { ShieldAlert, RefreshCw, AlertTriangle, Info, CheckCircle2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import type { PipelineHygieneIssue, PipelineHygieneSummary } from '@/types/dashboard';

function formatCurrency(n: number) {
  if (n < 0) return `-${formatCurrency(Math.abs(n))}`;
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function PipelineHygieneCard() {
  const { data, isLoading } = usePipelineHygiene();
  const runScan = useRunHygieneScan();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Card className="metric-card">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const issues = (data?.issues as PipelineHygieneIssue[]) || [];
  const healthScore = data?.health_score ?? 100;
  const summary = (data?.summary as PipelineHygieneSummary) || {};
  const criticalIssues = issues.filter(i => i.severity === 'critical');
  const warningIssues = issues.filter(i => i.severity === 'warning');

  // Navigate to the appropriate page when clicking an issue
  const handleIssueClick = (issue: PipelineHygieneIssue) => {
    if (issue.record_type === 'opportunity') {
      navigate('/quota');
    } else if (issue.record_type === 'renewal') {
      navigate('/renewals');
    } else if (issue.record_type === 'account') {
      navigate('/weekly-outreach');
    }
  };

  return (
    <Card className={cn("metric-card", healthScore < 50 && "border-destructive/30")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" />
            Pipeline Health
          </CardTitle>
          <div className="flex items-center gap-2">
            <HealthBadge score={healthScore} />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => runScan.mutate()}
              disabled={runScan.isPending}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", runScan.isPending && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {issues.length === 0 ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-recovery/10 text-recovery">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-medium">Pipeline is clean. No issues found.</span>
          </div>
        ) : (
          <>
            {/* Summary row */}
            <div className="flex gap-3 text-xs">
              {criticalIssues.length > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  {criticalIssues.length} critical
                </span>
              )}
              {warningIssues.length > 0 && (
                <span className="flex items-center gap-1 text-status-yellow">
                  <Info className="h-3 w-3" />
                  {warningIssues.length} warnings
                </span>
              )}
              {summary.total_arr_at_risk > 0 && (
                <span className="text-muted-foreground">
                  {formatCurrency(summary.total_arr_at_risk)} at risk
                </span>
              )}
            </div>

            {/* Issues list */}
            <ScrollArea className="max-h-64">
              <div className="space-y-2">
                {issues.slice(0, 8).map((issue, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleIssueClick(issue)}
                    className={cn(
                      "p-2.5 rounded-lg text-sm w-full text-left transition-colors cursor-pointer",
                      "hover:ring-1 hover:ring-primary/30",
                      issue.severity === 'critical' ? 'bg-destructive/5 border border-destructive/20' : 'bg-muted/30'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {issue.record_type}
                          </Badge>
                          <span className="font-medium truncate text-xs">{issue.record_name}</span>
                          <ExternalLink className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                        </div>
                        <p className="text-xs text-muted-foreground">{issue.message}</p>
                        <p className="text-xs text-primary mt-1">{issue.suggested_action}</p>
                      </div>
                      {issue.arr_at_risk > 0 && (
                        <span className="text-xs font-mono text-destructive whitespace-nowrap">
                          {formatCurrency(issue.arr_at_risk)}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
                {issues.length > 8 && (
                  <p className="text-xs text-muted-foreground text-center py-1">
                    +{issues.length - 8} more issues
                  </p>
                )}
              </div>
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HealthBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-recovery bg-recovery/10' : score >= 50 ? 'text-status-yellow bg-status-yellow/10' : 'text-destructive bg-destructive/10';
  return (
    <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", color)}>
      {score}/100
    </span>
  );
}
