// Expected vs Actual - Today + Week-to-Date Progress
import { motion } from 'framer-motion';
import { Target, TrendingUp, TrendingDown, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

interface MetricRow {
  metric: string;
  expected: number;
  actual: number;
  gap: number;
  percentComplete: number;
  status: 'ahead' | 'on-track' | 'behind';
}

interface ExpectedVsActualCardProps {
  title: string;
  subtitle?: string;
  metrics: MetricRow[];
  pointsEarned: number;
  pointsTarget: number;
  isLoading?: boolean;
  compact?: boolean;
}

export function ExpectedVsActualCard({
  title,
  subtitle,
  metrics,
  pointsEarned,
  pointsTarget,
  isLoading,
  compact,
}: ExpectedVsActualCardProps) {
  const pointsPercentage = pointsTarget > 0 ? (pointsEarned / pointsTarget) * 100 : 0;
  const pointsStatus = pointsPercentage >= 100 ? 'ahead' : 
                       pointsPercentage >= 80 ? 'on-track' : 'behind';
  
  if (isLoading) {
    return (
      <div className={cn("metric-card animate-pulse", compact ? "p-4" : "p-6")}>
        <div className="h-5 bg-muted rounded w-1/3 mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-6 bg-muted rounded" />
          ))}
        </div>
      </div>
    );
  }
  
  return (
    <motion.div
      className={cn("metric-card h-full", compact ? "p-4" : "p-6")}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className={cn("flex items-center gap-2", compact ? "mb-3" : "mb-4")}>
        <Target className={cn(compact ? "h-4 w-4" : "h-5 w-5", "text-primary")} />
        <div>
          <h3 className={cn("font-display font-semibold", compact ? "text-sm" : "text-base")}>{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      
      {/* Points Summary */}
      <div className={cn(
        "rounded-lg",
        compact ? "p-3 mb-3" : "p-4 mb-4",
        pointsStatus === 'ahead' ? "bg-status-green/10" :
        pointsStatus === 'on-track' ? "bg-status-yellow/10" : "bg-status-red/10"
      )}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium">Points</span>
          <div className="flex items-center gap-1">
            <span className={cn(
              "font-bold",
              compact ? "text-lg" : "text-2xl",
              pointsStatus === 'ahead' ? "text-status-green" :
              pointsStatus === 'on-track' ? "text-status-yellow" : "text-status-red"
            )}>
              {pointsEarned}
            </span>
            <span className="text-xs text-muted-foreground">/ {pointsTarget}</span>
          </div>
        </div>
        <Progress 
          value={Math.min(pointsPercentage, 100)} 
          className="h-1.5"
        />
        <div className="flex items-center justify-between mt-1.5 text-xs">
          <span className={cn(
            "flex items-center gap-1",
            pointsStatus === 'ahead' ? "text-status-green" :
            pointsStatus === 'on-track' ? "text-status-yellow" : "text-status-red"
          )}>
            {pointsStatus === 'ahead' ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                Ahead
              </>
            ) : pointsStatus === 'on-track' ? (
              <>
                <TrendingUp className="h-3 w-3" />
                On track
              </>
            ) : (
              <>
                <TrendingDown className="h-3 w-3" />
                -{pointsTarget - pointsEarned}
              </>
            )}
          </span>
          <span className="text-muted-foreground">
            {pointsPercentage.toFixed(0)}%
          </span>
        </div>
      </div>
      
      {/* Metric Breakdown - show fewer in compact mode */}
      <div className="space-y-1.5">
        {metrics.length === 0 ? (
          <div className="text-center py-3 text-muted-foreground text-xs">
            No activity data yet
          </div>
        ) : (
          metrics
            .filter(m => m.metric !== 'Points')
            .slice(0, compact ? 2 : undefined)
            .map((metric) => (
            <div 
              key={metric.metric}
              className="flex items-center justify-between p-1.5 rounded-lg bg-secondary/30"
            >
              <div className="flex items-center gap-1.5">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  metric.status === 'ahead' ? "bg-status-green" :
                  metric.status === 'on-track' ? "bg-status-yellow" : "bg-status-red"
                )} />
                <span className="text-xs">{metric.metric}</span>
              </div>
              <span className="text-xs font-mono">
                <span className={cn(
                  "font-semibold",
                  metric.status === 'ahead' ? "text-status-green" :
                  metric.status === 'on-track' ? "text-foreground" : "text-status-red"
                )}>
                  {metric.actual}
                </span>
                <span className="text-muted-foreground">/{metric.expected}</span>
              </span>
            </div>
          ))
        )}
      </div>
      
      {/* Quickest catch-up hint - only show in non-compact mode */}
      {!compact && pointsStatus === 'behind' && (
        <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/10">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-primary">Quickest catch-up:</span>{' '}
            {getQuickestCatchUp(metrics)}
          </p>
        </div>
      )}
    </motion.div>
  );
}

function getQuickestCatchUp(metrics: MetricRow[]): string {
  // Find the metric with the smallest absolute gap that's behind
  const behindMetrics = metrics.filter(m => m.status === 'behind' && m.gap > 0);
  
  if (behindMetrics.length === 0) return 'You\'re on track!';
  
  // Prioritize high-point metrics
  const sorted = behindMetrics.sort((a, b) => {
    // Conversations are worth 1 point each
    if (a.metric === 'Conversations') return -1;
    if (b.metric === 'Conversations') return 1;
    // Meetings are worth 1 point each
    if (a.metric === 'Meetings Set') return -1;
    if (b.metric === 'Meetings Set') return 1;
    return a.gap - b.gap;
  });
  
  const top = sorted[0];
  return `+${top.gap} more ${top.metric.toLowerCase()} to close the gap`;
}
