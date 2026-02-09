// Sales Age Tile - WHOOP-like top metric
import { motion } from 'framer-motion';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SalesAgeResult } from '@/lib/salesAgeCalculations';

interface SalesAgeTileProps {
  salesAge: SalesAgeResult | undefined;
  isLoading: boolean;
  onClick: () => void;
}

export function SalesAgeTile({ salesAge, isLoading, onClick }: SalesAgeTileProps) {
  if (isLoading || !salesAge) {
    return (
      <motion.div 
        className="metric-card p-6 cursor-pointer hover:shadow-lg transition-shadow"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="animate-pulse">
          <div className="h-4 bg-muted rounded w-24 mb-4" />
          <div className="h-12 bg-muted rounded w-20 mb-2" />
          <div className="h-3 bg-muted rounded w-32" />
        </div>
      </motion.div>
    );
  }

  const { salesAge: age, paceOfAging, status, qpi, benchmark30d } = salesAge;
  
  // Color based on status
  const statusColors = {
    improving: 'text-status-green',
    stable: 'text-status-yellow',
    declining: 'text-status-red',
  };
  
  const bgColors = {
    improving: 'bg-status-green/10 border-status-green/20',
    stable: 'bg-status-yellow/10 border-status-yellow/20',
    declining: 'bg-status-red/10 border-status-red/20',
  };
  
  const StatusIcon = status === 'improving' 
    ? TrendingDown 
    : status === 'declining' 
      ? TrendingUp 
      : Minus;
  
  // QPI interpretation
  const qpiStatus = qpi.qpiCombined >= 1.0 
    ? 'On Pace' 
    : qpi.qpiCombined >= 0.8 
      ? 'Slightly Behind' 
      : 'Behind Pace';

  return (
    <motion.div 
      className={cn(
        "metric-card p-6 cursor-pointer hover:shadow-lg transition-all border-2",
        bgColors[status]
      )}
      onClick={onClick}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Activity className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-muted-foreground">Sales Age</span>
          </div>
          
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-5xl font-display font-bold">{age}</span>
            <span className="text-lg text-muted-foreground">years</span>
          </div>
          
          <div className="flex items-center gap-2 mt-2">
            <StatusIcon className={cn("h-4 w-4", statusColors[status])} />
            <span className={cn("text-sm font-medium", statusColors[status])}>
              {paceOfAging > 0 ? '+' : ''}{paceOfAging.toFixed(1)} this week
            </span>
            <span className="text-xs text-muted-foreground">
              • {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-xs text-muted-foreground mb-1">QPI</div>
          <div className={cn(
            "text-2xl font-bold",
            qpi.qpiCombined >= 1.0 ? 'text-status-green' : 
            qpi.qpiCombined >= 0.8 ? 'text-status-yellow' : 'text-status-red'
          )}>
            {qpi.qpiCombined.toFixed(2)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{qpiStatus}</div>
        </div>
      </div>
      
      <div className="mt-4 pt-4 border-t border-border/50 grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-xs text-muted-foreground">30D Pace</div>
          <div className={cn(
            "text-sm font-semibold",
            benchmark30d >= 1.0 ? 'text-status-green' : 'text-status-yellow'
          )}>
            {(benchmark30d * 100).toFixed(0)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">New Logo</div>
          <div className={cn(
            "text-sm font-semibold",
            qpi.qpiNewLogo >= 1.0 ? 'text-status-green' : 'text-status-yellow'
          )}>
            {(qpi.qpiNewLogo * 100).toFixed(0)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Renewal</div>
          <div className={cn(
            "text-sm font-semibold",
            qpi.qpiRenewal >= 1.0 ? 'text-status-green' : 'text-status-yellow'
          )}>
            {(qpi.qpiRenewal * 100).toFixed(0)}%
          </div>
        </div>
      </div>
      
      <div className="mt-3 text-xs text-center text-muted-foreground">
        Click to view drivers and recommendations →
      </div>
    </motion.div>
  );
}
