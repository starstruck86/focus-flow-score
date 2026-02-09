// Pace to Quota Card - New ARR + Renewal ARR lanes
import { motion } from 'framer-motion';
import { Target, TrendingUp, TrendingDown, Minus, DollarSign } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/commissionCalculations';
import type { PaceToQuota } from '@/lib/salesAgeCalculations';

interface PaceToQuotaCardProps {
  paceToQuota: PaceToQuota;
}

function PaceLane({ 
  title, 
  data,
  color 
}: { 
  title: string; 
  data: PaceToQuota['newArr']; 
  color: 'green' | 'blue';
}) {
  const colorClasses = {
    green: {
      text: 'text-status-green',
      bg: 'bg-status-green/10',
      progress: 'bg-status-green',
    },
    blue: {
      text: 'text-primary',
      bg: 'bg-primary/10',
      progress: 'bg-primary',
    },
  };
  
  const StatusIcon = data.status === 'ahead' 
    ? TrendingUp 
    : data.status === 'behind' 
      ? TrendingDown 
      : Minus;
  
  const statusText = {
    ahead: 'Ahead',
    'on-track': 'On Track',
    behind: 'Behind',
  };
  
  const statusColors = {
    ahead: 'text-status-green bg-status-green/10',
    'on-track': 'text-status-yellow bg-status-yellow/10',
    behind: 'text-status-red bg-status-red/10',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{title}</span>
        <span className={cn(
          "text-xs px-2 py-1 rounded-full flex items-center gap-1",
          statusColors[data.status]
        )}>
          <StatusIcon className="h-3 w-3" />
          {statusText[data.status]}
        </span>
      </div>
      
      <div className="flex items-baseline justify-between">
        <div>
          <span className={cn("text-2xl font-bold", colorClasses[color].text)}>
            {formatCurrency(data.closed)}
          </span>
          <span className="text-sm text-muted-foreground ml-1">
            / {formatCurrency(data.quota)}
          </span>
        </div>
        <span className={cn("text-lg font-semibold", colorClasses[color].text)}>
          {(data.attainment * 100).toFixed(0)}%
        </span>
      </div>
      
      <Progress 
        value={Math.min(data.attainment * 100, 100)} 
        className="h-2"
      />
      
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Should be at</div>
          <div className="font-medium">{formatCurrency(data.paceExpected)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Gap</div>
          <div className={cn(
            "font-medium",
            data.paceDelta >= 0 ? 'text-status-green' : 'text-status-red'
          )}>
            {data.paceDelta >= 0 ? '+' : ''}{formatCurrency(data.paceDelta)}
          </div>
        </div>
      </div>
      
      <div className={cn("p-2 rounded-lg text-sm", colorClasses[color].bg)}>
        <span className="text-muted-foreground">Need </span>
        <span className={cn("font-semibold", colorClasses[color].text)}>
          {formatCurrency(data.neededPerWeek)}/week
        </span>
        <span className="text-muted-foreground"> to hit 100%</span>
      </div>
    </div>
  );
}

export function PaceToQuotaCard({ paceToQuota }: PaceToQuotaCardProps) {
  return (
    <motion.div 
      className="metric-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      <div className="flex items-center gap-2 mb-6">
        <Target className="h-5 w-5 text-primary" />
        <h3 className="font-display font-semibold">Pace to Quota</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          {paceToQuota.bizDaysElapsed}/{paceToQuota.bizDaysTotal} biz days
          • {paceToQuota.weeksRemaining.toFixed(1)} weeks left
        </span>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <PaceLane 
          title="New ARR" 
          data={paceToQuota.newArr} 
          color="green" 
        />
        <PaceLane 
          title="Renewal ARR" 
          data={paceToQuota.renewalArr} 
          color="blue" 
        />
      </div>
    </motion.div>
  );
}
