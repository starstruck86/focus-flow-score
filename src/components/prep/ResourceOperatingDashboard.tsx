/**
 * Resource Operating Dashboard — infrastructure-level visibility
 * into the resource enrichment system's health and performance.
 */
import { memo, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Shield, ShieldAlert, ShieldOff, Clock, AlertTriangle,
  CheckCircle2, XCircle, TrendingUp, Zap, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  assessBatch,
  getTrustStatusLabel,
  getTrustStatusColor,
  type TrustStatus,
  type DownstreamPurpose,
  type ResourceForTrust,
} from '@/lib/resourceTrust';
import { getCostSummary } from '@/lib/resourceStrategyPlanner';
import type { Resource } from '@/hooks/useResources';

interface Props {
  resources: Resource[];
}

// Map Resource to ResourceForTrust shape
function toTrustResource(r: Resource): ResourceForTrust {
  const any = r as any;
  return {
    id: r.id,
    title: r.title,
    content: any.content ?? null,
    content_length: any.content_length ?? null,
    enrichment_status: any.enrichment_status ?? 'not_enriched',
    enrichment_version: any.enrichment_version ?? 0,
    validation_version: any.validation_version ?? 0,
    enriched_at: any.enriched_at ?? null,
    failure_reason: any.failure_reason ?? null,
    file_url: r.file_url ?? null,
    resource_type: any.resource_type,
    description: any.description ?? null,
    last_quality_score: any.last_quality_score ?? null,
    last_quality_tier: any.last_quality_tier ?? null,
    failure_count: any.failure_count ?? 0,
    last_reconciled_at: any.last_reconciled_at ?? null,
  };
}

const TRUST_ICONS: Record<TrustStatus, typeof Shield> = {
  trusted: Shield,
  limited: ShieldAlert,
  suspect: AlertTriangle,
  stale: Clock,
  quarantined: ShieldOff,
};

const PURPOSE_LABELS: Record<DownstreamPurpose, string> = {
  search: 'Search',
  library_display: 'Library',
  summary_generation: 'Summaries',
  dave_grounding: 'Dave AI',
  playbook_generation: 'Playbooks',
  roleplay: 'Roleplay',
  weekly_insights: 'Insights',
  strategic_recommendations: 'Strategy',
  deal_intelligence: 'Deal Intel',
};

export const ResourceOperatingDashboard = memo(function ResourceOperatingDashboard({ resources }: Props) {
  const trustResources = useMemo(() => resources.map(toTrustResource), [resources]);
  const batchReport = useMemo(() => assessBatch(trustResources), [trustResources]);
  const costSummary = useMemo(() => getCostSummary(), []);

  const total = trustResources.length;
  if (total === 0) return null;

  const enrichedCount = trustResources.filter(r => r.enrichment_status === 'deep_enriched').length;
  const enrichedPct = Math.round((enrichedCount / total) * 100);
  const trustedPct = Math.round((batchReport.distribution.trusted / total) * 100);

  return (
    <div className="space-y-4">
      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Resources" value={total} icon={<Eye className="h-4 w-4 text-muted-foreground" />} />
        <StatCard label="Enriched" value={`${enrichedPct}%`} sub={`${enrichedCount} of ${total}`} icon={<Zap className="h-4 w-4 text-primary" />} />
        <StatCard label="Trusted" value={`${trustedPct}%`} sub={`${batchReport.distribution.trusted} resources`} icon={<Shield className="h-4 w-4 text-status-green" />} />
        <StatCard label="Avg Trust Score" value={batchReport.avgTrustScore} sub="/100" icon={<TrendingUp className="h-4 w-4 text-status-yellow" />} />
      </div>

      {/* Trust Distribution */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Trust Distribution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(Object.entries(batchReport.distribution) as [TrustStatus, number][]).map(([status, count]) => {
            const Icon = TRUST_ICONS[status];
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div key={status} className="flex items-center gap-3">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs font-medium w-20">{getTrustStatusLabel(status)}</span>
                <Progress value={pct} className="h-1.5 flex-1" />
                <Badge variant="outline" className={cn('text-[10px] min-w-[52px] justify-center', getTrustStatusColor(status))}>
                  {count} ({pct}%)
                </Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Downstream Eligibility */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Downstream Eligibility</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            {(Object.entries(batchReport.eligibilitySummary) as [DownstreamPurpose, number][]).map(([purpose, count]) => {
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={purpose} className="text-center p-2 rounded-md bg-muted/50">
                  <div className="text-lg font-bold text-foreground">{pct}%</div>
                  <div className="text-[10px] text-muted-foreground">{PURPOSE_LABELS[purpose]}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Top Failure Categories */}
      {batchReport.topFailureCategories.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Top Failure Categories</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {batchReport.topFailureCategories.slice(0, 5).map((fc, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate max-w-[70%]">{fc.reason}</span>
                <Badge variant="outline" className="text-[10px] bg-status-red/10 text-status-red">
                  {fc.count}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Cost Summary */}
      {costSummary.totalAttempts > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Cost & Efficiency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">Total Attempts</span>
                <div className="text-lg font-bold text-foreground">{costSummary.totalAttempts}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Success Rate</span>
                <div className="text-lg font-bold text-foreground">
                  {costSummary.totalAttempts > 0 ? Math.round((costSummary.totalSuccesses / costSummary.totalAttempts) * 100) : 0}%
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Cost/Trusted Success</span>
                <div className="text-lg font-bold text-foreground">{costSummary.costPerTrustedSuccess}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Total Est. Cost</span>
                <div className="text-lg font-bold text-foreground">{costSummary.totalEstimatedCost}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
});

function StatCard({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon: React.ReactNode }) {
  return (
    <Card className="border-border">
      <CardContent className="p-3 flex items-center gap-3">
        {icon}
        <div>
          <div className="text-lg font-bold text-foreground leading-tight">{value}{sub && <span className="text-xs text-muted-foreground">{sub}</span>}</div>
          <div className="text-[10px] text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
