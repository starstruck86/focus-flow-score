/**
 * ResourceCard — mobile-first action card for the resource list.
 * Shows title, signal strength, readiness, and next action.
 * Expandable for details.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown, ChevronUp, MoreVertical, Eye, Trash2,
  RotateCcw, Star, BookOpen, RefreshCw, Zap, HelpCircle,
  CheckCircle2, AlertTriangle, TrendingUp, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Resource } from '@/hooks/useResources';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';
import { deriveResourceInsight, type ResourceInsight } from '@/lib/resourceSignal';
import { deriveProcessingState } from '@/lib/processingState';
import { decodeHTMLEntities } from '@/lib/stringUtils';
import { useResourceJobProgress, getJobLabel, isJobStale } from '@/store/useResourceJobProgress';
import { routeFailure, getFailureBucketActions } from '@/lib/failureRouting';
import { deriveProcessingRoute, getRouteLabel, ASSET_LABELS } from '@/lib/processingRoute';

interface Props {
  resource: Resource;
  lc: { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number } | undefined;
  audioJob: AudioJobRecord | null;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onAction: (action: string, resource: Resource) => void;
}

const SIGNAL_ICON: Record<string, React.ReactNode> = {
  high: <CheckCircle2 className="h-3 w-3 text-emerald-600" />,
  medium: <TrendingUp className="h-3 w-3 text-amber-600" />,
  low: <AlertTriangle className="h-3 w-3 text-muted-foreground" />,
};

export function ResourceCard({ resource, lc, audioJob, isSelected, onToggleSelect, onAction }: Props) {
  const [expanded, setExpanded] = useState(false);
  const insight = deriveResourceInsight(resource, lc, audioJob);
  const liveJob = useResourceJobProgress(s => s.resources[resource.id]);

  const decoded = decodeHTMLEntities(resource.title);
  const separatorIdx = decoded.indexOf(' > ');
  const parentName = separatorIdx > 0 ? decoded.slice(0, separatorIdx) : null;
  const childName = separatorIdx > 0 ? decoded.slice(separatorIdx + 3) : decoded;

  return (
    <div className={cn(
      'rounded-lg border transition-colors',
      isSelected ? 'border-primary bg-primary/5' : 'border-border bg-card',
    )}>
      {/* Main row */}
      <div className="flex items-start gap-2 p-3">
        {/* Checkbox */}
        <div className="pt-0.5" onClick={e => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(resource.id)}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1.5" onClick={() => setExpanded(!expanded)}>
          {/* Title */}
          <div className="space-y-0.5">
            {parentName && (
              <p className="text-[10px] text-muted-foreground truncate">{parentName}</p>
            )}
            <p className="text-sm font-medium text-foreground leading-tight line-clamp-2">{childName}</p>
          </div>

          {/* Signal + Readiness row */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              {SIGNAL_ICON[insight.signal.signal]}
              <span className={cn('text-[10px] font-medium', insight.signal.signalColor)}>
                {insight.signal.signalLabel}
              </span>
            </div>
            <Badge className={cn(
              'text-[10px] h-5 px-1.5 font-medium',
              insight.readiness.readinessBg,
              insight.readiness.readinessColor,
            )}>
              {insight.readiness.readinessLabel}
            </Badge>
            {lc && lc.kiCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {lc.activeKi}/{lc.kiCount} KI
              </span>
            )}
          </div>

          {/* Live job progress */}
          {liveJob && liveJob.status === 'running' && (
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              <span className="text-[10px] text-muted-foreground">{getJobLabel(liveJob.jobType, 'running')}</span>
            </div>
          )}
        </div>

        {/* Action area */}
        <div className="flex items-center gap-1 shrink-0">
          {insight.nextAction ? (
            <Button
              size="sm"
              variant={insight.nextAction.variant}
              className="h-7 text-xs px-2.5"
              onClick={e => { e.stopPropagation(); onAction(insight.nextAction!.actionKey, resource); }}
            >
              {insight.nextAction.label}
            </Button>
          ) : (
            <Badge className="text-[10px] h-5 bg-emerald-500/10 text-emerald-600 px-2">
              Complete
            </Badge>
          )}

          {/* More menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onAction('view', resource)}>
                <Eye className="h-3.5 w-3.5 mr-2" /> Inspect
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onAction('mark_template', resource)}>
                <Star className="h-3.5 w-3.5 mr-2" /> Use as Template
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction('mark_example', resource)}>
                <BookOpen className="h-3.5 w-3.5 mr-2" /> Mark as Example
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onAction('reset', resource)}>
                <RotateCcw className="h-3.5 w-3.5 mr-2" /> Reset Status
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => onAction('delete', resource)}>
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Expand toggle */}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (() => {
        const route = deriveProcessingRoute(resource);
        return (
        <div className="border-t border-border px-3 py-2 space-y-1.5 bg-muted/30">
          {/* Route line */}
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">Route:</span>
            <span className="font-medium text-primary">{getRouteLabel(route)}</span>
            <Badge variant="outline" className={cn('text-[8px] h-3.5 ml-1',
              route.confidence === 'high' && 'border-emerald-500/30 text-emerald-600',
              route.confidence === 'medium' && 'border-amber-500/30 text-amber-600',
              route.confidence === 'low' && 'border-muted-foreground/30 text-muted-foreground',
            )}>{route.confidence}</Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="text-muted-foreground">Type:</span>
            <span className="capitalize font-medium">{resource.resource_type}</span>
            {lc && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">Stage:</span>
                <span className="font-medium">{lc.stage.replace(/_/g, ' ')}</span>
              </>
            )}
          </div>
          {lc && lc.blocked !== 'none' && (
            <div className="flex items-center gap-1 text-[11px]">
              <AlertTriangle className="h-3 w-3 text-destructive" />
              <span className="text-destructive font-medium">
                {lc.blocked.replace(/_/g, ' ')}
              </span>
            </div>
          )}
          {resource.enrichment_status && (
            <div className="text-[11px] text-muted-foreground">
              Enrichment: {resource.enrichment_status.replace(/_/g, ' ')}
              {resource.enrichment_version ? ` · v${resource.enrichment_version}` : ''}
            </div>
          )}
          {(resource as any).last_quality_score != null && (
            <div className="text-[11px] text-muted-foreground">
              Quality: {Math.round((resource as any).last_quality_score)} / 100
            </div>
          )}
        </div>
        );
      })()}

    </div>
  );
}
