// Commission Pacing Detail Modal - Full breakdown and action plan
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  Zap,
  Target,
  Calendar,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/commissionCalculations';
import { Button } from '@/components/ui/button';

interface CommissionPacingDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectedCommission: number;
  currentCommission: number;
  weeklyPaceTrend: number;
  projectedAttainment: number;
  benchmarks: {
    pace30d: number;
    pace6m: number;
    paceRequired: number;
  };
  drivers: Array<{
    name: string;
    trend: 'up' | 'down' | 'stable';
    impact: number;
    current: number;
    target: number;
  }>;
  actionPlan: Array<{
    action: string;
    target: string;
    timeframe: string;
    workflow: string;
    impact: string;
  }>;
  sensitivityAnalysis: Array<{
    lever: string;
    increment: number;
    unit: string;
    commissionImpact: number;
  }>;
}

export function CommissionPacingDetailModal({
  open,
  onOpenChange,
  projectedCommission,
  currentCommission,
  weeklyPaceTrend,
  projectedAttainment,
  benchmarks,
  drivers,
  actionPlan,
  sensitivityAnalysis,
}: CommissionPacingDetailModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <DollarSign className="h-5 w-5 text-status-green" />
            Commission Pacing Details
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Summary Row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-status-green/10">
              <div className="text-xs text-muted-foreground mb-1">Projected Q-End</div>
              <div className="text-2xl font-bold text-status-green">
                {formatCurrency(projectedCommission)}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-muted">
              <div className="text-xs text-muted-foreground mb-1">Earned YTD</div>
              <div className="text-2xl font-bold">
                {formatCurrency(currentCommission)}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-muted">
              <div className="text-xs text-muted-foreground mb-1">Weekly Pace</div>
              <div className={cn(
                "text-2xl font-bold flex items-center gap-1",
                weeklyPaceTrend >= 0 ? "text-status-green" : "text-status-red"
              )}>
                {weeklyPaceTrend >= 0 ? '+' : ''}{formatCurrency(weeklyPaceTrend)}
                {weeklyPaceTrend >= 0 ? (
                  <TrendingUp className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
              </div>
            </div>
          </div>
          
          {/* Benchmarks */}
          <div>
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              Pace Benchmarks ($/week)
            </h4>
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg border">
                <div className="text-xs text-muted-foreground mb-1">Rolling 30D</div>
                <div className="text-lg font-semibold">{formatCurrency(benchmarks.pace30d)}</div>
              </div>
              <div className="p-3 rounded-lg border">
                <div className="text-xs text-muted-foreground mb-1">Rolling 6M</div>
                <div className="text-lg font-semibold">{formatCurrency(benchmarks.pace6m)}</div>
              </div>
              <div className="p-3 rounded-lg border border-primary/30 bg-primary/5">
                <div className="text-xs text-muted-foreground mb-1">Required for 100%</div>
                <div className="text-lg font-semibold text-primary">
                  {formatCurrency(benchmarks.paceRequired)}
                </div>
              </div>
            </div>
          </div>
          
          {/* What's Driving Pace */}
          <div>
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <Zap className="h-4 w-4 text-status-yellow" />
              What's Driving Pace
            </h4>
            <div className="space-y-2">
              {drivers.map((driver) => (
                <div 
                  key={driver.name}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/30"
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center",
                      driver.trend === 'up' ? "bg-status-green/10" :
                      driver.trend === 'down' ? "bg-status-red/10" : "bg-muted"
                    )}>
                      {driver.trend === 'up' ? (
                        <TrendingUp className="h-4 w-4 text-status-green" />
                      ) : driver.trend === 'down' ? (
                        <TrendingDown className="h-4 w-4 text-status-red" />
                      ) : (
                        <Target className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <div className="font-medium">{driver.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {driver.current.toFixed(1)} avg / {driver.target.toFixed(1)} target
                      </div>
                    </div>
                  </div>
                  <div className={cn(
                    "text-sm font-medium",
                    driver.impact >= 0 ? "text-status-green" : "text-status-red"
                  )}>
                    {driver.impact >= 0 ? '+' : ''}{formatCurrency(driver.impact)}/wk
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Sensitivity Analysis */}
          <div>
            <h4 className="font-semibold mb-3">If You Do X, You Make $Y</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {sensitivityAnalysis.map((item) => (
                <div key={item.lever} className="p-3 rounded-lg bg-muted">
                  <div className="text-sm text-muted-foreground mb-1">
                    +{item.increment} {item.unit}
                  </div>
                  <div className="text-lg font-semibold text-status-green">
                    +{formatCurrency(item.commissionImpact)}
                  </div>
                  <div className="text-xs text-muted-foreground">{item.lever}</div>
                </div>
              ))}
            </div>
          </div>
          
          {/* 7-Day Action Plan */}
          <div>
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Next 7 Days Commission Plan
            </h4>
            <div className="space-y-3">
              {actionPlan.map((action, idx) => (
                <motion.div
                  key={idx}
                  className="p-4 rounded-lg border bg-card"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-primary">{idx + 1}</span>
                    </div>
                    <div className="flex-1">
                      <div className="font-medium mb-1">{action.action}</div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Target:</span>{' '}
                          <span className="font-medium">{action.target}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Timeframe:</span>{' '}
                          <span className="font-medium">{action.timeframe}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Workflow:</span>{' '}
                          <span className="font-medium">{action.workflow}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Impact:</span>{' '}
                          <span className="font-medium text-status-green">{action.impact}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
