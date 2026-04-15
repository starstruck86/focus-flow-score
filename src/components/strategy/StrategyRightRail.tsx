import { useState, useMemo } from 'react';
import {
  ChevronRight, Link2, Lightbulb, HelpCircle, FileText,
  Pin, Copy, Save, Loader2, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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

interface Props {
  thread: StrategyThread;
  onCollapse: () => void;
  linkedContext?: any;
  memories: StrategyMemoryEntry[];
  uploads: StrategyUpload[];
  outputs: StrategyOutput[];
  onSaveMemory: (type: string, content: string) => void;
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
  fact: 'bg-blue-500/20 text-blue-300',
  hypothesis: 'bg-amber-500/20 text-amber-300',
  risk: 'bg-red-500/20 text-red-300',
  priority: 'bg-green-500/20 text-green-300',
  stakeholder_note: 'bg-purple-500/20 text-purple-300',
  messaging_note: 'bg-cyan-500/20 text-cyan-300',
  next_step: 'bg-orange-500/20 text-orange-300',
};

function RailSection({ title, icon: Icon, children, empty, count }: {
  title: string; icon: React.ElementType; children?: React.ReactNode; empty?: string; count?: number;
}) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex-1">{title}</h3>
        {count !== undefined && count > 0 && (
          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{count}</Badge>
        )}
      </div>
      {children ?? <p className="text-[10px] text-muted-foreground/60 italic">{empty || 'None yet'}</p>}
    </div>
  );
}

export function StrategyRightRail({ thread, onCollapse, linkedContext, memories, uploads, outputs, onSaveMemory }: Props) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [memType, setMemType] = useState('fact');
  const [memContent, setMemContent] = useState('');

  const pinnedMemories = useMemo(() => memories.filter(m => m.is_pinned), [memories]);
  const hypotheses = useMemo(() => memories.filter(m => m.memory_type === 'hypothesis'), [memories]);
  const recentDecisions = useMemo(() => memories.filter(m => m.memory_type === 'priority' || m.memory_type === 'next_step').slice(0, 5), [memories]);
  const openQuestions = useMemo(() => memories.filter(m => m.memory_type === 'risk').slice(0, 5), [memories]);

  const handleSave = () => {
    if (!memContent.trim()) return;
    onSaveMemory(memType, memContent.trim());
    setMemContent('');
    setSaveOpen(false);
  };

  const copyThread = () => {
    const text = thread.summary || thread.title;
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

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
          {linkedContext?.account ? (
            <Card className="bg-muted/30"><CardContent className="p-2">
              <p className="text-xs font-medium">{linkedContext.account.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {[linkedContext.account.industry, linkedContext.account.tier].filter(Boolean).join(' · ') || 'Account'}
              </p>
            </CardContent></Card>
          ) : linkedContext?.opportunity ? (
            <Card className="bg-muted/30"><CardContent className="p-2">
              <p className="text-xs font-medium">{linkedContext.opportunity.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {linkedContext.opportunity.stage || 'Opportunity'}
              </p>
            </CardContent></Card>
          ) : (
            <p className="text-[10px] text-muted-foreground/60 italic">No linked objects</p>
          )}
        </RailSection>

        <div className="border-t border-border" />

        {/* Pinned Insights */}
        <RailSection title="Pinned Insights" icon={Pin} count={pinnedMemories.length} empty="Pin insights from conversations">
          {pinnedMemories.length > 0 && (
            <div className="space-y-1">
              {pinnedMemories.slice(0, 5).map(m => (
                <div key={m.id} className="text-[11px] bg-muted/30 rounded px-2 py-1">
                  <Badge variant="outline" className={`text-[8px] px-1 py-0 mr-1 ${MEMORY_TYPE_COLORS[m.memory_type] || ''}`}>
                    {m.memory_type}
                  </Badge>
                  <span className="text-foreground/80">{m.content.slice(0, 100)}</span>
                </div>
              ))}
            </div>
          )}
        </RailSection>

        <div className="border-t border-border" />

        {/* Hypotheses */}
        <RailSection title="Hypotheses" icon={Lightbulb} count={hypotheses.length} empty="No hypotheses recorded">
          {hypotheses.length > 0 && (
            <div className="space-y-1">
              {hypotheses.slice(0, 5).map(m => (
                <p key={m.id} className="text-[11px] text-foreground/80 bg-muted/30 rounded px-2 py-1">{m.content.slice(0, 100)}</p>
              ))}
            </div>
          )}
        </RailSection>

        <div className="border-t border-border" />

        {/* Recent Decisions */}
        <RailSection title="Decisions & Next Steps" icon={FileText} count={recentDecisions.length} empty="No decisions yet">
          {recentDecisions.length > 0 && (
            <div className="space-y-1">
              {recentDecisions.map(m => (
                <p key={m.id} className="text-[11px] text-foreground/80 bg-muted/30 rounded px-2 py-1">{m.content.slice(0, 100)}</p>
              ))}
            </div>
          )}
        </RailSection>

        <div className="border-t border-border" />

        {/* Open Questions / Risks */}
        <RailSection title="Open Questions" icon={HelpCircle} count={openQuestions.length} empty="No open questions">
          {openQuestions.length > 0 && (
            <div className="space-y-1">
              {openQuestions.map(m => (
                <p key={m.id} className="text-[11px] text-foreground/80 bg-muted/30 rounded px-2 py-1">{m.content.slice(0, 100)}</p>
              ))}
            </div>
          )}
        </RailSection>

        <div className="border-t border-border" />

        {/* Uploaded Resources */}
        <RailSection title="Uploads" icon={FileText} count={uploads.length} empty="Drag files into composer">
          {uploads.length > 0 && (
            <div className="space-y-1">
              {uploads.slice(0, 8).map(u => (
                <div key={u.id} className="text-[11px] bg-muted/30 rounded px-2 py-1 truncate">
                  📎 {u.file_name}
                </div>
              ))}
            </div>
          )}
        </RailSection>

        <div className="border-t border-border" />

        {/* Outputs */}
        <RailSection title="Outputs" icon={FileText} count={outputs.length} empty="No outputs yet">
          {outputs.length > 0 && (
            <div className="space-y-1">
              {outputs.slice(0, 5).map(o => (
                <div key={o.id} className="text-[11px] bg-muted/30 rounded px-2 py-1">
                  <Badge variant="outline" className="text-[8px] px-1 py-0 mr-1">{o.output_type}</Badge>
                  <span className="truncate">{o.title}</span>
                </div>
              ))}
            </div>
          )}
        </RailSection>

        <div className="border-t border-border" />

        {/* Latest Rollup */}
        <RailSection title="Latest Rollup" icon={FileText}>
          {thread.latest_rollup ? (
            <p className="text-[11px] text-foreground/80">{JSON.stringify(thread.latest_rollup).slice(0, 150)}</p>
          ) : (
            <p className="text-[10px] text-muted-foreground/60 italic">No rollup generated</p>
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

          <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5" onClick={copyThread}>
            <Copy className="h-3 w-3" /> Copy Summary
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
