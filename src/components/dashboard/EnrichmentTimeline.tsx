// Enrichment Timeline — chronological discovery feed per account
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, TrendingUp, UserPlus, Newspaper, Cpu, ExternalLink } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TriggerEvent, TimelineEntry } from '@/types/dashboard';

interface EnrichmentTimelineProps {
  enrichmentEvidence?: Record<string, string> | null;
  triggerEvents?: TriggerEvent[] | null;
  lastEnrichedAt?: string | null;
  enrichmentSourceSummary?: string | null;
}

export function EnrichmentTimeline({ enrichmentEvidence, triggerEvents, lastEnrichedAt, enrichmentSourceSummary }: EnrichmentTimelineProps) {
  const timeline = useMemo(() => {
    const events: TimelineEntry[] = [];

    // Add enrichment event
    if (lastEnrichedAt) {
      events.push({
        date: new Date(lastEnrichedAt).toLocaleDateString(),
        type: 'enrichment',
        title: 'Account Enriched',
        detail: enrichmentEvidence?.enrichment_source ? `via ${enrichmentEvidence.enrichment_source}` : 'Signals extracted',
        icon: Sparkles,
        color: 'text-primary',
      });
    }

    // Add trigger events
    if (triggerEvents && Array.isArray(triggerEvents)) {
      for (const event of triggerEvents) {
        const typeMap: Record<string, { icon: any; color: string }> = {
          executive_hire: { icon: UserPlus, color: 'text-amber-500' },
          job_posting: { icon: TrendingUp, color: 'text-blue-500' },
          company_news: { icon: Newspaper, color: 'text-emerald-500' },
          tech_change: { icon: Cpu, color: 'text-purple-500' },
        };
        const config = typeMap[event.type] || { icon: Newspaper, color: 'text-muted-foreground' };
        events.push({
          date: event.date || 'Recent',
          type: event.type,
          title: event.headline || event.type?.replace(/_/g, ' '),
          detail: event.source || '',
          icon: config.icon,
          color: config.color,
        });
      }
    }

    // Add evidence items
    if (enrichmentEvidence) {
      if (enrichmentEvidence.recent_news && enrichmentEvidence.recent_news.length > 10) {
        events.push({
          date: lastEnrichedAt ? new Date(lastEnrichedAt).toLocaleDateString() : 'Recent',
          type: 'news',
          title: 'News & Developments',
          detail: enrichmentEvidence.recent_news.slice(0, 200),
          icon: Newspaper,
          color: 'text-emerald-500',
        });
      }
      if (enrichmentEvidence.case_studies && enrichmentEvidence.case_studies.length > 10) {
        events.push({
          date: lastEnrichedAt ? new Date(lastEnrichedAt).toLocaleDateString() : 'Recent',
          type: 'case_study',
          title: 'MarTech Case Studies Found',
          detail: enrichmentEvidence.case_studies.slice(0, 200),
          icon: TrendingUp,
          color: 'text-cyan-500',
        });
      }
    }

    // Sort by date descending
    events.sort((a, b) => {
      try { return new Date(b.date).getTime() - new Date(a.date).getTime(); } catch { return 0; }
    });

    return events;
  }, [enrichmentEvidence, triggerEvents, lastEnrichedAt]);

  if (timeline.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground text-xs">
        <Sparkles className="h-6 w-6 mx-auto mb-1 opacity-20" />
        No enrichment history yet
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[300px]">
      <div className="relative pl-4 space-y-3">
        {/* Timeline line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
        {timeline.map((event, i) => {
          const Icon = event.icon;
          return (
            <div key={i} className="relative flex gap-3">
              <div className={cn("absolute left-[-9px] rounded-full bg-background border-2 border-border p-0.5 z-10", event.color)}>
                <Icon className="h-2.5 w-2.5" />
              </div>
              <div className="flex-1 ml-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold">{event.title}</span>
                  <Badge variant="outline" className="text-[9px] px-1">{event.type.replace(/_/g, ' ')}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2">{event.detail}</p>
                <span className="text-[10px] text-muted-foreground">{event.date}</span>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
