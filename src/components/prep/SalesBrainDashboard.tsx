import { memo, useMemo, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Brain, BookOpen, TrendingUp, AlertTriangle, Zap, Shield, ClipboardCheck, History, Tag } from 'lucide-react';
import {
  DOCTRINE_CHAPTERS,
  getChapterLabel,
  getDoctrineByChapter,
  getBrainHealth,
  loadChangelog,
  getFreshnessColor,
  getGovernanceColor,
  getGovernanceLabel,
  getDoctrineGovernanceStats,
  isDoctrineEligibleForPropagation,
  getLegacyHydratedCount,
  type DoctrineChapter,
} from '@/lib/salesBrain';
import { cn } from '@/lib/utils';
import { DoctrineReviewQueue } from './DoctrineReviewQueue';
import { DoctrineChangeDigest } from './DoctrineChangeDigest';
import { DoctrineRecoveryTools } from './DoctrineRecoveryTools';
import { DoctrineDetailDrawer } from './DoctrineDetailDrawer';

export const SalesBrainDashboard = memo(function SalesBrainDashboard() {
  const [refreshKey, setRefreshKey] = useState(0);
  const health = useMemo(() => getBrainHealth(), [refreshKey]);
  const stats = useMemo(() => getDoctrineGovernanceStats(), [refreshKey]);
  const legacyCount = useMemo(() => getLegacyHydratedCount(), [refreshKey]);
  const [selectedDoctrineId, setSelectedDoctrineId] = useState<string | null>(null);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  return (
    <div className="space-y-4">
      {/* Health summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatCard label="Insights" value={health.totalInsights} icon={<Zap className="h-3.5 w-3.5" />} />
        <StatCard label="Approved" value={stats.approved} icon={<Shield className="h-3.5 w-3.5" />} />
        <StatCard label="Review Needed" value={stats.reviewNeeded} icon={<ClipboardCheck className="h-3.5 w-3.5" />}
          color={stats.reviewNeeded > 0 ? 'text-status-yellow' : undefined} />
        <StatCard label="Stale" value={stats.stale} icon={<AlertTriangle className="h-3.5 w-3.5" />}
          color={stats.stale > 0 ? 'text-status-yellow' : undefined} />
        <StatCard label="Propagating" value={stats.propagationEnabled} icon={<TrendingUp className="h-3.5 w-3.5" />} />
      </div>
      {legacyCount > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] text-status-yellow bg-status-yellow/10 rounded px-2 py-1">
          <Tag className="h-3 w-3" /> {legacyCount} legacy-hydrated doctrine entries (consider reviewing)
        </div>
      )}

      {/* Sub-tabs */}
      <Tabs defaultValue="chapters">
        <TabsList className="w-max flex gap-0.5">
          <TabsTrigger value="chapters" className="text-xs">
            <BookOpen className="h-3.5 w-3.5 mr-1" /> Chapters
          </TabsTrigger>
          <TabsTrigger value="review" className="text-xs">
            <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Review
            {stats.reviewNeeded > 0 && (
              <Badge variant="destructive" className="text-[8px] ml-1 h-4 min-w-4 px-1">{stats.reviewNeeded}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="changes" className="text-xs">
            <History className="h-3.5 w-3.5 mr-1" /> Changes
          </TabsTrigger>
          <TabsTrigger value="recovery" className="text-xs">
            <Shield className="h-3.5 w-3.5 mr-1" /> Recovery
          </TabsTrigger>
        </TabsList>

        {/* Chapters */}
        <TabsContent value="chapters" className="mt-3">
          <Card>
            <CardContent className="pt-4">
              <ScrollArea className="max-h-[400px]">
                <div className="space-y-3">
                  {DOCTRINE_CHAPTERS.map(chapter => (
                    <ChapterSection key={chapter} chapter={chapter} onSelect={setSelectedDoctrineId} />
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Review queue */}
        <TabsContent value="review" className="mt-3">
          <DoctrineReviewQueue onSelectDoctrine={setSelectedDoctrineId} />
        </TabsContent>

        {/* Changes */}
        <TabsContent value="changes" className="mt-3">
          <DoctrineChangeDigest />
        </TabsContent>

        {/* Recovery */}
        <TabsContent value="recovery" className="mt-3">
          <DoctrineRecoveryTools />
        </TabsContent>
      </Tabs>

      {/* Empty state */}
      {health.totalDoctrine === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <Brain className="h-8 w-8 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm font-medium text-foreground">No doctrine yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Promote resources from the Incoming queue to start building your Sales Brain
            </p>
          </CardContent>
        </Card>
      )}

      {/* Detail drawer */}
      <DoctrineDetailDrawer
        doctrineId={selectedDoctrineId}
        open={!!selectedDoctrineId}
        onOpenChange={open => { if (!open) setSelectedDoctrineId(null); }}
        onRefresh={refresh}
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

function ChapterSection({ chapter, onSelect }: { chapter: DoctrineChapter; onSelect: (id: string) => void }) {
  const entries = useMemo(() => getDoctrineByChapter(chapter), [chapter]);

  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 py-1 opacity-50">
        <span className="text-xs font-medium text-muted-foreground">{getChapterLabel(chapter)}</span>
        <span className="text-[10px] text-muted-foreground">—</span>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold text-foreground mb-1">
        {getChapterLabel(chapter)} <span className="text-muted-foreground font-normal">({entries.length})</span>
      </p>
      <div className="space-y-1 pl-2 border-l-2 border-border">
        {entries.map(entry => (
          <button key={entry.id} onClick={() => onSelect(entry.id)}
            className="flex items-start gap-1.5 w-full text-left hover:bg-muted/30 rounded px-1 py-0.5 transition-colors">
            <Badge className={cn('text-[8px] shrink-0 mt-0.5', getGovernanceColor(entry.governance.status))}>
              {getGovernanceLabel(entry.governance.status)}
            </Badge>
            <Badge className={cn('text-[8px] shrink-0 mt-0.5', getFreshnessColor(entry.freshnessState))}>
              {entry.freshnessState}
            </Badge>
            {isDoctrineEligibleForPropagation(entry) && (
              <Badge variant="outline" className="text-[8px] shrink-0 mt-0.5 text-primary border-primary/30">
                propagating
              </Badge>
            )}
            {entry.governance.isLegacyHydrated && (
              <Badge variant="outline" className="text-[8px] shrink-0 mt-0.5 border-status-yellow text-status-yellow">legacy</Badge>
            )}
            {entry.governance.duplicateFlag !== 'none' && (
              <Badge variant="outline" className="text-[7px] shrink-0 mt-0.5 border-status-yellow text-status-yellow">dup</Badge>
            )}
            {entry.governance.conflictFlag !== 'none' && (
              <Badge variant="outline" className="text-[7px] shrink-0 mt-0.5 border-destructive text-destructive">conflict</Badge>
            )}
            <span className="text-xs text-foreground flex-1">{entry.statement}</span>
            <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
              {(entry.confidence * 100).toFixed(0)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
