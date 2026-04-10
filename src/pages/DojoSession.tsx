import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Send, RotateCcw, Loader2, Target, AlertTriangle,
  CheckCircle2, Lightbulb, Swords, ChevronRight,
} from 'lucide-react';
import { getRandomScenario, SKILL_LABELS, MISTAKE_LABELS, type DojoScenario, type SkillFocus } from '@/lib/dojo/scenarios';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

type Phase = 'respond' | 'scoring' | 'feedback' | 'retry';

interface ScoreResult {
  score: number;
  feedback: string;
  topMistake: string;
  improvedVersion: string;
}

export default function DojoSession() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const state = location.state as { scenario?: DojoScenario; skillFocus?: SkillFocus; mode?: string } | null;
  const [scenario] = useState<DojoScenario>(() => {
    if (state?.scenario) return state.scenario;
    return getRandomScenario(state?.skillFocus);
  });

  const [phase, setPhase] = useState<Phase>('respond');
  const [response, setResponse] = useState('');
  const [retryResponse, setRetryResponse] = useState('');
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [retryResult, setRetryResult] = useState<ScoreResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [firstTurnId, setFirstTurnId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Auto-focus textarea
  useEffect(() => {
    if (phase === 'respond' || phase === 'retry') {
      setTimeout(() => textareaRef.current?.focus(), 300);
    }
  }, [phase]);

  const scoreResponse = useCallback(async (text: string, isRetry: boolean) => {
    setPhase('scoring');

    try {
      const { data, error } = await supabase.functions.invoke('dojo-score', {
        body: {
          scenario: {
            skillFocus: scenario.skillFocus,
            context: scenario.context,
            objection: scenario.objection,
          },
          userResponse: text,
          retryCount: isRetry ? retryCount + 1 : 0,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const scoreData = data as ScoreResult;

      // Save to DB
      if (user) {
        if (!isRetry) {
          // Create session
          const { data: session, error: sessionErr } = await supabase
            .from('dojo_sessions')
            .insert({
              user_id: user.id,
              mode: (state?.mode as 'autopilot' | 'custom') || 'autopilot',
              session_type: 'drill',
              skill_focus: scenario.skillFocus,
              scenario_title: scenario.title,
              scenario_context: scenario.context,
              scenario_objection: scenario.objection,
              best_score: scoreData.score,
              latest_score: scoreData.score,
              status: 'completed',
              completed_at: new Date().toISOString(),
            })
            .select('id')
            .single();

          if (!sessionErr && session) {
            setSessionId(session.id);
            // Save turn
            const { data: turn } = await supabase
              .from('dojo_session_turns')
              .insert({
                session_id: session.id,
                user_id: user.id,
                turn_index: 0,
                prompt_text: scenario.objection,
                user_response: text,
                score: scoreData.score,
                feedback: scoreData.feedback,
                top_mistake: scoreData.topMistake,
                improved_version: scoreData.improvedVersion,
                score_json: scoreData as any,
              })
              .select('id')
              .single();

            if (turn) setFirstTurnId(turn.id);
          }

          setResult(scoreData);
        } else {
          // Retry — update session + save new turn
          const newRetryCount = retryCount + 1;
          setRetryCount(newRetryCount);

          if (sessionId) {
            const bestScore = Math.max(result?.score ?? 0, scoreData.score);
            await supabase
              .from('dojo_sessions')
              .update({
                best_score: bestScore,
                latest_score: scoreData.score,
                retry_count: newRetryCount,
              })
              .eq('id', sessionId);

            await supabase
              .from('dojo_session_turns')
              .insert({
                session_id: sessionId,
                user_id: user.id,
                turn_index: newRetryCount,
                prompt_text: scenario.objection,
                user_response: text,
                score: scoreData.score,
                feedback: scoreData.feedback,
                top_mistake: scoreData.topMistake,
                improved_version: scoreData.improvedVersion,
                score_json: scoreData as any,
                retry_of_turn_id: firstTurnId,
              });
          }

          setRetryResult(scoreData);
        }
      }

      setPhase('feedback');
    } catch (e: any) {
      console.error('Score error:', e);
      toast.error(e.message || 'Failed to score response');
      setPhase(isRetry ? 'retry' : 'respond');
    }
  }, [scenario, user, sessionId, firstTurnId, retryCount, result, state?.mode]);

  const handleSubmit = () => {
    if (!response.trim()) return;
    scoreResponse(response.trim(), false);
  };

  const handleRetrySubmit = () => {
    if (!retryResponse.trim()) return;
    scoreResponse(retryResponse.trim(), true);
  };

  const handleStartRetry = () => {
    setRetryResponse('');
    setRetryResult(null);
    setPhase('retry');
  };

  const handleNextRep = () => {
    navigate('/dojo');
  };

  const currentResult = retryResult || result;
  const scoreDelta = retryResult && result ? retryResult.score - result.score : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ── */}
      <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur-sm px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/dojo')} className="p-1 -ml-1">
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{scenario.title}</p>
          <p className="text-xs text-muted-foreground">{SKILL_LABELS[scenario.skillFocus]} · Drill</p>
        </div>
        <Badge variant="outline" className="text-xs shrink-0">5 min</Badge>
      </div>

      {/* ── Content ── */}
      <div className={cn('flex-1 px-4 py-4 space-y-4', SHELL.main.bottomPad)}>
        {/* Scenario context */}
        <Card className="border-border/60">
          <CardContent className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground">{scenario.context}</p>
            <div className="border-l-2 border-primary/40 pl-3">
              <p className="text-sm font-medium italic text-foreground">
                "{scenario.objection}"
              </p>
            </div>
          </CardContent>
        </Card>

        <AnimatePresence mode="wait">
          {/* ── Phase: Respond ── */}
          {phase === 'respond' && (
            <motion.div
              key="respond"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3"
            >
              <p className="text-sm text-muted-foreground font-medium">Your response:</p>
              <Textarea
                ref={textareaRef}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                placeholder="Type your response to the buyer..."
                className="min-h-[120px] text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
                }}
              />
              <Button
                className="w-full gap-2"
                disabled={!response.trim()}
                onClick={handleSubmit}
              >
                <Send className="h-4 w-4" />
                Submit Response
              </Button>
            </motion.div>
          )}

          {/* ── Phase: Scoring ── */}
          {phase === 'scoring' && (
            <motion.div
              key="scoring"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-12 gap-3"
            >
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Dave is reviewing your response...</p>
            </motion.div>
          )}

          {/* ── Phase: Feedback ── */}
          {phase === 'feedback' && currentResult && (
            <motion.div
              key="feedback"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              {/* Score */}
              <div className="flex items-center gap-4">
                <div className={cn(
                  'text-4xl font-bold',
                  currentResult.score >= 80 ? 'text-green-500' :
                  currentResult.score >= 65 ? 'text-yellow-500' :
                  currentResult.score >= 50 ? 'text-orange-500' : 'text-red-500'
                )}>
                  {currentResult.score}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {currentResult.score >= 80 ? 'Strong' :
                       currentResult.score >= 65 ? 'Solid' :
                       currentResult.score >= 50 ? 'Average' : 'Needs Work'}
                    </span>
                    {scoreDelta !== null && (
                      <Badge
                        variant={scoreDelta > 0 ? 'default' : 'destructive'}
                        className="text-xs"
                      >
                        {scoreDelta > 0 ? '+' : ''}{scoreDelta} pts
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {retryResult ? `Retry #${retryCount}` : 'First attempt'}
                  </p>
                </div>
              </div>

              {/* Feedback */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <Swords className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <p className="text-sm text-foreground leading-relaxed">{currentResult.feedback}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Top mistake */}
              <div className="flex items-center gap-2 px-1">
                <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                <p className="text-sm">
                  <span className="text-muted-foreground">Main issue: </span>
                  <span className="font-medium">{MISTAKE_LABELS[currentResult.topMistake] || currentResult.topMistake}</span>
                </p>
              </div>

              {/* Improved version */}
              <Card className="border-green-500/20 bg-green-500/5">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-green-500" />
                    <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">
                      Stronger Answer
                    </p>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed italic">
                    "{currentResult.improvedVersion}"
                  </p>
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={handleStartRetry}
                >
                  <RotateCcw className="h-4 w-4" />
                  Try Again
                </Button>
                <Button
                  className="flex-1 gap-2"
                  onClick={handleNextRep}
                >
                  Next Rep
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Phase: Retry ── */}
          {phase === 'retry' && (
            <motion.div
              key="retry"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3"
            >
              {/* Previous feedback reminder */}
              <div className="flex items-start gap-2 px-1">
                <Swords className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  {currentResult?.feedback}
                </p>
              </div>

              <p className="text-sm text-muted-foreground font-medium">Try again:</p>
              <Textarea
                ref={textareaRef}
                value={retryResponse}
                onChange={(e) => setRetryResponse(e.target.value)}
                placeholder="Give it another shot..."
                className="min-h-[120px] text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRetrySubmit();
                }}
              />
              <Button
                className="w-full gap-2"
                disabled={!retryResponse.trim()}
                onClick={handleRetrySubmit}
              >
                <Send className="h-4 w-4" />
                Submit Retry
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
