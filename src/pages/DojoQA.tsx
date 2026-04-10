/**
 * Dojo QA Inspection Panel — Triage + inspection for all 3 modes.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2, XCircle, ArrowLeft, ChevronDown, ChevronUp, Filter } from 'lucide-react';
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
  code: string;
  message: string;
}

function validateResult(sj: DojoScoreResult, sessionType: string): ValidationFlag[] {
  const flags: ValidationFlag[] = [];

  if (sj.focusPattern && !VALID_FOCUS_PATTERN_IDS.has(sj.focusPattern)) {
    flags.push({ type: 'error', code: 'invalid_focus_pattern', message: `focusPattern "${sj.focusPattern}" not in approved list` });
  }

  if (sj.worldClassResponse && sj.improvedVersion) {
    const wcClean = sj.worldClassResponse.toLowerCase().replace(/[^a-z ]/g, '');
    const ivClean = sj.improvedVersion.toLowerCase().replace(/[^a-z ]/g, '');
    if (wcClean === ivClean) {
      flags.push({ type: 'error', code: 'wc_identical', message: 'worldClassResponse identical to improvedVersion' });
    } else {
      const wcWords = new Set(wcClean.split(' ').filter(w => w.length > 3));
      const ivWords = new Set(ivClean.split(' ').filter(w => w.length > 3));
      const overlap = [...wcWords].filter(w => ivWords.has(w)).length;
      const total = Math.max(wcWords.size, ivWords.size);
      if (total > 0 && overlap / total > 0.85) {
        flags.push({ type: 'warning', code: 'wc_overlap', message: `worldClassResponse 85%+ word overlap with improvedVersion` });
      }
    }
  }

  if (sj.practiceCue) {
    if (/^(focus on|improve|show more|be more|work on|try to)/i.test(sj.practiceCue)) {
      flags.push({ type: 'warning', code: 'vague_practice_cue', message: `practiceCue too vague: "${sj.practiceCue.slice(0, 60)}"` });
    }
    if (sj.practiceCue.split(' ').length < 4) {
      flags.push({ type: 'warning', code: 'vague_practice_cue', message: 'practiceCue too short' });
    }
  } else {
    flags.push({ type: 'warning', code: 'vague_practice_cue', message: 'Missing practiceCue' });
  }

  if (!sj.deltaNote || sj.deltaNote.length < 15) {
    flags.push({ type: 'warning', code: 'weak_delta_note', message: 'Missing or weak deltaNote' });
  }

  if (!sj.feedback || sj.feedback.length < 20) {
    flags.push({ type: 'error', code: 'missing_feedback', message: 'Feedback missing or too short' });
  }

  if (sj.topMistake && sj.focusPattern) {
    const tmWords = sj.topMistake.replace(/_/g, ' ').toLowerCase().split(' ');
    const fpWords = sj.focusPattern.replace(/_/g, ' ').toLowerCase().split(' ');
    const hasOverlap = tmWords.some(t => fpWords.includes(t)) ||
      (sj.topMistake.includes('impact') && sj.focusPattern.includes('impact')) ||
      (sj.topMistake.includes('control') && sj.focusPattern.includes('control')) ||
      (sj.topMistake.includes('generic') && (sj.focusPattern.includes('specific') || sj.focusPattern.includes('proof')));
    if (!hasOverlap) {
      flags.push({ type: 'warning', code: 'coherence_gap', message: `Coherence gap: topMistake="${sj.topMistake}" vs focusPattern="${sj.focusPattern}"` });
    }
  }

  // Roleplay-specific
  if (sessionType === 'roleplay') {
    const raw = sj as unknown as Record<string, unknown>;
    if (!raw.turnAnalysis || !Array.isArray(raw.turnAnalysis) || (raw.turnAnalysis as unknown[]).length === 0) {
      flags.push({ type: 'warning', code: 'missing_turn_analysis', message: 'Missing turnAnalysis for roleplay' });
    }
    if (!raw.controlArc || (typeof raw.controlArc === 'string' && raw.controlArc.length < 10)) {
      flags.push({ type: 'warning', code: 'missing_control_arc', message: 'Missing or weak controlArc' });
    }
  }

  // Review-specific
  if (sessionType === 'review') {
    const raw = sj as unknown as Record<string, unknown>;
    if (typeof raw.diagnosisAccuracy !== 'string') {
      flags.push({ type: 'warning', code: 'missing_diagnosis_accuracy', message: 'Missing diagnosisAccuracy for review' });
    }
  }

  return flags;
}

type FilterMode = 'all' | 'drill' | 'roleplay' | 'review';
type FilterSeverity = 'all' | 'errors' | 'warnings' | 'clean';

export default function DojoQA() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [filterSeverity, setFilterSeverity] = useState<FilterSeverity>('all');
  const [filterSkill, setFilterSkill] = useState<string>('all');
  const [expandedJson, setExpandedJson] = useState<Set<string>>(new Set());

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
        .limit(100);
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

  const turnsBySession = useMemo(() => {
    const map = new Map<string, TurnRow[]>();
    for (const t of turns || []) {
      if (!map.has(t.session_id)) map.set(t.session_id, []);
      map.get(t.session_id)!.push(t);
    }
    return map;
  }, [turns]);

  // Build enriched session data
  const sessionData = useMemo(() => {
    return (sessions || []).map(s => {
      const sTurns = turnsBySession.get(s.id) || [];
      const latestTurn = [...sTurns].sort((a, b) => b.turn_index - a.turn_index)[0];
      const sj = latestTurn?.score_json ? normalizeScoreResult(latestTurn.score_json) : null;
      const rawJson = latestTurn?.score_json || null;
      const flags = sj ? validateResult(sj, s.session_type) : [];
      return { session: s, turns: sTurns, sj, rawJson, flags };
    });
  }, [sessions, turnsBySession]);

  // Stats by mode
  const statsByMode = useMemo(() => {
    const stats: Record<string, { total: number; clean: number; flagged: number }> = {
      drill: { total: 0, clean: 0, flagged: 0 },
      roleplay: { total: 0, clean: 0, flagged: 0 },
      review: { total: 0, clean: 0, flagged: 0 },
    };
    for (const d of sessionData) {
      const mode = d.session.session_type;
      if (stats[mode]) {
        stats[mode].total++;
        if (d.flags.length === 0) stats[mode].clean++;
        else stats[mode].flagged++;
      }
    }
    return stats;
  }, [sessionData]);

  // Top recurring problems
  const recurringProblems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of sessionData) {
      for (const f of d.flags) {
        counts.set(f.code, (counts.get(f.code) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([code, count]) => ({ code, count, label: code.replace(/_/g, ' ') }));
  }, [sessionData]);

  // Filtered data
  const filtered = useMemo(() => {
    return sessionData.filter(d => {
      if (filterMode !== 'all' && d.session.session_type !== filterMode) return false;
      if (filterSkill !== 'all' && d.session.skill_focus !== filterSkill) return false;
      if (filterSeverity === 'errors' && !d.flags.some(f => f.type === 'error')) return false;
      if (filterSeverity === 'warnings' && d.flags.length === 0) return false;
      if (filterSeverity === 'clean' && d.flags.length > 0) return false;
      return true;
    });
  }, [sessionData, filterMode, filterSeverity, filterSkill]);

  const totalFlags = useMemo(() => {
    const t = { errors: 0, warnings: 0 };
    for (const d of sessionData) {
      t.errors += d.flags.filter(f => f.type === 'error').length;
      t.warnings += d.flags.filter(f => f.type === 'warning').length;
    }
    return t;
  }, [sessionData]);

  const toggleJson = (id: string) => {
    setExpandedJson(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

        {/* Stats by mode */}
        <div className="grid grid-cols-3 gap-2">
          {(['drill', 'roleplay', 'review'] as const).map(mode => (
            <Card key={mode} className="cursor-pointer" onClick={() => setFilterMode(filterMode === mode ? 'all' : mode)}>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5 capitalize">{mode}</p>
                <p className="text-lg font-bold">{statsByMode[mode]?.total || 0}</p>
                <div className="flex justify-center gap-2 mt-1">
                  <span className="text-[10px] text-green-500">{statsByMode[mode]?.clean || 0} clean</span>
                  <span className="text-[10px] text-red-500">{statsByMode[mode]?.flagged || 0} flagged</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Top recurring problems */}
        {recurringProblems.length > 0 && (
          <Card className="border-border/60">
            <CardContent className="p-3 space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Top Recurring Issues</p>
              <div className="space-y-1">
                {recurringProblems.map(p => (
                  <div key={p.code} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground capitalize">{p.label}</span>
                    <Badge variant="outline" className="text-[10px]">{p.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {(['all', 'errors', 'warnings', 'clean'] as const).map(s => (
            <Badge key={s} variant={filterSeverity === s ? 'default' : 'outline'} className="text-[10px] cursor-pointer capitalize" onClick={() => setFilterSeverity(s)}>
              {s}
            </Badge>
          ))}
          <span className="text-muted-foreground text-[10px]">|</span>
          {(['all', 'drill', 'roleplay', 'review'] as const).map(m => (
            <Badge key={m} variant={filterMode === m ? 'default' : 'outline'} className="text-[10px] cursor-pointer capitalize" onClick={() => setFilterMode(m)}>
              {m}
            </Badge>
          ))}
          <span className="text-muted-foreground text-[10px]">|</span>
          <select value={filterSkill} onChange={e => setFilterSkill(e.target.value)} className="text-[10px] bg-transparent border border-border rounded px-1.5 py-0.5">
            <option value="all">All Skills</option>
            {Object.entries(SKILL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <p className="text-[10px] text-muted-foreground">{filtered.length} sessions shown</p>

        {/* Session list */}
        <div className="space-y-2">
          {filtered.map(({ session, sj, rawJson, flags }) => (
            <Card key={session.id} className={cn(
              'border-border/60',
              flags.some(f => f.type === 'error') && 'border-red-500/30',
              flags.length === 0 && 'border-green-500/15',
            )}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{session.session_type}</Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {SKILL_LABELS[session.skill_focus as keyof typeof SKILL_LABELS] || session.skill_focus}
                    </Badge>
                    {flags.length === 0 && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                    {flags.some(f => f.type === 'error') && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                    {!flags.some(f => f.type === 'error') && flags.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(session.created_at).toLocaleDateString()}</span>
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

                {/* JSON inspector toggle */}
                {rawJson && (
                  <div className="pt-1 border-t border-border/30">
                    <button onClick={() => toggleJson(session.id)} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                      {expandedJson.has(session.id) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      Raw score_json
                    </button>
                    {expandedJson.has(session.id) && (
                      <pre className="mt-1.5 text-[9px] text-muted-foreground bg-muted/50 rounded p-2 overflow-x-auto max-h-[300px] overflow-y-auto">
                        {JSON.stringify(rawJson, null, 2)}
                      </pre>
                    )}
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
