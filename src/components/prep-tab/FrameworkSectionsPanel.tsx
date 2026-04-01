/**
 * FrameworkSectionsPanel — renders predefined framework-driven sections
 * for a Prep stage and auto-populates them with matching KIs.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { STAGE_FRAMEWORK_MAP, getFrameworkColorClasses, FRAMEWORK_AUTHORS } from '@/data/stageFrameworkMap';
import type { StageFrameworkRole, FrameworkSection } from '@/data/stageFrameworkMap';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, BookOpen, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  stageId: string;
  stageLabel: string;
}

interface KI {
  id: string;
  title: string;
  tactic_summary: string | null;
  why_it_matters: string | null;
  who: string | null;
  framework: string | null;
  confidence_score: number;
  source_resource_id: string | null;
}

/** Fetch all KIs that match any framework used by this stage */
function useStageKIs(stageId: string) {
  const { user } = useAuth();
  const stageFrameworks = STAGE_FRAMEWORK_MAP[stageId] || [];
  const frameworkNames = stageFrameworks.map(f => f.framework);

  return useQuery({
    queryKey: ['stage-framework-kis', user?.id, stageId],
    enabled: !!user && frameworkNames.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('knowledge_items' as any)
        .select('id, title, tactic_summary, why_it_matters, who, framework, confidence_score, source_resource_id')
        .eq('active', true)
        .in('framework', frameworkNames)
        .order('confidence_score', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as KI[];
    },
  });
}

function FrameworkBadgeLabel({ framework, who }: { framework: string; who: string }) {
  const colors = getFrameworkColorClasses(framework);
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold border',
      colors.bg, colors.text, colors.border,
    )}>
      <BookOpen className="h-3 w-3" />
      {framework} — {who}
    </span>
  );
}

function SectionBlock({
  section,
  kis,
  defaultOpen,
}: {
  section: FrameworkSection;
  kis: KI[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-1.5 px-2 hover:bg-accent/30 rounded transition-colors">
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        <span className="text-xs font-medium text-foreground">{section.heading}</span>
        {kis.length > 0 && (
          <Badge variant="secondary" className="text-[9px] ml-auto">{kis.length}</Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-6 pb-2 space-y-1.5">
        <p className="text-[10px] text-muted-foreground italic">{section.description}</p>
        {kis.length === 0 && (
          <p className="text-[10px] text-muted-foreground/60">No matching knowledge items yet</p>
        )}
        {kis.map(ki => (
          <div key={ki.id} className="pl-4 py-1 border-l-2 border-muted">
            <p className="text-xs text-foreground font-medium">{ki.title}</p>
            {ki.tactic_summary && (
              <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{ki.tactic_summary}</p>
            )}
            {ki.who && (
              <span className="text-[9px] text-muted-foreground">— {ki.who}</span>
            )}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function FrameworkBlock({
  frameworkRole,
  kis,
  defaultOpen,
}: {
  frameworkRole: StageFrameworkRole;
  kis: KI[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const colors = getFrameworkColorClasses(frameworkRole.framework);

  // Match KIs: framework matches, plus fuzzy match on section headings
  const matchKIsToSection = (section: FrameworkSection): KI[] => {
    const headingLower = section.heading.toLowerCase();
    // Simple keyword matching — KIs whose title or tactic mentions the section heading words
    return kis.filter(ki => {
      const text = `${ki.title} ${ki.tactic_summary || ''}`.toLowerCase();
      const words = headingLower.split(/\s+/).filter(w => w.length > 3);
      return words.some(w => text.includes(w));
    });
  };

  // KIs not matched to any section
  const matchedIds = new Set<string>();
  const sectionKIs = frameworkRole.sections.map(section => {
    const matched = matchKIsToSection(section);
    matched.forEach(ki => matchedIds.add(ki.id));
    return { section, kis: matched };
  });

  const unmatchedKIs = kis.filter(ki => !matchedIds.has(ki.id));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={cn(
        'flex items-center gap-2 w-full py-2 px-3 rounded-lg transition-colors hover:bg-accent/30',
        `border-l-3 ${colors.border}`,
      )}>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <FrameworkBadgeLabel framework={frameworkRole.framework} who={frameworkRole.who} />
        <span className="text-[10px] text-muted-foreground ml-1">— {frameworkRole.role}</span>
        <Badge variant="secondary" className="text-[9px] ml-auto">{kis.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-2 space-y-0.5 pb-1">
        {sectionKIs.map(({ section, kis: sKIs }) => (
          <SectionBlock key={section.heading} section={section} kis={sKIs} defaultOpen={sKIs.length > 0} />
        ))}
        {unmatchedKIs.length > 0 && (
          <SectionBlock
            section={{ heading: 'Additional Insights', description: 'Other relevant knowledge items for this framework' }}
            kis={unmatchedKIs}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function FrameworkSectionsPanel({ stageId, stageLabel }: Props) {
  const stageFrameworks = STAGE_FRAMEWORK_MAP[stageId] || [];
  const { data: allKIs = [], isLoading } = useStageKIs(stageId);

  // Group KIs by framework
  const kisByFramework = useMemo(() => {
    const map = new Map<string, KI[]>();
    for (const ki of allKIs) {
      const fw = ki.framework || '';
      if (!map.has(fw)) map.set(fw, []);
      map.get(fw)!.push(ki);
    }
    return map;
  }, [allKIs]);

  if (stageFrameworks.length === 0) return null;

  const totalKIs = allKIs.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5" />
            Sales Operating System
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Framework-driven sections · {totalKIs} knowledge items
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-card divide-y">
        {stageFrameworks.map((fr, i) => (
          <FrameworkBlock
            key={fr.framework}
            frameworkRole={fr}
            kis={kisByFramework.get(fr.framework) || []}
            defaultOpen={i === 0}
          />
        ))}
      </div>
    </div>
  );
}
