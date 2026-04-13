/**
 * DaveCoachingHistory — Compact recent history of closed-loop coaching sessions.
 *
 * Shows what Dave has been coaching, what got resolved, and what's still open.
 * Collapsible — not a full page.
 */

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, CheckCircle2, RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { loadUnresolvedLoops, loadRecentCompletedLoops, buildProgressSummary, type ClosedLoopProgressSummary } from '@/lib/daveClosedLoopStore';
import type { ClosedLoopSession } from '@/lib/daveClosedLoopEngine';
import { useAuth } from '@/contexts/AuthContext';

interface HistoryEntry extends ClosedLoopProgressSummary {
  status: string;
  updatedAt?: string;
}

const OUTCOME_ICONS: Record<string, React.ReactNode> = {
  missed: <AlertTriangle className="h-3 w-3 text-destructive" />,
  partial: <RefreshCw className="h-3 w-3 text-muted-foreground" />,
  applied: <CheckCircle2 className="h-3 w-3 text-accent-foreground" />,
  strong: <CheckCircle2 className="h-3 w-3 text-primary" />,
};

export function DaveCoachingHistory() {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const [unresolved, completed] = await Promise.all([
        loadUnresolvedLoops(user.id),
        loadRecentCompletedLoops(user.id, 5),
      ]);

      if (cancelled) return;

      const all = [...unresolved, ...completed];
      const history: HistoryEntry[] = all.map(s => ({
        ...buildProgressSummary(s),
        status: s.status,
      }));

      setEntries(history);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [user]);

  if (loading || entries.length === 0) return null;

  const visibleEntries = expanded ? entries : entries.slice(0, 3);
  const activeCount = entries.filter(e => e.status !== 'completed').length;

  return (
    <Card className="border-border/50 bg-card/80">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Coaching History
            {activeCount > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">
                {activeCount} active
              </Badge>
            )}
          </p>
          {entries.length > 3 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="h-6 px-2 text-xs text-muted-foreground"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          )}
        </div>

        <div className="space-y-1.5">
          {visibleEntries.map((entry, i) => (
            <div
              key={`${entry.skill}-${entry.concept}-${i}`}
              className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-muted/30"
            >
              {entry.mastered ? (
                <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
              ) : (
                OUTCOME_ICONS[entry.latestOutcome] || <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {entry.concept}
                </p>
                <p className="text-[10px] text-muted-foreground capitalize">
                  {entry.skill.replace(/_/g, ' ')} · {entry.attempts} attempt{entry.attempts !== 1 ? 's' : ''}
                  {entry.routedToReview && ' · reviewed'}
                  {entry.routedToSkillBuilder && ' · skill builder'}
                </p>
              </div>
              <Badge
                variant={entry.mastered ? 'default' : 'outline'}
                className="text-[9px] px-1.5 py-0 shrink-0"
              >
                {entry.mastered ? 'Mastered' : entry.improved ? 'Improving' : 'In progress'}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
