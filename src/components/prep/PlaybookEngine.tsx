/**
 * PlaybookEngine — the redesigned Learn tab
 *
 * Replaces SalesBrainDashboard with an active playbook engine
 * built on real knowledge_items from the database.
 */

import { memo, useState, useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Brain, BookOpen, Zap, Shield, AlertTriangle, TrendingUp,
  ChevronRight, Play, Sparkles, CheckCircle2, Clock, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useKnowledgeStats, type KnowledgeItem } from '@/hooks/useKnowledgeItems';
import { useChapterRoleplay } from '@/hooks/useChapterRoleplay';
import { ChapterDetailSheet } from './ChapterDetailSheet';
import { KnowledgeItemDrawer } from './KnowledgeItemDrawer';
import { ExtractKnowledgeDialog } from './ExtractKnowledgeDialog';

const CHAPTERS = [
  { id: 'cold_calling', label: 'Cold Calling', icon: '📞' },
  { id: 'discovery', label: 'Discovery', icon: '🔍' },
  { id: 'objection_handling', label: 'Objection Handling', icon: '🛡️' },
  { id: 'negotiation', label: 'Negotiation', icon: '🤝' },
  { id: 'competitors', label: 'Competitors', icon: '⚔️' },
  { id: 'personas', label: 'Personas', icon: '👤' },
  { id: 'messaging', label: 'Messaging', icon: '💬' },
  { id: 'closing', label: 'Closing', icon: '🎯' },
  { id: 'stakeholder_navigation', label: 'Stakeholder Nav', icon: '🗺️' },
  { id: 'expansion', label: 'Expansion', icon: '📈' },
];

export const PlaybookEngine = memo(function PlaybookEngine() {
  const stats = useKnowledgeStats();
  const { session: roleplaySession } = useChapterRoleplay();
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [extractOpen, setExtractOpen] = useState(false);

  const handlePractice = useCallback((chapter: string) => {
    window.dispatchEvent(new CustomEvent('dave-start-roleplay', { detail: { chapter } }));
  }, []);

  // Compute operationalized resource count
  const operationalizedCount = useMemo(() => {
    const sourceIds = new Set<string>();
    for (const item of stats.items) {
      if (item.active && item.source_resource_id && item.applies_to_contexts?.length > 0) {
        sourceIds.add(item.source_resource_id);
      }
    }
    return sourceIds.size;
  }, [stats.items]);

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

      {/* Operationalized CTA */}
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
            {stats.active} active knowledge item{stats.active !== 1 ? 's' : ''} across {
              [...stats.byChapter.entries()].filter(([_, items]) => items.some(i => i.active)).length
            } chapters
          </p>
          <Button variant="outline" size="sm" onClick={() => setExtractOpen(true)} className="gap-1.5 text-xs">
            <Sparkles className="h-3 w-3" />
            Extract More
          </Button>
        </div>
      )}

      {/* Active roleplay indicator */}
      {roleplaySession?.active && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 flex items-center gap-3">
            <Play className="h-4 w-4 text-primary animate-pulse" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">
                Roleplay active: {roleplaySession.chapter.replace(/_/g, ' ')}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Grounded in {roleplaySession.groundedItemCount} active knowledge items
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Operationalized count */}
      {operationalizedCount > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {operationalizedCount} resource{operationalizedCount !== 1 ? 's' : ''} operationalized — actively changing how you sell
        </p>
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
          const recentItems = items
            .filter(i => {
              const age = Date.now() - new Date(i.updated_at).getTime();
              return age < 7 * 24 * 60 * 60 * 1000; // last 7 days
            });

          return (
            <button
              key={ch.id}
              onClick={() => setSelectedChapter(ch.id)}
              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors text-left w-full group"
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
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {lastUpdated && `Updated ${formatRelativeTime(lastUpdated)}`}
                    {recentItems.length > 0 && ` · ${recentItems.length} changed this week`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {activeCount > 0 && (
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); handlePractice(ch.id); }}
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
    </div>
  );
});

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
