import { ArrowRight, Zap, RotateCcw, BookOpen, Brain, Shield, Wrench, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { LearnPrimaryAction, LearnPrimaryActionMode } from '@/lib/learning/learnActionEngine';

const MODE_CONFIG: Record<LearnPrimaryActionMode, { icon: typeof Zap; accent: string }> = {
  replay_missed_moment: { icon: RotateCcw, accent: 'text-red-500' },
  run_today_rep:        { icon: Zap, accent: 'text-primary' },
  prep_friday:          { icon: Shield, accent: 'text-amber-500' },
  open_lesson:          { icon: BookOpen, accent: 'text-blue-500' },
  review_ki:            { icon: Brain, accent: 'text-violet-500' },
  remediate_anchor:     { icon: Wrench, accent: 'text-orange-500' },
  maintenance:          { icon: Sparkles, accent: 'text-muted-foreground' },
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'Strong signal',
  medium: 'Moderate signal',
  low: 'Light signal',
};

interface Props {
  action: LearnPrimaryAction;
  onExecute: () => void;
}

export function PrimaryActionCard({ action, onExecute }: Props) {
  const config = MODE_CONFIG[action.mode];
  const Icon = config.icon;
  const isDisabled = action.target.type === 'none' && action.mode === 'maintenance';

  return (
    <div className="rounded-lg border-2 border-primary/20 bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 ${config.accent}`}>
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="space-y-1 pt-0.5">
            <p className="text-sm font-semibold text-foreground">{action.label}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{action.reason}</p>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">
          {CONFIDENCE_LABEL[action.confidence]}
        </Badge>
      </div>

      <Button
        className="w-full"
        size="default"
        onClick={onExecute}
        disabled={isDisabled}
      >
        {action.label}
        <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}
