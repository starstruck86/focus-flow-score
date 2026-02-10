// Metric-style cell: small label on top, larger formatted value below
// Wraps CustomFieldCell with a two-line layout for enhanced readability
import { useCustomFields, type CustomFieldDefinition } from '@/hooks/useCustomFields';
import { CustomFieldCell } from './CustomFieldCell';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface MetricFieldCellProps {
  field: CustomFieldDefinition;
  recordId: string;
  showLabel?: boolean;
}

function formatMetricValue(value: string | number | undefined, type: CustomFieldDefinition['type']): string | null {
  if (value == null || value === '' || value === 0) return null;
  
  if (type === 'currency') {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return null;
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  
  if (type === 'number') {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return null;
    return num.toLocaleString('en-US');
  }
  
  return null; // Non-numeric types don't get special formatting
}

function abbreviate(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (num >= 10_000) return `${(num / 1_000).toFixed(0)}k`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return num.toLocaleString('en-US');
}

export function MetricFieldCell({ field, recordId, showLabel = true }: MetricFieldCellProps) {
  const { getFieldValue } = useCustomFields();
  const value = getFieldValue(recordId, field.id);
  const hasValue = value != null && value !== '' && value !== 0;
  
  const isNumeric = field.type === 'number' || field.type === 'currency';
  const numericValue = isNumeric && hasValue ? (typeof value === 'string' ? parseFloat(value as string) : value as number) : null;
  const fullFormatted = formatMetricValue(value, field.type);
  const abbreviated = numericValue != null && !isNaN(numericValue) ? abbreviate(numericValue) : null;
  const needsAbbreviation = fullFormatted && abbreviated && fullFormatted.replace(/[$,]/g, '').length > 6;

  return (
    <div className="flex flex-col gap-0.5 py-0.5 min-w-0">
      {showLabel && (
        <span className="text-[10px] font-medium text-muted-foreground leading-tight truncate">
          {field.name}
        </span>
      )}
      <div className="text-sm font-semibold leading-snug min-w-0 tabular-nums text-foreground">
        {isNumeric && hasValue && fullFormatted ? (
          <>
            {needsAbbreviation ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-pointer hover:text-primary transition-colors">
                      <CustomFieldCell field={field} recordId={recordId} metricDisplay={
                        field.type === 'currency' ? `$${abbreviated}` : abbreviated!
                      } />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{fullFormatted}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <CustomFieldCell field={field} recordId={recordId} metricDisplay={fullFormatted} />
            )}
          </>
        ) : (
          <div className={!hasValue ? 'text-xs font-normal text-muted-foreground' : ''}>
            <CustomFieldCell field={field} recordId={recordId} />
          </div>
        )}
      </div>
    </div>
  );
}
