// Commission Snapshot - Simple YTD commission summary
import { motion } from 'framer-motion';
import { DollarSign, TrendingUp, Award } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/commissionCalculations';

interface CommissionSnapshotProps {
  totalCommission: number;
  newArrAttainment: number;
  renewalArrAttainment: number;
  combinedAttainment: number;
  projectedImpact?: {
    additionalNewArr: number;
    additionalCommission: number;
  };
}

export function CommissionSnapshot({ 
  totalCommission, 
  newArrAttainment,
  renewalArrAttainment,
  combinedAttainment,
  projectedImpact,
}: CommissionSnapshotProps) {
  // Determine accelerator tier
  const getTier = (attainment: number): string => {
    if (attainment >= 1.5) return '2.0x';
    if (attainment >= 1.25) return '1.7x';
    if (attainment >= 1.0) return '1.5x';
    return 'Base';
  };
  
  const currentTier = getTier(combinedAttainment);
  const tierColors = {
    'Base': 'text-muted-foreground',
    '1.5x': 'text-status-yellow',
    '1.7x': 'text-status-green',
    '2.0x': 'text-primary',
  };

  return (
    <motion.div 
      className="metric-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
    >
      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="h-5 w-5 text-status-green" />
        <h3 className="font-display font-semibold">Commission Snapshot</h3>
      </div>
      
      <div className="space-y-4">
        {/* Total Commission */}
        <div className="text-center py-4 bg-status-green/10 rounded-lg">
          <div className="text-xs text-muted-foreground mb-1">Est. Commission YTD</div>
          <div className="text-3xl font-bold text-status-green">
            {formatCurrency(totalCommission)}
          </div>
        </div>
        
        {/* Attainment Tiers */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="text-xs text-muted-foreground mb-1">New ARR</div>
            <div className="text-lg font-semibold">
              {(newArrAttainment * 100).toFixed(0)}%
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="text-xs text-muted-foreground mb-1">Renewal</div>
            <div className="text-lg font-semibold">
              {(renewalArrAttainment * 100).toFixed(0)}%
            </div>
          </div>
          <div className="p-3 rounded-lg bg-primary/10">
            <div className="text-xs text-muted-foreground mb-1">Combined</div>
            <div className="text-lg font-semibold text-primary">
              {(combinedAttainment * 100).toFixed(0)}%
            </div>
          </div>
        </div>
        
        {/* Current Tier */}
        <div className="flex items-center justify-between p-3 rounded-lg border">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-primary" />
            <span className="text-sm">Current Tier</span>
          </div>
          <span className={cn("font-semibold", tierColors[currentTier as keyof typeof tierColors])}>
            {currentTier} ACR
          </span>
        </div>
        
        {/* Projection */}
        {projectedImpact && projectedImpact.additionalNewArr > 0 && (
          <div className="p-3 rounded-lg bg-muted/50 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4" />
              <span>If you close {formatCurrency(projectedImpact.additionalNewArr)} more New ARR:</span>
            </div>
            <div className="text-status-green font-medium">
              Est. additional commission: {formatCurrency(projectedImpact.additionalCommission)}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
