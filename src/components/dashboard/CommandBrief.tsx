// Command Brief — the Jarvis layer UI surface
// ONE state sentence + ONE primary action. No noise.
// External execution model: actions happen in Salesforce/Outreach,
// user confirms here with one tap.

import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Check, SkipForward, ArrowRight, AlertTriangle, ExternalLink } from 'lucide-react';
import { useOperatingState } from '@/hooks/useOperatingState';
import { usePrimaryAction } from '@/hooks/usePrimaryAction';
import { useActionMemory } from '@/hooks/useActionMemory';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useState } from 'react';

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

/** Infer which external system to reference based on entity type */
function inferExternalSystem(entityType: string): string | null {
  if (entityType === 'opportunity' || entityType === 'renewal') return 'Salesforce';
  if (entityType === 'account') return 'Outreach / Salesloft';
  return null;
}

export function CommandBrief() {
  const { sentence, band } = useOperatingState();
  const primaryAction = usePrimaryAction();
  const { recordAction } = useActionMemory();
  const [dismissed, setDismissed] = useState(false);

  const handleComplete = () => {
    if (primaryAction) {
      recordAction(primaryAction.id, 'completed', primaryAction.entityType, primaryAction.entityId);
      toast.success('Confirmed ✓', { description: 'Advancing to next action...' });
      setDismissed(true);
      setTimeout(() => setDismissed(false), 2000);
    }
  };

  const handleSkip = () => {
    if (primaryAction) {
      recordAction(primaryAction.id, 'deferred', primaryAction.entityType, primaryAction.entityId);
      toast('Skipped — next action loading');
      setDismissed(true);
      setTimeout(() => setDismissed(false), 2000);
    }
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
      {/* Operating State — one line */}
      <div className="flex items-center gap-2">
        <div className={cn('w-2 h-2 rounded-full shrink-0 animate-pulse', BAND_DOT[band])} />
        <span className="text-sm font-medium text-foreground">{sentence}</span>
      </div>

      {/* Primary Action — one action only */}
      <AnimatePresence mode="wait">
        {primaryAction && !dismissed ? (
          <motion.div
            key={primaryAction.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            className="bg-card/80 rounded-lg border border-border/50 p-3 space-y-2"
          >
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
            </div>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ArrowRight className="h-3 w-3" />
              <span>{primaryAction.nextStep}</span>
            </div>

            {/* External system hint */}
            {extSystem && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                <ExternalLink className="h-3 w-3" />
                <span>Execute in {extSystem}</span>
              </div>
            )}

            {/* Delay consequence — only shown for high/critical escalation */}
            {primaryAction.delayConsequence && showEscalation && (
              <p className={cn('text-xs italic', ESCALATION_STYLES[primaryAction.escalation!])}>
                ⚠ {primaryAction.delayConsequence}
              </p>
            )}

            {/* One-tap confirm / skip — external execution model */}
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs gap-1"
                onClick={handleComplete}
              >
                <Check className="h-3 w-3" />
                Done
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1 text-muted-foreground"
                onClick={handleSkip}
              >
                <SkipForward className="h-3 w-3" />
                Skip
              </Button>
            </div>
          </motion.div>
        ) : dismissed ? (
          <motion.div
            key="dismissed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs text-muted-foreground text-center py-2"
          >
            ✓ Loading next action...
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
