/**
 * PlaybookEngine — the Learn tab as an active playbook engine
 *
 * Shows knowledge stats, operationalized metrics, chapter cards with
 * recency/counts, active roleplay grounding proof, and extraction CTAs.
 */

import { memo, useState, useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Brain, Zap, Shield, AlertTriangle, Play, Sparkles,
  CheckCircle2, Clock, ChevronRight, Info, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useKnowledgeStats, type KnowledgeItem } from '@/hooks/useKnowledgeItems';
import { useChapterRoleplay } from '@/hooks/useChapterRoleplay';
import { ChapterDetailSheet } from './ChapterDetailSheet';
import { KnowledgeItemDrawer } from './KnowledgeItemDrawer';
import { ExtractKnowledgeDialog } from './ExtractKnowledgeDialog';
import { RoleplayPreviewSheet } from './RoleplayPreviewSheet';
import { ResourceReadinessSheet } from './ResourceReadinessSheet';
import { LifecycleSummaryBar } from './LifecycleSummaryBar';
import { useCanonicalLifecycle } from '@/hooks/useCanonicalLifecycle';
import type { RoleplayPlan } from '@/components/dave/tools/intelligence/roleplayPlan';
import { queryKnowledge } from '@/lib/knowledgeRetrieval';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';

/** Priority chapters first, rest after */
const PRIORITY_IDS = ['cold_calling', 'discovery', 'competitors', 'messaging'];

const CHAPTERS = [
  { id: 'cold_calling', label: 'Cold Calling', icon: '📞', priority: true },
  { id: 'discovery', label: 'Discovery', icon: '🔍', priority: true },
  { id: 'competitors', label: 'Competitors', icon: '⚔️', priority: true },
  { id: 'messaging', label: 'Messaging', icon: '💬', priority: true },
  { id: 'objection_handling', label: 'Objection Handling', icon: '🛡️' },
  { id: 'negotiation', label: 'Negotiation', icon: '🤝' },
  { id: 'personas', label: 'Personas', icon: '👤' },
  { id: 'closing', label: 'Closing', icon: '🎯' },
  { id: 'stakeholder_navigation', label: 'Stakeholder Nav', icon: '🗺️' },
  { id: 'expansion', label: 'Expansion', icon: '📈' },
];

export const PlaybookEngine = memo(function PlaybookEngine() {
  const stats = useKnowledgeStats();
  const { session: roleplaySession } = useChapterRoleplay();
  const { summary: lifecycle } = useCanonicalLifecycle();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [extractOpen, setExtractOpen] = useState(false);
  const [opDrilldownOpen, setOpDrilldownOpen] = useState(false);
  const [previewPlan, setPreviewPlan] = useState<RoleplayPlan | null>(null);
  const [pendingPractice, setPendingPractice] = useState<{ chapter: string; knowledgeItemId?: string } | null>(null);
  const [readinessOpen, setReadinessOpen] = useState(false);

  // Build preview plan from active knowledge
  const launchPreview = useCallback(async (chapter: string, knowledgeItemId?: string) => {
    const items = await queryKnowledge({
      chapters: [chapter],
      context: 'roleplay',
      activeOnly: true,
      maxItems: 15,
    });
    if (items.length === 0) {
      // No items, skip preview and dispatch directly
      window.dispatchEvent(new CustomEvent('dave-start-roleplay', { detail: { chapter, knowledgeItemId } }));
      return;
    }
    const { buildPlan } = await import('@/components/dave/tools/intelligence/roleplayPlan');
    const plan = buildPlan(chapter, items, knowledgeItemId);
    setPreviewPlan(plan);
    setPendingPractice({ chapter, knowledgeItemId });
  }, []);

  const handleStartFromPreview = useCallback(() => {
    if (pendingPractice) {
      window.dispatchEvent(new CustomEvent('dave-start-roleplay', { detail: pendingPractice }));
    }
    setPreviewPlan(null);
    setPendingPractice(null);
  }, [pendingPractice]);

  const handlePractice = useCallback((chapter: string) => {
    launchPreview(chapter);
  }, [launchPreview]);

  // Operationalized metrics
  const opMetrics = useMemo(() => {
    const operationalizedIds = new Set<string>();
    const allSourceIds = new Set<string>();
    for (const item of stats.items) {
      if (item.source_resource_id) allSourceIds.add(item.source_resource_id);
      if (item.active && item.source_resource_id && item.applies_to_contexts?.length > 0) {
        operationalizedIds.add(item.source_resource_id);
      }
    }
    return {
      operationalized: operationalizedIds.size,
      extracted: allSourceIds.size,
      percent: allSourceIds.size > 0 ? Math.round((operationalizedIds.size / allSourceIds.size) * 100) : 0,
    };
  }, [stats.items]);

  // Build chapter summary for active roleplay grounding proof
  const groundingItems = useMemo(() => {
    if (!roleplaySession?.active) return [];
    return stats.items.filter(
      i => i.active && i.chapter === roleplaySession.chapter,
    );
  }, [roleplaySession, stats.items]);

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatCard label="Extracted" value={stats.extracted} icon={<Zap className="h-3.5 w-3.5" />} />
        <StatCard label="Active" value={stats.active} icon={<Shield className="h-3.5 w-3.5" />}
          color={stats.active > 0 ? 'text-emerald-500' : undefined} />
        <StatCard label="Review" value={stats.reviewNeeded} icon={<AlertTriangle className="h-3.5 w-3.5" />}
          color={stats.reviewNeeded > 0 ? 'text-status-yellow' : undefined} />
        <StatCard label="Stale" value={stats.stale} icon={<Clock className="h-3.5 w-3.5" />}
          color={stats.stale > 0 ? 'text-status-yellow' : undefined} />
        <StatCard label="Total" value={stats.total} icon={<Brain className="h-3.5 w-3.5" />} />
      </div>

      {/* Operationalized metric */}
      {stats.total > 0 && (
        <Collapsible open={opDrilldownOpen} onOpenChange={setOpDrilldownOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between rounded-lg border border-border bg-card p-3 hover:bg-accent/30 transition-colors text-left">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-sm font-medium text-foreground">
                    {opMetrics.operationalized} / {opMetrics.extracted} resources operationalized
                  </span>
                  <span className="text-xs text-muted-foreground">({opMetrics.percent}%)</span>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      A resource is operationalized when at least one active knowledge item from it is available to Dave / practice / prep.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', opDrilldownOpen && 'rotate-90')} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
              <p>
                <span className="text-emerald-600 font-medium">{opMetrics.operationalized}</span> resource{opMetrics.operationalized !== 1 ? 's' : ''} have active knowledge items available to Dave/practice
              </p>
              {opMetrics.extracted - opMetrics.operationalized > 0 && (
                <p>
                  <span className="text-foreground font-medium">{opMetrics.extracted - opMetrics.operationalized}</span> resource{opMetrics.extracted - opMetrics.operationalized !== 1 ? 's' : ''} have extracted items but none yet activated
                </p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Empty state */}
      {stats.total === 0 && (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-6 text-center space-y-3">
            <Brain className="h-8 w-8 mx-auto text-primary opacity-60" />
            <div>
              <p className="text-sm font-medium text-foreground">No knowledge extracted yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Extract knowledge from your enriched resources to build your living playbook
              </p>
            </div>
            <Button size="sm" onClick={() => setExtractOpen(true)} className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Extract Knowledge
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Extract button when items exist */}
      {stats.total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {stats.active} active across {
              [...stats.byChapter.entries()].filter(([_, items]) => items.some(i => i.active)).length
            } chapters
          </p>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setReadinessOpen(true)} className="gap-1.5 text-xs">
              <Activity className="h-3 w-3" />
              Readiness
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExtractOpen(true)} className="gap-1.5 text-xs">
              <Sparkles className="h-3 w-3" />
              Extract More
            </Button>
          </div>
        </div>
      )}

      {/* Active roleplay grounding proof */}
      {roleplaySession?.active && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-primary animate-pulse shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  🎭 Roleplay: {roleplaySession.chapter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Grounded in {roleplaySession.groundedItemCount} active knowledge items
                </p>
              </div>
            </div>
            {/* Focus item */}
            {roleplaySession.focusItemTitle && (
              <p className="pl-6 text-[10px] font-medium text-primary">
                🎯 Focus: {roleplaySession.focusItemTitle}
              </p>
            )}
            {/* Competitor context */}
            {roleplaySession.competitorContext && (
              <p className="pl-6 text-[10px] text-destructive">
                ⚔️ Competitor context: {roleplaySession.competitorContext}
              </p>
            )}
            {/* Show grounded tactics */}
            {groundingItems.length > 0 && (
              <div className="pl-6 space-y-0.5">
                {groundingItems.slice(0, 5).map(item => (
                  <p key={item.id} className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                    <span className="truncate">{item.title}</span>
                    {item.competitor_name && (
                      <Badge variant="outline" className="text-[8px] h-3 px-1 border-destructive/30 text-destructive ml-1">
                        vs {item.competitor_name}
                      </Badge>
                    )}
                  </p>
                ))}
                {groundingItems.length > 5 && (
                  <p className="text-[10px] text-muted-foreground">
                    + {groundingItems.length - 5} more
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Chapters grid */}
      <div className="grid gap-2">
        {CHAPTERS.map(ch => {
          const items = stats.byChapter.get(ch.id) || [];
          const activeCount = items.filter(i => i.active).length;
          const newCount = items.filter(i => i.status === 'extracted').length;
          const reviewCount = items.filter(i => i.status === 'review_needed').length;
          const lastUpdated = items.length > 0
            ? items.reduce((latest, i) => i.updated_at > latest ? i.updated_at : latest, items[0].updated_at)
            : null;
          const recentCount = items.filter(i => {
            return Date.now() - new Date(i.updated_at).getTime() < 7 * 24 * 60 * 60 * 1000;
          }).length;

          // Competitor summary for Competitors chapter
          const competitorNames = ch.id === 'competitors'
            ? [...new Set(items.filter(i => i.competitor_name).map(i => i.competitor_name!))]
            : [];

          return (
            <button
              key={ch.id}
              onClick={() => setSelectedChapter(ch.id)}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left w-full group',
                (ch as any).priority ? 'border-primary/20' : 'border-border',
              )}
            >
              <span className="text-lg shrink-0">{ch.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{ch.label}</span>
                  {activeCount > 0 && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-emerald-500/10 text-emerald-600 border-0">
                      {activeCount} active
                    </Badge>
                  )}
                  {newCount > 0 && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                      {newCount} new
                    </Badge>
                  )}
                  {reviewCount > 0 && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-status-yellow/10 text-status-yellow border-0">
                      {reviewCount} review
                    </Badge>
                  )}
                </div>
                {items.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground mt-0.5">No knowledge yet</p>
                ) : (
                  <div className="text-[10px] text-muted-foreground mt-0.5 space-y-0">
                    <p>
                      {lastUpdated && `Updated ${formatRelativeTime(lastUpdated)}`}
                      {recentCount > 0 && ` · ${recentCount} changed this week`}
                    </p>
                    {competitorNames.length > 0 && (
                      <p className="truncate">
                        {competitorNames.slice(0, 3).map(n => `vs ${n}`).join(' · ')}
                        {competitorNames.length > 3 && ` +${competitorNames.length - 3}`}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {activeCount > 0 && (
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); handlePractice(ch.id); }}
                    title="Practice this chapter"
                  >
                    <Play className="h-3.5 w-3.5 text-primary" />
                  </Button>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Chapter detail sheet */}
      <ChapterDetailSheet
        chapter={selectedChapter}
        open={!!selectedChapter}
        onOpenChange={(open) => { if (!open) setSelectedChapter(null); }}
        onSelectItem={setSelectedItemId}
        onPractice={handlePractice}
        onPracticeTactic={(chapter, itemId) => launchPreview(chapter, itemId)}
      />

      {/* Roleplay preview sheet */}
      <RoleplayPreviewSheet
        plan={previewPlan}
        open={!!previewPlan}
        onOpenChange={(open) => { if (!open) { setPreviewPlan(null); setPendingPractice(null); } }}
        onStart={handleStartFromPreview}
      />

      {/* Knowledge item drawer */}
      <KnowledgeItemDrawer
        itemId={selectedItemId}
        open={!!selectedItemId}
        onOpenChange={(open) => { if (!open) setSelectedItemId(null); }}
      />

      {/* Extract dialog */}
      <ExtractKnowledgeDialog
        open={extractOpen}
        onOpenChange={setExtractOpen}
      />

      {/* Resource Readiness sheet */}
      <ResourceReadinessSheet
        open={readinessOpen}
        onOpenChange={setReadinessOpen}
      />
    </div>
  );
});

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function StatCard({ label, value, icon, color }: {
  label: string; value: number; icon: React.ReactNode; color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-2">
        <div className={cn('text-primary', color)}>{icon}</div>
        <div>
          <p className={cn('text-lg font-bold text-foreground', color)}>{value}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
