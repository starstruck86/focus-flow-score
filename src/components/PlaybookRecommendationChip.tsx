/**
 * Lightweight playbook recommendation chip.
 * Shows ONE playbook recommendation with a single CTA.
 * Enhanced: roleplay nudge for call/prep blocks, usage tracking.
 */
import { memo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BookOpen, Zap, Brain, Swords } from 'lucide-react';
import type { PlaybookRecommendation } from '@/hooks/usePlaybookRecommendation';
import { usePlaybookUsageTracking } from '@/hooks/usePlaybookUsageTracking';
import { cn } from '@/lib/utils';

const CTA_CONFIG = {
  use: { label: 'Use this', icon: Zap },
  practice: { label: 'Practice this', icon: BookOpen },
  prep: { label: 'Prep with Dave', icon: Brain },
} as const;

interface Props {
  recommendation: PlaybookRecommendation | null;
  compact?: boolean;
  showRoleplayNudge?: boolean;
  blockType?: string;
  onAction?: (playbook: PlaybookRecommendation) => void;
  className?: string;
}

export const PlaybookRecommendationChip = memo(function PlaybookRecommendationChip({
  recommendation,
  compact = false,
  showRoleplayNudge = false,
  blockType,
  onAction,
  className,
}: Props) {
  const { track } = usePlaybookUsageTracking();

  const handleClick = useCallback(() => {
    if (!recommendation) return;
    const { playbook, cta } = recommendation;
    track({
      playbookTitle: playbook.title,
      playbookId: playbook.id,
      eventType: 'recommendation_accepted',
      blockType,
    });

    if (cta === 'prep') {
      window.dispatchEvent(new CustomEvent('dave-playbook-request', {
        detail: { playbookId: playbook.id, title: playbook.title },
      }));
    }
    onAction?.(recommendation);
  }, [recommendation, track, blockType, onAction]);

  const handleRoleplay = useCallback(() => {
    if (!recommendation) return;
    const { playbook } = recommendation;
    track({
      playbookTitle: playbook.title,
      playbookId: playbook.id,
      eventType: 'roleplay_started',
      blockType,
    });

    window.dispatchEvent(new CustomEvent('dave-playbook-request', {
      detail: {
        playbookId: playbook.id,
        title: playbook.title,
        mode: 'roleplay',
      },
    }));
  }, [recommendation, track, blockType]);

  if (!recommendation) return null;

  const { playbook, reason, cta } = recommendation;
  const ctaConfig = CTA_CONFIG[cta];
  const CtaIcon = ctaConfig.icon;
      playbookTitle: playbook.title,
      playbookId: playbook.id,
      eventType: 'recommendation_accepted',
      blockType,
    });

    if (cta === 'prep') {
      window.dispatchEvent(new CustomEvent('dave-playbook-request', {
        detail: { playbookId: playbook.id, title: playbook.title },
      }));
    }
    onAction?.(recommendation);
  }, [playbook, cta, track, blockType, onAction, recommendation]);

  const handleRoleplay = useCallback(() => {
    track({
      playbookTitle: playbook.title,
      playbookId: playbook.id,
      eventType: 'roleplay_started',
      blockType,
    });

    window.dispatchEvent(new CustomEvent('dave-playbook-request', {
      detail: {
        playbookId: playbook.id,
        title: playbook.title,
        mode: 'roleplay',
      },
    }));
  }, [playbook, track, blockType]);

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <button
          onClick={handleClick}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors text-left group"
        >
          <BookOpen className="h-3 w-3 text-primary shrink-0" />
          <span className="text-[10px] font-medium text-foreground truncate max-w-[140px]">
            {playbook.title}
          </span>
        </button>
        {showRoleplayNudge && (
          <button
            onClick={handleRoleplay}
            className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-status-yellow/10 border border-status-yellow/20 hover:bg-status-yellow/20 transition-colors text-left"
            title="Quick 2-min roleplay"
          >
            <Swords className="h-3 w-3 text-status-yellow shrink-0" />
            <span className="text-[10px] font-medium text-status-yellow">Practice</span>
          </button>
        )}
      </div>
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
        <div className="flex items-center gap-1 mt-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-5 text-[10px] gap-1 px-1.5 text-primary hover:text-primary hover:bg-primary/10"
            onClick={handleClick}
          >
            <CtaIcon className="h-3 w-3" />
            {ctaConfig.label}
          </Button>
          {showRoleplayNudge && (
            <Button
              size="sm"
              variant="ghost"
              className="h-5 text-[10px] gap-1 px-1.5 text-status-yellow hover:text-status-yellow hover:bg-status-yellow/10"
              onClick={handleRoleplay}
            >
              <Swords className="h-3 w-3" />
              2-min sim
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});
