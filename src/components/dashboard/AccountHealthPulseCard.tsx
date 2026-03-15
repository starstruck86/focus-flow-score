// Account Health Pulse — unified score ranking all accounts
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { useAccountHealthPulse, AccountHealthPulse } from '@/hooks/useAccountHealthPulse';
import { Activity, Flame, ThermometerSun, Snowflake, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const TIER_CONFIG = {
  hot: { icon: Flame, color: 'text-destructive', bg: 'bg-destructive/10', label: 'Hot' },
  warm: { icon: ThermometerSun, color: 'text-amber-500', bg: 'bg-amber-500/10', label: 'Warm' },
  cool: { icon: Activity, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Cool' },
  cold: { icon: Snowflake, color: 'text-muted-foreground', bg: 'bg-muted/30', label: 'Cold' },
};

function ScoreBar({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-16 shrink-0">{label}</span>
      <Progress value={(value / max) * 100} className="h-1 flex-1" />
      <span className="text-[10px] font-mono w-6 text-right">{value}</span>
    </div>
  );
}

export function AccountHealthPulseCard() {
  const { data: accounts, isLoading } = useAccountHealthPulse();

  const top10 = (accounts || []).slice(0, 10);
  const tierCounts = {
    hot: (accounts || []).filter(a => a.tier === 'hot').length,
    warm: (accounts || []).filter(a => a.tier === 'warm').length,
    cool: (accounts || []).filter(a => a.tier === 'cool').length,
    cold: (accounts || []).filter(a => a.tier === 'cold').length,
  };

  return (
    <Card className="metric-card border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Account Health Pulse
          </CardTitle>
          <div className="flex items-center gap-1">
            {(['hot', 'warm', 'cool', 'cold'] as const).map(tier => {
              const cfg = TIER_CONFIG[tier];
              return tierCounts[tier] > 0 ? (
                <Badge key={tier} variant="outline" className={cn("text-[9px] px-1.5 gap-0.5", cfg.bg, cfg.color)}>
                  <cfg.icon className="h-2.5 w-2.5" />{tierCounts[tier]}
                </Badge>
              ) : null;
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : top10.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="h-10 w-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No accounts to score</p>
            <p className="text-xs mt-1">Add accounts and enrich them to see health scores</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[450px]">
            <div className="space-y-2">
              {top10.map((acct, idx) => {
                const cfg = TIER_CONFIG[acct.tier];
                const TierIcon = cfg.icon;
                return (
                  <div key={acct.accountId} className={cn("p-3 rounded-lg border transition-all hover:bg-muted/30", cfg.bg)}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-muted-foreground font-mono">#{idx + 1}</span>
                        <TierIcon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
                        <span className="text-sm font-semibold truncate">{acct.accountName}</span>
                      </div>
                      <Badge variant={acct.overallScore >= 75 ? 'default' : 'outline'} className="text-[10px] font-mono shrink-0">
                        {acct.overallScore}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <ScoreBar label="ICP Fit" value={acct.icpFit} />
                      <ScoreBar label="Timing" value={acct.timingScore} />
                      <ScoreBar label="Contacts" value={acct.stakeholderCoverage} />
                      <ScoreBar label="Signals" value={acct.signalStrength} />
                      <ScoreBar label="Engaged" value={acct.engagementRecency} />
                    </div>
                    {acct.topGap !== 'Well covered' && (
                      <div className="flex items-center gap-1 mt-2 text-[10px] text-amber-500">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {acct.topGap}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
