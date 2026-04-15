import { useState, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Copy, RefreshCw, Loader2, Mail, FileText, Target, ArrowRight,
  History, Pencil, CheckCircle2, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import type { StrategyArtifact } from '@/hooks/strategy/useStrategyArtifacts';

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

export function ArtifactDetailModal({
  artifact, allArtifacts, open, onOpenChange, onRegenerate, isTransforming,
}: Props) {
  const [view, setView] = useState<'detail' | 'history' | 'refine'>('detail');
  const [refineInstructions, setRefineInstructions] = useState('');
  const [viewingArtifact, setViewingArtifact] = useState<StrategyArtifact | null>(null);

  // The artifact currently being displayed (either selected or a version from history)
  const displayArtifact = viewingArtifact || artifact;

  // Reset viewing artifact when modal artifact changes
  const resetOnChange = artifact?.id;

  // Build version chain
  const versionChain = useMemo(() => {
    if (!artifact) return [];
    const rootId = artifact.parent_artifact_id || artifact.id;
    return allArtifacts
      .filter(a => a.id === rootId || a.parent_artifact_id === rootId || a.id === artifact.id || a.parent_artifact_id === artifact.id)
      .sort((a, b) => a.version - b.version);
  }, [artifact, allArtifacts]);

  if (!artifact || !displayArtifact) return null;

  const TypeIcon = TYPE_ICONS[displayArtifact.artifact_type] || FileText;
  const typeLabel = displayArtifact.artifact_type.replace(/_/g, ' ');
  const structured = displayArtifact.content_json as any;

  const copyContent = () => {
    navigator.clipboard.writeText(displayArtifact.rendered_text || JSON.stringify(displayArtifact.content_json, null, 2));
    toast.success('Copied to clipboard');
  };

  const handleRegenerate = async () => {
    if (!onRegenerate) return;
    const result = await onRegenerate(artifact.id, artifact.artifact_type);
    if (result) {
      toast.success('New version created');
    }
  };

  const handleRefine = async () => {
    if (!onRegenerate || !refineInstructions.trim()) return;
    const result = await onRegenerate(artifact.id, artifact.artifact_type, refineInstructions.trim());
    if (result) {
      setRefineInstructions('');
      setView('detail');
      setViewingArtifact(null);
    }
  };

  const handleViewVersion = (v: StrategyArtifact) => {
    setViewingArtifact(v);
    setView('detail');
  };

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
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 capitalize">{typeLabel}</Badge>
                <Badge variant="outline" className="text-[9px] px-1.5 py-0">v{displayArtifact.version}</Badge>
                <span className="text-[9px] text-muted-foreground">
                  {new Date(displayArtifact.created_at).toLocaleDateString()}
                </span>
                {viewingArtifact && viewingArtifact.id !== artifact.id && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0 text-amber-400 border-amber-400/30">Viewing older version</Badge>
                )}
              </div>
            </div>
          </div>
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
                currentId={artifact.id}
                viewingId={viewingArtifact?.id}
                onViewVersion={handleViewVersion}
              />
            )}
            {view === 'refine' && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Describe how you'd like to refine this artifact. A new version will be generated.
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
  switch (type) {
    case 'email':
      return (
        <div className="space-y-4">
          <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Subject Line</p>
            <p className="text-sm font-medium text-foreground">{data.subject_line}</p>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Body</p>
            <div className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap bg-background border border-border/50 rounded-lg p-4">
              {data.body}
            </div>
          </div>
          {data.cta && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">Call to Action</p>
              <p className="text-sm text-foreground/85">{data.cta}</p>
            </div>
          )}
          {data.tone && (
            <Badge variant="outline" className="text-[9px]">Tone: {data.tone}</Badge>
          )}
        </div>
      );
    case 'account_plan':
      return (
        <div className="space-y-5">
          <SectionBlock label="Executive Summary" content={data.executive_summary} highlight />
          <SectionBlock label="Account Overview" content={data.account_overview} />
          <ListBlock label="Objectives" items={data.objectives} numbered />
          <ListBlock label="Stakeholders" items={data.stakeholders} />
          <ListBlock label="Action Plan" items={data.action_plan} numbered />
          <SectionBlock label="Timeline" content={data.timeline} />
          <ListBlock label="Risks" items={data.risks} variant="risk" />
          <ListBlock label="Success Metrics" items={data.success_metrics} variant="success" />
        </div>
      );
    case 'call_prep':
      return (
        <div className="space-y-5">
          <ListBlock label="Objectives" items={data.objectives} numbered variant="primary" />
          <ListBlock label="Talking Points" items={data.talking_points} numbered />
          <ListBlock label="Questions to Ask" items={data.questions} />
          <ListBlock label="Anticipated Objections" items={data.objections} variant="risk" />
          <ListBlock label="Risks" items={data.risks} variant="risk" />
          <SectionBlock label="Desired Outcome" content={data.desired_outcome} highlight />
        </div>
      );
    case 'memo':
      return (
        <div className="space-y-5">
          {data.title && <h3 className="text-base font-semibold text-foreground">{data.title}</h3>}
          <SectionBlock label="Summary" content={data.summary} highlight />
          <ListBlock label="Key Points" items={data.key_points} numbered />
          <ListBlock label="Recommendations" items={data.recommendations} variant="primary" />
          <ListBlock label="Next Steps" items={data.next_steps} variant="success" />
        </div>
      );
    case 'next_steps':
      return (
        <div className="space-y-4">
          <SectionBlock label="Context" content={data.context_summary} />
          {data.steps?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Actions</p>
              <div className="space-y-1.5">
                {data.steps.map((step: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 rounded-lg border border-border/50 px-3 py-2"
                  >
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
          {renderedText || JSON.stringify(data, null, 2)}
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
          <div key={i} className={`flex items-start gap-2 pl-2.5 border-l-2 ${borderColor} py-0.5`}>
            {numbered && <span className="text-[10px] font-mono text-muted-foreground/50 mt-0.5 shrink-0">{i + 1}.</span>}
            <p className="text-sm text-foreground/80 leading-relaxed">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Version History ───────────────────────────────────────
function VersionHistoryView({ versions, currentId, viewingId, onViewVersion }: {
  versions: StrategyArtifact[]; currentId: string; viewingId?: string;
  onViewVersion: (v: StrategyArtifact) => void;
}) {
  if (versions.length === 0) {
    return <p className="text-xs text-muted-foreground py-8 text-center">No version history yet</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{versions.length} version{versions.length !== 1 ? 's' : ''} — click to view</p>
      {versions.map((v) => {
        const isCurrent = v.id === currentId;
        const isViewing = v.id === (viewingId || currentId);
        return (
          <button
            key={v.id}
            className={`w-full text-left group flex items-start gap-3 p-3 rounded-lg border transition-colors ${
              isViewing ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-card/50 hover:bg-card cursor-pointer'
            }`}
            onClick={() => onViewVersion(v)}
          >
            <div className="flex flex-col items-center gap-1 pt-0.5">
              <Badge variant={isViewing ? 'default' : 'outline'} className="text-[10px] w-8 justify-center">
                v{v.version}
              </Badge>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-foreground truncate">{v.title}</p>
                {isCurrent && (
                  <Badge variant="secondary" className="text-[8px] px-1 py-0 gap-0.5 shrink-0">
                    <CheckCircle2 className="h-2 w-2" /> Latest
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />
                {new Date(v.created_at).toLocaleString()}
              </div>
              {v.rendered_text && (
                <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-3 whitespace-pre-wrap leading-relaxed">
                  {v.rendered_text.slice(0, 250)}
                </p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
