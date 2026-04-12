/**
 * SimulationMode
 *
 * Multi-turn conversation simulation for Friday sessions.
 * Manages the 3-turn arc: buyer prompt → rep response → score → next turn → arc score.
 * Persists state locally for resilience.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Send, Loader2, Layers, ChevronRight, Zap, Target,
  AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import type { SimulationArc, SimulationTurnTemplate } from '@/lib/dojo/v5/simulationArcs';
import { getBuyerMessage } from '@/lib/dojo/v5/simulationArcs';
import { computeArcScore, toArcTurnResult, type ArcScore, type ArcTurnResult } from '@/lib/dojo/v5/arcScoring';
import { normalizeScoreResult, type DojoScoreResult } from '@/lib/dojo/types';
import { SKILL_LABELS, MISTAKE_LABELS } from '@/lib/dojo/scenarios';
import { FOCUS_PATTERN_LABELS } from '@/lib/dojo/focusPatterns';
import { ConversationFlowCard } from './ConversationFlowCard';
import type { Json } from '@/integrations/supabase/types';
import { completeAssignment } from '@/lib/dojo/v3/assignmentManager';

// ── Local persistence ─────────────────────────────────────────────

const SIM_STATE_KEY = 'qc_simulation_state';

interface SimulationRunState {
  arcId: string;
  currentTurnIndex: number;
  turns: {
    buyerMessage: string;
    repResponse?: string;
    score?: number;
    topMistake?: string;
    feedback?: string;
    scoreResult?: DojoScoreResult;
  }[];
  completed: boolean;
  sessionId: string | null;
  savedAt: number;
}

function saveSimState(state: SimulationRunState): void {
  try {
    localStorage.setItem(SIM_STATE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch { /* noop */ }
}

function loadSimState(arcId: string): SimulationRunState | null {
  try {
    const raw = localStorage.getItem(SIM_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SimulationRunState;
    if (parsed.arcId !== arcId) return null;
    if (Date.now() - parsed.savedAt > 2 * 60 * 60 * 1000) {
      clearSimState();
      return null;
    }
    return parsed;
  } catch {
    clearSimState();
    return null;
  }
}

function clearSimState(): void {
  try { localStorage.removeItem(SIM_STATE_KEY); } catch { /* noop */ }
}

// ── Types ─────────────────────────────────────────────────────────

type SimPhase = 'brief' | 'turn_active' | 'turn_scoring' | 'next_turn' | 'final_scoring' | 'feedback';

interface SimulationModeProps {
  arc: SimulationArc;
  userId: string;
  assignmentId: string | null;
  benchmarkTag: boolean;
  scenarioFamilyId: string | null;
  pressureLevel: string | null;
  pressureDimensions: string[] | null;
  assignmentFocusPattern?: string | null;
  onComplete: () => void;
}

function scoreToJson(score: DojoScoreResult): Json {
  return JSON.parse(JSON.stringify(score)) as Json;
}

// ── Component ─────────────────────────────────────────────────────

export default function SimulationMode({
  arc, userId, assignmentId, benchmarkTag, scenarioFamilyId,
  pressureLevel, pressureDimensions, assignmentFocusPattern, onComplete,
}: SimulationModeProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Try to resume from local state
  const [runState, setRunState] = useState<SimulationRunState>(() => {
    const saved = loadSimState(arc.id);
    if (saved && !saved.completed) return saved;
    return {
      arcId: arc.id,
      currentTurnIndex: 0,
      turns: [],
      completed: false,
      sessionId: null,
      savedAt: Date.now(),
    };
  });

  const [phase, setPhase] = useState<SimPhase>(
    runState.turns.length > 0 && !runState.completed ? 'turn_active' : 'brief'
  );
  const [response, setResponse] = useState('');
  const [arcScore, setArcScore] = useState<ArcScore | null>(null);

  const currentTurn = arc.turns[runState.currentTurnIndex];
  const priorScore = runState.currentTurnIndex > 0
    ? runState.turns[runState.currentTurnIndex - 1]?.score
    : undefined;

  useEffect(() => {
    if (phase === 'turn_active') {
      setTimeout(() => textareaRef.current?.focus(), 300);
    }
  }, [phase]);

  // Persist state on changes
  useEffect(() => {
    saveSimState(runState);
  }, [runState]);

  const startSimulation = useCallback(() => {
    setPhase('turn_active');
  }, []);

  const handleSubmitTurn = useCallback(async () => {
    if (!response.trim() || !currentTurn) return;
    setPhase('turn_scoring');

    try {
      // Score this turn using existing dojo-score function
      const { data, error } = await supabase.functions.invoke('dojo-score', {
        body: {
          scenario: {
            skillFocus: currentTurn.testsSkills[0],
            context: arc.setup,
            objection: getBuyerMessage(currentTurn, priorScore),
          },
          userResponse: response.trim(),
          retryCount: 0,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const scoreResult = normalizeScoreResult(data as Record<string, unknown>);

      // Update run state with this turn's result
      const updatedTurns = [...runState.turns];
      updatedTurns[runState.currentTurnIndex] = {
        buyerMessage: getBuyerMessage(currentTurn, priorScore),
        repResponse: response.trim(),
        score: scoreResult.score,
        topMistake: scoreResult.topMistake,
        feedback: scoreResult.feedback,
        scoreResult,
      };

      // Create DB session on first turn
      let sessionId = runState.sessionId;
      if (runState.currentTurnIndex === 0) {
        const { data: session } = await supabase
          .from('dojo_sessions')
          .insert({
            user_id: userId,
            mode: 'autopilot',
            session_type: 'simulation',
            skill_focus: arc.skillChain[0],
            scenario_title: arc.title,
            scenario_context: arc.setup,
            scenario_objection: currentTurn.buyerMessage,
            latest_score: scoreResult.score,
            best_score: scoreResult.score,
            status: 'in_progress',
            assignment_id: assignmentId,
            benchmark_tag: benchmarkTag,
            scenario_family_id: scenarioFamilyId,
            pressure_level: pressureLevel,
            pressure_dimensions: pressureDimensions,
          })
          .select('id')
          .single();

        if (session) sessionId = session.id;
      }

      // Write turn to DB
      if (sessionId) {
        await supabase.from('dojo_session_turns').insert({
          session_id: sessionId,
          user_id: userId,
          turn_index: runState.currentTurnIndex,
          prompt_text: getBuyerMessage(currentTurn, priorScore),
          user_response: response.trim(),
          score: scoreResult.score,
          feedback: scoreResult.feedback,
          top_mistake: scoreResult.topMistake,
          improved_version: scoreResult.improvedVersion,
          score_json: scoreToJson(scoreResult),
        });
      }

      const newState: SimulationRunState = {
        ...runState,
        turns: updatedTurns,
        sessionId,
      };

      // Check if more turns
      const nextTurnIndex = runState.currentTurnIndex + 1;
      if (nextTurnIndex < arc.turns.length) {
        newState.currentTurnIndex = nextTurnIndex;
        setRunState(newState);
        setResponse('');
        setPhase('next_turn');
      } else {
        // Final — compute arc score
        newState.completed = true;
        setRunState(newState);

        const turnResults: ArcTurnResult[] = updatedTurns.map((t, i) =>
          toArcTurnResult(i, t.scoreResult ?? normalizeScoreResult({}))
        );
        const finalArcScore = computeArcScore(turnResults);
        setArcScore(finalArcScore);

        // Update session with final score
        if (sessionId) {
          const allScores = updatedTurns.map(t => t.score ?? 0);
          await supabase.from('dojo_sessions').update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            latest_score: finalArcScore.overallScore,
            best_score: Math.max(...allScores),
            retry_count: arc.turns.length - 1,
          }).eq('id', sessionId);

          // Complete assignment
          if (assignmentId) {
            const today = new Date().toISOString().split('T')[0];
            completeAssignment(userId, today, sessionId).catch(err =>
              console.error('[SimulationMode] completeAssignment failed:', err)
            );
          }
        }

        clearSimState();
        setPhase('feedback');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Scoring failed';
      console.error('[SimulationMode] score error:', e);
      toast.error(msg);
      setPhase('turn_active');
    }
  }, [response, currentTurn, arc, runState, userId, assignmentId, benchmarkTag, scenarioFamilyId, pressureLevel, pressureDimensions, priorScore]);

  const proceedToNextTurn = useCallback(() => {
    setPhase('turn_active');
  }, []);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        {/* ── Brief ── */}
        {phase === 'brief' && (
          <motion.div key="brief" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  <p className="text-[10px] font-bold text-primary uppercase tracking-wider">
                    Simulation
                  </p>
                </div>
                <p className="text-sm font-semibold text-foreground">{arc.title}</p>
                <div className="flex flex-wrap gap-1">
                  {arc.skillChain.map(s => (
                    <Badge key={s} variant="outline" className="text-[9px]">
                      {SKILL_LABELS[s]}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{arc.setup}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{arc.turns.length} turns</span>
                  <span>·</span>
                  <span>~{arc.turns.length * 3 + 2} min</span>
                </div>
                {pressureLevel && pressureLevel !== 'none' && (
                  <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-600 border-amber-500/20">
                    <Zap className="h-2.5 w-2.5 mr-0.5" />
                    Pressure: {pressureLevel}
                  </Badge>
                )}
              </CardContent>
            </Card>
            <Button className="w-full gap-2" onClick={startSimulation}>
              <Layers className="h-4 w-4" /> Begin Simulation
            </Button>
          </motion.div>
        )}

        {/* ── Turn Active ── */}
        {phase === 'turn_active' && currentTurn && (
          <motion.div key={`turn-${runState.currentTurnIndex}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
            {/* Turn header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  Turn {runState.currentTurnIndex + 1} of {arc.turns.length}
                </Badge>
                <Badge variant="outline" className="text-[9px] capitalize">
                  {currentTurn.buyerMoveType.replace(/_/g, ' ')}
                </Badge>
              </div>
              <div className="flex gap-1">
                {currentTurn.testsSkills.map(s => (
                  <Badge key={s} variant="outline" className="text-[9px]">{SKILL_LABELS[s]}</Badge>
                ))}
              </div>
            </div>

            {/* Buyer message */}
            <Card className="border-border/60">
              <CardContent className="p-4">
                <div className="border-l-2 border-primary/40 pl-3">
                  <p className="text-sm font-medium italic text-foreground">
                    "{getBuyerMessage(currentTurn, priorScore)}"
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Rep response */}
            <Textarea
              ref={textareaRef}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="Your response..."
              className="min-h-[120px] text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmitTurn(); }}
            />
            <Button className="w-full gap-2" disabled={!response.trim()} onClick={handleSubmitTurn}>
              <Send className="h-4 w-4" /> Submit Turn {runState.currentTurnIndex + 1}
            </Button>
          </motion.div>
        )}

        {/* ── Scoring ── */}
        {phase === 'turn_scoring' && (
          <motion.div key="scoring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Scoring Turn {runState.currentTurnIndex + 1}...
            </p>
          </motion.div>
        )}

        {/* ── Next Turn Transition ── */}
        {phase === 'next_turn' && (
          <motion.div key="next" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Show last turn result */}
            {(() => {
              const lastTurn = runState.turns[runState.currentTurnIndex - 1];
              if (!lastTurn) return null;
              return (
                <Card className="border-border/60">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Turn {runState.currentTurnIndex} Score</span>
                      <span className={cn(
                        'text-lg font-bold',
                        (lastTurn.score ?? 0) >= 75 ? 'text-green-500' :
                        (lastTurn.score ?? 0) >= 60 ? 'text-amber-500' : 'text-red-500'
                      )}>
                        {lastTurn.score}
                      </span>
                    </div>
                    {lastTurn.feedback && (
                      <p className="text-xs text-muted-foreground">{lastTurn.feedback}</p>
                    )}
                    {lastTurn.topMistake && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <AlertTriangle className="h-3 w-3 text-orange-500" />
                        <span className="text-muted-foreground">
                          {MISTAKE_LABELS[lastTurn.topMistake] || lastTurn.topMistake.replace(/_/g, ' ')}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
            <Button className="w-full gap-2" onClick={proceedToNextTurn}>
              <ChevronRight className="h-4 w-4" /> Next Turn
            </Button>
          </motion.div>
        )}

        {/* ── Final Scoring ── */}
        {phase === 'final_scoring' && (
          <motion.div key="final-scoring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Computing conversation score...</p>
          </motion.div>
        )}

        {/* ── Feedback ── */}
        {phase === 'feedback' && arcScore && (
          <motion.div key="feedback" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <ConversationFlowCard
              arc={arc}
              turnResults={runState.turns.map((t, i) =>
                toArcTurnResult(i, t.scoreResult ?? normalizeScoreResult({}))
              )}
              arcScore={arcScore}
              assignmentFocusPattern={assignmentFocusPattern}
            />

            {/* What to focus next */}
            <Card className="border-border/60">
              <CardContent className="p-4 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {arcScore.overallScore >= 70 ? 'What Worked' : 'What to Sharpen'}
                </p>
                {arcScore.controlHeld ? (
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                    <span className="text-muted-foreground">You maintained control across the conversation.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs">
                    <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                    <span className="text-muted-foreground">Practice holding form when the buyer shifts pressure late.</span>
                  </div>
                )}
                {arcScore.closingScore < 60 && (
                  <div className="flex items-center gap-2 text-xs">
                    <Target className="h-3 w-3 text-amber-500 shrink-0" />
                    <span className="text-muted-foreground">Your close needs more commitment language. Drive to a specific next step.</span>
                  </div>
                )}
                {arcScore.overallScore >= 70 && arcScore.closingScore >= 60 && (
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                    <span className="text-muted-foreground">Solid execution — keep drilling consistency under new pressure types.</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Button variant="ghost" className="w-full gap-2 text-muted-foreground" onClick={onComplete}>
              Back to Dojo <ChevronRight className="h-4 w-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
