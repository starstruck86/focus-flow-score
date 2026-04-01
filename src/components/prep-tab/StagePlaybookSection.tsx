import { useState } from 'react';
import { useStagePlaybook, type PlaybookSection, type PlaybookItem } from '@/hooks/useStagePlaybook';
import { useStageResources } from '@/hooks/useStageResources';
import { STAGE_FRAMEWORK_MAP, getFrameworkColorClasses } from '@/data/stageFrameworkMap';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { BookOpen, ChevronDown, ChevronRight, Copy, RefreshCw, Loader2, Quote, AlertTriangle, Lightbulb, MessageSquare, HelpCircle, Layers, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  stageId: string;
  stageLabel: string;
}

const TYPE_CONFIG: Record<string, { icon: typeof BookOpen; color: string; label: string }> = {
  tactic: { icon: CheckCircle, color: 'text-emerald-500', label: 'Tactic' },
  question: { icon: HelpCircle, color: 'text-blue-500', label: 'Question' },
  talk_track: { icon: MessageSquare, color: 'text-violet-500', label: 'Talk Track' },
  framework: { icon: Layers, color: 'text-amber-500', label: 'Framework' },
  warning: { icon: AlertTriangle, color: 'text-destructive', label: 'Warning' },
  tip: { icon: Lightbulb, color: 'text-primary', label: 'Tip' },
};

function PlaybookItemRow({ item }: { item: PlaybookItem }) {
  const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.tactic;
  const Icon = config.icon;
  const [showCitations, setShowCitations] = useState(false);

  return (
    <div className="group relative pl-6 py-1.5">
      <Icon className={cn('absolute left-0 top-2 h-4 w-4', config.color)} />
      <p className="text-sm text-foreground leading-relaxed">{item.content}</p>
      {item.citations?.length > 0 && (
        <button
          onClick={() => setShowCitations(!showCitations)}
          className="inline-flex items-center gap-1 mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Quote className="h-3 w-3" />
          {item.citations.length} source{item.citations.length > 1 ? 's' : ''}
        </button>
      )}
      {showCitations && item.citations?.length > 0 && (
        <div className="mt-1.5 pl-3 border-l-2 border-muted space-y-0.5">
          {item.citations.map((c, i) => (
            <p key={i} className="text-[10px] text-muted-foreground italic">{c}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function FrameworkBadgeInline({ framework }: { framework: string }) {
  const colors = getFrameworkColorClasses(framework);
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border', colors.bg, colors.text, colors.border)}>
      {framework}
    </span>
  );
}

function PlaybookSectionBlock({ section, defaultOpen }: { section: PlaybookSection; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const framework = section.framework;
  const fwColors = framework ? getFrameworkColorClasses(framework) : null;

  // Strip framework prefix from title for cleaner display
  const displayTitle = framework && section.title.startsWith(framework + ':')
    ? section.title.slice(framework.length + 1).trim()
    : section.title;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={cn(
        'flex items-center gap-2 w-full py-2 hover:bg-accent/30 rounded px-2 transition-colors',
        fwColors && `border-l-2 ${fwColors.border}`
      )}>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        {framework && <FrameworkBadgeInline framework={framework} />}
        <span className="text-sm font-medium text-foreground">{displayTitle}</span>
        <Badge variant="secondary" className="text-[9px] ml-auto">{section.items.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-4 space-y-1 pb-2">
        {section.items.map((item, i) => (
          <PlaybookItemRow key={i} item={item} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Group sections by framework for visual clustering */
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
      .map(s => `## ${s.framework ? `[${s.framework}] ` : ''}${s.title}\n${s.items.map(i => `- ${i.content}${i.citations?.length ? ` [${i.citations.join('; ')}]` : ''}`).join('\n')}`)
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
            Sales Operating System
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Unified playbook: GAP · Challenger · MEDDPICC · CoM
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

      {/* Framework legend for this stage */}
      {!content && hasResources && !generate.isPending && stageFrameworks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stageFrameworks.map(f => {
            const colors = getFrameworkColorClasses(f.framework);
            return (
              <div key={f.framework} className={cn('flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px]', colors.bg, colors.border)}>
                <span className={cn('font-semibold', colors.text)}>{f.framework}</span>
                <span className="text-muted-foreground">— {f.role}</span>
              </div>
            );
          })}
        </div>
      )}

      {!hasResources && !content && (
        <div className="rounded-lg border border-dashed border-muted-foreground/20 p-6 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Add resources to this stage to generate a playbook</p>
          <p className="text-[10px] text-muted-foreground mt-1">Select Keystone Resources for foundational guidance</p>
        </div>
      )}

      {hasResources && !content && !generate.isPending && (
        <div className="rounded-lg border border-dashed border-primary/20 bg-primary/5 p-6 text-center">
          <BookOpen className="h-8 w-8 text-primary/40 mx-auto mb-2" />
          <p className="text-sm text-foreground font-medium">Ready to compile your {stageLabel} playbook</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {stageResources.length} resource{stageResources.length > 1 ? 's' : ''} assigned
            {keystoneResources.length > 0 && ` · ${keystoneResources.length} keystone`}
            {` · ${stageFrameworks.length} frameworks`}
          </p>
          <Button size="sm" className="mt-3 h-7 text-xs gap-1" onClick={handleGenerate}>
            <BookOpen className="h-3 w-3" /> Generate Playbook
          </Button>
        </div>
      )}

      {generate.isPending && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-8 text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">Compiling unified playbook…</p>
          <p className="text-[10px] text-muted-foreground mt-1">Synthesizing GAP Selling · Challenger · MEDDPICC · Command of the Message</p>
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
              {/* Framework badges */}
              {stageFrameworks.map(f => (
                <FrameworkBadgeInline key={f.framework} framework={f.framework} />
              ))}
            </div>
          </div>
          <div className="divide-y">
            {groups.map((group, gi) => (
              <div key={gi}>
                {group.sections.map((section, si) => (
                  <PlaybookSectionBlock key={`${gi}-${si}`} section={section} defaultOpen={gi === 0 && si < 2} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
