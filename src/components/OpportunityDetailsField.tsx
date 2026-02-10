import { EditableDatePicker } from '@/components/EditableDatePicker';
import { EditableTextareaCell, EditableNumberCell } from '@/components/table/EditableCell';
import { CustomFieldRow } from '@/components/table/CustomFieldCell';
import { useCustomFields } from '@/hooks/useCustomFields';
import { cn } from '@/lib/utils';
import { parseISO, isPast, isToday } from 'date-fns';

interface OpportunityDetailsFieldProps {
  opportunityId?: string;
  nextStepDate?: string;
  onNextStepDateChange?: (value: string | undefined) => void;
  lastTouchDate?: string;
  onLastTouchDateChange?: (value: string | undefined) => void;
  notes?: string;
  onNotesChange?: (value: string) => void;
  isRenewal?: boolean;
  priorContractArr?: number;
  onPriorContractArrChange?: (value: number | undefined) => void;
  renewalArr?: number;
  onRenewalArrChange?: (value: number | undefined) => void;
  oneTimeAmount?: number;
  onOneTimeAmountChange?: (value: number | undefined) => void;
}

export function OpportunityDetailsField({
  opportunityId,
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
  const { getFieldsForTab } = useCustomFields();
  const customExpandedFields = getFieldsForTab('opportunities', 'expanded');
  
  const expansionArr = isRenewal && renewalArr && priorContractArr
    ? Math.max(0, renewalArr - priorContractArr) 
    : 0;
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
    <div className="pt-3 space-y-4">
      {/* Renewal ARR Breakdown */}
      {isRenewal && (
        <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
          <label className="text-xs font-semibold text-muted-foreground mb-3 block">
            ARR Breakdown
          </label>
          <div className="grid grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Prior Contract</label>
              <EditableNumberCell
                value={priorContractArr || 0}
                onChange={(v) => onPriorContractArrChange?.(v || undefined)}
                format="currency"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Renewal ARR</label>
              <EditableNumberCell
                value={renewalArr || 0}
                onChange={(v) => onRenewalArrChange?.(v || undefined)}
                format="currency"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">One-Time</label>
              <EditableNumberCell
                value={oneTimeAmount || 0}
                onChange={(v) => onOneTimeAmountChange?.(v || undefined)}
                format="currency"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Expansion</label>
              <div className="h-7 px-2 flex items-center text-sm font-mono text-muted-foreground">
                {formatCurrency(expansionArr)}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Total Value</label>
              <div className="h-7 px-2 flex items-center text-sm font-mono font-medium">
                {formatCurrency(totalDealValue)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Next Step Date
          </label>
          <EditableDatePicker
            value={nextStepDate}
            onChange={(v) => onNextStepDateChange?.(v)}
            placeholder="+ Add"
            className={cn(
              "w-full",
              nextStepDate && isPast(parseISO(nextStepDate)) && !isToday(parseISO(nextStepDate)) && "[&_button]:border-status-red"
            )}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Last Touch Date
          </label>
          <EditableDatePicker
            value={lastTouchDate}
            onChange={(v) => onLastTouchDateChange?.(v)}
            placeholder="+ Add"
            className="w-full"
          />
        </div>
      </div>

      {/* Notes - display-first */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Notes
        </label>
        <EditableTextareaCell
          value={notes || ''}
          onChange={(v) => onNotesChange?.(v)}
          placeholder="Add notes about this opportunity..."
          emptyText="Add Notes"
        />
      </div>

      {/* Custom Fields */}
      {opportunityId && customExpandedFields.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {customExpandedFields.map(field => (
            <CustomFieldRow key={field.id} field={field} recordId={opportunityId} />
          ))}
        </div>
      )}
    </div>
  );
}
