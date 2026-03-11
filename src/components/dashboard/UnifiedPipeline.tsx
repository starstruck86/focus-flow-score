// Unified Pipeline: All opps in one view with workstream toggle
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { 
  ChevronRight,
  DollarSign,
  Calendar,
  AlertTriangle,
  ArrowUpRight,
} from 'lucide-react';
import type { Opportunity, OpportunityStage, DealType } from '@/types';
import { format, differenceInDays, parseISO } from 'date-fns';

const STAGE_ORDER: OpportunityStage[] = ['Prospect', 'Discover', 'Demo', 'Proposal', 'Negotiate'];

const STAGE_COLORS: Record<string, string> = {
  'Prospect': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  'Discover': 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  'Demo': 'bg-status-yellow/15 text-status-yellow border-status-yellow/30',
  'Proposal': 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  'Negotiate': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

const DEAL_TYPE_LABELS: Record<string, string> = {
  'new-logo': 'New Logo',
  'expansion': 'Expansion',
  'renewal': 'Renewal',
  'one-time': 'One-Time',
};

type WorkstreamFilter = 'all' | 'new-logo' | 'renewal';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function UnifiedPipeline() {
  const { opportunities, renewals } = useStore();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<WorkstreamFilter>('all');

  // Active pipeline opps
  const activeOpps = useMemo(() => {
    let opps = opportunities.filter(o => o.status === 'active' || o.status === 'stalled');
    
    if (filter === 'new-logo') {
      const renewalOppIds = new Set(renewals.map(r => r.linkedOpportunityId).filter(Boolean));
      opps = opps.filter(o => !renewalOppIds.has(o.id) && o.dealType !== 'renewal');
    } else if (filter === 'renewal') {
      const renewalOppIds = new Set(renewals.map(r => r.linkedOpportunityId).filter(Boolean));
      opps = opps.filter(o => renewalOppIds.has(o.id) || o.dealType === 'renewal');
    }
    
    return opps;
  }, [opportunities, renewals, filter]);

  // Group by stage
  const stageGroups = useMemo(() => {
    const groups: Record<string, Opportunity[]> = {};
    STAGE_ORDER.forEach(s => { groups[s] = []; });
    groups['Other'] = [];
    
    activeOpps.forEach(o => {
      const stage = o.stage || 'Other';
      if (groups[stage]) {
        groups[stage].push(o);
      } else {
        groups['Other'].push(o);
      }
    });
    
    return groups;
  }, [activeOpps]);

  const totalArr = activeOpps.reduce((sum, o) => sum + (o.arr || 0), 0);
  const stalledCount = activeOpps.filter(o => o.status === 'stalled').length;
  const noNextStep = activeOpps.filter(o => !o.nextStep && !o.nextStepDate).length;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="font-display text-sm font-bold">Pipeline</h3>
          <span className="text-xs text-muted-foreground font-mono font-semibold">
            {activeOpps.length} opps • {formatCurrency(totalArr)}
          </span>
        </div>
        
        {/* Workstream toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          {([
            { value: 'all' as const, label: 'All' },
            { value: 'new-logo' as const, label: 'New Logo' },
            { value: 'renewal' as const, label: 'Renewal' },
          ]).map(w => (
            <button
              key={w.value}
              className={cn(
                "px-2.5 py-1 text-[10px] font-medium transition-colors",
                filter === w.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-card hover:bg-muted text-muted-foreground"
              )}
              onClick={() => setFilter(w.value)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Warnings */}
      {(stalledCount > 0 || noNextStep > 0) && (
        <div className="flex items-center gap-3 mb-3 text-[11px]">
          {stalledCount > 0 && (
            <span className="flex items-center gap-1 text-status-yellow">
              <AlertTriangle className="h-3 w-3" />
              {stalledCount} stalled
            </span>
          )}
          {noNextStep > 0 && (
            <span className="flex items-center gap-1 text-status-red">
              <AlertTriangle className="h-3 w-3" />
              {noNextStep} missing next step
            </span>
          )}
        </div>
      )}

      {/* Stage summary bars */}
      <div className="grid grid-cols-5 gap-2">
        {STAGE_ORDER.map(stage => {
          const opps = stageGroups[stage] || [];
          const stageArr = opps.reduce((sum, o) => sum + (o.arr || 0), 0);
          
          return (
            <div key={stage} className={cn("rounded-lg border p-2.5", STAGE_COLORS[stage] || 'border-border')}>
              <div className="text-[10px] font-semibold mb-1 opacity-80">{stage}</div>
              <div className="text-lg font-bold font-mono">{opps.length}</div>
              <div className="text-[10px] opacity-70 font-mono">{formatCurrency(stageArr)}</div>
              {/* Top opp preview */}
              {opps.slice(0, 2).map(o => (
                <div key={o.id} className="mt-1.5 text-[10px] truncate opacity-80">
                  {o.name}
                  {o.closeDate && (
                    <span className="ml-1 opacity-60">
                      {differenceInDays(parseISO(o.closeDate), new Date())}d
                    </span>
                  )}
                </div>
              ))}
              {opps.length > 2 && (
                <div className="text-[9px] mt-1 opacity-50">+{opps.length - 2} more</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick links */}
      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/50">
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild>
          <a href="/outreach">
            New Logo <ArrowUpRight className="h-3 w-3" />
          </a>
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild>
          <a href="/renewals">
            Renewals <ArrowUpRight className="h-3 w-3" />
          </a>
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild>
          <a href="/quota">
            Quota <ArrowUpRight className="h-3 w-3" />
          </a>
        </Button>
      </div>
    </div>
  );
}
