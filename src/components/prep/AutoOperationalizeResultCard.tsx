/**
 * AutoOperationalizeResult — shows pipeline outcome after resource upload/fix
 */

import { CheckCircle2, AlertCircle, ArrowRight, Zap, Tag, Brain, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type AutoOperationalizeResult,
  type PipelineStage,
  PIPELINE_STAGES,
  getStageLabel,
} from '@/lib/autoOperationalize';

interface Props {
  result: AutoOperationalizeResult;
  compact?: boolean;
}

export function AutoOperationalizeResultCard({ result, compact }: Props) {
  const {
    resourceTitle,
    stagesCompleted,
    currentStage,
    tagsAdded,
    knowledgeExtracted,
    knowledgeActivated,
    operationalized,
    needsReview,
    reason,
  } = result;

  if (compact) {
    return (
      <div className={cn(
        'flex items-center gap-2 text-sm px-3 py-2 rounded-md border',
        operationalized ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' :
        needsReview ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800' :
        'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800'
      )}>
        {operationalized ? (
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
        ) : needsReview ? (
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
        ) : (
          <Zap className="h-4 w-4 text-blue-600 shrink-0" />
        )}
        <span className="truncate">
          {operationalized
            ? `Operationalized — ${knowledgeExtracted} extracted, ${knowledgeActivated} activated`
            : needsReview
            ? reason || 'Needs review'
            : `${getStageLabel(currentStage)} — ${knowledgeExtracted} extracted`}
        </span>
      </div>
    );
  }

  return (
    <div className={cn(
      'rounded-lg border p-4 space-y-3',
      operationalized ? 'border-green-200 bg-green-50/50 dark:bg-green-950/20' :
      needsReview ? 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/20' :
      'border-border bg-card'
    )}>
      {/* Title + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h4 className="text-sm font-medium truncate max-w-[280px]">{resourceTitle}</h4>
          <p className={cn(
            'text-xs font-medium',
            operationalized ? 'text-green-700 dark:text-green-400' :
            needsReview ? 'text-amber-700 dark:text-amber-400' :
            'text-blue-700 dark:text-blue-400'
          )}>
            {operationalized
              ? 'Fully Operationalized'
              : needsReview
              ? 'Needs Review'
              : getStageLabel(currentStage)}
          </p>
        </div>
        {operationalized ? (
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
        ) : needsReview ? (
          <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
        ) : (
          <Zap className="h-5 w-5 text-blue-600 shrink-0" />
        )}
      </div>

      {/* Pipeline stages */}
      <div className="flex items-center gap-1 flex-wrap">
        {PIPELINE_STAGES.map((stage, i) => {
          const completed = stagesCompleted.includes(stage);
          const isCurrent = stage === currentStage;
          return (
            <div key={stage} className="flex items-center gap-1">
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                completed
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                  : isCurrent
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                  : 'bg-muted text-muted-foreground'
              )}>
                {getStageLabel(stage)}
              </span>
              {i < PIPELINE_STAGES.length - 1 && (
                <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
              )}
            </div>
          );
        })}
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {tagsAdded.length > 0 && (
          <span className="flex items-center gap-1">
            <Tag className="h-3 w-3" />
            {tagsAdded.length} tags added
          </span>
        )}
        {knowledgeExtracted > 0 && (
          <span className="flex items-center gap-1">
            <Brain className="h-3 w-3" />
            {knowledgeExtracted} extracted
          </span>
        )}
        {knowledgeActivated > 0 && (
          <span className="flex items-center gap-1">
            <Play className="h-3 w-3" />
            {knowledgeActivated} activated
          </span>
        )}
      </div>

      {/* Reason if needs review */}
      {needsReview && reason && (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-100/50 dark:bg-amber-900/20 rounded px-2 py-1.5">
          {reason}
        </p>
      )}
    </div>
  );
}
