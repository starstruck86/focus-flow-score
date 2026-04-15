import { useState, useMemo, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Copy, RefreshCw, Loader2, Mail, FileText, Target, ArrowRight,
  History, Pencil, CheckCircle2, Clock, Eye, Link2, Info,
  ThumbsUp, ThumbsDown,
} from 'lucide-react';
import { toast } from 'sonner';
import type { StrategyArtifact } from '@/hooks/strategy/useStrategyArtifacts';
import { useArtifactFeedback } from '@/hooks/strategy/useArtifactFeedback';

interface Props {
  artifact: StrategyArtifact | null;
  allArtifacts: StrategyArtifact[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegenerate?: (artifactId: string, artifactType: string, refineInstructions?: string) => Promise<StrategyArtifact | null>;
  isTransforming?: boolean;
}

const TYPE_ICONS: Record<string, typeof FileText> = {
  email: Mail,
  account_plan: FileText,
  call_prep: Target,
  memo: FileText,
  next_steps: ArrowRight,
};

/** Walk full ancestry tree from any artifact to build the complete version chain */
function buildFullVersionChain(artifact: StrategyArtifact, allArtifacts: StrategyArtifact[]): StrategyArtifact[] {
  let rootId = artifact.id;
  const byId = new Map(allArtifacts.map(a => [a.id, a]));
  let current: StrategyArtifact | undefined = artifact;
  while (current?.parent_artifact_id) {
    const parent = byId.get(current.parent_artifact_id);
    if (!parent) break;
    rootId = parent.id;
    current = parent;
  }

  const chain: StrategyArtifact[] = [];
  const queue = [rootId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (node) {
      chain.push(node);
      for (const a of allArtifacts) {
        if (a.parent_artifact_id === id && !visited.has(a.id)) {
          queue.push(a.id);
        }
      }
    }
  }

  return chain.sort((a, b) => a.version - b.version);
}

export function ArtifactDetailModal({
  artifact, allArtifacts, open, onOpenChange, onRegenerate, isTransforming,
}: Props) {
  const [view, setView] = useState<'detail' | 'history' | 'refine'>('detail');
  const [refineInstructions, setRefineInstructions] = useState('');
  const [viewingArtifact, setViewingArtifact] = useState<StrategyArtifact | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, number>>({});
  const { submitFeedback } = useArtifactFeedback();

  const displayArtifact = viewingArtifact || artifact;

  useEffect(() => {
    setViewingArtifact(null);
    setView('detail');
    setRefineInstructions('');
  }, [artifact?.id]);

  const versionChain = useMemo(() => {
    if (!artifact) return [];
    return buildFullVersionChain(artifact, allArtifacts);
  }, [artifact, allArtifacts]);

  const latestVersion = useMemo(() => {
    if (versionChain.length === 0) return artifact;
    return versionChain[versionChain.length - 1];
  }, [versionChain, artifact]);

  useEffect(() => {
    if (viewingArtifact) {
      const fresh = allArtifacts.find(a => a.id === viewingArtifact.id);
      if (fresh && fresh !== viewingArtifact) {
        setViewingArtifact(fresh);
      }
    }
  }, [allArtifacts, viewingArtifact]);

  if (!artifact || !displayArtifact) return null;

  const TypeIcon = TYPE_ICONS[displayArtifact.artifact_type] || FileText;
  const typeLabel = displayArtifact.artifact_type.replace(/_/g, ' ');
  const contentJson = displayArtifact.content_json as any;
  const refineUsed = contentJson?._refine_instructions;

  const copyContent = () => {
    navigator.clipboard.writeText(displayArtifact.rendered_text || JSON.stringify(displayArtifact.content_json, null, 2));
    toast.success('Copied to clipboard');
  };

  const handleRegenerate = async () => {
    if (!onRegenerate || !displayArtifact) return;
    const result = await onRegenerate(displayArtifact.id, displayArtifact.artifact_type);
    if (result) {
      setViewingArtifact(result);
      setView('detail');
    }
  };

  const handleRefine = async () => {
    if (!onRegenerate || !refineInstructions.trim() || !displayArtifact) return;
    const result = await onRegenerate(displayArtifact.id, displayArtifact.artifact_type, refineInstructions.trim());
    if (result) {
      setRefineInstructions('');
      setViewingArtifact(result);
      setView('detail');
    }
  };

  const handleViewVersion = (v: StrategyArtifact) => {
    setViewingArtifact(v);
    setView('detail');
  };

  const handleFeedback = (rating: number) => {
    submitFeedback(displayArtifact.id, rating);
    setFeedbackGiven(prev => ({ ...prev, [displayArtifact.id]: rating }));
  };

  const isViewingLatest = !viewingArtifact || viewingArtifact.id === latestVersion?.id;
  const currentFeedback = feedbackGiven[displayArtifact.id];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <TypeIcon className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-sm font-semibold truncate">{displayArtifact.title}</DialogTitle>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 capitalize">{typeLabel}</Badge>
                <Badge variant="outline" className="text-[9px] px-1.5 py-0">v{displayArtifact.version}</Badge>
                <span className="text-[9px] text-muted-foreground">
                  {new Date(displayArtifact.created_at).toLocaleDateString()}
                </span>
                {!isViewingLatest && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0 text-amber-400 border-amber-400/30">
                    Older version
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Lineage info */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {displayArtifact.source_output_id && (
              <Badge variant="outline" className="text-[8px] px-1.5 py-0 gap-0.5 font-normal text-muted-foreground">
                <Link2 className="h-2 w-2" /> From output
              </Badge>
            )}
            {displayArtifact.parent_artifact_id && (
              <Badge variant="outline" className="text-[8px] px-1.5 py-0 gap-0.5 font-normal text-muted-foreground">
                <History className="h-2 w-2" /> Refined from v{versionChain.find(v => v.id === displayArtifact.parent_artifact_id)?.version ?? '?'}
              </Badge>
            )}
          </div>

          {/* Refine instructions used */}
          {refineUsed && (
            <div className="mt-2 bg-muted/20 rounded-md px-2.5 py-1.5 border border-border/30">
              <div className="flex items-center gap-1 mb-0.5">
                <Info className="h-2.5 w-2.5 text-muted-foreground/50" />
                <span className="text-[9px] font-medium text-muted-foreground/70">Refinement instructions</span>
              </div>
              <p className="text-[10px] text-foreground/60 italic leading-relaxed">{refineUsed}</p>
            </div>
          )}

          {/* Tab bar */}
          <div className="flex gap-1 mt-3">
            {(['detail', 'history', 'refine'] as const).map(tab => (
              <Button
                key={tab}
                size="sm"
                variant={view === tab ? 'secondary' : 'ghost'}
                className="h-7 text-[10px] px-2.5 gap-1 capitalize"
                onClick={() => setView(tab)}
              >
                {tab === 'detail' && <FileText className="h-3 w-3" />}
                {tab === 'history' && <History className="h-3 w-3" />}
                {tab === 'refine' && <Pencil className="h-3 w-3" />}
                {tab}
              </Button>
            ))}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-4">
            {view === 'detail' && (
              <ArtifactFullContent type={displayArtifact.artifact_type} data={displayArtifact.content_json as any} renderedText={displayArtifact.rendered_text} />
            )}
            {view === 'history' && (
              <VersionHistoryView
                versions={versionChain}
                latestId={latestVersion?.id ?? null}
                viewingId={displayArtifact.id}
                onViewVersion={handleViewVersion}
              />
            )}
            {view === 'refine' && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Refining <strong>v{displayArtifact.version}</strong>. A new version will be generated with your instructions.
                </p>
                <Textarea
                  value={refineInstructions}
                  onChange={e => setRefineInstructions(e.target.value)}
                  placeholder="e.g., Make it more concise, add competitive positioning, change the CTA to focus on ROI..."
                  className="min-h-[100px] text-sm"
                />
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={handleRefine}
                  disabled={!refineInstructions.trim() || isTransforming}
                >
                  {isTransforming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                  Generate Refined Version
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Bottom actions */}
        <div className="border-t border-border px-5 py-3 flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={copyContent}>
            <Copy className="h-3 w-3" /> Copy
          </Button>
          <Button
            size="sm" variant="outline" className="gap-1.5 text-xs"
            onClick={handleRegenerate}
            disabled={isTransforming}
          >
            {isTransforming ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Regenerate
          </Button>

          {/* Feedback buttons */}
          <div className="flex items-center gap-1 ml-1">
            <Button
              size="icon" variant={currentFeedback === 1 ? 'secondary' : 'ghost'}
              className="h-7 w-7"
              onClick={() => handleFeedback(1)}
              title="Good output"
            >
              <ThumbsUp className={`h-3 w-3 ${currentFeedback === 1 ? 'text-green-400' : ''}`} />
            </Button>
            <Button
              size="icon" variant={currentFeedback === -1 ? 'secondary' : 'ghost'}
              className="h-7 w-7"
              onClick={() => handleFeedback(-1)}
              title="Poor output"
            >
              <ThumbsDown className={`h-3 w-3 ${currentFeedback === -1 ? 'text-red-400' : ''}`} />
            </Button>
          </div>

          {!isViewingLatest && latestVersion && (
            <Button
              size="sm" variant="ghost" className="gap-1 text-xs text-primary"
              onClick={() => handleViewVersion(latestVersion)}
            >
              <ArrowRight className="h-3 w-3" /> View Latest
            </Button>
          )}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" className="text-xs" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Full Content Renderer ─────────────────────────────────
function ArtifactFullContent({ type, data, renderedText }: { type: string; data: any; renderedText: string | null }) {
  const cleanData = data ? Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('_'))) : data;

  switch (type) {
    case 'email':
      return (
        <div className="space-y-4">
          <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Subject Line</p>
            <p className="text-sm font-medium text-foreground">{cleanData.subject_line}</p>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Body</p>
            <div className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap bg-background border border-border/50 rounded-lg p-4">
              {cleanData.body}
            </div>
          </div>
          {cleanData.cta && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">Call to Action</p>
              <p className="text-sm text-foreground/85">{cleanData.cta}</p>
            </div>
          )}
          {cleanData.tone && (
            <Badge variant="outline" className="text-[9px]">Tone: {cleanData.tone}</Badge>
          )}
        </div>
      );
    case 'account_plan':
      return (
        <div className="space-y-5">
          <SectionBlock label="Executive Summary" content={cleanData.executive_summary} highlight />
          <SectionBlock label="Account Overview" content={cleanData.account_overview} />
          <ListBlock label="Objectives" items={cleanData.objectives} numbered />
          <ListBlock label="Stakeholders" items={cleanData.stakeholders} />
          <ListBlock label="Action Plan" items={cleanData.action_plan} numbered />
          <SectionBlock label="Timeline" content={cleanData.timeline} />
          <ListBlock label="Risks" items={cleanData.risks} variant="risk" />
          <ListBlock label="Success Metrics" items={cleanData.success_metrics} variant="success" />
        </div>
      );
    case 'call_prep':
      return (
        <div className="space-y-5">
          <ListBlock label="Objectives" items={cleanData.objectives} numbered variant="primary" />
          <ListBlock label="Talking Points" items={cleanData.talking_points} numbered />
          <ListBlock label="Questions to Ask" items={cleanData.questions} />
          <ListBlock label="Anticipated Objections" items={cleanData.objections} variant="risk" />
          <ListBlock label="Risks" items={cleanData.risks} variant="risk" />
          <SectionBlock label="Desired Outcome" content={cleanData.desired_outcome} highlight />
        </div>
      );
    case 'memo':
      return (
        <div className="space-y-5">
          {cleanData.title && <h3 className="text-base font-semibold text-foreground">{cleanData.title}</h3>}
          <SectionBlock label="Summary" content={cleanData.summary} highlight />
          <ListBlock label="Key Points" items={cleanData.key_points} numbered />
          <ListBlock label="Recommendations" items={cleanData.recommendations} variant="primary" />
          <ListBlock label="Next Steps" items={cleanData.next_steps} variant="success" />
        </div>
      );
    case 'next_steps':
      return (
        <div className="space-y-4">
          <SectionBlock label="Context" content={cleanData.context_summary} />
          {cleanData.steps?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Actions</p>
              <div className="space-y-1.5">
                {cleanData.steps.map((step: any, i: number) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-lg border border-border/50 px-3 py-2">
                    <PriorityDot priority={step.priority} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground/85">{step.action}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {step.owner && <span className="text-[10px] text-muted-foreground">Owner: {step.owner}</span>}
                        {step.due && <span className="text-[10px] text-muted-foreground">Due: {step.due}</span>}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[8px] px-1.5 py-0 capitalize shrink-0 ${
                        step.priority === 'high' ? 'text-red-400 border-red-400/30'
                        : step.priority === 'medium' ? 'text-amber-400 border-amber-400/30'
                        : 'text-muted-foreground border-border'
                      }`}
                    >
                      {step.priority}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    default:
      return (
        <pre className="text-xs text-foreground/70 whitespace-pre-wrap font-mono bg-muted/20 rounded-lg p-4">
          {renderedText || JSON.stringify(cleanData, null, 2)}
        </pre>
      );
  }
}

function PriorityDot({ priority }: { priority?: string }) {
  const color = priority === 'high' ? 'bg-red-400' : priority === 'medium' ? 'bg-amber-400' : 'bg-muted-foreground/40';
  return <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${color}`} />;
}

function SectionBlock({ label, content, highlight }: { label: string; content?: string; highlight?: boolean }) {
  if (!content) return null;
  return (
    <div className={highlight ? 'bg-primary/5 border border-primary/15 rounded-lg p-3.5' : ''}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">{content}</p>
    </div>
  );
}

function ListBlock({ label, items, numbered, variant }: {
  label: string; items?: string[]; numbered?: boolean;
  variant?: 'risk' | 'success' | 'primary';
}) {
  if (!items?.length) return null;
  const borderColor = variant === 'risk' ? 'border-red-400/30'
    : variant === 'success' ? 'border-green-400/30'
    : variant === 'primary' ? 'border-primary/30'
    : 'border-border/50';
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{label}</p>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className={`flex items-start gap-2 text-sm text-foreground/80 pl-2.5 border-l-2 ${borderColor} leading-relaxed`}>
            {numbered && <span className="text-[10px] text-muted-foreground/50 font-mono mt-0.5 shrink-0">{i + 1}.</span>}
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Version History View ──────────────────────────────────
function VersionHistoryView({ versions, latestId, viewingId, onViewVersion }: {
  versions: StrategyArtifact[];
  latestId: string | null;
  viewingId: string;
  onViewVersion: (v: StrategyArtifact) => void;
}) {
  if (versions.length === 0) {
    return <p className="text-xs text-muted-foreground/50 italic">No version history available.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Version History ({versions.length} version{versions.length !== 1 ? 's' : ''})
      </p>
      {versions.map((v) => {
        const isViewing = v.id === viewingId;
        const isLatest = v.id === latestId;
        const vContent = v.content_json as any;
        const hasRefine = !!vContent?._refine_instructions;

        return (
          <button
            key={v.id}
            onClick={() => onViewVersion(v)}
            className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
              isViewing
                ? 'border-primary/40 bg-primary/5'
                : 'border-border/30 bg-muted/10 hover:bg-muted/30'
            }`}
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">v{v.version}</Badge>
              {isLatest && (
                <Badge className="text-[8px] px-1.5 py-0 bg-green-500/20 text-green-400 border-green-500/20">
                  <CheckCircle2 className="h-2 w-2 mr-0.5" /> Latest
                </Badge>
              )}
              {isViewing && (
                <Badge className="text-[8px] px-1.5 py-0 bg-primary/20 text-primary border-primary/20">
                  <Eye className="h-2 w-2 mr-0.5" /> Viewing
                </Badge>
              )}
              {hasRefine && (
                <Badge variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground/50">
                  <Pencil className="h-2 w-2 mr-0.5" /> Refined
                </Badge>
              )}
              <span className="text-[9px] text-muted-foreground/50 ml-auto">
                {new Date(v.created_at).toLocaleString()}
              </span>
            </div>
            <p className="text-[10px] text-foreground/60 mt-1 line-clamp-1 leading-relaxed">{v.title}</p>
          </button>
        );
      })}
    </div>
  );
}
