import React, { useState } from 'react';
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
  Package,
  Wrench,
  ChevronDown,
  ChevronUp,
  ImagePlus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Account } from '@/types';
import { useAccountEnrichment, isEnrichmentStale } from '@/hooks/useAccountEnrichment';
import { ScreenshotEnrichModal } from '@/components/ScreenshotEnrichModal';

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

  const stale = isEnrichmentStale(account);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              'h-7 w-7',
              loading && 'animate-spin',
              stale && !loading && 'text-status-yellow'
            )}
            onClick={(e) => { e.stopPropagation(); enrichAccount(account); }}
            disabled={loading}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {loading ? 'Enriching...' : stale ? 'Enrichment is 90+ days old — click to refresh' : account.lastEnrichedAt ? 'Re-enrich account' : account.website ? 'Auto-detect ICP signals' : 'Auto-find website & detect ICP signals'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Signal Detail Panel (for expanded account row) ──────

const SIGNAL_DEFS = [
  { key: 'directEcommerce', evidenceKey: 'direct_ecommerce', label: 'Direct Ecommerce', icon: Globe, description: 'Customers can buy online' },
  { key: 'emailSmsCapture', evidenceKey: 'email_sms_capture', label: 'Email/SMS Capture', icon: Mail, description: 'Active subscriber acquisition' },
  { key: 'loyaltyMembership', evidenceKey: 'loyalty_membership', label: 'Loyalty/Membership', icon: Crown, description: 'Rewards or membership program' },
  { key: 'categoryComplexity', evidenceKey: 'category_complexity', label: 'Category Complexity', icon: LayoutGrid, description: '5+ top-level nav categories' },
  { key: 'mobileApp', evidenceKey: 'mobile_app', label: 'Mobile App', icon: Smartphone, description: 'Has mobile application' },
  { key: 'marketingPlatformDetected', evidenceKey: 'marketing_platform', label: 'Marketing Platform', icon: Cpu, description: 'Detected marketing platform' },
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

// ── Enrichment Summary Panel (clean formatted display) ──

function EnrichmentSummaryPanel({ summary, evidence }: { summary: string; evidence: Record<string, string> }) {
  // Parse the summary into sections
  const sections: { title: string; content: string }[] = [];
  
  // Extract the main summary (before any ** sections)
  const mainMatch = summary.match(/^([\s\S]*?)(?=\n\n\*\*|$)/);
  const mainSummary = (mainMatch?.[1] || summary).replace(/\*\*/g, '').trim();
  
  // Extract "How they make money" section
  const businessMatch = summary.match(/\*\*How they make money:\*\*\n?([\s\S]*?)(?=\n\n\*\*|$)/i);
  const businessSummary = evidence.business_summary || (businessMatch?.[1] || '').trim();
  
  // Extract "Recent news" section  
  const newsMatch = summary.match(/\*\*Recent news[^*]*\*\*\n?([\s\S]*?)$/i);
  const recentNews = evidence.recent_news || (newsMatch?.[1] || '').trim();

  return (
    <div className="space-y-2">
      {/* Main ICP summary */}
      {mainSummary && (
        <div className="text-xs bg-muted/50 p-3 rounded-md border border-border/50">
          <p className="text-foreground/80 leading-relaxed">{mainSummary}</p>
        </div>
      )}
      
      {/* Business model */}
      {businessSummary && (
        <div className="text-xs p-3 rounded-md border border-primary/20 bg-primary/5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <DollarSignIcon className="h-3 w-3 text-primary" />
            <span className="font-semibold text-primary text-[11px] uppercase tracking-wide">How They Make Money</span>
          </div>
          <div className="text-foreground/80 leading-relaxed whitespace-pre-line">
            {formatBullets(businessSummary)}
          </div>
        </div>
      )}
      
      {/* Recent news */}
      {recentNews && recentNews !== 'No significant recent news found.' && (
        <div className="text-xs p-3 rounded-md border border-status-yellow/20 bg-status-yellow/5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Zap className="h-3 w-3 text-status-yellow" />
            <span className="font-semibold text-status-yellow text-[11px] uppercase tracking-wide">Recent News & Hires</span>
          </div>
          <div className="text-foreground/80 leading-relaxed whitespace-pre-line">
            {formatBullets(recentNews)}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper: clean up bullet points for display
function formatBullets(text: string): React.ReactNode {
  const lines = text.split('\n').filter(l => l.trim());
  return lines.map((line, i) => {
    const cleaned = line.replace(/^\s*[-•*]\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1').trim();
    if (!cleaned) return null;
    const isBullet = /^\s*[-•*]/.test(line);
    return (
      <div key={i} className={cn('leading-relaxed', isBullet ? 'pl-3 relative before:content-["•"] before:absolute before:left-0 before:text-muted-foreground' : i > 0 ? 'mt-1' : '')}>
        {cleaned}
      </div>
    );
  });
}

// Inline dollar sign icon to avoid adding to top-level imports
function DollarSignIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

export function SignalDetailPanel({ account }: { account: Account }) {
  const score = account.icpScoreOverride ?? account.icpFitScore;
  const tier = account.tierOverride || account.lifecycleTier;
  const { enrichAccount, isEnriching } = useAccountEnrichment();
  const [expanded, setExpanded] = React.useState(true);
  const [screenshotOpen, setScreenshotOpen] = useState(false);
  const evidence = account.enrichmentEvidence || {};

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
        <div className="flex items-center gap-1">
          {score != null && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              className="h-7 text-xs gap-1"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? 'Collapse' : 'Expand'}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setScreenshotOpen(true)}
            className="h-7 text-xs gap-1"
          >
            <ImagePlus className="h-3 w-3" />
            Screenshots
          </Button>
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
      </div>
      
      <ScreenshotEnrichModal open={screenshotOpen} onOpenChange={setScreenshotOpen} account={account} />

      {/* Discovery Cards */}
      {score != null && expanded ? (
        <div className="space-y-3">
          {/* Tech Stack Discovery - always show first if we have data */}
          {(evidence.ecommerce_platform || evidence.marketing_platform || evidence.other_tech_detected) && (
            <div className="p-3 rounded-md border border-primary/20 bg-primary/5">
              <div className="flex items-center gap-1.5 mb-2">
                <Wrench className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-primary">Tech Stack Discovered</span>
              </div>
              <div className="space-y-1.5">
                {evidence.ecommerce_platform && (
                  <div className="flex items-start gap-2 text-xs">
                    <Package className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                    <span><span className="font-medium">Ecommerce:</span> {evidence.ecommerce_platform}</span>
                  </div>
                )}
                {account.marketingPlatformDetected && (
                  <div className="flex items-start gap-2 text-xs">
                    <Cpu className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                    <span><span className="font-medium">Marketing Platform:</span> {account.marketingPlatformDetected}</span>
                  </div>
                )}
                {evidence.marketing_platform && (
                  <p className="text-[11px] text-muted-foreground ml-5">{evidence.marketing_platform}</p>
                )}
                {evidence.other_tech_detected && (
                  <div className="flex items-start gap-2 text-xs">
                    <Wrench className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                    <span><span className="font-medium">Other Tech:</span> {evidence.other_tech_detected}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Signal Discovery Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {SIGNAL_DEFS.map(({ key, evidenceKey, label, icon: Icon }) => {
              const value = (account as any)[key];
              const isDetected = key === 'marketingPlatformDetected' ? !!value : value === true;
              const details = evidence[evidenceKey];

              return (
                <div
                  key={key}
                  className={cn(
                    'flex items-start gap-2 p-2.5 rounded-md border text-xs',
                    isDetected ? 'border-status-green/30 bg-status-green/5' : 'border-border bg-background'
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5 shrink-0 mt-0.5', isDetected ? 'text-status-green' : 'text-muted-foreground')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{label}</span>
                      {key === 'marketingPlatformDetected' && value ? (
                        <Badge variant="outline" className="text-[9px] h-4 px-1 font-mono">{value}</Badge>
                      ) : (
                        <span className={cn('text-[10px]', isDetected ? 'text-status-green' : 'text-muted-foreground')}>
                          {isDetected ? '✓' : '✗'}
                        </span>
                      )}
                    </div>
                    {details ? (
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{details}</p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5 italic">
                        {isDetected ? 'Detected — re-enrich for details' : 'Not detected'}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* CRM Team Size */}
            <div className={cn(
              'flex items-start gap-2 p-2.5 rounded-md border text-xs',
              account.crmLifecycleTeamSize != null && account.crmLifecycleTeamSize >= 1 && account.crmLifecycleTeamSize <= 5
                ? 'border-status-green/30 bg-status-green/5'
                : 'border-border bg-background'
            )}>
              <Users className={cn('h-3.5 w-3.5 shrink-0 mt-0.5',
                account.crmLifecycleTeamSize != null && account.crmLifecycleTeamSize >= 1 && account.crmLifecycleTeamSize <= 5
                  ? 'text-status-green' : 'text-muted-foreground'
              )} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">CRM/Lifecycle Team</span>
                  <span className="text-[10px] text-muted-foreground">
                    {account.crmLifecycleTeamSize == null ? '?' : `~${account.crmLifecycleTeamSize}`}
                  </span>
                </div>
                {evidence.crm_lifecycle_team_size ? (
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{evidence.crm_lifecycle_team_size}</p>
                ) : (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5 italic">
                    {account.crmLifecycleTeamSize != null ? 'Re-enrich for details' : 'Unknown'}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Enrichment Summary - structured display */}
          {account.enrichmentSourceSummary && (
            <EnrichmentSummaryPanel summary={account.enrichmentSourceSummary} evidence={evidence} />
          )}
        </div>
      ) : score == null ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Info className="h-3.5 w-3.5" />
          Click "{account.website ? 'Auto-detect' : 'Auto-detect'}" to analyze this account for ICP signals.
          {!account.website && ' We\'ll auto-find the website for you.'}
        </div>
      ) : null}

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
