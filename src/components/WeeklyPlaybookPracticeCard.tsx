/**
 * Weekly Playbook Practice Summary Card
 * Shows practice activity and gentle accountability nudges.
 */
import { memo } from 'react';
import { BookOpen, Zap, Target, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useWeeklyPlaybookSummary } from '@/hooks/usePlaybookUsageTracking';
import { cn } from '@/lib/utils';

export const WeeklyPlaybookPracticeCard = memo(function WeeklyPlaybookPracticeCard({
  className,
}: { className?: string }) {
  const { data: summary, isLoading } = useWeeklyPlaybookSummary();

  if (isLoading || !summary) return null;

  const hasActivity = summary.roleplaysCompleted > 0 || summary.usedInCalls > 0 || summary.postCallFeedbackCount > 0;

  // Only show if there's something meaningful to display
  if (!hasActivity && summary.recommendationsShown === 0) return null;

  const nudgeMessage = !hasActivity
    ? "You haven't practiced any playbooks this week"
    : summary.roleplaysCompleted === 0
      ? "Try a 2-minute roleplay to sharpen your skills"
      : summary.postCallFeedbackCount === 0
        ? "Log feedback after your next call to track improvement"
        : null;

  return (
    <Card className={cn("border-primary/10", className)}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">Practice This Week</span>
          </div>
          {summary.acceptanceRate > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-primary/30 text-primary">
              {summary.acceptanceRate}% adopted
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-1.5 rounded bg-muted/30">
            <Zap className="h-3 w-3 mx-auto text-status-yellow mb-0.5" />
            <p className="text-sm font-bold">{summary.roleplaysCompleted}</p>
            <p className="text-[9px] text-muted-foreground">Roleplays</p>
          </div>
          <div className="text-center p-1.5 rounded bg-muted/30">
            <Target className="h-3 w-3 mx-auto text-status-green mb-0.5" />
            <p className="text-sm font-bold">{summary.usedInCalls}</p>
            <p className="text-[9px] text-muted-foreground">Used in calls</p>
          </div>
          <div className="text-center p-1.5 rounded bg-muted/30">
            <TrendingUp className="h-3 w-3 mx-auto text-primary mb-0.5" />
            <p className="text-sm font-bold">{summary.postCallFeedbackCount}</p>
            <p className="text-[9px] text-muted-foreground">Reflections</p>
          </div>
        </div>

        {summary.topPlaybooks.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground font-medium">Most practiced:</p>
            {summary.topPlaybooks.slice(0, 3).map(p => (
              <div key={p.title} className="flex items-center justify-between text-[10px]">
                <span className="text-foreground truncate">{p.title}</span>
                <span className="text-muted-foreground shrink-0 ml-2">{p.count}×</span>
              </div>
            ))}
          </div>
        )}

        {nudgeMessage && (
          <p className="text-[10px] text-status-yellow/80 italic pt-1 border-t border-border/50">
            💡 {nudgeMessage}
          </p>
        )}
      </CardContent>
    </Card>
  );
});
