import { useState, useMemo, useCallback } from 'react';
import {
  ChevronRight, Link2, Lightbulb, HelpCircle, FileText,
  Pin, Copy, Save, Plus, RefreshCw, Loader2, Sparkles,
  Upload, BarChart3, Building2, Target, Globe, Cpu, Tag,
  AlertTriangle, CheckCircle2, Clock, Eye, Mail, ArrowRight,
  Trash2, X, PinOff, ThumbsDown, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import type { StrategyThread, StrategyOutput } from '@/types/strategy';
import type { StrategyArtifact } from '@/hooks/strategy/useStrategyArtifacts';
import type { StrategyMemoryEntry } from '@/hooks/strategy/useStrategyMemory';
import type { StrategyUpload } from '@/hooks/strategy/useStrategyUploads';
import { getParseStatus } from '@/hooks/strategy/useStrategyUploads';
import type { StrategyRollup, MemorySuggestion } from '@/lib/strategy/workflowSchemas';
import { ArtifactDetailModal } from './ArtifactDetailModal';
import { ProposalReviewPanel } from './ProposalReviewPanel';
import type { StrategyProposal, ProposalScope } from '@/hooks/strategy/useStrategyProposals';

interface Props {
  thread: StrategyThread;
  onCollapse: () => void;
  linkedContext?: any;
  memories: StrategyMemoryEntry[];
  uploads: StrategyUpload[];
  outputs: StrategyOutput[];
  artifacts: StrategyArtifact[];
  onSaveMemory: (type: string, content: string) => void;
  onDeleteMemory?: (memoryId: string) => void;
  onTogglePin?: (memoryId: string) => void;
  onSetConfidence?: (memoryId: string, confidence: number) => void;
  onMarkIrrelevant?: (memoryId: string) => void;
  rollup: StrategyRollup | null;
  memorySuggestions: MemorySuggestion[];
  isRollupLoading: boolean;
  onTriggerRollup: () => void;
  onRegenerateArtifact?: (artifactId: string, artifactType: string, refineInstructions?: string) => Promise<StrategyArtifact | null>;
  isTransforming?: boolean;
  onReprocessUpload?: (uploadId: string) => void;
  onUseArtifactAsInput?: (artifact: StrategyArtifact) => void;
  onDuplicateArtifact?: (artifact: StrategyArtifact) => void;
  // Phase 3 — proposal review
  proposals?: StrategyProposal[];
  proposalsLoading?: boolean;
  onConfirmProposal?: (id: string, overrides?: { target_account_id?: string | null; target_opportunity_id?: string | null; target_scope?: ProposalScope; payload_json?: Record<string, unknown> }) => Promise<boolean>;
  onRejectProposal?: (id: string, reason?: string) => Promise<boolean>;
  onEditProposalPayload?: (id: string, payload: Record<string, unknown>) => Promise<boolean>;
}

const MEMORY_TYPES = [
  { value: 'fact', label: 'Fact' },
  { value: 'hypothesis', label: 'Hypothesis' },
  { value: 'risk', label: 'Risk' },
  { value: 'priority', label: 'Priority' },
  { value: 'stakeholder_note', label: 'Stakeholder Note' },
  { value: 'messaging_note', label: 'Messaging Note' },
  { value: 'next_step', label: 'Next Step' },
];

const MEMORY_TYPE_COLORS: Record<string, string> = {
  fact: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
  hypothesis: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  risk: 'bg-red-500/15 text-red-300 border-red-500/20',
  priority: 'bg-green-500/15 text-green-300 border-green-500/20',
  stakeholder_note: 'bg-purple-500/15 text-purple-300 border-purple-500/20',
  messaging_note: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/20',
  next_step: 'bg-orange-500/15 text-orange-300 border-orange-500/20',
};

const PARSE_STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle2; color: string }> = {
  summarized: { label: 'Analyzed', icon: CheckCircle2, color: 'text-green-400' },
  parsed: { label: 'Parsed', icon: Eye, color: 'text-blue-400' },
  partial: { label: 'Partial', icon: Clock, color: 'text-amber-400' },
  unsupported: { label: 'Binary', icon: AlertTriangle, color: 'text-muted-foreground/50' },
  pending: { label: 'Pending', icon: Clock, color: 'text-muted-foreground' },
};

const CONFIDENCE_LEVELS = [
  { value: 0.9, label: 'High', color: 'text-green-400' },
  { value: 0.6, label: 'Medium', color: 'text-amber-400' },
  { value: 0.3, label: 'Low', color: 'text-red-400' },
];

function RailSection({ title, icon: Icon, children, empty, count, action }: {
  title: string; icon: React.ElementType; children?: React.ReactNode;
  empty?: string; count?: number; action?: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider flex-1">{title}</h3>
        {count !== undefined && count > 0 && (
          <Badge variant="secondary" className="text-[8px] px-1 py-0 h-4 font-normal">{count}</Badge>
        )}
        {action}
      </div>
      {children ?? (
        <p className="text-[10px] text-foreground/50 italic pl-5">{empty || 'None yet'}</p>
      )}
    </div>
  );
}

export function StrategyRightRail({
  thread, onCollapse, linkedContext, memories, uploads, outputs, artifacts,
  onSaveMemory, onDeleteMemory, onTogglePin, onSetConfidence, onMarkIrrelevant,
  rollup, memorySuggestions, isRollupLoading, onTriggerRollup,
  onRegenerateArtifact, isTransforming, onReprocessUpload,
  onUseArtifactAsInput, onDuplicateArtifact,
}: Props) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [memType, setMemType] = useState('fact');
  const [memContent, setMemContent] = useState('');
  const [savedSuggestions, setSavedSuggestions] = useState<Set<number>>(new Set());
  const [selectedArtifact, setSelectedArtifact] = useState<StrategyArtifact | null>(null);
  const [expandedUploadId, setExpandedUploadId] = useState<string | null>(null);

  const pinnedMemories = useMemo(() => memories.filter(m => m.is_pinned), [memories]);
  const risks = useMemo(() => memories.filter(m => m.memory_type === 'risk').slice(0, 5), [memories]);
  const nextSteps = useMemo(() => memories.filter(m => m.memory_type === 'next_step' || m.memory_type === 'priority').slice(0, 5), [memories]);

  const handleSave = () => {
    if (!memContent.trim()) return;
    onSaveMemory(memType, memContent.trim());
    setMemContent('');
    setSaveOpen(false);
  };

  const handleSuggestionSave = useCallback((suggestion: MemorySuggestion, index: number) => {
    onSaveMemory(suggestion.memory_type, suggestion.content);
    setSavedSuggestions(prev => new Set(prev).add(index));
    toast.success('Saved to memory');
  }, [onSaveMemory]);

  const copyThread = () => {
    const text = rollup?.summary || thread.summary || thread.title;
    navigator.clipboard.writeText(text);
    toast.success('Copied');
  };

  const handleRegenerate = useCallback(async (artifactId: string, artifactType: string, refineInstructions?: string) => {
    if (!onRegenerateArtifact) return null;
    const result = await onRegenerateArtifact(artifactId, artifactType, refineInstructions);
    if (result) {
      setSelectedArtifact(result);
    }
    return result;
  }, [onRegenerateArtifact]);

  return (
    <div className="w-64 border-l border-border flex flex-col bg-card shrink-0">
      <div className="p-3 border-b border-border flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-primary/60" />
        <h2 className="text-xs font-semibold text-foreground flex-1">Working Memory</h2>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCollapse}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {/* Linked Object */}
        <RailSection title="Context" icon={Link2}>
          {linkedContext?.account ? (
            <Card className="bg-muted/20 border-border/30">
              <CardContent className="p-2.5 space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="h-3.5 w-3.5 text-primary/70" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{linkedContext.account.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {[linkedContext.account.industry, linkedContext.account.tier].filter(Boolean).join(' · ') || 'Account'}
                    </p>
                  </div>
                </div>
                <div className="space-y-0.5 pl-0.5">
                  {linkedContext.account.website && (
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                      <Globe className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{linkedContext.account.website}</span>
                    </div>
                  )}
                  {linkedContext.account.tech_stack?.length > 0 && (
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                      <Cpu className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{linkedContext.account.tech_stack.slice(0, 3).join(', ')}</span>
                    </div>
                  )}
                  {linkedContext.account.outreach_status && (
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                      <Tag className="h-2.5 w-2.5 shrink-0" />
                      <span>{linkedContext.account.outreach_status}</span>
                    </div>
                  )}
                  {linkedContext.account.notes && (
                    <p className="text-[9px] text-muted-foreground/60 line-clamp-2 mt-1">{linkedContext.account.notes}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : linkedContext?.opportunity ? (
            <Card className="bg-muted/20 border-border/30">
              <CardContent className="p-2.5 space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Target className="h-3.5 w-3.5 text-primary/70" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{linkedContext.opportunity.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {[linkedContext.opportunity.stage, linkedContext.opportunity.close_date].filter(Boolean).join(' · ') || 'Opportunity'}
                    </p>
                  </div>
                </div>
                {linkedContext.opportunity.notes && (
                  <p className="text-[9px] text-muted-foreground/60 line-clamp-2">{linkedContext.opportunity.notes}</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <p className="text-[10px] text-foreground/55 italic pl-5">Freeform thread — no linked object</p>
          )}
        </RailSection>

        <Divider />

        {/* Thread Rollup */}
        <RailSection
          title="Thread Rollup"
          icon={BarChart3}
          action={
            <Button
              size="icon" variant="ghost" className="h-5 w-5"
              onClick={onTriggerRollup} disabled={isRollupLoading}
              title="Regenerate rollup"
            >
              {isRollupLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          }
        >
          {rollup ? (
            <div className="space-y-2">
              <p className="text-[11px] text-foreground/80 leading-relaxed">{rollup.summary}</p>
              <RollupList label="Key Facts" items={rollup.key_facts} />
              <RollupList label="Hypotheses" items={rollup.hypotheses} />
              <RollupList label="Risks" items={rollup.risks} icon={AlertTriangle} color="text-red-400/70" />
              <RollupList label="Open Questions" items={rollup.open_questions} />
              <RollupList label="Next Steps" items={rollup.next_steps} icon={CheckCircle2} color="text-green-400/70" />
            </div>
          ) : isRollupLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Generating rollup…</span>
            </div>
          ) : (
            <p className="text-[10px] text-foreground/55 italic pl-5">
              Send messages or run a workflow to generate.
            </p>
          )}
        </RailSection>

        <Divider />

        {/* Memory Suggestions */}
        {memorySuggestions.length > 0 && (
          <>
            <RailSection title="Suggested Saves" icon={Sparkles} count={memorySuggestions.filter((_, i) => !savedSuggestions.has(i)).length}>
              <div className="space-y-1.5">
                {memorySuggestions.map((s, i) => {
                  const isSaved = savedSuggestions.has(i);
                  return (
                    <div key={i} className={`rounded-lg px-2.5 py-2 transition-all ${isSaved ? 'bg-green-500/5 border border-green-500/15' : 'bg-primary/5 border border-primary/10'}`}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Badge variant="outline" className={`text-[8px] px-1 py-0 border ${MEMORY_TYPE_COLORS[s.memory_type] || ''}`}>
                          {s.memory_type.replace(/_/g, ' ')}
                        </Badge>
                        <span className="text-[9px] text-muted-foreground/60">
                          {Math.round((s.confidence ?? 0.5) * 100)}%
                        </span>
                      </div>
                      <p className="text-[10px] text-foreground/75 line-clamp-2 leading-relaxed">{s.content}</p>
                      {!isSaved ? (
                        <Button
                          size="sm" variant="ghost"
                          className="h-5 text-[9px] px-1.5 mt-1 gap-0.5 text-primary hover:text-primary"
                          onClick={() => handleSuggestionSave(s, i)}
                        >
                          <Save className="h-2 w-2" /> Save
                        </Button>
                      ) : (
                        <span className="text-[9px] text-green-400 mt-1 inline-block">✓ Saved</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </RailSection>
            <Divider />
          </>
        )}

        {/* Risks */}
        {risks.length > 0 && (
          <>
            <RailSection title="Active Risks" icon={AlertTriangle} count={risks.length}>
              <div className="space-y-1">
                {risks.map(m => (
                  <MemoryCard key={m.id} memory={m} onDelete={onDeleteMemory} onTogglePin={onTogglePin} onSetConfidence={onSetConfidence} onMarkIrrelevant={onMarkIrrelevant} />
                ))}
              </div>
            </RailSection>
            <Divider />
          </>
        )}

        {/* Next Steps */}
        {nextSteps.length > 0 && (
          <>
            <RailSection title="Next Steps" icon={CheckCircle2} count={nextSteps.length}>
              <div className="space-y-1">
                {nextSteps.map(m => (
                  <MemoryCard key={m.id} memory={m} onDelete={onDeleteMemory} onTogglePin={onTogglePin} onSetConfidence={onSetConfidence} onMarkIrrelevant={onMarkIrrelevant} />
                ))}
              </div>
            </RailSection>
            <Divider />
          </>
        )}

        {/* Pinned Insights */}
        <RailSection title="Pinned" icon={Pin} count={pinnedMemories.length} empty="Pin insights from conversations">
          {pinnedMemories.length > 0 && (
            <div className="space-y-1">
              {pinnedMemories.slice(0, 5).map(m => (
                <MemoryCard key={m.id} memory={m} onDelete={onDeleteMemory} onTogglePin={onTogglePin} onSetConfidence={onSetConfidence} onMarkIrrelevant={onMarkIrrelevant} />
              ))}
            </div>
          )}
        </RailSection>

        <Divider />

        {/* Uploads */}
        <RailSection title="Uploads" icon={Upload} count={uploads.length} empty="Drag files into the composer">
          {uploads.length > 0 && (
            <div className="space-y-1.5">
              {uploads.slice(0, 8).map(u => {
                const status = getParseStatus(u);
                const statusConfig = PARSE_STATUS_CONFIG[status];
                const StatusIcon = statusConfig.icon;
                const meta = u.metadata_json as any;
                const isExpanded = expandedUploadId === u.id;
                return (
                  <div key={u.id} className="bg-muted/20 rounded-lg border border-border/20 overflow-hidden">
                    <div className="px-2.5 py-2">
                      <div className="flex items-center gap-1.5">
                        <FileTypeIcon fileType={u.file_type} fileName={u.file_name} />
                        <span className="text-[11px] font-medium truncate flex-1">{u.file_name}</span>
                        <div className={`flex items-center gap-0.5 ${statusConfig.color}`}>
                          <StatusIcon className="h-2.5 w-2.5" />
                          <span className="text-[8px]">{statusConfig.label}</span>
                        </div>
                      </div>
                      {u.summary && (
                        <p className="text-[9px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{u.summary}</p>
                      )}
                      {meta?.entities?.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-1">
                          {meta.entities.slice(0, 4).map((e: any, i: number) => (
                            <Badge key={i} variant="outline" className="text-[7px] px-1 py-0 font-normal">
                              {e.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1 mt-1.5">
                        {u.parsed_text && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-5 text-[9px] px-1.5 gap-0.5 text-muted-foreground hover:text-foreground"
                            onClick={() => setExpandedUploadId(isExpanded ? null : u.id)}
                          >
                            <Eye className="h-2 w-2" /> {isExpanded ? 'Hide' : 'View text'}
                          </Button>
                        )}
                        {onReprocessUpload && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-5 text-[9px] px-1.5 gap-0.5 text-muted-foreground hover:text-foreground"
                            onClick={() => onReprocessUpload(u.id)}
                          >
                            <RefreshCw className="h-2 w-2" /> Reprocess
                          </Button>
                        )}
                      </div>
                    </div>
                    {isExpanded && u.parsed_text && (
                      <div className="border-t border-border/20 px-2.5 py-2 bg-muted/10">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Extracted Text</span>
                          <Button
                            size="icon" variant="ghost" className="h-4 w-4"
                            onClick={() => setExpandedUploadId(null)}
                          >
                            <X className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                        <pre className="text-[9px] text-foreground/60 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto leading-relaxed">
                          {u.parsed_text.slice(0, 3000)}
                          {u.parsed_text.length > 3000 && (
                            <span className="text-muted-foreground/40 block mt-1">
                              … truncated ({u.parsed_text.length.toLocaleString()} chars total)
                            </span>
                          )}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </RailSection>

        <Divider />

        {/* Outputs */}
        <RailSection title="Outputs" icon={FileText} count={outputs.length} empty="Run a workflow to create outputs">
          {outputs.length > 0 && (
            <div className="space-y-1">
              {outputs.slice(0, 5).map(o => (
                <div key={o.id} className="bg-muted/20 rounded-lg px-2.5 py-1.5 border border-border/20">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[8px] px-1 py-0 shrink-0">{(o.output_type || '').replace(/_/g, ' ')}</Badge>
                    <span className="text-[11px] truncate">{o.title}</span>
                  </div>
                  {o.rendered_text && (
                    <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1">{o.rendered_text.slice(0, 80)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </RailSection>

        <Divider />

        {/* Artifacts */}
        <RailSection title="Artifacts" icon={Sparkles} count={artifacts.length} empty="Transform outputs into reusable assets">
          {artifacts.length > 0 && (
            <div className="space-y-1.5">
              {artifacts.slice(0, 8).map(a => (
                <ArtifactRailCard
                  key={a.id}
                  artifact={a}
                  onClick={() => setSelectedArtifact(a)}
                />
              ))}
            </div>
          )}
        </RailSection>

        {/* Actions */}
        <div className="border-t border-border px-3 py-3 space-y-1.5">
          <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5">
                <Plus className="h-3 w-3" /> Save Insight
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle className="text-sm">Save Insight</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Select value={memType} onValueChange={setMemType}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MEMORY_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  value={memContent}
                  onChange={e => setMemContent(e.target.value)}
                  placeholder="Write insight…"
                  className="min-h-[60px] text-xs"
                />
                <Button size="sm" className="w-full" onClick={handleSave} disabled={!memContent.trim()}>
                  Save
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5 text-muted-foreground" onClick={copyThread}>
            <Copy className="h-3 w-3" /> Copy Summary
          </Button>
        </div>
      </ScrollArea>

      {/* Artifact Detail Modal */}
      <ArtifactDetailModal
        artifact={selectedArtifact}
        allArtifacts={artifacts}
        open={!!selectedArtifact}
        onOpenChange={(open) => { if (!open) setSelectedArtifact(null); }}
        onRegenerate={handleRegenerate}
        isTransforming={isTransforming}
      />
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border/50 mx-3" />;
}

function MemoryCard({ memory, onDelete, onTogglePin, onSetConfidence, onMarkIrrelevant }: {
  memory: StrategyMemoryEntry;
  onDelete?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onSetConfidence?: (id: string, c: number) => void;
  onMarkIrrelevant?: (id: string) => void;
}) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      className="bg-muted/20 rounded-lg px-2.5 py-1.5 border border-border/20 group relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className={`text-[8px] px-1 py-0 border shrink-0 ${MEMORY_TYPE_COLORS[memory.memory_type] || ''}`}>
          {memory.memory_type.replace(/_/g, ' ')}
        </Badge>
        {memory.is_pinned && <Pin className="h-2 w-2 text-amber-400 shrink-0" />}
        {memory.confidence != null && (
          <span className={`text-[8px] ml-auto shrink-0 ${
            memory.confidence >= 0.7 ? 'text-green-400/70' : memory.confidence >= 0.4 ? 'text-amber-400/70' : 'text-red-400/70'
          }`}>
            {memory.confidence >= 0.7 ? 'High' : memory.confidence >= 0.4 ? 'Med' : 'Low'}
          </span>
        )}
        {showActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-4 w-4 ml-auto shrink-0 text-muted-foreground/40 hover:text-foreground">
                <ChevronDown className="h-2.5 w-2.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {onTogglePin && (
                <DropdownMenuItem onClick={() => onTogglePin(memory.id)} className="text-[11px] gap-1.5">
                  {memory.is_pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                  {memory.is_pinned ? 'Unpin' : 'Pin'}
                </DropdownMenuItem>
              )}
              {onSetConfidence && (
                <>
                  {CONFIDENCE_LEVELS.map(c => (
                    <DropdownMenuItem key={c.value} onClick={() => onSetConfidence(memory.id, c.value)} className={`text-[11px] gap-1.5 ${c.color}`}>
                      Set {c.label}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {onMarkIrrelevant && (
                <DropdownMenuItem onClick={() => onMarkIrrelevant(memory.id)} className="text-[11px] gap-1.5 text-amber-400">
                  <ThumbsDown className="h-3 w-3" /> Mark irrelevant
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem onClick={() => onDelete(memory.id)} className="text-[11px] gap-1.5 text-red-400">
                  <Trash2 className="h-3 w-3" /> Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p className="text-[10px] text-foreground/70 mt-0.5 line-clamp-2 leading-relaxed">{memory.content}</p>
    </div>
  );
}

function FileTypeIcon({ fileType, fileName }: { fileType: string | null; fileName: string }) {
  const ext = fileName?.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return <span className="text-[11px]">📄</span>;
  if (['docx', 'doc'].includes(ext)) return <span className="text-[11px]">📝</span>;
  if (['pptx', 'ppt'].includes(ext)) return <span className="text-[11px]">📊</span>;
  if (['xlsx', 'xls', 'csv'].includes(ext)) return <span className="text-[11px]">📈</span>;
  if (fileType?.startsWith('text/') || ['md', 'txt', 'json'].includes(ext)) return <span className="text-[11px]">📝</span>;
  return <span className="text-[11px]">📎</span>;
}

function RollupList({ label, items, icon, color }: { label: string; items?: string[]; icon?: React.ElementType; color?: string }) {
  if (!items?.length) return null;
  const Icon = icon;
  return (
    <div>
      <p className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-0.5">{label}</p>
      <ul className="space-y-0.5">
        {items.slice(0, 5).map((item, i) => (
          <li key={i} className="text-[10px] text-foreground/65 pl-2 border-l-2 border-primary/15 leading-relaxed flex items-start gap-1">
            {Icon && <Icon className={`h-2.5 w-2.5 mt-0.5 shrink-0 ${color || ''}`} />}
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ARTIFACT_TYPE_ICONS: Record<string, typeof FileText> = {
  email: Mail,
  account_plan: FileText,
  call_prep: Target,
  memo: FileText,
  next_steps: ArrowRight,
};

function ArtifactRailCard({ artifact, onClick }: {
  artifact: StrategyArtifact;
  onClick: () => void;
}) {
  const TypeIcon = ARTIFACT_TYPE_ICONS[artifact.artifact_type] || FileText;
  const typeLabel = artifact.artifact_type.replace(/_/g, ' ');

  return (
    <button
      className="w-full bg-muted/20 rounded-lg border border-border/20 overflow-hidden px-2.5 py-2 flex items-center gap-1.5 text-left hover:bg-muted/40 transition-colors"
      onClick={onClick}
    >
      <TypeIcon className="h-3 w-3 text-primary/70 shrink-0" />
      <span className="text-[11px] font-medium truncate flex-1">{artifact.title}</span>
      <Badge variant="outline" className="text-[8px] px-1 py-0 capitalize shrink-0">{typeLabel}</Badge>
      {artifact.version > 1 && (
        <Badge variant="secondary" className="text-[7px] px-1 py-0">v{artifact.version}</Badge>
      )}
    </button>
  );
}
