import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Sparkles, Search, ChevronDown, ChevronUp, Trash2, BookOpen, CheckCircle2 } from 'lucide-react';
import { usePlaybooks, useGeneratePlaybooks, useDeletePlaybook, type Playbook } from '@/hooks/usePlaybooks';
import { cn } from '@/lib/utils';

const STAGE_OPTIONS = ['All', 'Prospecting', 'Discovery', 'Demo', 'Negotiation', 'Closing', 'Renewal'];

export function PlaybooksPanel() {
  const { data: playbooks = [], isLoading } = usePlaybooks();
  const generate = useGeneratePlaybooks();
  const deletePlaybook = useDeletePlaybook();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = playbooks;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.problem_type.toLowerCase().includes(q)
      );
    }
    if (stageFilter !== 'All') {
      list = list.filter(p =>
        p.stage_fit.some(s => s.toLowerCase() === stageFilter.toLowerCase())
      );
    }
    return list;
  }, [playbooks, search, stageFilter]);

  // Group by problem_type
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const p of filtered) {
      const key = p.problem_type || 'Uncategorized';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    // Sort groups by highest confidence playbook first
    return [...map.entries()].sort((a, b) => {
      const maxA = Math.max(...a[1].map(p => p.confidence_score));
      const maxB = Math.max(...b[1].map(p => p.confidence_score));
      return maxB - maxA;
    });
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search playbooks…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGE_OPTIONS.map(s => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="h-8 text-xs gap-1"
        >
          {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Generate
        </Button>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground space-y-2">
          <BookOpen className="h-8 w-8 mx-auto opacity-40" />
          <p className="text-sm font-medium">No playbooks yet</p>
          <p className="text-xs">Click Generate to create playbooks from your enriched resources.</p>
        </div>
      )}

      {grouped.length > 0 && (
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4">
            {grouped.map(([problemType, items]) => (
              <div key={problemType}>
                <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/30 rounded-md mb-1">
                  <span className="text-xs font-semibold text-foreground">{problemType}</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{items.length}</Badge>
                </div>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background z-10 border-b">
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1.5 px-2 font-medium">Playbook</th>
                      <th className="py-1.5 px-2 font-medium">Stage</th>
                      <th className="py-1.5 px-2 font-medium text-right">Confidence</th>
                      <th className="py-1.5 px-1 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(p => (
                      <PlaybookRow
                        key={p.id}
                        playbook={p}
                        expanded={expandedId === p.id}
                        onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                        onDelete={() => deletePlaybook.mutate(p.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function PlaybookRow({ playbook: p, expanded, onToggle, onDelete }: {
  playbook: Playbook;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr className="border-b hover:bg-muted/40 cursor-pointer transition-colors" onClick={onToggle}>
        <td className="py-2 px-2 font-medium text-foreground max-w-[220px] truncate">{p.title}</td>
        <td className="py-2 px-2">
          <div className="flex gap-1 flex-wrap">
            {p.stage_fit.slice(0, 2).map(s => (
              <Badge key={s} variant="secondary" className="text-[10px] px-1.5 py-0">{s}</Badge>
            ))}
            {p.stage_fit.length > 2 && (
              <Badge variant="outline" className="text-[10px] px-1 py-0">+{p.stage_fit.length - 2}</Badge>
            )}
          </div>
        </td>
        <td className="py-2 px-2 text-right">
          <Badge
            variant="outline"
            className={cn(
              'text-[10px]',
              p.confidence_score >= 70 ? 'border-green-500/30 text-green-600' :
              p.confidence_score >= 40 ? 'border-yellow-500/30 text-yellow-600' :
              'border-red-500/30 text-red-500'
            )}
          >
            {Math.round(p.confidence_score)}
          </Badge>
        </td>
        <td className="py-2 px-1">
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="p-3 bg-muted/20 border-b">
            <PlaybookDetail playbook={p} onDelete={onDelete} />
          </td>
        </tr>
      )}
    </>
  );
}

function PlaybookDetail({ playbook: p, onDelete }: { playbook: Playbook; onDelete: () => void }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="When to use" value={p.when_to_use} />
        <Field label="Why it matters" value={p.why_it_matters} />
      </div>

      {p.tactic_steps.length > 0 && (
        <div>
          <span className="font-medium text-foreground">Execution Steps</span>
          <ol className="list-decimal list-inside mt-1 text-muted-foreground space-y-0.5">
            {p.tactic_steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      )}

      {p.talk_tracks.length > 0 && (
        <div>
          <span className="font-medium text-foreground">Talk Tracks</span>
          <ul className="mt-1 text-muted-foreground space-y-1">
            {p.talk_tracks.map((t, i) => (
              <li key={i} className="bg-muted/40 rounded px-2 py-1 italic">"{t}"</li>
            ))}
          </ul>
        </div>
      )}

      {p.key_questions.length > 0 && (
        <div>
          <span className="font-medium text-foreground">Key Questions</span>
          <ul className="list-disc list-inside mt-1 text-muted-foreground space-y-0.5">
            {p.key_questions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {p.traps.length > 0 && (
          <div>
            <span className="font-medium text-destructive">Traps</span>
            <ul className="list-disc list-inside mt-1 text-muted-foreground space-y-0.5">
              {p.traps.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </div>
        )}
        {p.anti_patterns.length > 0 && (
          <div>
            <span className="font-medium text-destructive">Anti-Patterns</span>
            <ul className="list-disc list-inside mt-1 text-muted-foreground space-y-0.5">
              {p.anti_patterns.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        )}
      </div>

      {(p as any).success_criteria && (
        <div className="flex items-start gap-1.5 bg-green-500/5 border border-green-500/20 rounded px-2 py-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
          <div>
            <span className="font-medium text-foreground">Success looks like</span>
            <p className="text-muted-foreground mt-0.5">{(p as any).success_criteria}</p>
          </div>
        </div>
      )}

      {p.persona_fit.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="font-medium text-foreground mr-1">Persona fit:</span>
          {p.persona_fit.map(pf => (
            <Badge key={pf} variant="outline" className="text-[10px]">{pf}</Badge>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-border/50">
        <span className="text-[10px] text-muted-foreground">
          Sources: {p.source_resource_ids.length} resource{p.source_resource_ids.length !== 1 ? 's' : ''}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] text-destructive hover:text-destructive gap-1"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <span className="font-medium text-foreground">{label}</span>
      <p className="text-muted-foreground mt-0.5">{value}</p>
    </div>
  );
}
