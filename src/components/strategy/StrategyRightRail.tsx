import { useState, useMemo, useCallback } from 'react';
import {
  ChevronRight, Link2, Lightbulb, HelpCircle, FileText,
  Pin, Copy, Save, Plus, RefreshCw, Loader2, Sparkles,
  Upload, BarChart3, Building2, Target,
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
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import type { StrategyThread, StrategyOutput } from '@/types/strategy';
import type { StrategyMemoryEntry } from '@/hooks/strategy/useStrategyMemory';
import type { StrategyUpload } from '@/hooks/strategy/useStrategyUploads';
import type { StrategyRollup, MemorySuggestion } from '@/lib/strategy/workflowSchemas';

interface Props {
  thread: StrategyThread;
  onCollapse: () => void;
  linkedContext?: any;
  memories: StrategyMemoryEntry[];
  uploads: StrategyUpload[];
  outputs: StrategyOutput[];
  onSaveMemory: (type: string, content: string) => void;
  rollup: StrategyRollup | null;
  memorySuggestions: MemorySuggestion[];
  isRollupLoading: boolean;
  onTriggerRollup: () => void;
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

function RailSection({ title, icon: Icon, children, empty, count, action }: {
  title: string; icon: React.ElementType; children?: React.ReactNode;
  empty?: string; count?: number; action?: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />
        <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">{title}</h3>
        {count !== undefined && count > 0 && (
          <Badge variant="secondary" className="text-[8px] px-1 py-0 h-4 font-normal">{count}</Badge>
        )}
        {action}
      </div>
      {children ?? (
        <p className="text-[10px] text-muted-foreground/40 italic pl-5">{empty || 'None yet'}</p>
      )}
    </div>
  );
}

export function StrategyRightRail({
  thread, onCollapse, linkedContext, memories, uploads, outputs,
  onSaveMemory, rollup, memorySuggestions, isRollupLoading, onTriggerRollup,
}: Props) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [memType, setMemType] = useState('fact');
  const [memContent, setMemContent] = useState('');
  const [savedSuggestions, setSavedSuggestions] = useState<Set<number>>(new Set());

  const pinnedMemories = useMemo(() => memories.filter(m => m.is_pinned), [memories]);
  const hypotheses = useMemo(() => memories.filter(m => m.memory_type === 'hypothesis'), [memories]);
  const decisions = useMemo(() => memories.filter(m => m.memory_type === 'priority' || m.memory_type === 'next_step').slice(0, 5), [memories]);
  const risks = useMemo(() => memories.filter(m => m.memory_type === 'risk').slice(0, 5), [memories]);

  const handleSave = () => {
    if (!memContent.trim()) return;
    onSaveMemory(memType, memContent.trim());
    setMemContent('');
    setSaveOpen(false);
    toast.success('Insight saved');
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
        {/* Linked Objects */}
        <RailSection title="Context" icon={Link2}>
          {linkedContext?.account ? (
            <Card className="bg-muted/20 border-border/30">
              <CardContent className="p-2.5 flex items-start gap-2">
                <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="h-3.5 w-3.5 text-primary/70" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{linkedContext.account.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {[linkedContext.account.industry, linkedContext.account.tier].filter(Boolean).join(' · ') || 'Account'}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : linkedContext?.opportunity ? (
            <Card className="bg-muted/20 border-border/30">
              <CardContent className="p-2.5 flex items-start gap-2">
                <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <Target className="h-3.5 w-3.5 text-primary/70" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{linkedContext.opportunity.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{linkedContext.opportunity.stage || 'Opportunity'}</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-[10px] text-muted-foreground/40 italic pl-5">Freeform thread — no linked object</p>
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
              <RollupList label="Risks" items={rollup.risks} />
              <RollupList label="Open Questions" items={rollup.open_questions} />
              <RollupList label="Next Steps" items={rollup.next_steps} />
            </div>
          ) : isRollupLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Generating rollup…</span>
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground/40 italic pl-5">
              Send messages or run a workflow to generate a rollup.
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

        {/* Pinned Insights */}
        <RailSection title="Pinned" icon={Pin} count={pinnedMemories.length} empty="Pin insights from conversations">
          {pinnedMemories.length > 0 && (
            <div className="space-y-1">
              {pinnedMemories.slice(0, 5).map(m => (
                <MemoryCard key={m.id} memory={m} />
              ))}
            </div>
          )}
        </RailSection>

        <Divider />

        {/* Hypotheses */}
        <RailSection title="Hypotheses" icon={Lightbulb} count={hypotheses.length} empty="No hypotheses recorded">
          {hypotheses.length > 0 && (
            <div className="space-y-1">
              {hypotheses.slice(0, 5).map(m => (
                <MemoryCard key={m.id} memory={m} />
              ))}
            </div>
          )}
        </RailSection>

        <Divider />

        {/* Decisions & Next Steps */}
        <RailSection title="Decisions & Next Steps" icon={FileText} count={decisions.length} empty="No decisions yet">
          {decisions.length > 0 && (
            <div className="space-y-1">
              {decisions.map(m => (
                <MemoryCard key={m.id} memory={m} />
              ))}
            </div>
          )}
        </RailSection>

        <Divider />

        {/* Risks */}
        <RailSection title="Risks & Questions" icon={HelpCircle} count={risks.length} empty="No risks identified">
          {risks.length > 0 && (
            <div className="space-y-1">
              {risks.map(m => (
                <MemoryCard key={m.id} memory={m} />
              ))}
            </div>
          )}
        </RailSection>

        <Divider />

        {/* Uploads */}
        <RailSection title="Uploads" icon={Upload} count={uploads.length} empty="Drag files into the composer">
          {uploads.length > 0 && (
            <div className="space-y-1">
              {uploads.slice(0, 8).map(u => (
                <div key={u.id} className="bg-muted/20 rounded-lg px-2.5 py-1.5 border border-border/20">
                  <div className="flex items-center gap-1.5">
                    <FileTypeIcon fileType={u.file_type} />
                    <span className="text-[11px] font-medium truncate flex-1">{u.file_name}</span>
                  </div>
                  {u.summary && <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1 pl-5">{u.summary}</p>}
                  {!u.summary && u.parsed_text && (
                    <Badge variant="secondary" className="text-[8px] px-1 py-0 mt-0.5 ml-5">Parsed</Badge>
                  )}
                  {!u.summary && !u.parsed_text && (
                    <Badge variant="outline" className="text-[8px] px-1 py-0 mt-0.5 ml-5 text-muted-foreground/50">Binary</Badge>
                  )}
                </div>
              ))}
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
                </div>
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
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border/50 mx-3" />;
}

function MemoryCard({ memory }: { memory: StrategyMemoryEntry }) {
  return (
    <div className="bg-muted/20 rounded-lg px-2.5 py-1.5 border border-border/20">
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className={`text-[8px] px-1 py-0 border shrink-0 ${MEMORY_TYPE_COLORS[memory.memory_type] || ''}`}>
          {memory.memory_type.replace(/_/g, ' ')}
        </Badge>
        {memory.is_pinned && <Pin className="h-2 w-2 text-amber-400 shrink-0" />}
      </div>
      <p className="text-[10px] text-foreground/70 mt-0.5 line-clamp-2 leading-relaxed">{memory.content}</p>
    </div>
  );
}

function FileTypeIcon({ fileType }: { fileType: string | null }) {
  const ext = fileType?.split('/')[1] || '';
  const label = ext === 'pdf' ? '📄' : ext === 'csv' ? '📊' : fileType?.startsWith('text/') ? '📝' : '📎';
  return <span className="text-[11px]">{label}</span>;
}

function RollupList({ label, items }: { label: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-0.5">{label}</p>
      <ul className="space-y-0.5">
        {items.slice(0, 5).map((item, i) => (
          <li key={i} className="text-[10px] text-foreground/65 pl-2 border-l-2 border-primary/15 leading-relaxed">{item}</li>
        ))}
      </ul>
    </div>
  );
}
