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
}

export function ExpectedVsActualCard({
  title,
  subtitle,
  metrics,
  pointsEarned,
  pointsTarget,
  isLoading,
}: ExpectedVsActualCardProps) {
  const pointsPercentage = pointsTarget > 0 ? (pointsEarned / pointsTarget) * 100 : 0;
  const pointsStatus = pointsPercentage >= 100 ? 'ahead' : 
                       pointsPercentage >= 80 ? 'on-track' : 'behind';
  
  if (isLoading) {
    return (
      <div className="metric-card p-6 animate-pulse">
        <div className="h-6 bg-muted rounded w-1/3 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-8 bg-muted rounded" />
          ))}
        </div>
      </div>
    );
  }
  
  return (
    <motion.div
      className="metric-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Target className="h-5 w-5 text-primary" />
        <div>
          <h3 className="font-display font-semibold">{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      
      {/* Points Summary */}
      <div className={cn(
        "p-4 rounded-lg mb-4",
        pointsStatus === 'ahead' ? "bg-status-green/10" :
        pointsStatus === 'on-track' ? "bg-status-yellow/10" : "bg-status-red/10"
      )}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Points Earned</span>
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-2xl font-bold",
              pointsStatus === 'ahead' ? "text-status-green" :
              pointsStatus === 'on-track' ? "text-status-yellow" : "text-status-red"
            )}>
              {pointsEarned}
            </span>
            <span className="text-sm text-muted-foreground">/ {pointsTarget}</span>
          </div>
        </div>
        <Progress 
          value={Math.min(pointsPercentage, 100)} 
          className="h-2"
        />
        <div className="flex items-center justify-between mt-2 text-xs">
          <span className={cn(
            "flex items-center gap-1",
            pointsStatus === 'ahead' ? "text-status-green" :
            pointsStatus === 'on-track' ? "text-status-yellow" : "text-status-red"
          )}>
            {pointsStatus === 'ahead' ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                Ahead of target
              </>
            ) : pointsStatus === 'on-track' ? (
              <>
                <TrendingUp className="h-3 w-3" />
                On track
              </>
            ) : (
              <>
                <TrendingDown className="h-3 w-3" />
                Behind by {pointsTarget - pointsEarned} pts
              </>
            )}
          </span>
          <span className="text-muted-foreground">
            {pointsPercentage.toFixed(0)}% complete
          </span>
        </div>
      </div>
      
      {/* Metric Breakdown */}
      <div className="space-y-2">
        {metrics
          .filter(m => m.metric !== 'Points')
          .map((metric, idx) => (
          <div 
            key={metric.metric}
            className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full",
                metric.status === 'ahead' ? "bg-status-green" :
                metric.status === 'on-track' ? "bg-status-yellow" : "bg-status-red"
              )} />
              <span className="text-sm">{metric.metric}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono">
                <span className={cn(
                  "font-semibold",
                  metric.status === 'ahead' ? "text-status-green" :
                  metric.status === 'on-track' ? "text-foreground" : "text-status-red"
                )}>
                  {metric.actual}
                </span>
                <span className="text-muted-foreground"> / {metric.expected}</span>
              </span>
              {metric.gap > 0 && (
                <span className="text-xs text-status-red">
                  -{metric.gap}
                </span>
              )}
              {metric.gap < 0 && (
                <span className="text-xs text-status-green">
                  +{Math.abs(metric.gap)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {/* Smallest lever to catch up */}
      {pointsStatus === 'behind' && (
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
