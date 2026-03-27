/**
 * Capability Prompt Card
 *
 * Compact, dismissible capability awareness prompt embedded in Prep flow.
 * Shows exactly one context-specific prompt when there's a strong signal.
 */

import { useState, useEffect, useCallback } from 'react';
import { Lightbulb, Play, CheckCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getCapabilityPrompt, type CapabilityPrompt, type CapabilityContext } from '@/lib/capabilityEngine';
import { recordCapabilityEvent } from '@/lib/capabilityEvents';
import { useCopilot } from '@/contexts/CopilotContext';

interface CapabilityPromptCardProps {
  context: CapabilityContext;
}

export function CapabilityPromptCard({ context }: CapabilityPromptCardProps) {
  const [prompt, setPrompt] = useState<CapabilityPrompt | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const { ask: askCopilot } = useCopilot();

  useEffect(() => {
    const p = getCapabilityPrompt(context);
    setPrompt(p);
    setDismissed(false);
    if (p) {
      recordCapabilityEvent({ promptId: p.suppressionKey, eventType: 'shown', contextType: context.recommendedPlaybookType, stage: context.dealStage });
    }
  }, [context.dealStage, context.dealName, context.recommendedPlaybookTitle]);

  const handleDismiss = useCallback(() => {
    if (prompt) {
      recordCapabilityEvent({ promptId: prompt.suppressionKey, eventType: 'ignored', contextType: context.recommendedPlaybookType, stage: context.dealStage });
    }
    setDismissed(true);
  }, [prompt, context]);

  const handlePractice = useCallback(() => {
    if (!prompt) return;
    recordCapabilityEvent({ promptId: prompt.suppressionKey, eventType: 'accepted', contextType: context.recommendedPlaybookType, stage: context.dealStage });
    askCopilot(`Practice ${prompt.skillFocus} scenarios for ${context.dealName || 'my current deal'}`, 'deal-strategy');
  }, [prompt, context, askCopilot]);

  const handleApply = useCallback(() => {
    if (!prompt) return;
    recordCapabilityEvent({ promptId: prompt.suppressionKey, eventType: 'used', contextType: context.recommendedPlaybookType, stage: context.dealStage });
    askCopilot(`Apply ${prompt.skillFocus} to ${context.dealName || 'my current deal'}`, 'deal-strategy');
  }, [prompt, context, askCopilot]);

  if (!prompt || dismissed) return null;

  const TIER_LABEL: Record<string, string> = {
    best_practice: 'Best Practice',
    emerging_pattern: 'Pattern',
    data_confirmed: 'Your Data',
  };

  return (
    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-muted/30 border border-border/40">
      <Lightbulb className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Badge variant="outline" className="text-[9px] h-4 px-1.5">{TIER_LABEL[prompt.type]}</Badge>
          <span className="text-[9px] text-muted-foreground">{prompt.skillFocus}</span>
        </div>
        <p className="text-[11px] text-foreground leading-snug">{prompt.message}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 italic">{prompt.whyNow}</p>
        {prompt.ctaType && (
          <div className="flex gap-1.5 mt-1.5">
            {prompt.ctaType === 'practice' && (
              <Button size="sm" variant="outline" className="h-5 text-[9px] px-2" onClick={handlePractice}>
                <Play className="h-2.5 w-2.5 mr-1" /> Practice
              </Button>
            )}
            {prompt.ctaType === 'apply' && (
              <Button size="sm" variant="outline" className="h-5 text-[9px] px-2" onClick={handleApply}>
                <CheckCircle className="h-2.5 w-2.5 mr-1" /> Apply
              </Button>
            )}
          </div>
        )}
      </div>
      <button
        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-0.5"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
