// Remaining to 100% Card
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/commissionCalculations';
import { Target, Calendar } from 'lucide-react';

interface RemainingCardProps {
  newArrRemaining: number;
  renewalArrRemaining: number;
  weeklyRateNeeded: number;
  endDate: string;
}

export function RemainingCard({
  newArrRemaining,
  renewalArrRemaining,
  weeklyRateNeeded,
  endDate,
}: RemainingCardProps) {
  const totalRemaining = newArrRemaining + renewalArrRemaining;
  const endDateFormatted = new Date(endDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="h-5 w-5 text-primary" />
          Remaining to 100%
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold mb-4">
          {formatCurrency(totalRemaining)}
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">New ARR</span>
            <span>{formatCurrency(newArrRemaining)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Renewal ARR</span>
            <span>{formatCurrency(renewalArrRemaining)}</span>
          </div>
        </div>
        
        <div className="mt-4 pt-3 border-t border-border/50">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">To hit 100% by {endDateFormatted}:</span>
          </div>
          <div className="mt-1 text-lg font-semibold text-primary">
            {formatCurrency(weeklyRateNeeded)}/week
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
