/**
 * Resource Inspect Drawer — tabbed deep inspection: Overview · Content · Knowledge.
 */
import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Zap, Play, Eye, Wrench, FileText, RotateCcw,
  History, ArrowRight, ShieldCheck, ShieldAlert, Clock, MinusCircle,
} from 'lucide-react';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';
import {
  type ControlPlaneState,
  CONTROL_PLANE_LABELS, CONTROL_PLANE_COLORS,
} from '@/lib/controlPlaneState';
import { getResourceActionHistory, type ActionOutcome, type ReconciliationVerdict } from '@/lib/actionOutcomeStore';
import { useResourceInspectData } from '@/hooks/useResourceInspectData';
import { InspectOverviewTab } from './inspect/InspectOverviewTab';
import { InspectContentTab } from './inspect/InspectContentTab';
import { InspectKnowledgeTab } from './inspect/InspectKnowledgeTab';

interface Props {
  resource: CanonicalResourceStatus | null;
  state: ControlPlaneState | null;
  open: boolean;
  onClose: () => void;
  onAction: (resourceId: string, action: string) => void;
  actionLoading?: boolean;
  /** If set, open directly to this tab */
  initialTab?: 'overview' | 'content' | 'knowledge';
}

const RECONCILIATION_CONFIG: Record<ReconciliationVerdict, { icon: React.ElementType; label: string; className: string }> = {
  confirmed: { icon: ShieldCheck, label: 'Confirmed', className: 'text-emerald-600' },
  partial: { icon: ArrowRight, label: 'Partial', className: 'text-amber-600' },
  mismatched: { icon: ShieldAlert, label: 'Mismatched', className: 'text-destructive' },
  pending: { icon: Clock, label: 'Pending', className: 'text-muted-foreground' },
};

export function ResourceInspectDrawer({ resource, state, open, onClose, onAction, actionLoading, initialTab }: Props) {
  const [activeTab, setActiveTab] = useState<string>(initialTab ?? 'overview');

  const resourceId = open && resource ? resource.resource_id : null;
  const { resource: detail, knowledgeItems, loading, error } = useResourceInspectData(resourceId);

  const handleNavigateTab = useCallback((tab: string) => setActiveTab(tab), []);

  // Reset tab when initialTab changes or drawer opens with a new resource
  const [lastResourceId, setLastResourceId] = useState<string | null>(null);
  if (resourceId && resourceId !== lastResourceId) {
    setLastResourceId(resourceId);
    setActiveTab(initialTab ?? 'overview');
  }

  if (!resource || !state) return null;

  const colors = CONTROL_PLANE_COLORS[state];
  const actions = getActionsForState(state, resource);
  const actionHistory = getResourceActionHistory(resource.resource_id);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:w-[440px] md:w-[500px] overflow-y-auto p-0">
        {/* ── Header ── */}
        <div className="px-6 pt-6 pb-3 space-y-2">
          <SheetTitle className="text-sm font-semibold leading-tight pr-6">
            {resource.title}
          </SheetTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn('text-[10px]', colors.text, colors.bg, colors.border)}>
              {CONTROL_PLANE_LABELS[state]}
            </Badge>
            <span className="text-[10px] text-muted-foreground">{detail?.resource_type ?? '—'}</span>
          </div>

          {/* ── Quick Actions ── */}
          {actions.length > 0 && (
            <div className="flex gap-1.5 flex-wrap pt-1">
              {actions.map(a => (
                <Button
                  key={a.key}
                  variant={a.primary ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-[11px] gap-1.5"
                  onClick={() => onAction(resource.resource_id, a.key)}
                  disabled={actionLoading}
                >
                  <a.icon className="h-3 w-3" />
                  {a.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* ── Tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1">
          <TabsList className="mx-6 mt-3 mb-0 h-8 w-auto self-start">
            <TabsTrigger value="overview" className="text-[11px] px-3 h-6">Overview</TabsTrigger>
            <TabsTrigger value="content" className="text-[11px] px-3 h-6">Content</TabsTrigger>
            <TabsTrigger value="knowledge" className="text-[11px] px-3 h-6">
              Knowledge
              {resource.knowledge_item_count > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[9px] px-1 py-0 h-4">
                  {resource.knowledge_item_count}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="px-6 pb-6">
            <TabsContent value="overview" className="mt-3">
              <InspectOverviewTab
                canonical={resource}
                state={state}
                detail={detail}
                loading={loading}
                onNavigateTab={handleNavigateTab}
              />
              {/* Action History — kept in overview for forensic context */}
              {actionHistory.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <History className="h-3 w-3" />
                    Recent Actions
                  </h4>
                  <div className="space-y-1.5">
                    {actionHistory.slice(0, 3).map(a => (
                      <ActionHistoryEntry key={a.id} outcome={a} />
                    ))}
                    {actionHistory.length > 3 && (
                      <p className="text-[10px] text-muted-foreground/70 italic">
                        …and {actionHistory.length - 3} older
                      </p>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="content" className="mt-3">
              <InspectContentTab detail={detail} loading={loading} />
            </TabsContent>

            <TabsContent value="knowledge" className="mt-3">
              <InspectKnowledgeTab
                knowledgeItems={knowledgeItems}
                loading={loading}
              />
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ── Action History Entry ───────────────────────────────────
function ActionHistoryEntry({ outcome }: { outcome: ActionOutcome }) {
  const reconcileCfg = RECONCILIATION_CONFIG[outcome.reconciliation];
  const ReconcileIcon = reconcileCfg.icon;
  const fromColors = CONTROL_PLANE_COLORS[outcome.expectedFromState];
  const actualTo = outcome.reconciledToState ?? outcome.mutationToState;
  const toColors = CONTROL_PLANE_COLORS[actualTo];

  return (
    <div className="rounded-md border bg-muted/30 px-2.5 py-2 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{outcome.actionLabel}</span>
        <div className="flex items-center gap-1">
          <ReconcileIcon className={cn('h-3 w-3', reconcileCfg.className)} />
          <span className={cn('text-[10px] font-medium', reconcileCfg.className)}>
            {reconcileCfg.label}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[10px]">
        <Badge variant="outline" className={cn('text-[9px] px-1 py-0', fromColors.text, fromColors.bg, fromColors.border)}>
          {CONTROL_PLANE_LABELS[outcome.expectedFromState]}
        </Badge>
        <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
        <Badge variant="outline" className={cn('text-[9px] px-1 py-0', toColors.text, toColors.bg, toColors.border)}>
          {CONTROL_PLANE_LABELS[actualTo]}
        </Badge>
      </div>
      {outcome.mismatchExplanation && (
        <p className="text-[10px] text-amber-600 italic">{outcome.mismatchExplanation}</p>
      )}
      <span className="text-[10px] text-muted-foreground/60">
        {new Date(outcome.timestamp).toLocaleString()}
      </span>
    </div>
  );
}

// ── Action model per state ─────────────────────────────────
interface ActionDef {
  key: string;
  label: string;
  icon: React.ElementType;
  primary: boolean;
}

function getActionsForState(state: ControlPlaneState, resource: CanonicalResourceStatus): ActionDef[] {
  switch (state) {
    case 'ingested':
      return [{ key: 'enrich', label: 'Enrich', icon: FileText, primary: true }];
    case 'has_content':
      return [{ key: 'extract', label: 'Extract', icon: Zap, primary: true }];
    case 'extracted':
      return [
        { key: 'activate', label: 'Activate', icon: Play, primary: true },
        { key: 'extract', label: 'Re-extract', icon: Zap, primary: false },
      ];
    case 'activated':
      return [{ key: 'extract', label: 'Re-extract', icon: Zap, primary: false }];
    case 'blocked': {
      const actions: ActionDef[] = [];
      if (['no_extraction', 'stale_blocker_state'].includes(resource.blocked_reason)) {
        actions.push({ key: 'fix', label: 'Diagnose & Repair', icon: Wrench, primary: true });
      }
      if (resource.blocked_reason === 'no_activation' || resource.blocked_reason === 'missing_contexts') {
        actions.push({ key: 'activate', label: 'Activate', icon: Play, primary: true });
      }
      if (resource.blocked_reason === 'empty_content') {
        actions.push({ key: 'enrich', label: 'Enrich', icon: FileText, primary: true });
      }
      return actions;
    }
    case 'processing':
      return [{ key: 'view_progress', label: 'View Progress', icon: Eye, primary: false }];
    default:
      return [];
  }
}
