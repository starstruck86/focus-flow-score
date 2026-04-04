/**
 * ResourceInspectPanel — Full redesigned inspect experience.
 * 8 sections: Identity, Pipeline Route, Processing Timeline, Quality/Trust,
 * Failure Dossier, Downstream Eligibility, Next Action, Attempt History, Source/KI Preview.
 */
import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ChevronUp, ExternalLink, Pencil, Check, X, Loader2,
  CheckCircle2, AlertTriangle, ArrowRight, Clock, Shield,
  FileText, Code, Copy, Eye, Info, Zap, TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useCanonicalLifecycle } from '@/hooks/useCanonicalLifecycle';
import { deriveProcessingState, getProcessingStateColor } from '@/lib/processingState';
import { deriveResourceInsight } from '@/lib/resourceSignal';
import { deriveResourceTruth } from '@/lib/resourceTruthState';
import { getResourceOrigin } from '@/lib/resourceEligibility';
import { decodeHTMLEntities } from '@/lib/stringUtils';
import { detectDrift } from '@/lib/resourceLifecycle';
import { isAudioResource } from '@/lib/salesBrain/audioPipeline';
import { buildFailureDossier, FAILURE_STAGE_LABELS, FAILURE_MODE_LABELS, type ResourceFailureDossier } from '@/lib/failureDossier';
import { ROOT_CAUSE_LABELS, ROOT_CAUSE_COLORS } from '@/lib/rootCauseDiagnosis';
import {
  deriveProcessingRoute, PIPELINE_LABELS, EXTRACTION_METHOD_LABELS, ORIGIN_TYPE_LABELS, ASSET_LABELS,
  type Pipeline, type ExtractionMethod, type AssetKind, type RouteOverride,
} from '@/lib/processingRoute';
import { useResourceJobProgress, getJobLabel, isJobStale } from '@/store/useResourceJobProgress';
import type { Resource } from '@/hooks/useResources';
import type { KnowledgeItem } from '@/hooks/useKnowledgeItems';

interface Props {
  resource: Resource;
  onClose: () => void;
  onAction: (action: string, resource: Resource) => void;
}

// ── A. Identity Section ────────────────────────────────────
function IdentitySection({ resource, onClose, onAction }: Props) {
  const qc = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(resource.title);
  const [saving, setSaving] = useState(false);
  const displayTitle = decodeHTMLEntities(resource.title);
  const separatorIdx = displayTitle.indexOf(' > ');
  const parentName = separatorIdx > 0 ? displayTitle.slice(0, separatorIdx) : null;
  const childName = separatorIdx > 0 ? displayTitle.slice(separatorIdx + 3) : displayTitle;

  const handleSaveTitle = async () => {
    if (!editTitle.trim() || editTitle.trim() === resource.title) { setIsEditing(false); return; }
    setSaving(true);
    try {
      await supabase.from('resources').update({ title: editTitle.trim(), updated_at: new Date().toISOString() } as any).eq('id', resource.id);
      toast.success('Title updated');
      qc.invalidateQueries({ queryKey: ['resources'] });
      setIsEditing(false);
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const r = resource as any;
  const tags = r.tags as string[] | null;

  return (
    <div className="px-4 py-3 bg-muted/30 border-b border-border space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-1.5">
              <Input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                className="h-7 text-sm font-semibold max-w-[300px]" autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') { setIsEditing(false); setEditTitle(resource.title); } }} />
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleSaveTitle} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setIsEditing(false); setEditTitle(resource.title); }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {parentName && <p className="text-[10px] text-muted-foreground">{parentName}</p>}
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-semibold text-foreground truncate">{childName}</h3>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-50 hover:opacity-100" onClick={() => setIsEditing(true)}>
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {resource.file_url && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
              <a href={resource.file_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}><ChevronUp className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
        <Badge variant="outline" className="text-[9px] capitalize">{resource.resource_type}</Badge>
        {r.resolution_method && <Badge variant="outline" className="text-[9px]">{r.resolution_method.replace(/_/g, ' ')}</Badge>}
        {resource.updated_at && <span className="text-muted-foreground">Updated {new Date(resource.updated_at).toLocaleDateString()}</span>}
        {tags && tags.length > 0 && tags.map(t => (
          <Badge key={t} variant="secondary" className="text-[8px] h-4">{t}</Badge>
        ))}
      </div>
    </div>
  );
}

// ── B. Pipeline Route ──────────────────────────────────────
function PipelineRouteSection({ resource, onAction }: { resource: Resource; onAction: (action: string, resource: Resource) => void }) {
  const { summary } = useCanonicalLifecycle();
  const qc = useQueryClient();
  const status = summary?.resources.find(r => r.resource_id === resource.id);
  const ps = deriveProcessingState(resource);
  const drift = detectDrift(resource);
  const route = deriveProcessingRoute(resource);
  const [showOverride, setShowOverride] = useState(false);
  const [overridePipeline, setOverridePipeline] = useState<Pipeline>(route.pipeline);
  const [overrideMethod, setOverrideMethod] = useState<ExtractionMethod>(route.extraction_method);
  const [overrideAsset, setOverrideAsset] = useState<AssetKind>(route.primary_asset);
  const [overrideReason, setOverrideReason] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  const insight = deriveResourceInsight(resource, status ? {
    stage: status.canonical_stage,
    blocked: status.blocked_reason,
    kiCount: status.knowledge_item_count,
    activeKi: status.active_ki_count,
    activeKiWithCtx: status.active_ki_with_context_count,
  } : undefined);

  const handleSaveOverride = async () => {
    setSavingOverride(true);
    try {
      const override: RouteOverride = {
        pipeline: overridePipeline,
        extraction_method: overrideMethod,
        primary_asset: overrideAsset,
        reason: overrideReason || 'Manual override',
      };
      await supabase.from('resources').update({
        route_override: override as any,
        updated_at: new Date().toISOString(),
      } as any).eq('id', resource.id);
      toast.success('Route override saved');
      qc.invalidateQueries({ queryKey: ['resources'] });
      setShowOverride(false);
    } catch (err: any) { toast.error(err.message); }
    finally { setSavingOverride(false); }
  };

  const handleClearOverride = async () => {
    setSavingOverride(true);
    try {
      await supabase.from('resources').update({
        route_override: null,
        updated_at: new Date().toISOString(),
      } as any).eq('id', resource.id);
      toast.success('Override cleared');
      qc.invalidateQueries({ queryKey: ['resources'] });
      setShowOverride(false);
    } catch (err: any) { toast.error(err.message); }
    finally { setSavingOverride(false); }
  };

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pipeline Route</h4>
        <div className="flex items-center gap-1">
          {route.has_override && (
            <Badge className="text-[8px] h-4 bg-amber-500/15 text-amber-700 border-amber-500/30">
              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Override Active
            </Badge>
          )}
          <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1.5" onClick={() => setShowOverride(!showOverride)}>
            {showOverride ? 'Close' : 'Override'}
          </Button>
        </div>
      </div>
      {/* Origin + Assets */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Origin:</span>
          <span className="font-medium">{ORIGIN_TYPE_LABELS[route.origin_type]}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Primary Asset:</span>
          <span className="font-medium text-primary">{ASSET_LABELS[route.primary_asset]}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Pipeline:</span>
          <span className="font-medium">{PIPELINE_LABELS[route.pipeline]}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Method:</span>
          <span className="font-medium">{EXTRACTION_METHOD_LABELS[route.extraction_method]}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Confidence:</span>
          <Badge variant="outline" className={cn('text-[9px] h-4',
            route.confidence === 'high' && 'border-emerald-500/30 text-emerald-600',
            route.confidence === 'medium' && 'border-amber-500/30 text-amber-600',
            route.confidence === 'low' && 'border-muted-foreground/30 text-muted-foreground',
          )}>{route.confidence.charAt(0).toUpperCase() + route.confidence.slice(1)}</Badge>
        </div>
      </div>
      {/* Available + Secondary assets */}
      {route.secondary_assets.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          Also available: {route.secondary_assets.map(a => ASSET_LABELS[a]).join(', ')}
        </div>
      )}
      {/* Reason log */}
      {route.reason.length > 0 && (
        <div className="text-[10px] text-muted-foreground space-y-0.5 pl-1 border-l-2 border-primary/15">
          {route.reason.map((r, i) => (
            <p key={i}>• {r}</p>
          ))}
        </div>
      )}

      {/* Override controls */}
      {showOverride && (
        <div className="space-y-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <p className="text-[10px] font-semibold text-amber-700">Manual Route Override</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-muted-foreground">Primary Asset</label>
              <select className="w-full h-7 text-[11px] rounded border border-border bg-background px-1.5" value={overrideAsset} onChange={e => setOverrideAsset(e.target.value as AssetKind)}>
                {route.available_assets.map(a => <option key={a} value={a}>{ASSET_LABELS[a]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground">Pipeline</label>
              <select className="w-full h-7 text-[11px] rounded border border-border bg-background px-1.5" value={overridePipeline} onChange={e => setOverridePipeline(e.target.value as Pipeline)}>
                {Object.entries(PIPELINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground">Extraction Method</label>
              <select className="w-full h-7 text-[11px] rounded border border-border bg-background px-1.5" value={overrideMethod} onChange={e => setOverrideMethod(e.target.value as ExtractionMethod)}>
                {Object.entries(EXTRACTION_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground">Reason</label>
              <Input className="h-7 text-[11px]" placeholder="Why override?" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" className="h-6 text-[10px] px-2" onClick={handleSaveOverride} disabled={savingOverride}>
              {savingOverride ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save Override'}
            </Button>
            {route.has_override && (
              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={handleClearOverride} disabled={savingOverride}>
                Clear Override
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setShowOverride(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Signal + Readiness */}
      <div className="flex items-center gap-3 text-[11px]">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Signal:</span>
          <span className={cn('font-medium', insight.signal.signalColor)}>{insight.signal.signalLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Readiness:</span>
          <Badge className={cn('text-[9px] h-4', insight.readiness.readinessBg, insight.readiness.readinessColor)}>
            {insight.readiness.readinessLabel}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">State:</span>
          <Badge className={cn('text-[9px] h-4', getProcessingStateColor(ps.state))}>{ps.label}</Badge>
        </div>
      </div>
      {drift.hasDrift && (
        <div className="flex items-center gap-1 text-[11px] text-amber-600">
          <AlertTriangle className="h-3 w-3" />
          <span>Drift detected: {drift.issues.join(', ')}</span>
        </div>
      )}
    </div>
  );
}

// ── C. Quality / Trust Panel ───────────────────────────────
function QualityTrustSection({ resource }: { resource: Resource }) {
  const { summary } = useCanonicalLifecycle();
  const status = summary?.resources.find(r => r.resource_id === resource.id);
  const r = resource as any;
  const audit = r.extraction_audit_summary as any;

  return (
    <div className="px-4 py-3 space-y-2 border-t border-border">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Quality & Trust</h4>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <MetricPill label="KI Total" value={status?.knowledge_item_count ?? 0} />
        <MetricPill label="Active" value={status?.active_ki_count ?? 0} color={status?.active_ki_count ? 'text-emerald-600' : undefined} />
        <MetricPill label="With Context" value={status?.active_ki_with_context_count ?? 0} color={status?.active_ki_with_context_count ? 'text-emerald-600' : undefined} />
        {r.last_quality_score != null && <MetricPill label="Quality Score" value={Math.round(r.last_quality_score)} />}
        {r.last_quality_tier && <MetricPill label="Quality Tier" value={r.last_quality_tier} />}
        {r.content_length != null && <MetricPill label="Content" value={`${(r.content_length / 1000).toFixed(1)}k chars`} />}
      </div>
      {audit && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
          {audit.validation_loss != null && <MetricPill label="Validation Loss" value={audit.validation_loss} color={audit.validation_loss > 3 ? 'text-amber-600' : undefined} />}
          {audit.dedup_loss != null && <MetricPill label="Dedup Loss" value={audit.dedup_loss} />}
          {audit.floor_met != null && <MetricPill label="Floor Met" value={audit.floor_met ? '✓' : '✗'} color={audit.floor_met ? 'text-emerald-600' : 'text-destructive'} />}
          {audit.confidence_score != null && <MetricPill label="Confidence" value={`${Math.round(audit.confidence_score * 100)}%`} />}
          {audit.yield_flag && <MetricPill label="Yield" value={audit.yield_flag} color={audit.yield_flag === 'healthy' ? 'text-emerald-600' : 'text-amber-600'} />}
          {audit.best_attempt_index != null && <MetricPill label="Best Attempt" value={`#${audit.best_attempt_index + 1}`} />}
        </div>
      )}
    </div>
  );
}

function MetricPill({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-muted/40 rounded-md px-2 py-1.5">
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className={cn('text-xs font-semibold', color || 'text-foreground')}>{value}</span>
    </div>
  );
}

// ── D. Downstream Eligibility ──────────────────────────────
type EligibilityState = 'eligible' | 'not_eligible' | 'recommended';

function DownstreamEligibilitySection({ resource }: { resource: Resource }) {
  const { summary } = useCanonicalLifecycle();
  const status = summary?.resources.find(r => r.resource_id === resource.id);
  const lc = status ? {
    stage: status.canonical_stage,
    blocked: status.blocked_reason,
    kiCount: status.knowledge_item_count,
    activeKi: status.active_ki_count,
    activeKiWithCtx: status.active_ki_with_context_count,
  } : undefined;
  const truth = deriveResourceTruth(resource, lc);
  const isReady = truth.is_ready;
  const hasActiveKi = truth.active_ki_total > 0;
  const hasContexts = truth.active_ki_with_context_total > 0;

  // Read stored eligibility if present
  const r = resource as any;
  const stored = r.downstream_eligibility as Record<string, boolean> | null;

  // Derive heuristic eligibility
  // Downstream eligibility derived from canonical truth — not lifecycle stage
  const heuristic: Record<string, boolean> = {
    dave_grounding: truth.is_ready && truth.can_feed_downstream,
    playbook_gen: truth.is_ready && hasActiveKi,
    coaching: truth.is_ready && hasActiveKi && hasContexts,
    search: truth.is_ready && hasActiveKi,
  };

  // Merge: stored overrides heuristic, but show "recommended" when heuristic says yes but stored is missing
  function getState(key: string): EligibilityState {
    if (stored && key in stored) return stored[key] ? 'eligible' : 'not_eligible';
    return heuristic[key] ? 'recommended' : 'not_eligible';
  }

  const targets = [
    { key: 'dave_grounding', label: 'Dave Grounding' },
    { key: 'playbook_gen', label: 'Playbook Generation' },
    { key: 'coaching', label: 'Coaching' },
    { key: 'search', label: 'Search' },
  ];

  const stateConfig: Record<EligibilityState, { bg: string; color: string; icon: React.ReactNode; suffix?: string }> = {
    eligible: { bg: 'bg-emerald-500/10', color: 'text-emerald-600', icon: <CheckCircle2 className="h-3 w-3 mr-1" /> },
    recommended: { bg: 'bg-amber-500/10', color: 'text-amber-600', icon: <TrendingUp className="h-3 w-3 mr-1" />, suffix: '(rec.)' },
    not_eligible: { bg: 'bg-muted', color: 'text-muted-foreground', icon: <X className="h-3 w-3 mr-1" /> },
  };

  return (
    <div className="px-4 py-3 space-y-2 border-t border-border">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Downstream Eligibility</h4>
      <div className="flex items-center gap-2 flex-wrap">
        {targets.map(t => {
          const state = getState(t.key);
          const cfg = stateConfig[state];
          return (
            <Badge key={t.key} className={cn('text-[10px] h-5 px-2', cfg.bg, cfg.color)}>
              {cfg.icon}
              {t.label}
              {cfg.suffix && <span className="ml-0.5 opacity-70">{cfg.suffix}</span>}
            </Badge>
          );
        })}
      </div>
      {!isReady && (
        <p className="text-[10px] text-muted-foreground">
          {hasActiveKi
            ? 'Active KIs present but needs full operationalization for Dave grounding.'
            : 'Needs extraction and activation before feeding downstream systems.'}
        </p>
      )}
      {stored && (
        <p className="text-[9px] text-muted-foreground/70 italic">Stored eligibility overrides applied</p>
      )}
    </div>
  );
}

// ── E. Next Action (truth-driven) ──────────────────────────
function NextActionSection({ resource, onAction }: { resource: Resource; onAction: (action: string, resource: Resource) => void }) {
  const { summary } = useCanonicalLifecycle();
  const status = summary?.resources.find(r => r.resource_id === resource.id);
  const lc = status ? {
    stage: status.canonical_stage,
    blocked: status.blocked_reason,
    kiCount: status.knowledge_item_count,
    activeKi: status.active_ki_count,
    activeKiWithCtx: status.active_ki_with_context_count,
  } : undefined;
  const insight = deriveResourceInsight(resource, lc);
  const truth = insight.truth;

  // Only show "Ready — No Action Needed" when truth_state is truly ready
  if (truth.is_ready && !insight.nextAction) {
    return (
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <div>
            <p className="text-xs font-medium text-emerald-600">Ready — No Action Needed</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              This resource is fully operationalized and feeding downstream systems.
              {truth.ki_total > 0 && ` ${truth.active_ki_total}/${truth.ki_total} KIs active.`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show blocker summary when truth says not ready, even if nextAction derived
  const blockerDetail = truth.primary_blocker
    ? `${truth.primary_blocker.label}: ${truth.primary_blocker.detail}`
    : getRationale(lc, resource);

  const action = insight.nextAction ?? truth.next_required_action;

  if (!action) {
    // Not ready but no action — show state
    return (
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <div>
            <p className="text-xs font-medium text-amber-600">{truth.readiness_label}</p>
            {blockerDetail && <p className="text-[10px] text-muted-foreground mt-0.5">{blockerDetail}</p>}
            {truth.has_stuck_job && (
              <p className="text-[10px] text-destructive mt-0.5">
                Job stalled for {Math.round(truth.stuck_duration_seconds / 60)}m
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-t border-border space-y-2">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Recommended Action</h4>
      <div className="flex items-start gap-3 bg-primary/5 border border-primary/20 rounded-lg p-3">
        <Zap className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground">{action.label}</p>
          {blockerDetail && <p className="text-[10px] text-muted-foreground mt-0.5">{blockerDetail}</p>}
          {truth.has_stuck_job && (
            <p className="text-[10px] text-destructive mt-0.5">
              Job stalled for {Math.round(truth.stuck_duration_seconds / 60)}m
            </p>
          )}
        </div>
        <Button size="sm" variant={action.variant} className="h-7 text-xs shrink-0"
          onClick={() => onAction(action.actionKey, resource)}>
          {action.label}
        </Button>
      </div>
    </div>
  );
}

function getRationale(lc: any, resource: Resource): string | null {
  if (!lc) return 'Unable to determine lifecycle state.';
  switch (lc.blocked) {
    case 'no_extraction': return 'Content is available but no knowledge items have been extracted yet.';
    case 'no_activation': return 'Knowledge items exist but none are marked active.';
    case 'missing_contexts': return 'Active KIs lack context tags needed for downstream routing.';
    case 'empty_content': return 'No content available — needs enrichment or manual input.';
    case 'stale_blocker_state': return 'Resource is in a stale state that needs manual review.';
  }
  const ps = deriveProcessingState(resource);
  if (ps.state === 'RETRYABLE_FAILURE') return `Previous attempt failed: ${ps.description}. Retry may resolve.`;
  if (ps.state === 'MANUAL_REQUIRED') return 'Automated processing cannot resolve this — manual assistance needed.';
  return null;
}

// ── F. Attempt History ─────────────────────────────────────
function AttemptHistorySection({ resourceId }: { resourceId: string }) {
  const { data: attempts = [], isLoading } = useQuery({
    queryKey: ['extraction-attempts', resourceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resource_extraction_attempts')
        .select('*')
        .eq('resource_id', resourceId)
        .order('attempt_number', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  if (isLoading) return <div className="px-4 py-3 border-t border-border"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (attempts.length === 0) return null;

  return (
    <div className="px-4 py-3 border-t border-border space-y-2">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Attempt History ({attempts.length})</h4>
      <div className="space-y-1.5">
        {attempts.map((a: any) => (
          <div key={a.id} className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px]',
            a.status === 'succeeded' ? 'bg-emerald-500/5' : a.status === 'failed' ? 'bg-destructive/5' : 'bg-muted/30',
          )}>
            <span className="font-medium text-foreground w-6">#{a.attempt_number}</span>
            <Badge variant="outline" className="text-[8px] h-4">{a.strategy || 'default'}</Badge>
            <span className={cn(
              'font-medium',
              a.status === 'succeeded' ? 'text-emerald-600' : a.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
            )}>
              {a.status}
            </span>
            {a.ki_count != null && <span className="text-muted-foreground">{a.ki_count} KI</span>}
            {a.confidence_score != null && (
              <span className="text-muted-foreground">{Math.round(a.confidence_score * 100)}% conf</span>
            )}
            {a.duration_ms != null && (
              <span className="text-muted-foreground ml-auto">{(a.duration_ms / 1000).toFixed(1)}s</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── G. Source / KI Preview ─────────────────────────────────
function PreviewSection({ resource }: { resource: Resource }) {
  const { user } = useAuth();
  const r = resource as any;
  const [tab, setTab] = useState<'content' | 'knowledge'>('content');
  const [copied, setCopied] = useState(false);

  const { data: fullContent } = useQuery({
    queryKey: ['resource-content', resource.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('resources')
        .select('content, content_length')
        .eq('id', resource.id)
        .single();
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ['knowledge-items-for-resource', resource.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('knowledge_items')
        .select('id, title, tactic_summary, confidence_score, active, status, framework, chapter')
        .eq('source_resource_id', resource.id)
        .order('confidence_score', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const content = fullContent?.content ?? r.content ?? '';
  const preview = content.slice(0, 2000);

  return (
    <div className="border-t border-border">
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('content')}
            className={cn('text-[10px] font-medium pb-1 border-b-2 transition-colors', tab === 'content' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground')}>
            Content Preview
          </button>
          <button onClick={() => setTab('knowledge')}
            className={cn('text-[10px] font-medium pb-1 border-b-2 transition-colors', tab === 'knowledge' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground')}>
            Knowledge Items ({items.length})
          </button>
        </div>
      </div>

      {tab === 'content' ? (
        <div className="px-4 py-2">
          {preview ? (
            <ScrollArea className="h-[200px] rounded-md border border-border/60 p-3">
              <pre className="whitespace-pre-wrap break-words text-[11px] font-sans leading-relaxed text-foreground">
                {preview}
                {content.length > 2000 && <span className="text-muted-foreground">{'\n\n'}… {(content.length - 2000).toLocaleString()} more characters</span>}
              </pre>
            </ScrollArea>
          ) : (
            <p className="text-xs text-muted-foreground py-4 text-center">No content available</p>
          )}
        </div>
      ) : (
        <ScrollArea className="h-[200px]">
          <div className="px-4 py-2 space-y-1.5">
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No knowledge items</p>
            ) : items.map((ki: any) => (
              <div key={ki.id} className={cn(
                'rounded border px-2 py-1.5 text-[11px]',
                ki.active ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border',
              )}>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground flex-1 min-w-0 truncate">{ki.title}</span>
                  <Badge variant={ki.active ? 'default' : 'secondary'} className="text-[8px] h-4 shrink-0">
                    {ki.active ? 'Active' : ki.status}
                  </Badge>
                  {ki.confidence_score != null && (
                    <span className="text-[9px] text-muted-foreground shrink-0">{Math.round(ki.confidence_score * 100)}%</span>
                  )}
                </div>
                {ki.tactic_summary && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{ki.tactic_summary}</p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ── F2. Processing Timeline ────────────────────────────────
function ProcessingTimelineSection({ resource }: { resource: Resource }) {
  const r = resource as any;
  const liveJob = useResourceJobProgress(s => s.resources[resource.id]);
  const ps = deriveProcessingState(resource);

  // Determine pipeline stages based on resource type
  const isAudio = (resource.resource_type === 'podcast' || resource.resource_type === 'audio' ||
    resource.file_url?.match(/\.(mp3|wav|m4a|ogg)/i));

  const stages = isAudio
    ? ['Ingested', 'Resolved', 'Transcribed', 'Enriched', 'Extracted', 'Activated', 'Operationalized']
    : ['Ingested', 'Enriched', 'Extracted', 'Activated', 'Operationalized'];

  // Determine completed stages
  const completedStages = new Set<string>();
  completedStages.add('Ingested');

  if (r.enrichment_status === 'deep_enriched' || r.enrichment_status === 'enriched' || r.content_length > 500) {
    completedStages.add('Enriched');
    if (isAudio) { completedStages.add('Resolved'); completedStages.add('Transcribed'); }
  }
  if (r.enrichment_status === 'deep_enrich_in_progress' || r.enrichment_status === 'reenrich_in_progress') {
    if (isAudio) { completedStages.add('Resolved'); }
  }

  // Check lifecycle for extraction/activation
  const { summary } = useCanonicalLifecycle();
  const status = summary?.resources.find(s => s.resource_id === resource.id);
  if (status) {
    if (['knowledge_extracted', 'activated', 'operationalized'].includes(status.canonical_stage)) {
      completedStages.add('Extracted');
    }
    if (['activated', 'operationalized'].includes(status.canonical_stage)) {
      completedStages.add('Activated');
    }
    if (status.canonical_stage === 'operationalized') {
      completedStages.add('Operationalized');
    }
  }

  // Determine current stage
  let currentStage: string | null = null;
  if (liveJob?.status === 'running') {
    currentStage = liveJob.jobType === 'extract' ? 'Extracted'
      : liveJob.jobType === 'enrich' || liveJob.jobType === 'deep_enrich' ? 'Enriched'
      : liveJob.jobType === 'transcribe' ? 'Transcribed'
      : 'Enriched';
  } else if (ps.state === 'RUNNING') {
    currentStage = 'Enriched';
  }

  // Stale detection
  const isStuck = r.active_job_status === 'running' && isJobStale(r.active_job_updated_at, 'running');
  const jobDuration = r.active_job_started_at
    ? Math.round((Date.now() - new Date(r.active_job_started_at).getTime()) / 1000)
    : null;

  // If nothing is processing and resource is complete, don't show
  if (!currentStage && !liveJob && ps.state !== 'RUNNING' && !isStuck && r.active_job_status !== 'running') {
    // Still show the timeline if there's history
    if (completedStages.size <= 1) return null;
  }

  return (
    <div className="px-4 py-3 border-t border-border space-y-2">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        Processing Timeline
        {isStuck && (
          <Badge className="text-[8px] h-4 bg-destructive/10 text-destructive ml-1">
            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Stuck
          </Badge>
        )}
        {liveJob?.status === 'running' && (
          <Badge className="text-[8px] h-4 bg-primary/10 text-primary ml-1">
            <Loader2 className="h-2.5 w-2.5 mr-0.5 animate-spin" /> Live
          </Badge>
        )}
      </h4>

      {/* Stage visualization */}
      <div className="flex items-center gap-0.5 flex-wrap">
        {stages.map((stage, i) => {
          const isCompleted = completedStages.has(stage);
          const isCurrent = stage === currentStage;
          return (
            <div key={stage} className="flex items-center gap-0.5">
              {i > 0 && (
                <div className={cn(
                  'w-3 h-px',
                  isCompleted ? 'bg-emerald-500' : isCurrent ? 'bg-primary' : 'bg-border',
                )} />
              )}
              <div className={cn(
                'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium',
                isCompleted && !isCurrent && 'bg-emerald-500/10 text-emerald-600',
                isCurrent && 'bg-primary/10 text-primary ring-1 ring-primary/30',
                !isCompleted && !isCurrent && 'bg-muted text-muted-foreground',
              )}>
                {isCompleted && !isCurrent && <CheckCircle2 className="h-2.5 w-2.5" />}
                {isCurrent && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                {stage}
              </div>
            </div>
          );
        })}
      </div>

      {/* Active job info */}
      {(liveJob?.status === 'running' || r.active_job_status === 'running') && (
        <div className="flex items-center gap-2 text-[10px] bg-muted/30 rounded px-2 py-1">
          <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
          <span className="text-foreground font-medium">
            {liveJob ? getJobLabel(liveJob.jobType, 'running') : r.active_job_type ? getJobLabel(r.active_job_type, 'running') : 'Processing…'}
          </span>
          {jobDuration != null && (
            <span className="text-muted-foreground ml-auto">
              {jobDuration < 60 ? `${jobDuration}s` : `${Math.floor(jobDuration / 60)}m ${jobDuration % 60}s`}
              {isStuck && <span className="text-destructive ml-1">— exceeded 10min timeout</span>}
            </span>
          )}
        </div>
      )}

      {/* Last completed job */}
      {r.active_job_status === 'succeeded' && r.active_job_result_summary && (
        <div className="flex items-center gap-2 text-[10px] text-emerald-600">
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          <span>{r.active_job_result_summary}</span>
          {r.active_job_finished_at && (
            <span className="text-muted-foreground ml-auto">
              {new Date(r.active_job_finished_at).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}
      {r.active_job_status === 'failed' && r.active_job_error && (
        <div className="flex items-center gap-2 text-[10px] text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">{r.active_job_error}</span>
        </div>
      )}
    </div>
  );
}

// ── Failure Dossier Section ─────────────────────────────────
function FailureDossierSection({ resource }: { resource: Resource }) {
  const { summary } = useCanonicalLifecycle();
  const status = summary?.resources.find(r => r.resource_id === resource.id);
  const lc = status ? {
    stage: status.canonical_stage,
    blocked: status.blocked_reason,
    kiCount: status.knowledge_item_count,
    activeKi: status.active_ki_count,
    activeKiWithCtx: status.active_ki_with_context_count ?? 0,
  } : undefined;
  if (!lc) return null;

  const truth = deriveResourceTruth(resource, lc);
  const dossier = buildFailureDossier(resource, truth);
  if (!dossier) return null;

  const ev = dossier.evidence;

  return (
    <div className="px-4 py-3 border-t border-border space-y-2.5">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3" />
        Failure Dossier
        <Badge className={cn('text-[8px] h-4 ml-1', ROOT_CAUSE_COLORS[dossier.root_cause_category])}>
          {ROOT_CAUSE_LABELS[dossier.root_cause_category]}
        </Badge>
        <Badge variant="outline" className="text-[8px] h-4">
          {dossier.root_cause_confidence} confidence
        </Badge>
      </h4>

      {/* Stage & Mode */}
      <div className="flex items-center gap-2 flex-wrap text-[10px]">
        <span className="text-muted-foreground">Stage:</span>
        <span className="font-medium text-foreground">{FAILURE_STAGE_LABELS[dossier.failure_stage]}</span>
        <span className="text-muted-foreground">Mode:</span>
        <span className="font-medium text-foreground">{FAILURE_MODE_LABELS[dossier.failure_mode]}</span>
      </div>

      {/* Explanation */}
      <div className="text-[11px] text-foreground bg-muted/30 rounded px-2.5 py-2 leading-relaxed">
        {dossier.exact_explanation}
      </div>

      {/* Key Evidence */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
        <div className="text-muted-foreground">Content length</div>
        <div className="font-medium text-foreground">{ev.content_length} chars</div>
        <div className="text-muted-foreground">Enrichment status</div>
        <div className="font-medium text-foreground">{ev.enrichment_status ?? 'none'}</div>
        <div className="text-muted-foreground">KIs / Active / w/Context</div>
        <div className="font-medium text-foreground">{ev.ki_count} / {ev.active_ki_count} / {ev.active_ki_with_context_count}</div>
        <div className="text-muted-foreground">Extraction attempts</div>
        <div className="font-medium text-foreground">{ev.extraction_attempt_count}</div>
        <div className="text-muted-foreground">Content sources</div>
        <div className="font-medium text-foreground">
          {[
            ev.manual_content_present && 'Manual',
            ev.transcript_present && 'Transcript',
            ev.lesson_text_present && 'Lesson text',
            ev.parsed_content_present && 'Parsed',
          ].filter(Boolean).join(', ') || 'None'}
        </div>
        {ev.route_pipeline && (
          <>
            <div className="text-muted-foreground">Route</div>
            <div className="font-medium text-foreground">
              {ev.route_pipeline} → {ev.route_extraction_method ?? 'auto'}
              {ev.route_override ? ' (override)' : ''}
              {ev.route_confidence && <span className="text-muted-foreground"> ({ev.route_confidence})</span>}
            </div>
          </>
        )}
        {ev.active_job_status && (
          <>
            <div className="text-muted-foreground">Job status</div>
            <div className="font-medium text-foreground">
              {ev.active_job_status}
              {ev.job_elapsed_seconds != null && ` (${ev.job_elapsed_seconds > 60 ? `${Math.floor(ev.job_elapsed_seconds / 60)}m` : `${ev.job_elapsed_seconds}s`})`}
              {ev.active_job_error && <span className="text-destructive"> — {ev.active_job_error}</span>}
            </div>
          </>
        )}
        {ev.failure_reason && (
          <>
            <div className="text-muted-foreground">Failure reason</div>
            <div className="font-medium text-destructive">{ev.failure_reason}</div>
          </>
        )}
        {ev.integrity_issues.length > 0 && (
          <>
            <div className="text-muted-foreground">Integrity issues</div>
            <div className="font-medium text-destructive">{ev.integrity_issues.join('; ')}</div>
          </>
        )}
      </div>

      {/* Fix recommendations */}
      <div className="space-y-1.5 pt-1 border-t border-border/50">
        <div className="text-[10px]">
          <span className="text-muted-foreground">Immediate fix: </span>
          <span className="font-medium text-foreground">{dossier.recommended_immediate_action}</span>
        </div>
        <div className="text-[10px]">
          <span className="text-muted-foreground">Permanent fix: </span>
          <span className="font-medium text-foreground">{dossier.recommended_permanent_fix}</span>
        </div>
        <div className="text-[10px]">
          <span className="text-muted-foreground">Prevention rule: </span>
          <span className="font-medium text-primary">{dossier.future_prevention_rule}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────
export function ResourceInspectPanel({ resource, onClose, onAction }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  return (
    <div ref={containerRef} className="relative z-10 isolate bg-card border-b-2 border-primary/20 animate-fade-in">
      <IdentitySection resource={resource} onClose={onClose} onAction={onAction} />
      <PipelineRouteSection resource={resource} onAction={onAction} />
      <ProcessingTimelineSection resource={resource} />
      <QualityTrustSection resource={resource} />
      <FailureDossierSection resource={resource} />
      <DownstreamEligibilitySection resource={resource} />
      <NextActionSection resource={resource} onAction={onAction} />
      <AttemptHistorySection resourceId={resource.id} />
      <PreviewSection resource={resource} />
    </div>
  );
}
