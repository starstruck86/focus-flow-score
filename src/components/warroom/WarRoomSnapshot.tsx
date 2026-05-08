import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X, ExternalLink } from 'lucide-react';
import type { WarRoomRow } from '@/hooks/useWarRooms';
import { useUpdateWarRoom } from '@/hooks/useWarRooms';
import { useDebouncedCallback } from '@/hooks/useDebouncedUpdate';

const STAGES = ['Screen', 'HM Interview', 'VP/CRO', 'Panel', 'Onsite', 'Offer', 'Negotiation', 'Closed'] as const;
const VERDICTS = ['Pursuing', 'Interested', 'Cooling', 'Declined', 'Offer', 'Accepted', 'Ghosted'] as const;
const WORK_MODELS = ['Remote', 'Hybrid', 'Onsite'] as const;

const VERDICT_COLORS: Record<string, string> = {
  Pursuing: 'bg-blue-500/20 text-blue-400',
  Interested: 'bg-green-500/20 text-green-400',
  Cooling: 'bg-yellow-500/20 text-yellow-400',
  Declined: 'bg-red-500/20 text-red-400',
  Offer: 'bg-purple-500/20 text-purple-400',
  Accepted: 'bg-emerald-500/20 text-emerald-400',
  Ghosted: 'bg-muted text-muted-foreground',
};

function InlineEdit({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [local, setLocal] = useState(value);
  const flush = useDebouncedCallback((v: string) => onChange(v), 600);
  return (
    <Input
      value={local}
      onChange={(e) => { setLocal(e.target.value); flush(e.target.value); }}
      placeholder={placeholder}
      className={className ?? 'h-8 text-sm bg-transparent border-transparent hover:border-border focus:border-border'}
    />
  );
}

export function WarRoomSnapshot({ war }: { war: WarRoomRow }) {
  const { mutate: update } = useUpdateWarRoom();
  const save = useCallback((updates: Record<string, any>) => update({ id: war.id, updates }), [update, war.id]);

  const comp = (war.comp_json ?? {}) as Record<string, any>;
  const nextInterview = (war.next_interview_json ?? {}) as Record<string, any>;
  const [questions, setQuestions] = useState<string[]>(war.open_questions ?? []);
  const [newQ, setNewQ] = useState('');

  const saveComp = (field: string, value: string) => save({ comp_json: { ...comp, [field]: value } });
  const saveNext = (field: string, value: string) => save({ next_interview_json: { ...nextInterview, [field]: value } });

  const addQuestion = () => {
    if (!newQ.trim()) return;
    const updated = [...questions, newQ.trim()];
    setQuestions(updated);
    setNewQ('');
    save({ open_questions: updated });
  };
  const removeQuestion = (idx: number) => {
    const updated = questions.filter((_, i) => i !== idx);
    setQuestions(updated);
    save({ open_questions: updated });
  };

  return (
    <div className="space-y-4">
      {/* Row 1: Stage + Verdict + Work Model */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={war.process_stage ?? ''} onValueChange={(v) => save({ process_stage: v })}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={war.verdict ?? ''} onValueChange={(v) => save({ verdict: v })}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Verdict" /></SelectTrigger>
          <SelectContent>{VERDICTS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
        </Select>
        {war.verdict && (
          <Badge className={VERDICT_COLORS[war.verdict] ?? 'bg-muted text-muted-foreground'}>{war.verdict}</Badge>
        )}
        <Select value={war.work_model ?? ''} onValueChange={(v) => save({ work_model: v })}>
          <SelectTrigger className="w-28 h-8 text-xs"><SelectValue placeholder="Work model" /></SelectTrigger>
          <SelectContent>{WORK_MODELS.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {/* Row 2: Comp snapshot */}
      <div className="p-3 rounded-lg border border-border/50 bg-card/30 space-y-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Compensation</span>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {['base', 'ote', 'equity', 'quota', 'ramp'].map(f => (
            <div key={f}>
              <label className="text-[10px] text-muted-foreground capitalize">{f}</label>
              <InlineEdit value={comp[f] ?? ''} onChange={(v) => saveComp(f, v)} placeholder={f} />
            </div>
          ))}
          <div className="col-span-2 sm:col-span-3">
            <label className="text-[10px] text-muted-foreground">Comp notes</label>
            <InlineEdit value={comp.notes ?? ''} onChange={(v) => saveComp('notes', v)} placeholder="Comp notes..." />
          </div>
        </div>
      </div>

      {/* Row 3: Key people + links */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground">Recruiter</label>
          <InlineEdit value={war.recruiter_name ?? ''} onChange={(v) => save({ recruiter_name: v })} placeholder="Recruiter name" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Hiring Manager</label>
          <InlineEdit value={war.hiring_manager_name ?? ''} onChange={(v) => save({ hiring_manager_name: v })} placeholder="HM name" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">JD Link</label>
          <div className="flex items-center gap-1">
            <InlineEdit value={war.jd_url ?? ''} onChange={(v) => save({ jd_url: v })} placeholder="https://..." />
            {war.jd_url && <a href={war.jd_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" /></a>}
          </div>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Company URL</label>
          <div className="flex items-center gap-1">
            <InlineEdit value={war.company_url ?? ''} onChange={(v) => save({ company_url: v })} placeholder="https://..." />
            {war.company_url && <a href={war.company_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" /></a>}
          </div>
        </div>
      </div>

      {/* Row 4: Next interview */}
      <div className="p-3 rounded-lg border border-border/50 bg-card/30 space-y-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Next Interview</span>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div><label className="text-[10px] text-muted-foreground">Who</label><InlineEdit value={nextInterview.who ?? ''} onChange={(v) => saveNext('who', v)} placeholder="Name" /></div>
          <div><label className="text-[10px] text-muted-foreground">When</label><InlineEdit value={nextInterview.when ?? ''} onChange={(v) => saveNext('when', v)} placeholder="Date/time" /></div>
          <div><label className="text-[10px] text-muted-foreground">Format</label><InlineEdit value={nextInterview.format ?? ''} onChange={(v) => saveNext('format', v)} placeholder="Video, phone..." /></div>
        </div>
      </div>

      {/* Row 5: Open questions */}
      <div className="space-y-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Open Questions</span>
        <ul className="space-y-1">
          {questions.map((q, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-foreground">
              <span className="mt-0.5 text-muted-foreground">•</span>
              <span className="flex-1">{q}</span>
              <button onClick={() => removeQuestion(i)} className="shrink-0 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input value={newQ} onChange={(e) => setNewQ(e.target.value)} placeholder="Add a question..." className="h-8 text-sm" onKeyDown={(e) => e.key === 'Enter' && addQuestion()} />
          <Button size="sm" variant="ghost" onClick={addQuestion} className="h-8 px-2"><Plus className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </div>
  );
}
