// Sales Age Detail Modal - Driver attribution and trends
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, TrendingUp, TrendingDown, Minus, Target, Zap, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import type { SalesAgeResult, ActionRecommendation } from '@/lib/salesAgeCalculations';

interface SalesAgeDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  salesAge: SalesAgeResult | undefined;
  recommendations: ActionRecommendation[];
  snapshotHistory: SalesAgeSnapshot[];
}

function DriverRow({ driver }: { driver: SalesAgeResult['qpi']['drivers'][0] }) {
  const DirectionIcon = driver.direction === 'up' 
    ? TrendingUp 
    : driver.direction === 'down' 
      ? TrendingDown 
      : Minus;
  
  const directionColors = {
    up: 'text-status-green',
    down: 'text-status-red',
    stable: 'text-muted-foreground',
  };
  
  const scorePercent = Math.min(driver.normalizedScore * 100, 150);
  const isBelow = driver.normalizedScore < 1.0;

  return (
    <div className="p-3 rounded-lg border bg-card space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">{driver.name}</span>
        <div className="flex items-center gap-2">
          <DirectionIcon className={cn("h-4 w-4", directionColors[driver.direction])} />
          <span className={cn(
            "text-sm font-medium",
            isBelow ? 'text-status-red' : 'text-status-green'
          )}>
            {(driver.normalizedScore * 100).toFixed(0)}%
          </span>
        </div>
      </div>
      
      <Progress value={Math.min(scorePercent, 100)} className="h-1.5" />
      
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Avg: {driver.value.toFixed(1)}/day</span>
        <span>Target: {driver.target.toFixed(1)}/day</span>
      </div>
      
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">
          Prior: {driver.priorValue.toFixed(1)}/day
        </span>
        <span className={cn(
          "font-medium",
          driver.contribution >= 0.1 ? 'text-status-green' : 
          driver.contribution >= 0.05 ? 'text-status-yellow' : 'text-muted-foreground'
        )}>
          +{(driver.contribution * 100).toFixed(1)}% QPI
        </span>
      </div>
    </div>
  );
}

export function SalesAgeDetailModal({ 
  open, 
  onOpenChange, 
  salesAge,
  recommendations,
  snapshotHistory,
}: SalesAgeDetailModalProps) {
  if (!salesAge) return null;

  const { salesAge: age, paceOfAging, status, qpi, benchmark30d, benchmark6m, projectedFinish30d, projectedFinish6m } = salesAge;
  
  const statusColors = {
    improving: 'text-status-green bg-status-green/10',
    stable: 'text-status-yellow bg-status-yellow/10',
    declining: 'text-status-red bg-status-red/10',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Sales Age Detail
          </DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="summary" className="mt-4">
          <TabsList className="w-full">
            <TabsTrigger value="summary" className="flex-1">Summary</TabsTrigger>
            <TabsTrigger value="drivers" className="flex-1">Drivers</TabsTrigger>
            <TabsTrigger value="actions" className="flex-1">Actions</TabsTrigger>
          </TabsList>
          
          {/* Summary Tab */}
          <TabsContent value="summary" className="space-y-4 mt-4">
            {/* Main Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <div className="text-xs text-muted-foreground mb-1">Sales Age</div>
                <div className="text-4xl font-bold">{age}</div>
                <div className="text-xs text-muted-foreground">years</div>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <div className="text-xs text-muted-foreground mb-1">Pace of Aging</div>
                <div className={cn(
                  "text-2xl font-bold",
                  paceOfAging < 0 ? 'text-status-green' : 
                  paceOfAging > 0 ? 'text-status-red' : 'text-muted-foreground'
                )}>
                  {paceOfAging > 0 ? '+' : ''}{paceOfAging.toFixed(1)}
                </div>
                <div className="text-xs text-muted-foreground">per week</div>
              </div>
              <div className="p-4 rounded-lg text-center">
                <div className="text-xs text-muted-foreground mb-1">Status</div>
                <div className={cn(
                  "text-lg font-semibold px-3 py-1 rounded-full inline-block",
                  statusColors[status]
                )}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </div>
              </div>
            </div>
            
            {/* Projections */}
            <div className="p-4 rounded-lg border">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                Projections
              </h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">At 30D pace:</div>
                  <div className={cn(
                    "font-semibold text-lg",
                    projectedFinish30d >= 100 ? 'text-status-green' : 'text-status-yellow'
                  )}>
                    {projectedFinish30d.toFixed(0)}% of quota
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">At 6M pace:</div>
                  <div className={cn(
                    "font-semibold text-lg",
                    projectedFinish6m >= 100 ? 'text-status-green' : 'text-status-yellow'
                  )}>
                    {projectedFinish6m.toFixed(0)}% of quota
                  </div>
                </div>
              </div>
            </div>
            
            {/* Benchmarks */}
            <div className="p-4 rounded-lg border">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Benchmarks vs Quota-Required (1.0)
              </h4>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">30D QPI</span>
                    <span className={cn(
                      "font-medium",
                      benchmark30d >= 1.0 ? 'text-status-green' : 'text-status-yellow'
                    )}>
                      {benchmark30d.toFixed(2)}
                    </span>
                  </div>
                  <Progress value={Math.min(benchmark30d * 100, 150)} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">6M QPI</span>
                    <span className={cn(
                      "font-medium",
                      benchmark6m >= 1.0 ? 'text-status-green' : 'text-status-yellow'
                    )}>
                      {benchmark6m.toFixed(2)}
                    </span>
                  </div>
                  <Progress value={Math.min(benchmark6m * 100, 150)} className="h-2" />
                </div>
              </div>
              
              {benchmark30d < 1.0 && benchmark6m >= benchmark30d && (
                <p className="text-xs text-status-yellow mt-3 p-2 bg-status-yellow/10 rounded">
                  Even though you're consistent, your 30D pace is below quota-required pace, so you are falling further behind.
                </p>
              )}
            </div>
          </TabsContent>
          
          {/* Drivers Tab */}
          <TabsContent value="drivers" className="space-y-3 mt-4">
            <p className="text-sm text-muted-foreground">
              Top drivers contributing to your QPI score. Higher is better.
            </p>
            {qpi.drivers.map(driver => (
              <DriverRow key={driver.key} driver={driver} />
            ))}
          </TabsContent>
          
          {/* Actions Tab */}
          <TabsContent value="actions" className="space-y-3 mt-4">
            <p className="text-sm text-muted-foreground">
              Next 7 days action plan to improve your Sales Age.
            </p>
            {recommendations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Complete more Daily Check-Ins to get personalized actions</p>
              </div>
            ) : (
              recommendations.map((rec, index) => (
                <div key={rec.id} className="p-4 rounded-lg border bg-card">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold">
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium">{rec.action}</h4>
                      <div className="text-sm text-muted-foreground mt-1 space-y-1">
                        <p><span className="font-medium">Target:</span> {rec.target}</p>
                        <p><span className="font-medium">Timeframe:</span> {rec.timeframe}</p>
                        <p><span className="font-medium">Why:</span> {rec.why}</p>
                        <p className="text-primary font-medium mt-2">
                          <Zap className="h-3 w-3 inline mr-1" />
                          {rec.impact}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
