/**
 * AccountWorkPanel — Primary "work these accounts" surface on the dashboard.
 *
 * Shows today's accounts with execution state as AccountWorkCards.
 * Replaces the need to context-switch between account/opp views.
 * Only renders when ENABLE_ACCOUNT_EXECUTION_MODEL is on and accounts exist.
 */

import { useState, useCallback, useMemo } from 'react';
import { Building2, Filter } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AccountWorkCard } from '@/components/accounts/AccountWorkCard';
import { useAllAccountWorkingViews, type AccountWorkingView } from '@/hooks/useAccountWorkingSummary';
import { isAccountExecutionModelEnabled } from '@/lib/featureFlags';
import type { AccountReadiness } from '@/lib/accountExecutionState';

type FilterMode = 'all' | 'ready' | 'prepped' | 'worked' | 'carry';

const FILTER_OPTIONS: { mode: FilterMode; label: string }[] = [
  { mode: 'all', label: 'All' },
  { mode: 'ready', label: 'Ready' },
  { mode: 'prepped', label: 'Prepped' },
  { mode: 'worked', label: 'Worked' },
  { mode: 'carry', label: 'Carry' },
];

export function AccountWorkPanel() {
  const { data: views, isLoading } = useAllAccountWorkingViews();
  const [filter, setFilter] = useState<FilterMode>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleOutcome = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return views;
    if (filter === 'ready') return views.filter(v => v.nextRecommendedAction === 'ready_to_call');
    if (filter === 'prepped') return views.filter(v => v.prepStatus === 'prepped' && v.actionStatus === 'not_worked');
    if (filter === 'worked') return views.filter(v => v.actionStatus !== 'not_worked');
    if (filter === 'carry') return views.filter(v => v.carryForward);
    return views;
  }, [views, filter, refreshKey]);

  // Counts for filter badges
  const counts = useMemo(() => ({
    all: views.length,
    ready: views.filter(v => v.nextRecommendedAction === 'ready_to_call').length,
    prepped: views.filter(v => v.prepStatus === 'prepped' && v.actionStatus === 'not_worked').length,
    worked: views.filter(v => v.actionStatus !== 'not_worked').length,
    carry: views.filter(v => v.carryForward).length,
  }), [views, refreshKey]);

  if (!isAccountExecutionModelEnabled()) return null;
  if (isLoading) return null;
  if (views.length === 0) return null;

  // Sort: ready_to_call first, then prepped, then carry-forward, then rest
  const READINESS_ORDER: Record<string, number> = {
    ready_to_call: 0,
    prep_needed: 1,
    retry_later: 2,
    follow_up_next_loop: 3,
    carry_forward_tomorrow: 4,
    not_actionable_today: 5,
  };

  const sorted = [...filtered].sort((a, b) => {
    const aO = READINESS_ORDER[a.nextRecommendedAction] ?? 9;
    const bO = READINESS_ORDER[b.nextRecommendedAction] ?? 9;
    return aO - bO;
  });

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Accounts</h3>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">{views.length}</Badge>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1">
        {FILTER_OPTIONS.map(opt => (
          <Button
            key={opt.mode}
            size="sm"
            variant={filter === opt.mode ? 'default' : 'ghost'}
            onClick={() => setFilter(opt.mode)}
            className={cn('h-6 px-2 text-[10px] gap-1', filter !== opt.mode && 'text-muted-foreground')}
          >
            {opt.label}
            {counts[opt.mode] > 0 && (
              <span className="text-[9px] opacity-70">{counts[opt.mode]}</span>
            )}
          </Button>
        ))}
      </div>

      {/* Account cards */}
      <div className="space-y-2">
        {sorted.map(view => (
          <AccountWorkCard
            key={view.accountId}
            view={view}
            onOutcomeLogged={handleOutcome}
          />
        ))}
        {sorted.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No accounts match this filter.
          </p>
        )}
      </div>
    </div>
  );
}
