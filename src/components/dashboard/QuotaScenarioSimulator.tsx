// Quota Scenario Simulator — "What-if" deal modeling for P-Club trajectory
import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { useStore } from '@/store/useStore';
import { useConversionMath } from '@/hooks/useCoachingEngine';
import { Calculator, Plus, X, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScenarioDeal {
  id: string;
  name: string;
  arr: number;
  probability: number;
  type: 'new-logo' | 'renewal';
}

function formatCurrency(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// FIX: Proper stage-to-probability mapping matching actual app stages
const STAGE_PROBABILITY: Record<string, number> = {
  'Prospect': 10,
  'Discover': 20,
  'Demo': 40,
  'Proposal': 60,
  'Negotiate': 80,
  'Closed Won': 100,
  'Closed Lost': 0,
};

function stageToProbability(stage: string | undefined | null): number {
  if (!stage) return 15;
  return STAGE_PROBABILITY[stage] ?? 15;
}

export function QuotaScenarioSimulator() {
  const { data: conversionData } = useConversionMath();
  const opportunities = useStore(s => s.opportunities);
  const [scenarioDeals, setScenarioDeals] = useState<ScenarioDeal[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Start from active pipeline
  const activePipelineDeals = useMemo(() =>
    opportunities
      .filter(o => o.status === 'active' && o.arr)
      .map(o => ({
        id: o.id,
        name: o.name,
        arr: o.arr || 0,
        probability: stageToProbability(o.stage),
        // FIX: handle null isNewLogo explicitly
        type: (o.isNewLogo === true ? 'new-logo' : 'renewal') as 'new-logo' | 'renewal',
      })),
    [opportunities]
  );

  const allDeals = [...activePipelineDeals, ...scenarioDeals];

  const scenarios = useMemo(() => {
    if (!conversionData) return null;

    const { quota } = conversionData;
    const totalQuota = quota.newArrQuota + quota.renewalArrQuota;
    const currentClosed = quota.newArrClosed + quota.renewalArrClosed;

    const bestCase = allDeals.reduce((s, d) => s + d.arr, 0) + currentClosed;
    const weightedCase = allDeals.reduce((s, d) => s + d.arr * (d.probability / 100), 0) + currentClosed;
    const worstCase = allDeals.filter(d => d.probability >= 70).reduce((s, d) => s + d.arr, 0) + currentClosed;

    return {
      totalQuota,
      currentClosed,
      bestCase: { total: bestCase, attainment: totalQuota > 0 ? bestCase / totalQuota : 0, pclub: bestCase >= totalQuota },
      weightedCase: { total: weightedCase, attainment: totalQuota > 0 ? weightedCase / totalQuota : 0, pclub: weightedCase >= totalQuota },
      worstCase: { total: worstCase, attainment: totalQuota > 0 ? worstCase / totalQuota : 0, pclub: worstCase >= totalQuota },
      gapToClose: totalQuota - weightedCase,
    };
  }, [allDeals, conversionData]);

  const addDeal = () => {
    setScenarioDeals(prev => [...prev, {
      id: `scenario-${Date.now()}`,
      name: '',
      arr: 50000,
      probability: 30,
      type: 'new-logo',
    }]);
  };

  const removeDeal = (id: string) => {
    setScenarioDeals(prev => prev.filter(d => d.id !== id));
  };

  const updateDeal = (id: string, field: string, value: any) => {
    setScenarioDeals(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d));
  };

  if (!conversionData || !scenarios) {
    return (
      <Card className="metric-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            Scenario Simulator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground text-center py-4">
            Set up your quota targets and conversion benchmarks in Settings to enable scenario modeling.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="metric-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            Scenario Simulator
          </CardTitle>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Collapse' : 'What-If'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Scenario summary bars */}
        <div className="space-y-2">
          <ScenarioBar label="Best Case" value={scenarios.bestCase.attainment} pclub={scenarios.bestCase.pclub} amount={scenarios.bestCase.total} />
          <ScenarioBar label="Weighted" value={scenarios.weightedCase.attainment} pclub={scenarios.weightedCase.pclub} amount={scenarios.weightedCase.total} highlight />
          <ScenarioBar label="Commit" value={scenarios.worstCase.attainment} pclub={scenarios.worstCase.pclub} amount={scenarios.worstCase.total} />
        </div>

        {scenarios.gapToClose > 0 && (
          <div className="text-xs text-muted-foreground text-center">
            {formatCurrency(scenarios.gapToClose)} gap to close (weighted) • Add "what-if" deals below
          </div>
        )}

        {expanded && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Pipeline ({activePipelineDeals.length} active) + Scenarios ({scenarioDeals.length})
            </div>

            {/* Active pipeline summary */}
            {activePipelineDeals.length > 0 && (
              <div className="space-y-1 mb-2">
                {activePipelineDeals.slice(0, 5).map(deal => (
                  <div key={deal.id} className="flex items-center justify-between text-xs p-1.5 rounded bg-muted/10">
                    <span className="truncate flex-1">{deal.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-muted-foreground">{deal.probability}%</span>
                      <span className="font-mono">{formatCurrency(deal.arr)}</span>
                    </div>
                  </div>
                ))}
                {activePipelineDeals.length > 5 && (
                  <p className="text-[10px] text-muted-foreground text-center">+{activePipelineDeals.length - 5} more</p>
                )}
              </div>
            )}

            {/* Scenario deals */}
            {scenarioDeals.map(deal => (
              <div key={deal.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/30">
                <Input
                  placeholder="Deal name"
                  value={deal.name}
                  onChange={e => updateDeal(deal.id, 'name', e.target.value)}
                  className="h-7 text-xs flex-1"
                />
                <Input
                  type="number"
                  value={deal.arr}
                  onChange={e => updateDeal(deal.id, 'arr', Number(e.target.value))}
                  className="h-7 text-xs w-24"
                  placeholder="ARR"
                />
                <div className="flex items-center gap-1 w-24">
                  <Slider
                    value={[deal.probability]}
                    onValueChange={([v]) => updateDeal(deal.id, 'probability', v)}
                    max={100}
                    step={10}
                    className="flex-1"
                  />
                  <span className="text-[10px] text-muted-foreground w-8">{deal.probability}%</span>
                </div>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeDeal(deal.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}

            <Button variant="outline" size="sm" className="w-full text-xs" onClick={addDeal}>
              <Plus className="h-3 w-3 mr-1" /> Add What-If Deal
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScenarioBar({ label, value, pclub, amount, highlight }: {
  label: string; value: number; pclub: boolean; amount: number; highlight?: boolean
}) {
  const pct = Math.min(value * 100, 150);
  return (
    <div className={cn("p-2 rounded-lg", highlight ? "bg-primary/5 border border-primary/20" : "bg-muted/20")}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className={cn("text-sm font-bold font-display", pclub ? "text-recovery" : "text-muted-foreground")}>
            {(value * 100).toFixed(0)}%
          </span>
          {pclub && <Trophy className="h-3 w-3 text-recovery" />}
          <span className="text-[10px] text-muted-foreground">{formatCurrency(amount)}</span>
        </div>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pclub ? "bg-recovery" : value >= 0.8 ? "bg-primary" : "bg-strain"
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
