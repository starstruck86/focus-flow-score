/**
 * RoleplayPreviewSheet — shows a structured preview of what a roleplay
 * session will cover before starting, with a "Start Roleplay" CTA.
 */

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Play, Target, ShieldAlert, Swords, Package, CheckCircle2 } from 'lucide-react';
import type { RoleplayPlan } from '@/components/dave/tools/intelligence/roleplayPlan';

interface Props {
  plan: RoleplayPlan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: () => void;
}

export function RoleplayPreviewSheet({ plan, open, onOpenChange, onStart }: Props) {
  if (!plan) return null;

  const chapterLabel = plan.type.replace(/\b\w/g, c => c.toUpperCase());

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] rounded-t-xl p-0">
        <SheetHeader className="p-4 pb-2 border-b border-border">
          <SheetTitle className="text-base flex items-center gap-2">
            🎭 Roleplay Preview: {chapterLabel}
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Grounded in {plan.grounding_count} active knowledge items
          </p>
        </SheetHeader>

        <ScrollArea className="max-h-[50vh]">
          <div className="p-4 space-y-4">
            {/* Focus item */}
            {plan.focus_item && (
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-primary/5 border border-primary/20">
                <Target className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-foreground">Primary Focus</p>
                  <p className="text-xs text-muted-foreground">{plan.focus_item}</p>
                </div>
              </div>
            )}

            {/* Tactics */}
            {plan.tactics.length > 0 && (
              <Section title="Tactics I'll test you on" icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}>
                {plan.tactics.slice(0, 6).map((t, i) => (
                  <li key={i} className="text-xs text-muted-foreground">{t}</li>
                ))}
              </Section>
            )}

            {/* Test areas */}
            <Section title="What I'll evaluate" icon={<Target className="h-3.5 w-3.5 text-primary" />}>
              {plan.test_areas.map((t, i) => (
                <li key={i} className="text-xs text-muted-foreground">{t}</li>
              ))}
            </Section>

            {/* Anti-patterns */}
            <Section title="What I'll punish" icon={<ShieldAlert className="h-3.5 w-3.5 text-destructive" />}>
              {plan.anti_patterns.map((a, i) => (
                <li key={i} className="text-xs text-muted-foreground">{a}</li>
              ))}
            </Section>

            {/* Context badges */}
            {(plan.context.competitor || plan.context.product) && (
              <div className="flex gap-2 flex-wrap">
                {plan.context.competitor && (
                  <Badge variant="outline" className="text-[10px] gap-1 border-destructive/30 text-destructive">
                    <Swords className="h-2.5 w-2.5" />
                    {plan.context.competitor}
                  </Badge>
                )}
                {plan.context.product && (
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Package className="h-2.5 w-2.5" />
                    {plan.context.product}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 pt-2 border-t border-border">
          <Button className="w-full gap-2" onClick={onStart}>
            <Play className="h-4 w-4" />
            Start Roleplay
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <p className="text-xs font-semibold text-foreground">{title}</p>
      </div>
      <ul className="space-y-1 pl-5 list-disc">{children}</ul>
    </div>
  );
}
