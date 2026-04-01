import { useState } from 'react';
import { useStagePlaybook, type PlaybookSection, type TacticalItem } from '@/hooks/useStagePlaybook';
import { useStageResources } from '@/hooks/useStageResources';
import { STAGE_FRAMEWORK_MAP, getFrameworkColorClasses, FRAMEWORK_AUTHORS } from '@/data/stageFrameworkMap';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import {
  BookOpen, ChevronDown, ChevronRight, Copy, RefreshCw, Loader2, Quote,
  HelpCircle, MessageSquare, Lightbulb, Eye, ArrowRight, Star, FileText, Brain, Target,
} from 'lucide-react';
import { SectionFeedback, PlaybookItemFeedback } from './PlaybookFeedbackControls';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  stageId: string;
  stageLabel: string;
}

function CitationSourceIcon({ citation }: { citation: string }) {
  if (citation.startsWith('[Keystone:') || citation.includes('KEYSTONE')) {
    return <Star className="h-2.5 w-2.5 text-amber-500 shrink-0" />;
  }
  if (citation.startsWith('[KI:') || citation.includes('Knowledge Item')) {
    return <Brain className="h-2.5 w-2.5 text-violet-500 shrink-0" />;
  }
  return <FileText className="h-2.5 w-2.5 text-muted-foreground shrink-0" />;
}

function TacticalItemRow({ item, icon: Icon, color, stageId, framework, sectionHeading, label }: {
  item: TacticalItem;
  icon: typeof HelpCircle;
  color: string;
  stageId: string;
  framework?: string;
  sectionHeading: string;
  label: string;
}) {
  const [showCitations, setShowCitations] = useState(false);

  return (
    <div className="group/item relative pl-5 py-1 flex items-start gap-1">
      <Icon className={cn('absolute left-0 top-1.5 h-3.5 w-3.5', color)} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-foreground leading-relaxed">{item.content}</p>
        {item.citations && item.citations.length > 0 && (
          <button
            onClick={() => setShowCitations(!showCitations)}
            className="inline-flex items-center gap-1 mt-0.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Quote className="h-2.5 w-2.5" />
            {item.citations.length} source{item.citations.length > 1 ? 's' : ''}
          </button>
        )}
        {showCitations && item.citations && item.citations.length > 0 && (
          <div className="mt-1 pl-3 border-l-2 border-muted space-y-0.5">
            {item.citations.map((c, i) => (
              <p key={i} className="text-[9px] text-muted-foreground italic flex items-center gap-1">
                <CitationSourceIcon citation={c} />
                {c}
              </p>
            ))}
          </div>
        )}
      </div>
      <PlaybookItemFeedback
        stageId={stageId}
        framework={framework}
        sectionHeading={sectionHeading}
        itemContent={item.content}
      />
    </div>
  );
}

function TacticalBlock({ label, items, icon: Icon, color, stageId, framework, sectionHeading }: {
  label: string;
  items: TacticalItem[];
  icon: typeof HelpCircle;
  color: string;
  stageId: string;
  framework?: string;
  sectionHeading: string;
}) {
  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn('h-3 w-3', color)} />
        <span className={cn('text-[10px] font-semibold uppercase tracking-wider', color)}>{label}</span>
        <Badge variant="secondary" className="text-[8px] h-3.5 px-1">{items.length}</Badge>
      </div>
      {items.map((item, i) => (
        <TacticalItemRow key={i} item={item} icon={Icon} color={color} stageId={stageId} framework={framework} sectionHeading={sectionHeading} label={label} />
      ))}
    </div>
  );
}

function FrameworkBadgeInline({ framework }: { framework: string }) {
  const colors = getFrameworkColorClasses(framework);
  const who = FRAMEWORK_AUTHORS[framework] || '';
  const label = who ? `${framework} — ${who}` : framework;
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold border', colors.bg, colors.text, colors.border)}>
      <BookOpen className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

function PlaybookSectionBlock({ section, stageId, defaultOpen }: { section: PlaybookSection; stageId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const framework = section.framework;
  const fwColors = framework ? getFrameworkColorClasses(framework) : null;

  const displayTitle = framework && section.title.startsWith(framework + ':')
    ? section.title.slice(framework.length + 1).trim()
    : section.title;

  const itemCount = (section.questions?.length || 0) + (section.talk_tracks?.length || 0) +
    (section.hypotheses?.length || 0) + (section.signals?.length || 0) + (section.next_steps?.length || 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={cn(
        'group/section flex items-center gap-2 w-full py-2 hover:bg-accent/30 rounded px-2 transition-colors',
        fwColors && `border-l-2 ${fwColors.border}`
      )}>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        {framework && <FrameworkBadgeInline framework={framework} />}
        <span className="text-sm font-medium text-foreground">{displayTitle}</span>
        <SectionFeedback stageId={stageId} framework={framework} sectionHeading={displayTitle} />
        <Badge variant="secondary" className="text-[9px] ml-auto">{itemCount}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-4 pb-3 space-y-3">
        {/* Objective */}
        {section.objective && (
          <div className="flex items-start gap-2 bg-muted/30 rounded-md px-3 py-2">
            <Target className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-foreground font-medium leading-relaxed">{section.objective}</p>
          </div>
        )}

        <TacticalBlock label="Questions" items={section.questions} icon={HelpCircle} color="text-blue-500" stageId={stageId} framework={framework} sectionHeading={displayTitle} />
        <TacticalBlock label="Talk Tracks" items={section.talk_tracks} icon={MessageSquare} color="text-violet-500" stageId={stageId} framework={framework} sectionHeading={displayTitle} />
        <TacticalBlock label="Hypotheses" items={section.hypotheses} icon={Lightbulb} color="text-amber-500" stageId={stageId} framework={framework} sectionHeading={displayTitle} />
        <TacticalBlock label="Signals" items={section.signals} icon={Eye} color="text-emerald-500" stageId={stageId} framework={framework} sectionHeading={displayTitle} />
        <TacticalBlock label="Next Steps" items={section.next_steps} icon={ArrowRight} color="text-primary" stageId={stageId} framework={framework} sectionHeading={displayTitle} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function groupByFramework(sections: PlaybookSection[]): { framework: string | null; sections: PlaybookSection[] }[] {
  const groups: { framework: string | null; sections: PlaybookSection[] }[] = [];
  let current: { framework: string | null; sections: PlaybookSection[] } | null = null;

  for (const section of sections) {
    const fw = section.framework || null;
    if (!current || current.framework !== fw) {
      current = { framework: fw, sections: [section] };
      groups.push(current);
    } else {
      current.sections.push(section);
    }
  }
  return groups;
}

export function StagePlaybookSection({ stageId, stageLabel }: Props) {
  const { playbook, isLoading, generate } = useStagePlaybook(stageId);
  const { stageResources, keystoneResources } = useStageResources(stageId);
  const stageFrameworks = STAGE_FRAMEWORK_MAP[stageId] || [];

  const handleGenerate = () => {
    const allIds = stageResources.map(r => r.resource_id);
    const keystoneIds = keystoneResources.map(r => r.resource_id);
    generate.mutate({ resourceIds: allIds, keystoneResourceIds: keystoneIds });
  };

  const handleCopy = () => {
    if (!playbook?.content) return;
    const text = playbook.content.sections
      .map(s => {
        const fw = s.framework ? FRAMEWORK_AUTHORS[s.framework] : null;
        const prefix = s.framework ? `[${s.framework}${fw ? ` — ${fw}` : ''}] ` : '';
        const parts: string[] = [`## ${prefix}${s.title}`];
        if (s.objective) parts.push(`Objective: ${s.objective}`);
        const renderItems = (label: string, items?: TacticalItem[]) => {
          if (items?.length) parts.push(`${label}:\n${items.map(i => `- ${i.content}`).join('\n')}`);
        };
        renderItems('Questions', s.questions);
        renderItems('Talk Tracks', s.talk_tracks);
        renderItems('Hypotheses', s.hypotheses);
        renderItems('Signals', s.signals);
        renderItems('Next Steps', s.next_steps);
        return parts.join('\n');
      })
      .join('\n\n');
    const full = `# ${playbook.content.title}\n${playbook.content.summary}\n\n${text}`;
    navigator.clipboard.writeText(full);
    toast.success('Playbook copied to clipboard');
  };

  const hasResources = stageResources.length > 0;
  const content = playbook?.content;
  const groups = content ? groupByFramework(content.sections) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            Tactical Playbook
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Questions, talk tracks, signals & next steps from your resources
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {content && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleCopy}>
              <Copy className="h-3 w-3" /> Copy
            </Button>
          )}
          <Button
            variant={content ? 'outline' : 'default'}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleGenerate}
            disabled={generate.isPending || !hasResources}
          >
            {generate.isPending ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
            ) : content ? (
              <><RefreshCw className="h-3 w-3" /> Regenerate</>
            ) : (
              <><BookOpen className="h-3 w-3" /> Generate Playbook</>
            )}
          </Button>
        </div>
      </div>

      {!content && hasResources && !generate.isPending && stageFrameworks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stageFrameworks.map(f => (
            <FrameworkBadgeInline key={f.framework} framework={f.framework} />
          ))}
        </div>
      )}

      {!hasResources && !content && (
        <div className="rounded-lg border border-dashed border-muted-foreground/20 p-6 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Add resources to this stage to generate a playbook</p>
        </div>
      )}

      {hasResources && !content && !generate.isPending && (
        <div className="rounded-lg border border-dashed border-primary/20 bg-primary/5 p-6 text-center">
          <BookOpen className="h-8 w-8 text-primary/40 mx-auto mb-2" />
          <p className="text-sm text-foreground font-medium">Ready to compile your {stageLabel} playbook</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {stageResources.length} resource{stageResources.length > 1 ? 's' : ''} assigned
            {keystoneResources.length > 0 && ` · ${keystoneResources.length} keystone`}
          </p>
          <Button size="sm" className="mt-3 h-7 text-xs gap-1" onClick={handleGenerate}>
            <BookOpen className="h-3 w-3" /> Generate Playbook
          </Button>
        </div>
      )}

      {generate.isPending && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-8 text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">Compiling tactical playbook…</p>
          <p className="text-[10px] text-muted-foreground mt-1">Generating questions, talk tracks, signals & next steps</p>
        </div>
      )}

      {content && !generate.isPending && (
        <div className="rounded-lg border bg-card">
          <div className="p-3 border-b">
            <h4 className="text-sm font-semibold text-foreground">{content.title}</h4>
            <p className="text-xs text-muted-foreground mt-0.5">{content.summary}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="outline" className="text-[9px]">
                {playbook!.knowledge_item_count} KIs compiled
              </Badge>
              <Badge variant="outline" className="text-[9px]">
                {playbook!.resource_ids.length} resources
              </Badge>
              <Badge variant="outline" className="text-[9px]">
                Generated {new Date(playbook!.generated_at).toLocaleDateString()}
              </Badge>
              {stageFrameworks.map(f => (
                <FrameworkBadgeInline key={f.framework} framework={f.framework} />
              ))}
            </div>
          </div>
          <div className="divide-y">
            {groups.map((group, gi) => (
              <div key={gi}>
                {group.sections.map((section, si) => (
                  <PlaybookSectionBlock key={`${gi}-${si}`} section={section} stageId={stageId} defaultOpen={gi === 0 && si < 2} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
