// Playbooks page — browse and reference Branch expansion playbooks
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  competitive: { label: 'Competitive', color: 'bg-red-500/15 text-red-600' },
  champion: { label: 'Champion', color: 'bg-blue-500/15 text-blue-600' },
  negotiation: { label: 'Negotiation', color: 'bg-purple-500/15 text-purple-600' },
  objection: { label: 'Objection', color: 'bg-amber-500/15 text-amber-600' },
  usage: { label: 'Usage / QBR', color: 'bg-green-500/15 text-green-600' },
  executive: { label: 'Executive', color: 'bg-pink-500/15 text-pink-600' },
};

interface Playbook {
  id: string;
  title: string;
  problem_type: string;
  when_to_use: string;
  talk_tracks: string[];
  key_questions: string[];
  tactic_steps: string[];
  traps: string[];
  success_criteria: string;
  confidence_score: number;
}

function PlaybookCard({ pb }: { pb: Playbook }) {
  const [expanded, setExpanded] = useState(false);
  const [section, setSection] = useState<'position' | 'questions' | 'steps'>('position');
  const meta = TYPE_LABELS[pb.problem_type] ?? { label: pb.problem_type, color: 'bg-muted text-muted-foreground' };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        className="w-full text-left p-4 flex items-start justify-between gap-3"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold">{pb.title}</h3>
            <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0', meta.color)}>{meta.label}</span>
            {pb.confidence_score >= 0.85 && (
              <span className="text-[10px] text-green-500 font-medium shrink-0">High confidence</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{pb.when_to_use}</p>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 space-y-3">
          {pb.success_criteria && (
            <div className="mt-3 p-2.5 rounded-lg bg-green-500/5 border border-green-500/20">
              <p className="text-[10px] font-semibold text-green-600 mb-0.5 uppercase tracking-wider">Win looks like</p>
              <p className="text-xs">{pb.success_criteria}</p>
            </div>
          )}

          <div className="flex gap-1 border-b border-border">
            {(['position', 'questions', 'steps'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={cn(
                  'text-xs font-medium px-3 py-1.5 border-b-2 transition-all',
                  section === s
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {s === 'position' ? '💬 My Position' : s === 'questions' ? '🪤 Trap Qs' : '📋 Steps'}
              </button>
            ))}
          </div>

          {section === 'position' && (
            <div className="space-y-2">
              {(pb.talk_tracks ?? []).map((track, i) => (
                <div key={i} className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-sm">{track}</p>
                </div>
              ))}
              {(pb.traps ?? []).length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-1.5">Don't do this</p>
                  {pb.traps.map((t, i) => (
                    <div key={i} className="flex gap-1.5 text-xs text-muted-foreground mb-1">
                      <span className="text-red-400 shrink-0">✗</span>
                      <span>{t}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === 'questions' && (
            <div className="space-y-2">
              {(pb.key_questions ?? []).map((q, i) => (
                <div key={i} className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-sm italic">"{q}"</p>
                </div>
              ))}
            </div>
          )}

          {section === 'steps' && (
            <div className="space-y-1.5">
              {(pb.tactic_steps ?? []).map((step, i) => (
                <div key={i} className="flex gap-2.5 text-sm">
                  <span className="text-primary font-bold shrink-0 w-4 text-right">{i + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Playbooks() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string>('all');

  const { data: playbooks } = useQuery({
    queryKey: ['playbooks-page'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('playbooks')
        .select('id, title, problem_type, when_to_use, talk_tracks, key_questions, tactic_steps, traps, success_criteria, confidence_score')
        .order('confidence_score', { ascending: false });
      return (data ?? []) as Playbook[];
    },
    staleTime: 120_000,
  });

  const types = ['all', ...Array.from(new Set((playbooks ?? []).map((p) => p.problem_type)))];
  const filtered = filter === 'all' ? (playbooks ?? []) : (playbooks ?? []).filter((p) => p.problem_type === filter);

  return (
    <div className="fixed inset-0 bg-background flex flex-col z-40">
      <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={() => navigate('/dojo')}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" /> Dojo
        </button>
        <h1 className="text-base font-bold ml-2">Playbooks</h1>
        <span className="text-[11px] text-muted-foreground ml-1">· {(playbooks ?? []).length} encoded situations</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-w-2xl w-full mx-auto">
        <div className="flex gap-1.5 flex-wrap">
          {types.map((t) => {
            const meta =
              t === 'all' ? { label: 'All', color: '' } : TYPE_LABELS[t] ?? { label: t, color: 'bg-muted text-muted-foreground' };
            return (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={cn(
                  'text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all',
                  filter === t
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border/60 text-muted-foreground hover:border-primary/40',
                )}
              >
                {t === 'all' ? 'All' : meta.label}
              </button>
            );
          })}
        </div>

        {!playbooks && <div className="text-center py-8 text-sm text-muted-foreground">Loading playbooks…</div>}
        {filtered.map((pb) => (
          <PlaybookCard key={pb.id} pb={pb} />
        ))}
      </div>
    </div>
  );
}
