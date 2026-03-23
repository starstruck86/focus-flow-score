// Command Brief — the Jarvis layer UI surface
// ONE state sentence + ONE primary action. No noise.
// Live Mode: auto-activates during call/prospecting blocks,
// compresses to action + who + reason. Expandable on demand.

import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Check, SkipForward, ArrowRight, AlertTriangle, ExternalLink, Ban, Clock, ChevronDown, ChevronUp, Radio } from 'lucide-react';
import { useOperatingState } from '@/hooks/useOperatingState';
import { usePrimaryAction } from '@/hooks/usePrimaryAction';
import { useActionMemory } from '@/hooks/useActionMemory';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useState, useMemo } from 'react';

const BAND_STYLES: Record<string, string> = {
  executing: 'border-status-green/30 bg-status-green/5',
  'on-pace': 'border-primary/20 bg-primary/5',
  drifting: 'border-status-yellow/30 bg-status-yellow/5',
  reactive: 'border-destructive/30 bg-destructive/5',
};

const BAND_DOT: Record<string, string> = {
  executing: 'bg-status-green',
  'on-pace': 'bg-primary',
  drifting: 'bg-status-yellow',
  reactive: 'bg-destructive',
};

const ESCALATION_STYLES: Record<string, string> = {
  critical: 'text-destructive',
  high: 'text-status-yellow',
  moderate: 'text-muted-foreground',
  low: 'text-muted-foreground',
};

function inferExternalSystem(entityType: string): string | null {
  if (entityType === 'opportunity' || entityType === 'renewal') return 'Salesforce';
  if (entityType === 'account') return 'Outreach / Salesloft';
  return null;
}

/** Detect if we're in a live-mode-eligible work block based on time of day */
function useIsLiveBlock(): boolean {
  return useMemo(() => {
    const hour = new Date().getHours();
    // Morning prospecting (before 10) or call blocks (10-12)
    return hour < 12;
  }, []);
}

export function CommandBrief() {
  const { sentence, band } = useOperatingState();
  const primaryAction = usePrimaryAction();
  const { recordAction } = useActionMemory();
  const [dismissed, setDismissed] = useState(false);
  const [dismissLabel, setDismissLabel] = useState('');
  const isLiveBlock = useIsLiveBlock();
  const [expanded, setExpanded] = useState(false);
  const [liveModeOverride, setLiveModeOverride] = useState<boolean | null>(null);

  // Live mode: auto-on during execution blocks, toggleable
  const liveMode = liveModeOverride ?? isLiveBlock;

  const advance = (label: string) => {
    setDismissLabel(label);
    setDismissed(true);
    setExpanded(false);
    setTimeout(() => setDismissed(false), 2000);
  };

  const handleDone = () => {
    if (!primaryAction) return;
    recordAction(primaryAction.id, 'completed', primaryAction.entityType, primaryAction.entityId);
    toast.success('✓ Done', { description: 'Next action...' });
    advance('✓ Done — loading next...');
  };

  const handleBlocked = () => {
    if (!primaryAction) return;
    recordAction(primaryAction.id, 'deferred', primaryAction.entityType, primaryAction.entityId);
    toast('Blocked — moving on');
    advance('⊘ Blocked — next...');
  };

  const handleSkip = () => {
    if (!primaryAction) return;
    recordAction(primaryAction.id, 'deferred', primaryAction.entityType, primaryAction.entityId);
    toast('Skipped');
    advance('↷ Skipped — next...');
  };

  const handleSnooze = () => {
    if (!primaryAction) return;
    recordAction(primaryAction.id, 'ignored', primaryAction.entityType, primaryAction.entityId);
    toast('Snoozed 30 min');
    advance('⏰ Snoozed — next...');
  };

  const showEscalation = primaryAction?.escalation === 'critical' || primaryAction?.escalation === 'high';
  const extSystem = primaryAction ? inferExternalSystem(primaryAction.entityType) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-xl border p-4 space-y-3',
        BAND_STYLES[band] || BAND_STYLES['on-pace']
      )}
    >
      {/* Header: Operating State + Live Mode indicator */}
      <div className="flex items-center gap-2">
        <div className={cn('w-2 h-2 rounded-full shrink-0 animate-pulse', BAND_DOT[band])} />
        <span className="text-sm font-medium text-foreground flex-1">{sentence}</span>
        {liveMode && (
          <button
            onClick={() => setLiveModeOverride(prev => prev === null ? false : prev ? false : true)}
            className="flex items-center gap-1 text-[10px] font-medium text-primary/80 hover:text-primary transition-colors"
          >
            <Radio className="h-3 w-3" />
            LIVE
          </button>
        )}
        {!liveMode && isLiveBlock && (
          <button
            onClick={() => setLiveModeOverride(true)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Live off
          </button>
        )}
      </div>

      {/* Primary Action */}
      <AnimatePresence mode="wait">
        {primaryAction && !dismissed ? (
          <motion.div
            key={primaryAction.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            className="bg-card/80 rounded-lg border border-border/50 p-3 space-y-2"
          >
            {/* ── LIVE MODE: compact ── */}
            {liveMode && !expanded ? (
              <>
                <div className="flex items-start gap-2">
                  {showEscalation ? (
                    <AlertTriangle className={cn('h-4 w-4 mt-0.5 shrink-0', ESCALATION_STYLES[primaryAction.escalation!])} />
                  ) : (
                    <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground leading-tight">
                      {primaryAction.action}
                    </p>
                    {primaryAction.entityName && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {primaryAction.entityName} · {primaryAction.why}
                      </p>
                    )}
                  </div>
                </div>

                {/* Compact actions + expand */}
                <div className="flex items-center gap-1.5 pt-0.5">
                  <Button size="sm" variant="default" className="h-6 text-xs gap-1 px-2" onClick={handleDone}>
                    <Check className="h-3 w-3" /> Done
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 px-2 text-muted-foreground" onClick={handleSkip}>
                    <SkipForward className="h-3 w-3" /> Skip
                  </Button>
                  <div className="flex-1" />
                  <button
                    onClick={() => setExpanded(true)}
                    className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
                  >
                    <ChevronDown className="h-3 w-3" /> More
                  </button>
                </div>
              </>
            ) : (
              /* ── FULL MODE (or expanded live) ── */
              <>
                <div className="flex items-start gap-2">
                  {showEscalation ? (
                    <AlertTriangle className={cn('h-4 w-4 mt-0.5 shrink-0', ESCALATION_STYLES[primaryAction.escalation!])} />
                  ) : (
                    <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground leading-tight">
                      {primaryAction.action}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {primaryAction.why}
                    </p>
                  </div>
                  {liveMode && expanded && (
                    <button
                      onClick={() => setExpanded(false)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ArrowRight className="h-3 w-3" />
                  <span>{primaryAction.nextStep}</span>
                </div>

                {extSystem && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                    <ExternalLink className="h-3 w-3" />
                    <span>Execute in {extSystem}</span>
                  </div>
                )}

                {primaryAction.delayConsequence && showEscalation && (
                  <p className={cn('text-xs italic', ESCALATION_STYLES[primaryAction.escalation!])}>
                    ⚠ {primaryAction.delayConsequence}
                  </p>
                )}

                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={handleDone}>
                    <Check className="h-3 w-3" /> Done
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-muted-foreground" onClick={handleBlocked}>
                    <Ban className="h-3 w-3" /> Blocked
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" onClick={handleSkip}>
                    <SkipForward className="h-3 w-3" /> Skip
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" onClick={handleSnooze}>
                    <Clock className="h-3 w-3" /> 30m
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        ) : dismissed ? (
          <motion.div
            key="dismissed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs text-muted-foreground text-center py-2"
          >
            {dismissLabel}
          </motion.div>
        ) : (
          <motion.div
            key="clear"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs text-muted-foreground text-center py-2"
          >
            ✅ No urgent actions — execute at will.
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
