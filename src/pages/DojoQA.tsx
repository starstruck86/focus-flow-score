/**
 * Dojo QA Inspection Panel
 * Internal tool to inspect recent sessions across all modes and spot drift.
 */
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { VALID_FOCUS_PATTERN_IDS, formatFocusPattern } from '@/lib/dojo/focusPatterns';
import { normalizeScoreResult, type DojoScoreResult } from '@/lib/dojo/types';

interface SessionRow {
  id: string;
  session_type: string;
  skill_focus: string;
  best_score: number | null;
  latest_score: number | null;
  created_at: string;
  scenario_title: string | null;
  retry_count: number;
}

interface TurnRow {
  id: string;
  session_id: string;
  turn_index: number;
  score: number | null;
  score_json: Record<string, unknown> | null;
  top_mistake: string | null;
  created_at: string;
}

interface ValidationFlag {
  type: 'error' | 'warning';
  message: string;
}

function validateResult(sj: DojoScoreResult, sessionType: string): ValidationFlag[] {
  const flags: ValidationFlag[] = [];

  // Focus pattern not in approved list
  if (sj.focusPattern && !VALID_FOCUS_PATTERN_IDS.has(sj.focusPattern)) {
    flags.push({ type: 'error', message: `focusPattern "${sj.focusPattern}" not in approved list` });
  }

  // worldClassResponse too close to improvedVersion
  if (sj.worldClassResponse && sj.improvedVersion) {
    const wcClean = sj.worldClassResponse.toLowerCase().replace(/[^a-z ]/g, '');
    const ivClean = sj.improvedVersion.toLowerCase().replace(/[^a-z ]/g, '');
    if (wcClean === ivClean) {
      flags.push({ type: 'error', message: 'worldClassResponse identical to improvedVersion' });
    } else {
      // Check word overlap
      const wcWords = new Set(wcClean.split(' ').filter(w => w.length > 3));
      const ivWords = new Set(ivClean.split(' ').filter(w => w.length > 3));
      const overlap = [...wcWords].filter(w => ivWords.has(w)).length;
      const total = Math.max(wcWords.size, ivWords.size);
      if (total > 0 && overlap / total > 0.85) {
        flags.push({ type: 'warning', message: `worldClassResponse 85%+ word overlap with improvedVersion` });
      }
    }
  }

  // Vague practice cue
  if (sj.practiceCue) {
    if (/^(focus on|improve|show more|be more|work on|try to)/i.test(sj.practiceCue)) {
      flags.push({ type: 'warning', message: `practiceCue too vague: "${sj.practiceCue.slice(0, 60)}"` });
    }
    if (sj.practiceCue.split(' ').length < 4) {
      flags.push({ type: 'warning', message: 'practiceCue too short' });
    }
  } else {
    flags.push({ type: 'warning', message: 'Missing practiceCue' });
  }

  // Missing or weak deltaNote
  if (!sj.deltaNote || sj.deltaNote.length < 15) {
    flags.push({ type: 'warning', message: 'Missing or weak deltaNote' });
  }

  // focusReason doesn't start with "Because"
  if (sj.focusReason && !sj.focusReason.startsWith('Because')) {
    flags.push({ type: 'warning', message: 'focusReason missing "Because" prefix' });
  }

  // Coherence: topMistake vs focusPattern alignment (basic check)
  if (sj.topMistake && sj.focusPattern) {
    const tmWords = sj.topMistake.replace(/_/g, ' ').toLowerCase().split(' ');
    const fpWords = sj.focusPattern.replace(/_/g, ' ').toLowerCase().split(' ');
    const hasOverlap = tmWords.some(t => fpWords.includes(t)) ||
      (sj.topMistake.includes('impact') && sj.focusPattern.includes('impact')) ||
      (sj.topMistake.includes('control') && sj.focusPattern.includes('control')) ||
      (sj.topMistake.includes('generic') && (sj.focusPattern.includes('specific') || sj.focusPattern.includes('proof')));
    if (!hasOverlap) {
      flags.push({ type: 'warning', message: `Possible coherence gap: topMistake="${sj.topMistake}" vs focusPattern="${sj.focusPattern}"` });
    }
  }

  // Missing feedback
  if (!sj.feedback || sj.feedback.length < 20) {
    flags.push({ type: 'error', message: 'Feedback missing or too short' });
  }

  return flags;
}

export default function DojoQA() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: sessions } = useQuery({
    queryKey: ['dojo-qa-sessions', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('dojo_sessions')
        .select('id, session_type, skill_focus, best_score, latest_score, created_at, scenario_title, retry_count')
        .eq('user_id', user!.id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(50);
      return (data || []) as SessionRow[];
    },
  });

  const sessionIds = sessions?.map(s => s.id) || [];

  const { data: turns } = useQuery({
    queryKey: ['dojo-qa-turns', sessionIds.join(',')],
    enabled: sessionIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('dojo_session_turns')
        .select('id, session_id, turn_index, score, score_json, top_mistake, created_at')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: false });
      return (data || []) as TurnRow[];
    },
  });

  const turnsBySession = new Map<string, TurnRow[]>();
  for (const t of turns || []) {
    if (!turnsBySession.has(t.session_id)) turnsBySession.set(t.session_id, []);
    turnsBySession.get(t.session_id)!.push(t);
  }

  // Aggregate stats
  const totalFlags = { errors: 0, warnings: 0 };
  const sessionData = (sessions || []).map(s => {
    const sTurns = turnsBySession.get(s.id) || [];
    const latestTurn = sTurns.sort((a, b) => b.turn_index - a.turn_index)[0];
    const sj = latestTurn?.score_json ? normalizeScoreResult(latestTurn.score_json) : null;
    const flags = sj ? validateResult(sj, s.session_type) : [];
    totalFlags.errors += flags.filter(f => f.type === 'error').length;
    totalFlags.warnings += flags.filter(f => f.type === 'warning').length;
    return { session: s, turns: sTurns, sj, flags };
  });

  return (
    <Layout>
      <div className={cn('px-4 pt-4 space-y-4', SHELL.main.bottomPad)}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dojo')} className="p-1 -ml-1">
            <ArrowLeft className="h-5 w-5 text-muted-foreground" />
          </button>
          <div>
            <h1 className="text-lg font-bold">Dojo QA Inspector</h1>
            <p className="text-xs text-muted-foreground">
              {sessions?.length || 0} sessions · {totalFlags.errors} errors · {totalFlags.warnings} warnings
            </p>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2">
          <SummaryCard label="Clean" value={sessionData.filter(d => d.flags.length === 0).length} color="text-green-500" />
          <SummaryCard label="Warnings" value={totalFlags.warnings} color="text-amber-500" />
          <SummaryCard label="Errors" value={totalFlags.errors} color="text-red-500" />
        </div>

        {/* Session list */}
        <div className="space-y-2">
          {sessionData.map(({ session, sj, flags }) => (
            <Card key={session.id} className={cn(
              'border-border/60',
              flags.some(f => f.type === 'error') && 'border-red-500/30',
              flags.length === 0 && 'border-green-500/15',
            )}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {session.session_type}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {SKILL_LABELS[session.skill_focus as keyof typeof SKILL_LABELS] || session.skill_focus}
                    </Badge>
                    {flags.length === 0 && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                    {flags.some(f => f.type === 'error') && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                    {!flags.some(f => f.type === 'error') && flags.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(session.created_at).toLocaleDateString()}
                  </span>
                </div>

                <p className="text-sm font-medium truncate">{session.scenario_title || 'Untitled'}</p>

                {sj && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    <div><span className="text-muted-foreground">Score:</span> <span className="font-medium">{sj.score}</span></div>
                    <div><span className="text-muted-foreground">Mistake:</span> <span className="font-medium">{sj.topMistake?.replace(/_/g, ' ') || '—'}</span></div>
                    <div><span className="text-muted-foreground">Focus:</span> <span className="font-medium">{sj.focusPattern ? formatFocusPattern(sj.focusPattern) : '—'}</span></div>
                    <div><span className="text-muted-foreground">Retries:</span> <span className="font-medium">{session.retry_count}</span></div>
                    {sj.focusApplied && (
                      <div className="col-span-2"><span className="text-muted-foreground">Focus Applied:</span> <span className="font-medium">{sj.focusApplied}</span></div>
                    )}
                  </div>
                )}

                {sj && (
                  <div className="text-[10px] text-muted-foreground space-y-0.5">
                    <p><span className="font-medium">Cue:</span> {sj.practiceCue || '—'}</p>
                    <p><span className="font-medium">Delta:</span> {sj.deltaNote || '—'}</p>
                  </div>
                )}

                {flags.length > 0 && (
                  <div className="space-y-0.5 pt-1 border-t border-border/40">
                    {flags.map((f, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        {f.type === 'error'
                          ? <XCircle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                          : <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />}
                        <p className={cn('text-[10px]', f.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>
                          {f.message}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <p className={cn('text-xl font-bold', color)}>{value}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
