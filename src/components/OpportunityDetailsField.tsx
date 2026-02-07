import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { EditableDatePicker } from '@/components/EditableDatePicker';
import { cn } from '@/lib/utils';
import { parseISO, isPast, isToday } from 'date-fns';

interface OpportunityDetailsFieldProps {
  nextStepDate?: string;
  onNextStepDateChange?: (value: string | undefined) => void;
  lastTouchDate?: string;
  onLastTouchDateChange?: (value: string | undefined) => void;
  notes?: string;
  onNotesChange?: (value: string) => void;
  // Renewal-specific fields
  isRenewal?: boolean;
  priorContractArr?: number;
  onPriorContractArrChange?: (value: number | undefined) => void;
  renewalArr?: number;
  onRenewalArrChange?: (value: number | undefined) => void;
  oneTimeAmount?: number;
  onOneTimeAmountChange?: (value: number | undefined) => void;
}

export function OpportunityDetailsField({
  nextStepDate,
  onNextStepDateChange,
  lastTouchDate,
  onLastTouchDateChange,
  notes,
  onNotesChange,
  isRenewal = false,
  priorContractArr,
  onPriorContractArrChange,
  renewalArr,
  onRenewalArrChange,
  oneTimeAmount,
  onOneTimeAmountChange,
}: OpportunityDetailsFieldProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasDetails = nextStepDate || lastTouchDate || notes || (isRenewal && (priorContractArr || renewalArr || oneTimeAmount));

  // Calculate expansion ARR (new ARR above prior contract)
  const expansionArr = isRenewal && renewalArr && priorContractArr 
    ? Math.max(0, renewalArr - priorContractArr) 
    : 0;

  // Calculate total deal value
  const totalDealValue = (renewalArr || 0) + (oneTimeAmount || 0);

  const formatCurrency = (amount?: number) => {
    if (!amount && amount !== 0) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start text-xs px-2 hover:bg-muted/50"
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3 mr-1 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 mr-1 shrink-0" />
          )}
          <span className={cn(
            hasDetails ? 'text-foreground' : 'text-muted-foreground'
          )}>
            {hasDetails ? 'View details' : 'Add details'}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 space-y-4">
        {/* Renewal ARR Breakdown - Only shown for renewal opportunities */}
        {isRenewal && (
          <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
            <Label className="text-xs font-semibold text-muted-foreground mb-3 block">
              ARR Breakdown
            </Label>
            <div className="grid grid-cols-5 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Prior Contract
                </Label>
                <Input
                  type="number"
                  value={priorContractArr || ''}
                  onChange={(e) => onPriorContractArrChange?.(e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="$0"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Renewal ARR
                </Label>
                <Input
                  type="number"
                  value={renewalArr || ''}
                  onChange={(e) => onRenewalArrChange?.(e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="$0"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  One-Time
                </Label>
                <Input
                  type="number"
                  value={oneTimeAmount || ''}
                  onChange={(e) => onOneTimeAmountChange?.(e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="$0"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Expansion
                </Label>
                <div className="h-8 px-3 flex items-center text-xs bg-background border rounded-md text-muted-foreground">
                  {formatCurrency(expansionArr)}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Total Value
                </Label>
                <div className="h-8 px-3 flex items-center text-xs bg-background border rounded-md font-medium">
                  {formatCurrency(totalDealValue)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Row 1: Next Step Date, Last Touch Date */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Next Step Date
            </Label>
            <EditableDatePicker
              value={nextStepDate}
              onChange={(v) => onNextStepDateChange?.(v)}
              placeholder="Select date..."
              className={cn(
                "w-full",
                nextStepDate && isPast(parseISO(nextStepDate)) && !isToday(parseISO(nextStepDate)) && "[&_button]:border-status-red"
              )}
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Last Touch Date
            </Label>
            <EditableDatePicker
              value={lastTouchDate}
              onChange={(v) => onLastTouchDateChange?.(v)}
              placeholder="Select date..."
              className="w-full"
            />
          </div>
        </div>

        {/* Row 2: Notes - full width */}
        <div>
          <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Notes
          </Label>
          <Textarea
            value={notes || ''}
            onChange={(e) => onNotesChange?.(e.target.value)}
            placeholder="Add notes about this opportunity..."
            className="min-h-[80px] text-sm resize-none py-2 px-3 w-full"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
