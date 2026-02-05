import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
  nextStep?: string;
  onNextStepChange?: (value: string) => void;
  lastTouchDate?: string;
  onLastTouchDateChange?: (value: string | undefined) => void;
  notes?: string;
  onNotesChange?: (value: string) => void;
}

export function OpportunityDetailsField({
  nextStepDate,
  onNextStepDateChange,
  nextStep,
  onNextStepChange,
  lastTouchDate,
  onLastTouchDateChange,
  notes,
  onNotesChange,
}: OpportunityDetailsFieldProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasDetails = nextStepDate || nextStep || lastTouchDate || notes;

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
        {/* Row 1: Next Step Date, Last Touch Date */}
        <div className="grid grid-cols-3 gap-4">
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
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Next Step
            </Label>
            <Textarea
              value={nextStep || ''}
              onChange={(e) => onNextStepChange?.(e.target.value)}
              placeholder="Describe next step..."
              className="min-h-[36px] text-sm resize-none py-2 px-3 w-full"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
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
