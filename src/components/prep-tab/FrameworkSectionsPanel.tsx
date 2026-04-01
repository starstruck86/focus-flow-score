/**
 * FrameworkSectionsPanel — renders predefined framework-driven sections
 * for a Prep stage and auto-populates them with matching KIs.
 * Uses tiered relevance: framework → tags/contexts → keyword fallback.
 * Includes match reason metadata and framework summary banner.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { STAGE_FRAMEWORK_MAP, getFrameworkColorClasses } from '@/data/stageFrameworkMap';
import type { StageFrameworkRole, FrameworkSection } from '@/data/stageFrameworkMap';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, ChevronRight, BookOpen, Lightbulb, Info, HelpCircle, MessageSquare, Eye, ArrowRight } from 'lucide-react';
import { SectionFeedback, KIPlacementFeedback } from './PlaybookFeedbackControls';
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
  tags: string[];
  applies_to_contexts: string[];
}

type MatchReason = 'framework' | 'stage_context' | 'tag' | 'keyword';

interface MatchedKI extends KI {
  matchReason: MatchReason;
}

/** Fetch all KIs that match any framework used by this stage, plus context-matched */
function useStageKIs(stageId: string) {
  const { user } = useAuth();
  const stageFrameworks = STAGE_FRAMEWORK_MAP[stageId] || [];
  const frameworkNames = stageFrameworks.map(f => f.framework);

  return useQuery({
    queryKey: ['stage-framework-kis', user?.id, stageId],
    enabled: !!user && frameworkNames.length > 0,
    queryFn: async () => {
      // Fetch framework-matched KIs
      const { data: fwData, error: fwErr } = await supabase
        .from('knowledge_items' as any)
        .select('id, title, tactic_summary, why_it_matters, who, framework, confidence_score, source_resource_id, tags, applies_to_contexts')
        .eq('active', true)
        .in('framework', frameworkNames)
        .order('confidence_score', { ascending: false });
      if (fwErr) throw fwErr;

      // Fetch stage-context-matched KIs
      const { data: ctxData, error: ctxErr } = await supabase
        .from('knowledge_items' as any)
        .select('id, title, tactic_summary, why_it_matters, who, framework, confidence_score, source_resource_id, tags, applies_to_contexts')
        .eq('active', true)
        .contains('applies_to_contexts', [stageId])
        .order('confidence_score', { ascending: false })
        .limit(30);
      if (ctxErr) throw ctxErr;

      // Deduplicate
      const map = new Map<string, KI>();
      for (const ki of [...(fwData ?? []), ...(ctxData ?? [])] as unknown as KI[]) {
        if (!map.has(ki.id)) map.set(ki.id, ki);
      }
      return Array.from(map.values());
    },
  });
}

/** Tiered matching: framework > tags/contexts > keyword */
function matchKIsToSection(
  kis: KI[],
  section: FrameworkSection,
  frameworkName: string,
  stageId: string,
): MatchedKI[] {
  const results: MatchedKI[] = [];
  const usedIds = new Set<string>();

  // Tier 1: Framework match — KI.framework matches this framework block
  for (const ki of kis) {
    if (ki.framework === frameworkName && !usedIds.has(ki.id)) {
      // Check if section heading has any relevance to KI
      const headingLower = section.heading.toLowerCase();
      const text = `${ki.title} ${ki.tactic_summary || ''} ${(ki.tags || []).join(' ')}`.toLowerCase();
      const words = headingLower.split(/\s+/).filter(w => w.length > 3);
      if (words.some(w => text.includes(w))) {
        results.push({ ...ki, matchReason: 'framework' });
        usedIds.add(ki.id);
      }
    }
  }

  // Tier 2: Stage context match
  for (const ki of kis) {
    if (usedIds.has(ki.id)) continue;
    if ((ki.applies_to_contexts || []).includes(stageId)) {
      const headingLower = section.heading.toLowerCase();
      const text = `${ki.title} ${ki.tactic_summary || ''} ${(ki.tags || []).join(' ')}`.toLowerCase();
      const words = headingLower.split(/\s+/).filter(w => w.length > 3);
      if (words.some(w => text.includes(w))) {
        results.push({ ...ki, matchReason: 'stage_context' });
        usedIds.add(ki.id);
      }
    }
  }

  // Tier 3: Tag overlap
  for (const ki of kis) {
    if (usedIds.has(ki.id)) continue;
    const sectionWords = section.heading.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const kiTags = (ki.tags || []).map(t => t.toLowerCase());
    if (sectionWords.some(w => kiTags.some(t => t.includes(w) || w.includes(t)))) {
      results.push({ ...ki, matchReason: 'tag' });
      usedIds.add(ki.id);
    }
  }

  // Tier 4: Keyword fallback (title + tactic_summary)
  for (const ki of kis) {
    if (usedIds.has(ki.id)) continue;
    const headingLower = section.heading.toLowerCase();
    const text = `${ki.title} ${ki.tactic_summary || ''}`.toLowerCase();
    const words = headingLower.split(/\s+/).filter(w => w.length > 3);
    if (words.some(w => text.includes(w))) {
      results.push({ ...ki, matchReason: 'keyword' });
      usedIds.add(ki.id);
    }
  }

  return results.sort((a, b) => b.confidence_score - a.confidence_score);
}

const MATCH_REASON_LABELS: Record<MatchReason, string> = {
  framework: 'Matched by framework',
  stage_context: 'Matched by stage context',
  tag: 'Matched by tag',
  keyword: 'Matched by keyword similarity',
};

const MATCH_REASON_COLORS: Record<MatchReason, string> = {
  framework: 'text-emerald-500',
  stage_context: 'text-blue-500',
  tag: 'text-violet-500',
  keyword: 'text-muted-foreground',
};

/** Compact framework role descriptions */
const FRAMEWORK_ROLE_LABELS: Record<string, string> = {
  'GAP Selling': 'Discovery & problem depth',
  'Challenger': 'Insight, reframe & teaching',
  'MEDDPICC': 'Deal qualification & progression',
  'Command of the Message': 'Structure & narrative',
};

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

function FrameworkSummaryBanner({ frameworks }: { frameworks: StageFrameworkRole[] }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        Frameworks applied on this page
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {frameworks.map(f => {
          const colors = getFrameworkColorClasses(f.framework);
          return (
            <div key={f.framework} className="flex items-center gap-1.5 text-[10px]">
              <span className={cn('font-semibold', colors.text)}>{f.framework}</span>
              <span className="text-muted-foreground">— {f.who}</span>
              <span className="text-muted-foreground/60">({FRAMEWORK_ROLE_LABELS[f.framework] || f.role})</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Map framework to primary tactical role for KIs */
const FRAMEWORK_KI_ROLES: Record<string, { primary: string; secondary: string }> = {
  'GAP Selling': { primary: 'Questions & Hypotheses', secondary: 'questions' },
  'Challenger': { primary: 'Talk Tracks & Insights', secondary: 'talk_tracks' },
  'MEDDPICC': { primary: 'Signals & Next Steps', secondary: 'signals' },
  'Command of the Message': { primary: 'Talk Tracks & Questions', secondary: 'talk_tracks' },
};

const ROLE_ICONS: Record<string, { icon: typeof HelpCircle; color: string }> = {
  questions: { icon: HelpCircle, color: 'text-blue-500' },
  talk_tracks: { icon: MessageSquare, color: 'text-violet-500' },
  signals: { icon: Eye, color: 'text-emerald-500' },
};

function SectionBlock({
  section,
  kis,
  stageId,
  framework,
  defaultOpen,
}: {
  section: FrameworkSection;
  kis: MatchedKI[];
  stageId: string;
  framework?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const fwRole = framework ? FRAMEWORK_KI_ROLES[framework] : null;
  const roleIcon = fwRole ? ROLE_ICONS[fwRole.secondary] : null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group/section flex items-center gap-2 w-full py-1.5 px-2 hover:bg-accent/30 rounded transition-colors">
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        <span className="text-xs font-medium text-foreground">{section.heading}</span>
        {fwRole && (
          <span className="text-[9px] text-muted-foreground/60 hidden sm:inline">→ {fwRole.primary}</span>
        )}
        <SectionFeedback stageId={stageId} framework={framework} sectionHeading={section.heading} />
        {kis.length > 0 && (
          <Badge variant="secondary" className="text-[9px] ml-auto">{kis.length}</Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-6 pb-2 space-y-1.5">
        <p className="text-[10px] text-muted-foreground italic">{section.description}</p>
        {kis.length === 0 && (
          <p className="text-[10px] text-muted-foreground/60">No matching knowledge items yet</p>
        )}
        <TooltipProvider delayDuration={200}>
          {kis.map(ki => {
            const RoleIcon = roleIcon?.icon || Lightbulb;
            const roleColor = roleIcon?.color || 'text-muted-foreground';
            return (
              <div key={ki.id} className="group/ki pl-5 py-1 border-l-2 border-muted flex items-start gap-1 relative">
                <RoleIcon className={cn('absolute left-0 top-1.5 h-3.5 w-3.5', roleColor)} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground font-medium">{ki.title}</p>
                  {ki.tactic_summary && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{ki.tactic_summary}</p>
                  )}
                  {ki.why_it_matters && (
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5 italic">↳ {ki.why_it_matters}</p>
                  )}
                  {ki.who && ki.framework && (
                    <span className="text-[9px] text-muted-foreground">[{ki.framework} — {ki.who}]</span>
                  )}
                </div>
                <KIPlacementFeedback
                  stageId={stageId}
                  framework={framework}
                  sectionHeading={section.heading}
                  kiId={ki.id}
                  kiTitle={ki.title}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className={cn('h-3 w-3 mt-0.5 shrink-0 cursor-help', MATCH_REASON_COLORS[ki.matchReason])} />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs max-w-[200px]">
                    <p className="font-medium">{MATCH_REASON_LABELS[ki.matchReason]}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </TooltipProvider>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FrameworkBlock({
  frameworkRole,
  kis,
  stageId,
  defaultOpen,
}: {
  frameworkRole: StageFrameworkRole;
  kis: KI[];
  stageId: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const colors = getFrameworkColorClasses(frameworkRole.framework);

  // Tiered matching per section
  const matchedIds = new Set<string>();
  const sectionKIs = frameworkRole.sections.map(section => {
    const matched = matchKIsToSection(kis, section, frameworkRole.framework, stageId);
    matched.forEach(ki => matchedIds.add(ki.id));
    return { section, kis: matched };
  });

  // Unmatched KIs that belong to this framework
  const unmatchedKIs: MatchedKI[] = kis
    .filter(ki => ki.framework === frameworkRole.framework && !matchedIds.has(ki.id))
    .map(ki => ({ ...ki, matchReason: 'framework' as MatchReason }));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={cn(
        'flex items-center gap-2 w-full py-2 px-3 rounded-lg transition-colors hover:bg-accent/30',
        `border-l-3 ${colors.border}`,
      )}>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <FrameworkBadgeLabel framework={frameworkRole.framework} who={frameworkRole.who} />
        <span className="text-[10px] text-muted-foreground ml-1 hidden sm:inline">— {frameworkRole.role}</span>
        <Badge variant="secondary" className="text-[9px] ml-auto">
          {sectionKIs.reduce((s, x) => s + x.kis.length, 0) + unmatchedKIs.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-2 space-y-0.5 pb-1">
        {sectionKIs.map(({ section, kis: sKIs }) => (
          <SectionBlock key={section.heading} section={section} kis={sKIs} stageId={stageId} framework={frameworkRole.framework} defaultOpen={sKIs.length > 0} />
        ))}
        {unmatchedKIs.length > 0 && (
          <SectionBlock
            section={{ heading: 'Additional Insights', description: 'Other relevant knowledge items for this framework' }}
            kis={unmatchedKIs}
            stageId={stageId}
            framework={frameworkRole.framework}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function FrameworkSectionsPanel({ stageId, stageLabel }: Props) {
  const stageFrameworks = STAGE_FRAMEWORK_MAP[stageId] || [];
  const { data: allKIs = [] } = useStageKIs(stageId);

  const kisByFramework = useMemo(() => {
    const map = new Map<string, KI[]>();
    for (const ki of allKIs) {
      const fw = ki.framework || '';
      if (!map.has(fw)) map.set(fw, []);
      map.get(fw)!.push(ki);
    }
    // Also add KIs without framework to all framework buckets for context matching
    const noFw = allKIs.filter(ki => !ki.framework);
    for (const fr of stageFrameworks) {
      const existing = map.get(fr.framework) || [];
      map.set(fr.framework, [...existing, ...noFw.filter(ki => !existing.some(e => e.id === ki.id))]);
    }
    return map;
  }, [allKIs, stageFrameworks]);

  if (stageFrameworks.length === 0) return null;

  const totalKIs = allKIs.length;

  return (
    <div className="space-y-2">
      <FrameworkSummaryBanner frameworks={stageFrameworks} />

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
            stageId={stageId}
            defaultOpen={i === 0}
          />
        ))}
      </div>
    </div>
  );
}
