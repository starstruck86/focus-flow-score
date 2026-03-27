/**
 * AccountWorkCard — The primary "work this account" surface.
 *
 * Unified card showing everything needed to work an account without context switching.
 * Consumes AccountWorkingSummary. Embeds opportunity context inline.
 * Lower-signal detail hidden behind expand.
 */

import { useState, memo } from 'react';
import {
  Building2, ChevronDown, ChevronUp, Phone, CheckCircle2,
  ArrowRight, AlertTriangle, Clock, Calendar, Sparkles, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AccountQuickActions } from './AccountQuickActions';
import type { AccountWorkingView } from '@/hooks/useAccountWorkingSummary';
import type { AccountEventType } from '@/lib/accountTimeline';

// ── Status display helpers ─────────────────────────────────

const READINESS_CONFIG: Record<string, { label: string; icon: typeof Phone; className: string }> = {
  ready_to_call: { label: 'Ready to call', icon: Phone, className: 'text-primary' },
  prep_needed: { label: 'Prep needed', icon: AlertTriangle, className: 'text-status-yellow' },
  retry_later: { label: 'Retry later', icon: Clock, className: 'text-muted-foreground' },
  follow_up_next_loop: { label: 'Follow up next loop', icon: ArrowRight, className: 'text-accent-foreground' },
  not_actionable_today: { label: 'Done today', icon: CheckCircle2, className: 'text-status-green' },
  carry_forward_tomorrow: { label: 'Carry forward', icon: ArrowRight, className: 'text-muted-foreground' },
};

const PREP_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  prepped: { label: 'Prepped', variant: 'default' },
  partial_prep: { label: 'Partial', variant: 'secondary' },
  not_prepped: { label: 'Not prepped', variant: 'outline' },
};

const EVENT_LABELS: Partial<Record<AccountEventType, string>> = {
  prepped: 'Prepped',
  attempted: 'Attempted',
  connected: 'Connected',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  meeting_booked: 'Meeting booked',
  follow_up_needed: 'Follow-up',
  carry_forward: 'Carried forward',
  opportunity_created: 'Opp created',
  opportunity_updated: 'Opp updated',
};

// ── Component ──────────────────────────────────────────────

interface AccountWorkCardProps {
  view: AccountWorkingView;
  onOutcomeLogged?: () => void;
  showQuickActions?: boolean;
  defaultExpanded?: boolean;
}

export const AccountWorkCard = memo(function AccountWorkCard({
  view,
  onOutcomeLogged,
  showQuickActions = true,
  defaultExpanded = false,
}: AccountWorkCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const readiness = READINESS_CONFIG[view.nextRecommendedAction] || READINESS_CONFIG.prep_needed;
  const ReadinessIcon = readiness.icon;
  const prepBadge = PREP_BADGE[view.prepStatus] || PREP_BADGE.not_prepped;

  return (
    <div className={cn(
      'rounded-lg border border-border/60 bg-card transition-all',
      view.nextRecommendedAction === 'ready_to_call' && 'border-primary/30',
      view.carryForward && 'border-accent/30',
    )}>
      {/* Header — always visible */}
      <div className="px-3 py-2.5 flex items-start gap-2">
        <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />

        <div className="flex-1 min-w-0">
          {/* Row 1: name + readiness */}
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{view.accountName}</span>
            <span className={cn('inline-flex items-center gap-1 text-[11px] ml-auto shrink-0', readiness.className)}>
              <ReadinessIcon className="h-3 w-3" />
              {readiness.label}
            </span>
          </div>

          {/* Row 2: prep badge + outcome + opp context */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant={prepBadge.variant} className="text-[10px] h-4 px-1.5">
              {prepBadge.label}
            </Badge>

            {view.latestOutcome && (
              <span className="text-[10px] text-muted-foreground">
                Last: {view.latestOutcome.replace(/_/g, ' ')}
                {view.callAttemptCount > 1 && ` (×${view.callAttemptCount})`}
              </span>
            )}

            {view.carryForward && (
              <span className="text-[10px] text-accent-foreground inline-flex items-center gap-0.5">
                <ArrowRight className="h-2.5 w-2.5" />
                Carried
              </span>
            )}

            {/* Inline opportunity context */}
            {view.primaryOpportunity && (
              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5 ml-auto">
                <Sparkles className="h-2.5 w-2.5" />
                {view.primaryOpportunity.stage || 'Opp'}
                {view.primaryOpportunity.arr != null && (
                  <> · ${(view.primaryOpportunity.arr / 1000).toFixed(0)}k</>
                )}
              </span>
            )}
          </div>

          {/* Post-action recommendation — show if exists and actionable */}
          {view.postActionRec && view.postActionRec.decision !== 'leave_ready' && (
            <div className="mt-1.5 text-[10px] text-muted-foreground bg-muted/40 rounded px-2 py-1">
              💡 {view.postActionRec.reason}
            </div>
          )}
        </div>

        {/* Expand toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="h-6 w-6 p-0 shrink-0"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Quick actions strip — always visible when enabled */}
      {showQuickActions && (
        <div className="px-3 pb-2 border-t border-border/30 pt-1.5">
          <AccountQuickActions
            accountId={view.accountId}
            accountName={view.accountName}
            loopId={view.loopId}
            onOutcomeLogged={onOutcomeLogged}
            compact
          />
        </div>
      )}

      {/* Expanded detail — lower-signal info */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/30 pt-2 space-y-2">
          {/* All opportunities */}
          {view.opportunities.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Opportunities</span>
              {view.opportunities.map(opp => (
                <div key={opp.opportunityId} className="flex items-center gap-2 mt-1 text-xs text-foreground">
                  <span className="truncate">{opp.opportunityName}</span>
                  <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                    {opp.stage || 'No stage'}
                  </Badge>
                  {opp.arr != null && (
                    <span className="text-muted-foreground text-[10px] ml-auto">
                      ${(opp.arr / 1000).toFixed(0)}k
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Recent events */}
          {view.recentEvents.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Recent</span>
              <div className="mt-1 space-y-0.5">
                {view.recentEvents.slice(-3).reverse().map(evt => (
                  <div key={evt.id} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{EVENT_LABELS[evt.eventType] || evt.eventType}</span>
                    {evt.notes && <span className="truncate italic">"{evt.notes}"</span>}
                    <span className="ml-auto text-[9px]">
                      {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meta */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            {view.industry && <span>{view.industry}</span>}
            {view.tier && <span>Tier: {view.tier}</span>}
            {view.sourceOfTruth !== 'crm_only' && (
              <span className="text-primary/70">⚡ Account truth</span>
            )}
            {view.website && (
              <a
                href={view.website.startsWith('http') ? view.website : `https://${view.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 hover:text-foreground"
              >
                <ExternalLink className="h-2.5 w-2.5" /> Web
              </a>
            )}
          </div>

          {/* Full quick actions when compact is off */}
          {showQuickActions && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Log Outcome</span>
              <div className="mt-1">
                <AccountQuickActions
                  accountId={view.accountId}
                  accountName={view.accountName}
                  loopId={view.loopId}
                  onOutcomeLogged={onOutcomeLogged}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
