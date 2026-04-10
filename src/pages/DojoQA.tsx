/**
 * Dojo QA Inspection Panel — Triage + inspection + fixture runner for all 3 modes.
 */
import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2, XCircle, ArrowLeft, ChevronDown, ChevronUp, Filter, Play, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { VALID_FOCUS_PATTERN_IDS, formatFocusPattern } from '@/lib/dojo/focusPatterns';
import { normalizeScoreResult, type DojoScoreResult } from '@/lib/dojo/types';
import { QA_FIXTURES, validateQAResult, type QAResult } from '@/lib/dojo/qaHarness';

interface AudioMetrics {
  totalChunks: number;
  completed: number;
  failed: number;
  skipped: number;
  timedOut: number;
  retries: number;
  degradations: number;
  recoveries: number;
  avgChunkDurationMs: number;
  p95ChunkDurationMs: number;
  sessionDurationMs: number;
  successRate: number;
}

interface SessionRow {
  id: string;
  session_type: string;
  skill_focus: string;
  best_score: number | null;
  latest_score: number | null;
  created_at: string;
  scenario_title: string | null;
  retry_count: number;
  audio_metrics: AudioMetrics | null;
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

  // Roleplay-specific flags
  if (sessionType === 'roleplay') {
    const raw = sj as unknown as Record<string, unknown>;
    if (!raw.turnAnalysis || !Array.isArray(raw.turnAnalysis) || (raw.turnAnalysis as unknown[]).length === 0) {
      flags.push({ type: 'warning', code: 'missing_turn_analysis', message: 'Missing turnAnalysis for roleplay' });
    }
    if (!raw.controlArc || (typeof raw.controlArc === 'string' && raw.controlArc.length < 10)) {
      flags.push({ type: 'warning', code: 'missing_control_arc', message: 'Missing or weak controlArc' });
    }
    if (!raw.adaptationNote || (typeof raw.adaptationNote === 'string' && raw.adaptationNote.length < 10)) {
      flags.push({ type: 'warning', code: 'missing_adaptation_note', message: 'Missing or weak adaptationNote' });
    }
  }

  // Review-specific flags
  if (sessionType === 'review') {
    const raw = sj as unknown as Record<string, unknown>;
    if (typeof raw.diagnosisAccuracy !== 'string' || !raw.diagnosisAccuracy) {
      flags.push({ type: 'warning', code: 'missing_diagnosis_accuracy', message: 'Missing diagnosisAccuracy for review' });
    }
    if (typeof raw.rewriteFixedIssue !== 'boolean') {
      flags.push({ type: 'warning', code: 'missing_rewrite_fixed', message: 'Missing rewriteFixedIssue for review' });
    }
    if (typeof raw.diagnosisFeedback !== 'string' || !raw.diagnosisFeedback) {
      flags.push({ type: 'warning', code: 'missing_diagnosis_feedback', message: 'Missing diagnosisFeedback for review' });
    }
    if (typeof raw.rewriteFeedback !== 'string' || !raw.rewriteFeedback) {
      flags.push({ type: 'warning', code: 'missing_rewrite_feedback', message: 'Missing rewriteFeedback for review' });
    }
  }

  return flags;
}

type FilterMode = 'all' | 'drill' | 'roleplay' | 'review';
type FilterSeverity = 'all' | 'errors' | 'warnings' | 'clean';
type FilterAudio = 'all' | 'has_audio' | 'degraded' | 'recovered' | 'replayed' | 'skipped' | 'timed_out';

export default function DojoQA() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [filterSeverity, setFilterSeverity] = useState<FilterSeverity>('all');
  const [filterSkill, setFilterSkill] = useState<string>('all');
  const [filterAudio, setFilterAudio] = useState<FilterAudio>('all');
  const [expandedJson, setExpandedJson] = useState<Set<string>>(new Set());

  // Fixture runner state
  const [fixtureResults, setFixtureResults] = useState<QAResult[]>([]);
  const [fixtureRunning, setFixtureRunning] = useState(false);
  const [fixtureProgress, setFixtureProgress] = useState(0);

  const { data: sessions } = useQuery({
    queryKey: ['dojo-qa-sessions', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('dojo_sessions')
        .select('id, session_type, skill_focus, best_score, latest_score, created_at, scenario_title, retry_count, audio_metrics')
        .eq('user_id', user!.id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(100);
      return (data || []) as unknown as SessionRow[];
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

  const sessionData = useMemo(() => {
    return (sessions || []).map(s => {
      const sTurns = turnsBySession.get(s.id) || [];
      const latestTurn = [...sTurns].sort((a, b) => b.turn_index - a.turn_index)[0];
      const sj = latestTurn?.score_json ? normalizeScoreResult(latestTurn.score_json) : null;
      // For mode-specific validation, we need the raw JSON which may have extra fields
      const rawSj = latestTurn?.score_json || null;
      // Merge raw fields onto normalized for validation
      const merged = rawSj ? { ...sj, ...rawSj } as unknown as DojoScoreResult : sj;
      const flags = merged ? validateResult(merged, s.session_type) : [];
      return { session: s, turns: sTurns, sj: merged, rawJson: rawSj, flags };
    });
  }, [sessions, turnsBySession]);

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

  const recurringProblems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of sessionData) {
      for (const f of d.flags) {
        counts.set(f.code, (counts.get(f.code) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([code, count]) => ({ code, count, label: code.replace(/_/g, ' ') }));
  }, [sessionData]);

  const filtered = useMemo(() => {
    return sessionData.filter(d => {
      if (filterMode !== 'all' && d.session.session_type !== filterMode) return false;
      if (filterSkill !== 'all' && d.session.skill_focus !== filterSkill) return false;
      if (filterSeverity === 'errors' && !d.flags.some(f => f.type === 'error')) return false;
      if (filterSeverity === 'warnings' && d.flags.length === 0) return false;
      if (filterSeverity === 'clean' && d.flags.length > 0) return false;

      const am = d.session.audio_metrics;
      if (filterAudio === 'has_audio' && !am) return false;
      if (filterAudio === 'degraded' && (!am || am.degradations === 0)) return false;
      if (filterAudio === 'recovered' && (!am || am.recoveries === 0)) return false;
      if (filterAudio === 'replayed' && (!am || !(am as unknown as Record<string, unknown>).replaysRequested)) return false;
      if (filterAudio === 'skipped' && (!am || am.skipped === 0)) return false;
      if (filterAudio === 'timed_out' && (!am || am.timedOut === 0)) return false;

      return true;
    });
  }, [sessionData, filterMode, filterSeverity, filterSkill, filterAudio]);

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

  // ── Fixture Runner ──
  const runFixtures = useCallback(async () => {
    setFixtureRunning(true);
    setFixtureResults([]);
    setFixtureProgress(0);

    const drillFixtures = QA_FIXTURES.filter(f => f.mode === 'drill');
    const roleplayFixtures = QA_FIXTURES.filter(f => f.mode === 'roleplay');
    const reviewFixtures = QA_FIXTURES.filter(f => f.mode === 'review');
    const allFixtures = [...drillFixtures, ...roleplayFixtures, ...reviewFixtures];
    const results: QAResult[] = [];

    for (let i = 0; i < allFixtures.length; i++) {
      const fixture = allFixtures[i];
      setFixtureProgress(i + 1);

      try {
        let data: Record<string, unknown>;

        if (fixture.mode === 'drill') {
          const resp = await supabase.functions.invoke('dojo-score', {
            body: {
              scenario: { skillFocus: fixture.skill, context: fixture.context, objection: fixture.objection },
              userResponse: fixture.userResponse,
              retryCount: 0,
            },
          });
          if (resp.error) throw resp.error;
          data = resp.data as Record<string, unknown>;
        } else if (fixture.mode === 'roleplay' && fixture.conversation) {
          const resp = await supabase.functions.invoke('dojo-roleplay-score', {
            body: {
              scenario: { skillFocus: fixture.skill, context: fixture.context, objection: fixture.objection },
              conversation: fixture.conversation,
              skillFocus: fixture.skill,
            },
          });
          if (resp.error) throw resp.error;
          data = resp.data as Record<string, unknown>;
        } else if (fixture.mode === 'review' && fixture.weakResponse) {
          const resp = await supabase.functions.invoke('dojo-review-score', {
            body: {
              scenario: { skillFocus: fixture.skill, context: fixture.context, objection: fixture.objection },
              skillFocus: fixture.skill,
              action: 'score_review',
              weakResponse: fixture.weakResponse,
              userDiagnosis: fixture.userDiagnosis || '',
              userRewrite: fixture.userRewrite || '',
            },
          });
          if (resp.error) throw resp.error;
          data = resp.data as Record<string, unknown>;
        } else {
          continue;
        }

        if (data?.error) throw new Error(String(data.error));
        const scoreResult = normalizeScoreResult(data);
        // Merge raw mode-specific fields onto score result for validation
        const merged = { ...scoreResult, ...data } as unknown as DojoScoreResult;
        results.push(validateQAResult(fixture, merged));
      } catch (e) {
        console.error(`Fixture ${fixture.id} error:`, e);
        const emptyResult = normalizeScoreResult({});
        results.push({
          fixture,
          result: emptyResult,
          scoreInRange: false,
          mistakeMatch: false,
          coherenceCheck: { feedbackAligned: false, focusPatternAligned: false, practiceCueActionable: false, deltaNotePresent: false },
          issues: [`Fixture error: ${e instanceof Error ? e.message : 'Unknown'}`],
        });
      }
    }

    setFixtureResults(results);
    setFixtureRunning(false);
  }, []);

  const fixturesByMode = useMemo(() => {
    const grouped: Record<string, QAResult[]> = { drill: [], roleplay: [], review: [] };
    for (const r of fixtureResults) {
      const mode = r.fixture.mode;
      if (grouped[mode]) grouped[mode].push(r);
    }
    return grouped;
  }, [fixtureResults]);

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

        {/* ── Fixture Runner ── */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Fixture Runner</p>
                <p className="text-[10px] text-muted-foreground">{QA_FIXTURES.length} fixtures across drill, roleplay, review</p>
              </div>
              <Button size="sm" className="gap-1.5" onClick={runFixtures} disabled={fixtureRunning}>
                {fixtureRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {fixtureRunning ? `Running ${fixtureProgress}/${QA_FIXTURES.length}` : 'Run Fixtures'}
              </Button>
            </div>

            {fixtureResults.length > 0 && (
              <div className="space-y-3">
                {/* Summary */}
                <div className="flex gap-3">
                  <Badge className="text-xs bg-green-600 hover:bg-green-600">{fixtureResults.filter(r => r.issues.length === 0).length} passed</Badge>
                  <Badge variant="destructive" className="text-xs">{fixtureResults.filter(r => r.issues.length > 0).length} failed</Badge>
                </div>

                {/* Results by mode */}
                {(['drill', 'roleplay', 'review'] as const).map(mode => {
                  const modeResults = fixturesByMode[mode] || [];
                  if (modeResults.length === 0) return null;
                  return (
                    <div key={mode} className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider capitalize">{mode} ({modeResults.filter(r => r.issues.length === 0).length}/{modeResults.length} pass)</p>
                      {modeResults.map(r => (
                        <div key={r.fixture.id} className={cn('rounded-md border p-2.5 text-xs space-y-1',
                          r.issues.length === 0 ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'
                        )}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              {r.issues.length === 0 ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                              <span className="font-medium">{r.fixture.id}</span>
                              <Badge variant="outline" className="text-[9px]">{r.fixture.skill}</Badge>
                            </div>
                            <span className="font-mono text-[10px]">
                              {r.result.score} <span className="text-muted-foreground">(expect {r.fixture.expectedScoreRange[0]}-{r.fixture.expectedScoreRange[1]})</span>
                            </span>
                          </div>
                          {r.fixture.expectedMistake && (
                            <p className="text-[10px] text-muted-foreground">
                              Mistake: <span className={r.mistakeMatch ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{r.result.topMistake || '—'}</span>
                              {!r.mistakeMatch && <span> (expected: {r.fixture.expectedMistake})</span>}
                            </p>
                          )}
                          {r.issues.length > 0 && (
                            <div className="space-y-0.5 pt-1 border-t border-border/30">
                              {r.issues.map((issue, i) => (
                                <p key={i} className="text-[10px] text-red-600 dark:text-red-400">• {issue}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

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
            <Badge key={s} variant={filterSeverity === s ? 'default' : 'outline'} className="text-[10px] cursor-pointer capitalize" onClick={() => setFilterSeverity(s)}>{s}</Badge>
          ))}
          <span className="text-muted-foreground text-[10px]">|</span>
          {(['all', 'drill', 'roleplay', 'review'] as const).map(m => (
            <Badge key={m} variant={filterMode === m ? 'default' : 'outline'} className="text-[10px] cursor-pointer capitalize" onClick={() => setFilterMode(m)}>{m}</Badge>
          ))}
          <span className="text-muted-foreground text-[10px]">|</span>
          <select value={filterSkill} onChange={e => setFilterSkill(e.target.value)} className="text-[10px] bg-transparent border border-border rounded px-1.5 py-0.5">
            <option value="all">All Skills</option>
            {Object.entries(SKILL_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
          <span className="text-muted-foreground text-[10px]">|</span>
          <select value={filterAudio} onChange={e => setFilterAudio(e.target.value as FilterAudio)} className="text-[10px] bg-transparent border border-border rounded px-1.5 py-0.5">
            <option value="all">Audio: All</option>
            <option value="has_audio">Has Audio</option>
            <option value="degraded">Degraded</option>
            <option value="recovered">Recovered</option>
            <option value="replayed">Replayed</option>
            <option value="skipped">Skipped</option>
            <option value="timed_out">Timed Out</option>
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
                    <Badge variant="secondary" className="text-[10px]">{SKILL_LABELS[session.skill_focus as keyof typeof SKILL_LABELS] || session.skill_focus}</Badge>
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
                        {f.type === 'error' ? <XCircle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />}
                        <p className={cn('text-[10px]', f.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>{f.message}</p>
                      </div>
                    ))}
                  </div>
                )}

                {session.audio_metrics && (
                  <div className="pt-1 border-t border-border/40">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Audio Metrics</p>
                    <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[10px]">
                      <div><span className="text-muted-foreground">Chunks:</span> {session.audio_metrics.completed}/{session.audio_metrics.totalChunks}</div>
                      <div><span className="text-muted-foreground">Success:</span> {session.audio_metrics.successRate}%</div>
                      <div><span className="text-muted-foreground">Avg ms:</span> {session.audio_metrics.avgChunkDurationMs}</div>
                      {session.audio_metrics.failed > 0 && <div className="text-red-500">Failed: {session.audio_metrics.failed}</div>}
                      {session.audio_metrics.timedOut > 0 && <div className="text-amber-500">Timed out: {session.audio_metrics.timedOut}</div>}
                      {session.audio_metrics.retries > 0 && <div className="text-amber-500">Retries: {session.audio_metrics.retries}</div>}
                      {session.audio_metrics.degradations > 0 && <div className="text-red-500">Degraded: {session.audio_metrics.degradations}</div>}
                      {session.audio_metrics.recoveries > 0 && <div className="text-green-500">Recovered: {session.audio_metrics.recoveries}</div>}
                      {session.audio_metrics.skipped > 0 && <div className="text-muted-foreground">Skipped: {session.audio_metrics.skipped}</div>}
                    </div>
                  </div>
                )}

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
