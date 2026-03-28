/**
 * Product Roadmap Panel — system gap drilldown.
 * Part 7 of the Enrichment Operator Console.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Wrench, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { RoadmapSummary, RoadmapIssue } from '@/lib/systemGapRoadmap';
import { generateBuildPrompt } from '@/lib/systemGapRoadmap';

interface Props {
  roadmap: RoadmapSummary;
  expanded: boolean;
  onToggle: () => void;
  onViewAffected: (resourceIds: string[]) => void;
}

const SEV_COLORS: Record<string, string> = {
  critical: 'text-destructive bg-destructive/10',
  high: 'text-orange-500 bg-orange-500/10',
  medium: 'text-status-yellow bg-status-yellow/10',
  low: 'text-muted-foreground bg-muted',
};

export function RoadmapPanel({ roadmap, expanded, onToggle, onViewAffected }: Props) {
  if (roadmap.issues.length === 0) return null;

  return (
    <Card className="border-destructive/30">
      <button onClick={onToggle} className="w-full text-left px-4 py-3 flex items-center gap-2">
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Wrench className="h-3.5 w-3.5 text-destructive" />
        <span className="text-sm font-semibold text-foreground">Product Roadmap</span>
        <Badge variant="destructive" className="text-[10px]">{roadmap.totalSystemGaps} gaps</Badge>
      </button>
      {expanded && (
        <CardContent className="pt-0 pb-3">
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2">
              {roadmap.issues.map((issue, i) => (
                <IssueCard key={i} issue={issue} onViewAffected={onViewAffected} />
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
}

function IssueCard({ issue, onViewAffected }: { issue: RoadmapIssue; onViewAffected: (ids: string[]) => void }) {
  return (
    <div className="border border-border rounded-md p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <Badge className={cn('text-[10px]', SEV_COLORS[issue.severity])}>{issue.severity}</Badge>
        <span className="text-xs font-semibold text-foreground">{issue.issueName}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{issue.affectedResources} resources</span>
      </div>
      <p className="text-[10px] text-muted-foreground">{issue.businessImpact}</p>
      <p className="text-[10px] text-foreground">{issue.requiredBuild.description}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="outline" className="text-[9px]">{issue.subtypeLabel}</Badge>
        <Badge variant="outline" className="text-[9px]">{issue.requiredBuild.type}</Badge>
        <div className="flex gap-1 ml-auto">
          <Button size="sm" variant="ghost" className="h-5 text-[9px] gap-0.5"
            onClick={() => onViewAffected(issue.resourceIds)}>
            View affected
          </Button>
          <Button size="sm" variant="ghost" className="h-5 text-[9px] gap-0.5"
            onClick={() => { navigator.clipboard.writeText(generateBuildPrompt(issue)); toast.success('Copied'); }}>
            <Copy className="h-2.5 w-2.5" /> Copy Prompt
          </Button>
        </div>
      </div>
    </div>
  );
}
