/**
 * Playbook Operating Dashboard
 *
 * Admin/ops view showing playbook system health, trust distribution,
 * usage, decomposition candidates, and regeneration queue.
 */
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { usePlaybooks, type Playbook } from '@/hooks/usePlaybooks';
import {
  type PlaybookModel,
  type PlaybookTrustStatus,
  type PlaybookStatus,
  scorePlaybookTrust,
  classifyPlaybookTrust,
  getPlaybookEligibility,
  detectDecompositionNeeds,
  type DecompositionSuggestion,
} from '@/lib/playbookLifecycle';
import {
  BookOpen,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Clock,
  TrendingDown,
  Merge,
  Split,
  BarChart3,
} from 'lucide-react';

function toPlaybookModel(p: Playbook): PlaybookModel {
  const trust = scorePlaybookTrust([], { usageCount: 0, acceptanceRate: 0, roleplaysCompleted: 0 }, 0, 0, p.created_at);
  return {
    id: p.id,
    title: p.title,
    problem_type: p.problem_type,
    trigger_conditions: p.when_to_use,
    use_cases: [],
    target_personas: p.persona_fit,
    applicable_stages: p.stage_fit,
    talk_tracks: p.talk_tracks,
    questions: p.key_questions,
    objection_handles: [],
    pressure_tactics: p.pressure_tactics,
    minimum_effective_version: p.minimum_effective_version,
    success_criteria: p.success_criteria,
    failure_consequences: p.failure_consequences,
    common_mistakes: p.common_mistakes,
    what_great_looks_like: p.what_great_looks_like,
    anti_patterns: p.anti_patterns,
    confidence_score: p.confidence_score,
    trust_status: classifyPlaybookTrust(trust, p.source_resource_ids.length, 'active'),
    trust_score: trust,
    status: 'active' as PlaybookStatus,
    version: 1,
    usage_count: 0,
    acceptance_rate: 0,
    derived_from_resource_ids: p.source_resource_ids,
    derived_from_cluster_id: null,
    last_generated_at: p.created_at,
    last_reconciled_at: null,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

const TRUST_COLORS: Record<PlaybookTrustStatus, string> = {
  trusted: 'bg-status-green/20 text-status-green',
  limited: 'bg-primary/20 text-primary',
  experimental: 'bg-status-yellow/20 text-status-yellow',
  stale: 'bg-muted text-muted-foreground',
  quarantined: 'bg-status-red/20 text-status-red',
  retired: 'bg-muted text-muted-foreground',
};

function StatCard({ label, value, icon: Icon, variant = 'default' }: {
  label: string; value: number; icon: React.ElementType; variant?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const variantClasses = {
    default: 'text-foreground',
    success: 'text-status-green',
    warning: 'text-status-yellow',
    danger: 'text-status-red',
  };
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
      <Icon className={`h-5 w-5 ${variantClasses[variant]}`} />
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export default function PlaybookOperatingDashboard() {
  const { data: rawPlaybooks = [] } = usePlaybooks();

  const { models, trustDist, decomps, eligibilityStats, topPlaybooks } = useMemo(() => {
    const models = rawPlaybooks.map(toPlaybookModel);
    const trustDist: Record<PlaybookTrustStatus, number> = { trusted: 0, limited: 0, experimental: 0, stale: 0, quarantined: 0, retired: 0 };
    const eligCounts: Record<string, number> = {};

    for (const m of models) {
      trustDist[m.trust_status]++;
      const elig = getPlaybookEligibility(m);
      for (const [purpose, ok] of Object.entries(elig)) {
        if (ok) eligCounts[purpose] = (eligCounts[purpose] ?? 0) + 1;
      }
    }

    const decomps = detectDecompositionNeeds(models);
    const topPlaybooks = [...models]
      .sort((a, b) => b.confidence_score - a.confidence_score)
      .slice(0, 5);

    return { models, trustDist, decomps, eligibilityStats: eligCounts, topPlaybooks };
  }, [rawPlaybooks]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Playbook Operating Dashboard</h2>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Playbooks" value={models.length} icon={BookOpen} />
        <StatCard label="Trusted" value={trustDist.trusted} icon={ShieldCheck} variant="success" />
        <StatCard label="Limited" value={trustDist.limited} icon={ShieldAlert} variant="warning" />
        <StatCard label="Stale / Quarantined" value={trustDist.stale + trustDist.quarantined} icon={AlertTriangle} variant="danger" />
      </div>

      {/* Trust Distribution */}
      <Card className="border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-foreground">Trust Distribution</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(trustDist).filter(([, v]) => v > 0).map(([status, count]) => (
              <Badge key={status} className={`${TRUST_COLORS[status as PlaybookTrustStatus]}`}>
                {status}: {count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top Playbooks */}
      <Card className="border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-foreground">Top Playbooks by Confidence</CardTitle></CardHeader>
        <CardContent>
          <ScrollArea className="max-h-48">
            <div className="space-y-2">
              {topPlaybooks.map(p => (
                <div key={p.id} className="flex justify-between items-center text-sm">
                  <span className="text-foreground truncate max-w-[60%]">{p.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge className={TRUST_COLORS[p.trust_status]}>{p.trust_status}</Badge>
                    <span className="text-muted-foreground">{p.confidence_score}%</span>
                  </div>
                </div>
              ))}
              {topPlaybooks.length === 0 && <p className="text-sm text-muted-foreground">No playbooks yet</p>}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Downstream Eligibility */}
      <Card className="border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-foreground">Downstream Eligibility</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(eligibilityStats).map(([purpose, count]) => (
              <div key={purpose} className="flex justify-between">
                <span className="text-muted-foreground">{purpose.replace(/_/g, ' ')}</span>
                <span className="text-foreground font-medium">{count}/{models.length}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Decomposition Suggestions */}
      {decomps.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-foreground">Decomposition Candidates</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="max-h-40">
              <div className="space-y-2">
                {decomps.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    {d.type === 'merge' ? <Merge className="h-4 w-4 text-primary mt-0.5" /> :
                     d.type === 'split' ? <Split className="h-4 w-4 text-status-yellow mt-0.5" /> :
                     <AlertTriangle className="h-4 w-4 text-status-red mt-0.5" />}
                    <span className="text-muted-foreground">{d.reason}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
