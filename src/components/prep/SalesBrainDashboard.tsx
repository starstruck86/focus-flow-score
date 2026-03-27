import { memo, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Brain, BookOpen, TrendingUp, AlertTriangle, Zap } from 'lucide-react';
import {
  DOCTRINE_CHAPTERS,
  getChapterLabel,
  getDoctrineByChapter,
  getBrainHealth,
  loadChangelog,
  getFreshnessColor,
  type DoctrineChapter,
  type BrainHealthSummary,
} from '@/lib/salesBrain';
import { cn } from '@/lib/utils';

export const SalesBrainDashboard = memo(function SalesBrainDashboard() {
  const health = useMemo(() => getBrainHealth(), []);
  const changelog = useMemo(() => loadChangelog().slice(0, 15), []);

  return (
    <div className="space-y-4">
      {/* Health summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatCard label="Insights" value={health.totalInsights} icon={<Zap className="h-3.5 w-3.5" />} />
        <StatCard label="Doctrine" value={health.totalDoctrine} icon={<BookOpen className="h-3.5 w-3.5" />} />
        <StatCard label="High Confidence" value={health.highConfidenceCount} icon={<TrendingUp className="h-3.5 w-3.5" />} />
        <StatCard label="Stale" value={health.staleCount} icon={<AlertTriangle className="h-3.5 w-3.5" />} color={health.staleCount > 0 ? 'text-status-yellow' : undefined} />
        <StatCard label="Recent Changes" value={health.recentChanges} icon={<Brain className="h-3.5 w-3.5" />} />
      </div>

      {/* Chapters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Doctrine by Chapter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-3">
              {DOCTRINE_CHAPTERS.map(chapter => (
                <ChapterSection key={chapter} chapter={chapter} />
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Recent changes */}
      {changelog.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Recent Changes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {changelog.map(event => (
                <div key={event.id} className="flex items-start gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0 w-[60px]">
                    {new Date(event.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    {event.eventType.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-foreground truncate">{event.description}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
    </div>
  );
});

function StatCard({ label, value, icon, color }: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color?: string;
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

function ChapterSection({ chapter }: { chapter: DoctrineChapter }) {
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
          <div key={entry.id} className="flex items-start gap-1.5">
            <Badge className={cn('text-[8px] shrink-0 mt-0.5', getFreshnessColor(entry.freshnessState))}>
              {entry.freshnessState}
            </Badge>
            <span className="text-xs text-foreground">{entry.statement}</span>
            <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
              {(entry.confidence * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
