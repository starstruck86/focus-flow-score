// Commission Summary Card
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/commissionCalculations';
import { DollarSign, TrendingUp, Award } from 'lucide-react';

interface CommissionCardProps {
  totalCommission: number;
  newArrBase: number;
  newArrAccelerator: number;
  renewalArrBase: number;
  renewalArrAccelerator: number;
  oneTimeCommission: number;
}

export function CommissionCard({
  totalCommission,
  newArrBase,
  newArrAccelerator,
  renewalArrBase,
  renewalArrAccelerator,
  oneTimeCommission,
}: CommissionCardProps) {
  const hasAccelerator = newArrAccelerator > 0 || renewalArrAccelerator > 0;
  
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <DollarSign className="h-5 w-5 text-status-green" />
          Estimated Commission
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-status-green mb-4">
          {formatCurrency(totalCommission)}
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">New ARR Base</span>
            <span>{formatCurrency(newArrBase)}</span>
          </div>
          {newArrAccelerator > 0 && (
            <div className="flex justify-between text-status-yellow">
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                New ARR Accelerator
              </span>
              <span>+{formatCurrency(newArrAccelerator)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Renewal ARR Base</span>
            <span>{formatCurrency(renewalArrBase)}</span>
          </div>
          {renewalArrAccelerator > 0 && (
            <div className="flex justify-between text-status-yellow">
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                Renewal ARR Accelerator
              </span>
              <span>+{formatCurrency(renewalArrAccelerator)}</span>
            </div>
          )}
          {oneTimeCommission > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">One-Time (3%)</span>
              <span>{formatCurrency(oneTimeCommission)}</span>
            </div>
          )}
        </div>
        
        {hasAccelerator && (
          <div className="mt-4 pt-3 border-t border-border/50">
            <div className="flex items-center gap-1 text-xs text-status-yellow">
              <Award className="h-3 w-3" />
              Accelerator bonuses earned on overachievement
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
