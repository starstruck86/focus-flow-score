// Quota Attainment Gauge Component
import { formatCurrency, formatPercent } from '@/lib/commissionCalculations';
import { Progress } from '@/components/ui/progress';

interface QuotaGaugeProps {
  title: string;
  booked: number;
  quota: number;
  attainment: number;
  color: 'green' | 'blue' | 'purple';
}

const colorStyles = {
  green: 'text-status-green',
  blue: 'text-primary',
  purple: 'text-purple-500',
};

export function QuotaGauge({ title, booked, quota, attainment, color }: QuotaGaugeProps) {
  const colorClass = colorStyles[color];
  const percentage = Math.min(attainment * 100, 100);
  
  return (
    <div className="metric-card p-4">
      <div className="flex justify-between items-start mb-2">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <span className={`text-xl font-bold ${colorClass}`}>
          {formatPercent(attainment, 0)}
        </span>
      </div>
      
      <Progress value={percentage} className="h-2 mb-3" />
      
      <div className="flex justify-between items-center">
        <div className={`text-lg font-bold ${colorClass}`}>
          {formatCurrency(booked)}
        </div>
        <div className="text-xs text-muted-foreground">
          of {formatCurrency(quota)}
        </div>
      </div>
    </div>
  );
}
