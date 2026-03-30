import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  FileText, Mail, Target, Presentation, MessageSquare,
  RefreshCcw, Zap, Shield, Sparkles,
} from 'lucide-react';
import type { OutputType } from '@/lib/executionTemplateTypes';

const DELIVERABLE_TYPES: { value: OutputType; label: string; icon: typeof FileText; shortLabel: string }[] = [
  { value: 'discovery_prep_sheet', label: 'Discovery Prep Sheet', shortLabel: 'Discovery', icon: Target },
  { value: 'discovery_recap_email', label: 'Recap Email', shortLabel: 'Recap', icon: Mail },
  { value: 'meeting_agenda', label: 'Meeting Agenda Email', shortLabel: 'Agenda', icon: Presentation },
  { value: 'demo_followup_email', label: 'Demo Follow-Up', shortLabel: 'Demo F/U', icon: FileText },
  { value: 'renewal_followup_email', label: 'Renewal Follow-Up', shortLabel: 'Renewal', icon: RefreshCcw },
  { value: 'pricing_followup_email', label: 'Pricing Recap', shortLabel: 'Pricing', icon: Zap },
  { value: 'cadence_sequence', label: 'Cadence Email', shortLabel: 'Cadence', icon: MessageSquare },
  { value: 'objection_handling_draft', label: 'Objection Response', shortLabel: 'Objection', icon: Shield },
  { value: 'custom', label: 'Custom', shortLabel: 'Custom', icon: Sparkles },
];

interface Props {
  value: OutputType;
  onChange: (v: OutputType) => void;
}

export function DeliverableTypeSelector({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">What are you creating?</h2>
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-1.5">
        {DELIVERABLE_TYPES.map(dt => {
          const Icon = dt.icon;
          const selected = value === dt.value;
          return (
            <button
              key={dt.value}
              onClick={() => onChange(dt.value)}
              className={cn(
                'flex flex-col items-center gap-1 p-2.5 rounded-lg border text-center transition-all',
                'hover:border-primary/40 hover:bg-primary/5 cursor-pointer',
                selected
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-border bg-card'
              )}
            >
              <Icon className={cn('h-4 w-4', selected ? 'text-primary' : 'text-muted-foreground')} />
              <span className={cn('text-[10px] leading-tight font-medium', selected ? 'text-primary' : 'text-muted-foreground')}>
                {dt.shortLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { DELIVERABLE_TYPES };
