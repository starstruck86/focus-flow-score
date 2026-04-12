/**
 * "In Your Next Rep" Card — Phase 2
 *
 * Translates the KI into exact execution guidance for the next rep.
 * Answers: "What should I say when this moment shows up?"
 */

import { Card, CardContent } from '@/components/ui/card';
import { Crosshair, MessageSquareQuote, Zap, AlertTriangle } from 'lucide-react';
import type { KnowledgeItem } from '@/hooks/useKnowledgeItems';
import { getMistakeEntry } from '@/lib/dojo/mistakeTaxonomy';

interface Props {
  ki: KnowledgeItem;
  topMistake?: string | null;
}

const SKILL_TRIGGERS: Record<string, string> = {
  objection_handling: 'When the buyer pushes back',
  discovery: 'When the answer feels surface-level',
  deal_control: 'When next steps are vague',
  executive_response: 'When a senior stakeholder challenges your position',
  qualification: 'When commitment signals are unclear',
};

export function NextRepExecutionCard({ ki, topMistake }: Props) {
  const momentTrigger = ki.when_to_use
    || SKILL_TRIGGERS[ki.chapter ?? '']
    || 'When this moment shows up in your next conversation';

  const whatToSay = ki.example_usage || ki.how_to_execute || null;
  const executionReminder = ki.how_to_execute
    ? ki.how_to_execute.length > 160
      ? ki.how_to_execute.slice(0, 157) + '…'
      : ki.how_to_execute
    : null;

  const mistakeEntry = topMistake ? getMistakeEntry(topMistake) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Crosshair className="h-3.5 w-3.5 text-primary" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          In Your Next Rep
        </p>
      </div>

      <Card className="border-primary/15">
        <CardContent className="p-4 space-y-3">
          {/* Moment Trigger */}
          <div className="flex gap-2">
            <Crosshair className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-foreground leading-relaxed">
              <span className="font-medium">When this shows up: </span>
              {momentTrigger}
            </p>
          </div>

          {/* What You Should Say */}
          {whatToSay && (
            <div className="bg-primary/5 rounded-md p-3">
              <div className="flex gap-2">
                <MessageSquareQuote className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    Say something like
                  </p>
                  <p className="text-xs text-foreground leading-relaxed italic">
                    "{whatToSay}"
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Execution Reminder */}
          {executionReminder && executionReminder !== whatToSay && (
            <div className="flex gap-2">
              <Zap className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
              <p className="text-xs text-foreground leading-relaxed">
                <span className="font-medium">Key move: </span>
                {executionReminder}
              </p>
            </div>
          )}

          {/* Failure Pattern */}
          {mistakeEntry && (
            <div className="flex gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-foreground leading-relaxed">
                <span className="font-medium">Watch out: </span>
                {mistakeEntry.whyItHurts}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
