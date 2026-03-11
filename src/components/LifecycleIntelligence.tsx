import React from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Zap,
  Globe,
  Mail,
  Crown,
  LayoutGrid,
  Smartphone,
  Users,
  Cpu,
  RefreshCw,
  Pencil,
  Info,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Account } from '@/types';
import { useAccountEnrichment } from '@/hooks/useAccountEnrichment';

// ── Tier Badge (for table rows) ──────────────────────────

const TIER_STYLES: Record<string, string> = {
  '1': 'bg-status-green/15 text-status-green border-status-green/30',
  '2': 'bg-primary/15 text-primary border-primary/30',
  '3': 'bg-status-yellow/15 text-status-yellow border-status-yellow/30',
  '4': 'bg-muted text-muted-foreground border-border',
};

export function LifecycleTierBadge({ account }: { account: Account }) {
  const tier = account.tierOverride || account.lifecycleTier;
  if (!tier) return <span className="text-xs text-muted-foreground">—</span>;
  
  const isOverridden = !!account.tierOverride;
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] font-mono font-bold tabular-nums',
              TIER_STYLES[tier] || TIER_STYLES['4'],
              isOverridden && 'ring-1 ring-primary/50'
            )}
          >
            T{tier}
            {isOverridden && <Pencil className="h-2 w-2 ml-0.5" />}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[200px]">
          <p className="font-semibold">ICP Tier {tier}</p>
          {account.icpFitScore != null && <p>Fit Score: {account.icpFitScore}/100</p>}
          {isOverridden && <p className="text-primary">Manually overridden</p>}
          {account.confidenceScore != null && <p>Confidence: {account.confidenceScore}%</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── ICP Score Pill ───────────────────────────────────────

export function IcpScorePill({ account }: { account: Account }) {
  const score = account.icpScoreOverride ?? account.icpFitScore;
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>;
  
  const color = score >= 75 ? 'text-status-green' : score >= 50 ? 'text-primary' : score >= 25 ? 'text-status-yellow' : 'text-muted-foreground';
  const isOverridden = account.icpScoreOverride != null;
  const isLowConfidence = account.confidenceScore != null && account.confidenceScore < 50;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            'text-sm font-mono font-bold tabular-nums cursor-default',
            color,
            isLowConfidence && 'opacity-60',
            isOverridden && 'underline decoration-dotted decoration-primary'
          )}>
            {score}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          ICP Fit Score {score}/100
          {isOverridden && ' (overridden)'}
          {isLowConfidence && ' • Low confidence'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Triggered Badge ─────────────────────────────────────

export function TriggeredBadge({ account }: { account: Account }) {
  if (!account.triggeredAccount && !(account.triggerEvents as any[])?.length) return null;
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className="bg-strain/15 text-strain border-strain/30 text-[10px] gap-0.5 cursor-default">
            <Zap className="h-2.5 w-2.5" />
            Triggered
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Account has recent trigger events
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Enrich Button ───────────────────────────────────────

export function EnrichButton({ account, compact = false }: { account: Account; compact?: boolean }) {
  const { enrichAccount, isEnriching } = useAccountEnrichment();
  const loading = isEnriching(account.id);

  if (!account.website) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className={cn('h-7 w-7', loading && 'animate-spin')}
            onClick={(e) => { e.stopPropagation(); enrichAccount(account); }}
            disabled={loading}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {loading ? 'Enriching...' : account.lastEnrichedAt ? 'Re-enrich account' : 'Auto-detect ICP signals'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Signal Detail Panel (for expanded account row) ──────

const SIGNAL_DEFS = [
  { key: 'directEcommerce', label: 'Direct Ecommerce', icon: Globe, description: 'Customers can buy online' },
  { key: 'emailSmsCapture', label: 'Email/SMS Capture', icon: Mail, description: 'Active subscriber acquisition' },
  { key: 'loyaltyMembership', label: 'Loyalty/Membership', icon: Crown, description: 'Rewards or membership program' },
  { key: 'categoryComplexity', label: 'Category Complexity', icon: LayoutGrid, description: '5+ top-level nav categories' },
  { key: 'mobileApp', label: 'Mobile App', icon: Smartphone, description: 'Has mobile application' },
  { key: 'marketingPlatformDetected', label: 'Marketing Platform', icon: Cpu, description: 'Detected marketing platform' },
] as const;

const CONFIDENCE_ICONS = {
  high: ShieldCheck,
  medium: ShieldAlert,
  low: ShieldQuestion,
};

const CONFIDENCE_COLORS = {
  high: 'text-status-green',
  medium: 'text-status-yellow',
  low: 'text-muted-foreground',
};

export function SignalDetailPanel({ account }: { account: Account }) {
  const score = account.icpScoreOverride ?? account.icpFitScore;
  const tier = account.tierOverride || account.lifecycleTier;
  const { enrichAccount, isEnriching } = useAccountEnrichment();

  return (
    <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border/50">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-semibold">ICP Intelligence</h4>
          {score != null && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn('font-mono', TIER_STYLES[tier || '4'] || TIER_STYLES['4'])}>
                Tier {tier}
              </Badge>
              <span className="text-sm font-mono font-bold">{score}/100</span>
              {account.confidenceScore != null && (
                <span className="text-xs text-muted-foreground">({account.confidenceScore}% confidence)</span>
              )}
            </div>
          )}
        </div>
        {account.website && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => enrichAccount(account)}
            disabled={isEnriching(account.id)}
            className="h-7 text-xs gap-1"
          >
            <RefreshCw className={cn('h-3 w-3', isEnriching(account.id) && 'animate-spin')} />
            {account.lastEnrichedAt ? 'Re-enrich' : 'Auto-detect'}
          </Button>
        )}
      </div>

      {/* Signals Grid */}
      {score != null ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {SIGNAL_DEFS.map(({ key, label, icon: Icon, description }) => {
            const value = (account as any)[key];
            const isDetected = key === 'marketingPlatformDetected' ? !!value : value === true;

            return (
              <div
                key={key}
                className={cn(
                  'flex items-center gap-2 p-2 rounded-md border text-xs',
                  isDetected ? 'border-status-green/30 bg-status-green/5' : 'border-border bg-background'
                )}
              >
                <Icon className={cn('h-3.5 w-3.5 shrink-0', isDetected ? 'text-status-green' : 'text-muted-foreground')} />
                <div className="min-w-0">
                  <div className="font-medium truncate">{label}</div>
                  {key === 'marketingPlatformDetected' && value ? (
                    <div className="text-[10px] text-primary truncate">{value}</div>
                  ) : (
                    <div className={cn('text-[10px]', isDetected ? 'text-status-green' : 'text-muted-foreground')}>
                      {isDetected ? 'Detected' : 'Not detected'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* CRM Team Size */}
          <div className={cn(
            'flex items-center gap-2 p-2 rounded-md border text-xs',
            account.crmLifecycleTeamSize != null && account.crmLifecycleTeamSize >= 1 && account.crmLifecycleTeamSize <= 5
              ? 'border-status-green/30 bg-status-green/5'
              : 'border-border bg-background'
          )}>
            <Users className={cn('h-3.5 w-3.5 shrink-0',
              account.crmLifecycleTeamSize != null && account.crmLifecycleTeamSize >= 1 && account.crmLifecycleTeamSize <= 5
                ? 'text-status-green' : 'text-muted-foreground'
            )} />
            <div className="min-w-0">
              <div className="font-medium">CRM/Lifecycle Team</div>
              <div className="text-[10px] text-muted-foreground">
                {account.crmLifecycleTeamSize == null ? 'Unknown' : `~${account.crmLifecycleTeamSize} people`}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Info className="h-3.5 w-3.5" />
          {account.website 
            ? 'Click "Auto-detect" to analyze this account\'s website for ICP signals.'
            : 'Add a website URL to enable automatic ICP detection.'}
        </div>
      )}

      {/* Enrichment Summary */}
      {account.enrichmentSourceSummary && (
        <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
          <span className="font-medium">AI Summary:</span> {account.enrichmentSourceSummary}
        </div>
      )}

      {/* Last enriched */}
      {account.lastEnrichedAt && (
        <div className="text-[10px] text-muted-foreground">
          Last enriched: {new Date(account.lastEnrichedAt).toLocaleDateString()} at {new Date(account.lastEnrichedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {/* Override indicator */}
      {account.lifecycleOverride && (
        <div className="text-[10px] text-primary flex items-center gap-1">
          <Pencil className="h-2.5 w-2.5" />
          Manual override active{account.lifecycleOverrideReason && `: ${account.lifecycleOverrideReason}`}
        </div>
      )}
    </div>
  );
}
