/**
 * Lightweight confirmation panel showing auto-detected context signals.
 * User can review, edit, or skip straight to generation.
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Edit2, Sparkles, Server, User, FileText, StickyNote, Building2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PrepSignal } from './buildPrepContext';

const CATEGORY_ICON: Record<PrepSignal['category'], React.ElementType> = {
  stack: Server,
  contact: User,
  transcript: FileText,
  note: StickyNote,
  industry: Building2,
};

const CATEGORY_COLOR: Record<PrepSignal['category'], string> = {
  stack: 'bg-primary/10 text-primary border-primary/20',
  contact: 'bg-accent/60 text-accent-foreground border-accent',
  transcript: 'bg-chart-2/10 text-chart-2 border-chart-2/20',
  note: 'bg-muted text-muted-foreground border-border',
  industry: 'bg-chart-4/10 text-chart-4 border-chart-4/20',
};

interface Props {
  signals: PrepSignal[];
  onConfirm: () => void;
  onEdit: () => void;
  isGenerating: boolean;
  actionLabel: string;
}

export function ContextConfirmationPanel({ signals, onConfirm, onEdit, isGenerating, actionLabel }: Props) {
  if (signals.length === 0) return null;

  const grouped = signals.reduce<Record<string, PrepSignal[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
        <p className="text-sm font-semibold">Detected context</p>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {signals.length} signal{signals.length !== 1 ? 's' : ''} found
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(grouped).map(([category, items]) => {
          const Icon = CATEGORY_ICON[category as PrepSignal['category']];
          const colorCls = CATEGORY_COLOR[category as PrepSignal['category']];
          return items.map((signal) => (
            <Badge
              key={signal.label}
              variant="outline"
              className={cn('text-[10px] gap-1 font-normal', colorCls)}
            >
              <Icon className="h-2.5 w-2.5" />
              {signal.label}
            </Badge>
          ));
        })}
      </div>

      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={onConfirm}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-2" /> Confirm & Generate</>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          disabled={isGenerating}
          className="shrink-0"
        >
          <Edit2 className="h-3.5 w-3.5 mr-1.5" />
          Edit
        </Button>
      </div>
    </div>
  );
}
