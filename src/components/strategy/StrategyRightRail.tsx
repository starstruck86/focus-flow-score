import { ChevronRight, Link2, Lightbulb, HelpCircle, FileText, Pin, Copy, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import type { StrategyThread } from '@/types/strategy';

interface Props {
  thread: StrategyThread;
  onCollapse: () => void;
}

function RailSection({ title, icon: Icon, children, empty }: {
  title: string; icon: React.ElementType; children?: React.ReactNode; empty?: string;
}) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{title}</h3>
      </div>
      {children ?? <p className="text-[10px] text-muted-foreground/60 italic">{empty || 'None yet'}</p>}
    </div>
  );
}

export function StrategyRightRail({ thread, onCollapse }: Props) {
  return (
    <div className="w-64 border-l border-border flex flex-col bg-card shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center gap-2">
        <h2 className="text-xs font-semibold text-foreground flex-1">Working Memory</h2>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCollapse}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {/* Linked Objects */}
        <RailSection title="Linked Objects" icon={Link2}>
          {thread.linked_account_id ? (
            <Card className="bg-muted/30"><CardContent className="p-2 text-xs">Account linked</CardContent></Card>
          ) : thread.linked_opportunity_id ? (
            <Card className="bg-muted/30"><CardContent className="p-2 text-xs">Opportunity linked</CardContent></Card>
          ) : (
            <p className="text-[10px] text-muted-foreground/60 italic">No linked objects</p>
          )}
        </RailSection>

        <div className="border-t border-border" />

        {/* Pinned Insights */}
        <RailSection title="Pinned Insights" icon={Pin} empty="Pin insights from conversations" />

        <div className="border-t border-border" />

        {/* Hypotheses */}
        <RailSection title="Hypotheses" icon={Lightbulb} empty="No hypotheses recorded" />

        <div className="border-t border-border" />

        {/* Open Questions */}
        <RailSection title="Open Questions" icon={HelpCircle} empty="No open questions" />

        <div className="border-t border-border" />

        {/* Uploaded Resources */}
        <RailSection title="Uploads" icon={FileText} empty="Drag files into composer" />

        <div className="border-t border-border" />

        {/* Outputs */}
        <RailSection title="Outputs" icon={FileText} empty="No outputs yet" />

        <div className="border-t border-border" />

        {/* Latest Rollup */}
        <RailSection title="Latest Rollup" icon={FileText}>
          {thread.latest_rollup ? (
            <p className="text-xs">{JSON.stringify(thread.latest_rollup).slice(0, 100)}</p>
          ) : (
            <p className="text-[10px] text-muted-foreground/60 italic">No rollup generated</p>
          )}
        </RailSection>

        {/* Actions */}
        <div className="border-t border-border px-3 py-3 space-y-1.5">
          <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5">
            <Save className="h-3 w-3" /> Save to Account Memory
          </Button>
          <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5">
            <Save className="h-3 w-3" /> Save to Opp Memory
          </Button>
          <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5">
            <Copy className="h-3 w-3" /> Copy Summary
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
