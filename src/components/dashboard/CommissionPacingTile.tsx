// Commission Pacing Tile - Top dashboard metric (replaces Sales Age)
import { motion } from 'framer-motion';
import { DollarSign, TrendingUp, TrendingDown, Minus, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/commissionCalculations';

interface CommissionPacingTileProps {
  projectedQuarterCommission: number;
  weeklyPaceTrend: number; // +/- $/week
  projectedAttainment: number; // 0-1.5+
  status: 'improving' | 'stable' | 'declining';
  isLoading?: boolean;
  onClick?: () => void;
  compact?: boolean;
}

export function CommissionPacingTile({
  projectedQuarterCommission,
  weeklyPaceTrend,
  projectedAttainment,
  status,
  isLoading,
  onClick,
  compact,
}: CommissionPacingTileProps) {
  const statusConfig = {
    improving: {
      label: 'Improving',
      color: 'text-status-green',
      bgColor: 'bg-status-green/10',
      icon: TrendingUp,
    },
    stable: {
      label: 'Stable',
      color: 'text-status-yellow',
      bgColor: 'bg-status-yellow/10',
      icon: Minus,
    },
    declining: {
      label: 'Declining',
      color: 'text-status-red',
      bgColor: 'bg-status-red/10',
      icon: TrendingDown,
    },
  };
  
  const config = statusConfig[status];
  const StatusIcon = config.icon;
  
  if (isLoading) {
    return (
      <div className="metric-card p-6 animate-pulse">
        <div className="h-6 bg-muted rounded w-1/3 mb-4" />
        <div className="h-12 bg-muted rounded w-1/2 mb-3" />
        <div className="h-4 bg-muted rounded w-2/3" />
      </div>
    );
  }
  
  return (
    <motion.button
      className={cn(
        "metric-card w-full text-left hover:border-primary/30 transition-colors h-full",
        compact ? "p-4" : "p-6"
      )}
      onClick={onClick}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className={cn("flex items-center justify-between", compact ? "mb-3" : "mb-4")}>
        <div className="flex items-center gap-2">
          <div className={cn(
            "rounded-xl bg-status-green/10 flex items-center justify-center",
            compact ? "w-8 h-8" : "w-10 h-10"
          )}>
            <DollarSign className={cn(compact ? "h-4 w-4" : "h-5 w-5", "text-status-green")} />
          </div>
          <div>
            <h3 className={cn("font-display font-semibold", compact ? "text-sm" : "text-lg")}>Commission Pacing</h3>
            {!compact && <p className="text-xs text-muted-foreground">Projected quarter-end</p>}
          </div>
        </div>
        
        <div className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
          config.bgColor,
          config.color
        )}>
          <StatusIcon className="h-3 w-3" />
          {config.label}
        </div>
      </div>
      
      {/* Main Metric */}
      <div className={compact ? "mb-3" : "mb-4"}>
        <div className={cn(
          "font-bold text-foreground mb-1",
          compact ? "text-2xl" : "text-4xl"
        )}>
          {formatCurrency(projectedQuarterCommission)}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={cn(
            "flex items-center gap-1",
            weeklyPaceTrend >= 0 ? "text-status-green" : "text-status-red"
          )}>
            {weeklyPaceTrend >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {weeklyPaceTrend >= 0 ? '+' : ''}{formatCurrency(weeklyPaceTrend)}/wk
          </span>
        </div>
      </div>
      
      {/* Projected Attainment Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Attainment</span>
          <span className={cn(
            "font-semibold",
            projectedAttainment >= 1.0 ? "text-status-green" : 
            projectedAttainment >= 0.8 ? "text-status-yellow" : "text-status-red"
          )}>
            {(projectedAttainment * 100).toFixed(0)}%
          </span>
        </div>
        
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <motion.div
            className={cn(
              "h-full rounded-full",
              projectedAttainment >= 1.0 ? "bg-status-green" : 
              projectedAttainment >= 0.8 ? "bg-status-yellow" : "bg-status-red"
            )}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(projectedAttainment * 100, 150)}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
      </div>
      
      {/* Click hint - hide in compact mode */}
      {!compact && (
        <div className="flex items-center justify-end mt-4 text-xs text-muted-foreground">
          <span>View details</span>
          <ChevronRight className="h-3 w-3 ml-1" />
        </div>
      )}
    </motion.button>
  );
}
