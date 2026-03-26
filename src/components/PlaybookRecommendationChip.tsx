/**
 * Lightweight playbook recommendation chip.
 * Shows ONE playbook recommendation with a single CTA.
 */
import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BookOpen, Zap, Brain } from 'lucide-react';
import type { PlaybookRecommendation } from '@/hooks/usePlaybookRecommendation';
import { cn } from '@/lib/utils';

const CTA_CONFIG = {
  use: { label: 'Use this', icon: Zap },
  practice: { label: 'Practice this', icon: BookOpen },
  prep: { label: 'Prep with Dave', icon: Brain },
} as const;

interface Props {
  recommendation: PlaybookRecommendation | null;
  compact?: boolean;
  onAction?: (playbook: PlaybookRecommendation) => void;
  className?: string;
}

export const PlaybookRecommendationChip = memo(function PlaybookRecommendationChip({
  recommendation,
  compact = false,
  onAction,
  className,
}: Props) {
  if (!recommendation) return null;

  const { playbook, reason, cta } = recommendation;
  const ctaConfig = CTA_CONFIG[cta];
  const CtaIcon = ctaConfig.icon;

  const handleClick = () => {
    if (cta === 'prep') {
      // Dispatch event for Dave to pick up
      window.dispatchEvent(new CustomEvent('dave-playbook-request', {
        detail: { playbookId: playbook.id, title: playbook.title },
      }));
    }
    onAction?.(recommendation);
  };

  if (compact) {
    return (
      <button
        onClick={handleClick}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/5 border border-primary/20",
          "hover:bg-primary/10 transition-colors text-left group",
          className,
        )}
      >
        <BookOpen className="h-3 w-3 text-primary shrink-0" />
        <span className="text-[10px] font-medium text-foreground truncate max-w-[160px]">
          {playbook.title}
        </span>
      </button>
    );
  }

  return (
    <div className={cn(
      "flex items-start gap-2 px-2.5 py-2 rounded-md bg-primary/5 border border-primary/20",
      className,
    )}>
      <BookOpen className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground truncate">{playbook.title}</span>
          <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 border-primary/30 text-primary">
            {playbook.problem_type}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{reason}</p>
        <Button
          size="sm"
          variant="ghost"
          className="h-5 text-[10px] gap-1 mt-1 px-1.5 text-primary hover:text-primary hover:bg-primary/10"
          onClick={handleClick}
        >
          <CtaIcon className="h-3 w-3" />
          {ctaConfig.label}
        </Button>
      </div>
    </div>
  );
});
