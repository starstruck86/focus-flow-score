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
  CheckCircle2, Lightbulb, Swords, ChevronRight, Crown, Sparkles,
  Crosshair, ListOrdered, MessageCircle, GraduationCap,
  TrendingUp, TrendingDown, Minus, Zap, Shield, XCircle,
  Eye, PenLine, Volume2, VolumeX,
} from 'lucide-react';
import { getRandomScenario, SKILL_LABELS, MISTAKE_LABELS, type DojoScenario, type SkillFocus } from '@/lib/dojo/scenarios';
import { DAY_ANCHORS, type DayAnchor } from '@/lib/dojo/v3/dayAnchors';
import {
  type DojoScoreResult,
  normalizeScoreResult,
  deriveRetryAssessment,
  RETRY_OUTCOME_LABELS,
  RETRY_OUTCOME_COLORS,
  type RetryAssessment,
} from '@/lib/dojo/types';
import { supabase } from '@/integrations/supabase/client';
import { completeAssignment } from '@/lib/dojo/v3/assignmentManager';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import DojoRoleplay from '@/components/dojo/DojoRoleplay';
import DojoReview, { type ReviewScoreResult } from '@/components/dojo/DojoReview';
import DaveCoachingDelivery from '@/components/dojo/DaveCoachingDelivery';
import AudioSessionMode from '@/components/dojo/AudioSessionMode';
import { SessionFeedbackCard } from '@/components/dojo/SessionFeedbackCard';
import { SaveIndicator } from '@/components/SaveIndicator';
import type { Json } from '@/integrations/supabase/types';
import { useAudioPreference } from '@/hooks/useAudioPreference';
import { ImprovementVerdictCard } from '@/components/dojo/ImprovementVerdictCard';
import { ThreeStageComparison } from '@/components/dojo/ThreeStageComparison';
import { assessImprovement } from '@/lib/dojo/improvementAssessment';
import { useScoreOriginalResponse } from '@/hooks/useScoreOriginalResponse';
import { PressureAnalysisCard } from '@/components/dojo/PressureAnalysisCard';
import { TransferProgressCard } from '@/components/dojo/TransferProgressCard';
import type { TranscriptOrigin } from '@/hooks/useExtractScenarios';

type Phase = 'respond' | 'scoring' | 'feedback' | 'retry';

import { FOCUS_PATTERN_LABELS, formatFocusPattern } from '@/lib/dojo/focusPatterns';

const PATTERN_TAG_LABELS: Record<string, string> = {
  isolates_real_issue: 'Isolates real issue',
  reframes_to_business_impact: 'Reframes to business impact',
  quantifies_pain: 'Quantifies pain',
  tests_urgency: 'Tests urgency',
  maps_stakeholders: 'Maps stakeholders',
  controls_next_step: 'Controls next step',
  locks_mutual_plan: 'Locks mutual plan',
  disqualifies_weak_opportunity: 'Disqualifies weak opp',
  stays_concise_under_pressure: 'Stays concise',
  names_the_risk: 'Names risk',
  uses_specific_proof: 'Uses proof',
  projects_certainty: 'Projects certainty',
  deepens_pain: 'Deepens pain',
  creates_mutual_accountability: 'Mutual accountability',
  validates_before_advancing: 'Validates first',
  leads_with_outcome: 'Leads with outcome',
};

/** Safely cast DojoScoreResult to Json for DB storage */
function scoreToJson(score: DojoScoreResult): Json {
  return JSON.parse(JSON.stringify(score)) as Json;
}

/** Extended review extras now include accuracy/fixed fields */
interface ReviewExtras {
  diagnosisScore?: number;
  rewriteScore?: number;
  diagnosisFeedback?: string;
  rewriteFeedback?: string;
  diagnosisAccuracy?: string;
  rewriteFixedIssue?: boolean;
}

/** Roleplay extras from the edge function */
interface RoleplayExtras {
  turnAnalysis?: Array<{ turn: number; assessment: string; verdict: string }>;
  controlArc?: string;
  adaptationNote?: string;
}

export default function DojoSession() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isAudio, toggleMode } = useAudioPreference();

  const state = location.state as { scenario?: DojoScenario; skillFocus?: SkillFocus; mode?: string; sessionType?: string; transcriptOrigin?: TranscriptOrigin; assignmentId?: string; benchmarkTag?: boolean; scenarioFamilyId?: string | null; assignmentReason?: string; assignmentAnchor?: string; assignmentFocusPattern?: string; fromLearn?: boolean; pressureLevel?: string; pressureDimensions?: string[] } | null;
  const transcriptOrigin = state?.transcriptOrigin ?? null;
  const sessionType = state?.sessionType || (isAudio ? 'audio' : 'drill');
  const assignmentId = state?.assignmentId ?? null;
  const benchmarkTag = state?.benchmarkTag ?? false;
  const scenarioFamilyId = state?.scenarioFamilyId ?? null;
  const pressureLevel = state?.pressureLevel ?? null;
  const pressureDimensions = state?.pressureDimensions ?? null;
  const [scenario] = useState<DojoScenario>(() => {
    if (state?.scenario) return state.scenario;
    return getRandomScenario(state?.skillFocus);
  });

  const [phase, setPhase] = useState<Phase>('respond');
  const [response, setResponse] = useState('');
  const [retryResponse, setRetryResponse] = useState('');
  const [result, setResult] = useState<DojoScoreResult | null>(null);
  const [retryResult, setRetryResult] = useState<DojoScoreResult | null>(null);
  const [retryAssessment, setRetryAssessment] = useState<RetryAssessment | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [firstTurnId, setFirstTurnId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [reviewExtras, setReviewExtras] = useState<ReviewExtras | null>(null);
  const [roleplayExtras, setRoleplayExtras] = useState<RoleplayExtras | null>(null);
  const { scoreOriginal, isScoring: isScoringOriginal, originalScore } = useScoreOriginalResponse();

  // Auto-score original call response when transcript origin has a rep response
  useEffect(() => {
    if (transcriptOrigin?.repResponse && transcriptOrigin.repResponse.length >= 10) {
      scoreOriginal(
        { skillFocus: scenario.skillFocus, context: scenario.context, objection: scenario.objection },
        transcriptOrigin.repResponse
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === 'respond' || phase === 'retry') {
      setTimeout(() => textareaRef.current?.focus(), 300);
    }
  }, [phase]);

  const scoreResponse = useCallback(async (text: string, isRetry: boolean) => {
    setPhase('scoring');

    try {
      const currentFocus = isRetry ? (retryResult?.focusPattern || result?.focusPattern) : undefined;

      const { data, error } = await supabase.functions.invoke('dojo-score', {
        body: {
          scenario: {
            skillFocus: scenario.skillFocus,
            context: scenario.context,
            objection: scenario.objection,
          },
          userResponse: text,
          retryCount: isRetry ? retryCount + 1 : 0,
          focusReminder: currentFocus,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const scoreData = normalizeScoreResult(data as Record<string, unknown>);

      if (user) {
        if (!isRetry) {
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
              assignment_id: assignmentId,
              benchmark_tag: benchmarkTag,
              scenario_family_id: scenarioFamilyId,
              pressure_level: pressureLevel,
              pressure_dimensions: pressureDimensions,
            })
            .select('id')
            .single();

          if (!sessionErr && session) {
            setSessionId(session.id);
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
                score_json: scoreToJson(scoreData),
              })
              .select('id')
              .single();

            if (turn) setFirstTurnId(turn.id);

            // V3: Complete assignment — links session and triggers snapshot/week advancement
            if (assignmentId) {
              const today = new Date().toISOString().split('T')[0];
              completeAssignment(user.id, today, session.id).catch(err =>
                console.error('[DojoSession] completeAssignment failed:', err)
              );
            }
          }

          setResult(scoreData);
        } else {
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
                score_json: scoreToJson(scoreData),
                retry_of_turn_id: firstTurnId,
              });
          }

          setRetryResult(scoreData);

          if (result) {
            setRetryAssessment(deriveRetryAssessment(result, scoreData));
          }
        }
      }

      setPhase('feedback');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to score response';
      console.error('Score error:', e);
      toast.error(msg);
      setPhase(isRetry ? 'retry' : 'respond');
    }
  }, [scenario, user, sessionId, firstTurnId, retryCount, result, retryResult, state?.mode]);

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
    setRetryAssessment(null);
    setPhase('retry');
  };

  const handleNextRep = () => {
    navigate('/dojo');
  };

  // Handle roleplay completion — extract roleplay-specific extras
  const handleRoleplayComplete = useCallback((scoreResult: DojoScoreResult) => {
    const raw = scoreResult as unknown as Record<string, unknown>;
    setRoleplayExtras({
      turnAnalysis: Array.isArray(raw.turnAnalysis) ? raw.turnAnalysis as RoleplayExtras['turnAnalysis'] : undefined,
      controlArc: typeof raw.controlArc === 'string' ? raw.controlArc : undefined,
      adaptationNote: typeof raw.adaptationNote === 'string' ? raw.adaptationNote : undefined,
    });
    setResult(scoreResult);
    setPhase('feedback');
  }, []);

  // Handle review completion
  const handleReviewComplete = useCallback((reviewResult: ReviewScoreResult) => {
    const { diagnosisScore, rewriteScore, diagnosisFeedback, rewriteFeedback, ...baseResult } = reviewResult;
    setResult(baseResult);
    const raw = reviewResult as unknown as Record<string, unknown>;
    setReviewExtras({
      diagnosisScore,
      rewriteScore,
      diagnosisFeedback,
      rewriteFeedback,
      diagnosisAccuracy: typeof raw.diagnosisAccuracy === 'string' ? raw.diagnosisAccuracy : undefined,
      rewriteFixedIssue: typeof raw.rewriteFixedIssue === 'boolean' ? raw.rewriteFixedIssue : undefined,
    });
    setPhase('feedback');
  }, []);

  const currentResult = retryResult || result;
  const scoreDelta = retryResult && result ? retryResult.score - result.score : null;
  const userText = retryResult ? retryResponse : response;
  const activeFocus = currentResult?.focusPattern;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ── */}
      <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur-sm px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/dojo')} className="p-1 -ml-1">
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{scenario.title}</p>
          <p className="text-xs text-muted-foreground">{SKILL_LABELS[scenario.skillFocus]} · {sessionType === 'audio' ? 'Audio Session' : sessionType === 'roleplay' ? 'Roleplay' : sessionType === 'review' ? 'Review' : 'Drill'}</p>
        </div>
        <button onClick={toggleMode} className="p-1.5 rounded-md hover:bg-accent/50 transition-colors" title={isAudio ? 'Switch to text mode' : 'Switch to audio mode'}>
          {isAudio ? <Volume2 className="h-4 w-4 text-primary" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
        </button>
        <Badge variant="outline" className="text-xs shrink-0">5 min</Badge>
        <SaveIndicator />
      </div>

      {/* ── Content ── */}
      <div className={cn('flex-1 px-4 py-4 space-y-4', SHELL.main.bottomPad)}>
        {/* Assignment context — why today */}
        {state?.assignmentReason && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-3 space-y-1">
              <div className="flex items-center gap-2">
                <Crosshair className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">
                  {state.assignmentAnchor ? `${DAY_ANCHORS[state.assignmentAnchor as DayAnchor]?.label ?? state.assignmentAnchor}` : 'Today\'s Focus'}
                  {state.assignmentFocusPattern ? ` · ${FOCUS_PATTERN_LABELS[state.assignmentFocusPattern] || state.assignmentFocusPattern.replace(/_/g, ' ')}` : ''}
                </span>
              </div>
              <p className="text-xs text-muted-foreground pl-5.5">{state.assignmentReason}</p>
            </CardContent>
          </Card>
        )}

        {/* Pre-session pressure brief */}
        {pressureLevel && pressureLevel !== 'none' && phase === 'respond' && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Pressure Rep
                </span>
                <Badge variant="outline" className="text-[9px] capitalize ml-auto">
                  {pressureLevel}
                </Badge>
              </div>
              {pressureDimensions && pressureDimensions.filter(d => d !== 'none').length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                  {pressureDimensions.filter(d => d !== 'none').map(d => {
                    const labels: Record<string, string> = {
                      time_pressure: 'You have less time than you want. Prioritize.',
                      hostile_persona: 'The buyer is tense. Stay controlled.',
                      ambiguity: "You won't get perfect clarity here. Create it.",
                      multi_stakeholder_tension: 'Multiple agendas in the room. Find alignment.',
                      executive_scrutiny: 'Executive eyes on this. Be precise.',
                    };
                    return labels[d] || d.replace(/_/g, ' ');
                  })[0]}
                </p>
              )}
            </CardContent>
          </Card>
        )}

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

        {/* ── Audio Session Mode ── */}
        {sessionType === 'audio' && user && (
          <AudioSessionMode
            scenario={scenario}
            userId={user.id}
            mode={state?.mode}
            onComplete={handleNextRep}
            assignmentId={assignmentId}
            benchmarkTag={benchmarkTag}
            scenarioFamilyId={scenarioFamilyId}
          />
        )}

        {/* ── Roleplay Mode ── */}
        {sessionType === 'roleplay' && phase !== 'feedback' && !currentResult && user && (
          <DojoRoleplay
            scenario={scenario}
            userId={user.id}
            onComplete={handleRoleplayComplete}
            assignmentId={assignmentId}
            benchmarkTag={benchmarkTag}
            scenarioFamilyId={scenarioFamilyId}
          />
        )}

        {/* ── Review Mode ── */}
        {sessionType === 'review' && phase !== 'feedback' && !currentResult && user && (
          <DojoReview
            scenario={scenario}
            userId={user.id}
            onComplete={handleReviewComplete}
            assignmentId={assignmentId}
            benchmarkTag={benchmarkTag}
            scenarioFamilyId={scenarioFamilyId}
          />
        )}

        {/* ── Drill Mode ── */}
        {sessionType === 'drill' && (
        <AnimatePresence mode="wait">
          {phase === 'respond' && (
            <motion.div key="respond" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-3">
              <p className="text-sm text-muted-foreground font-medium">Your response:</p>
              <Textarea ref={textareaRef} value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Type your response to the buyer..." className="min-h-[120px] text-sm" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }} />
              <Button className="w-full gap-2" disabled={!response.trim()} onClick={handleSubmit}><Send className="h-4 w-4" />Submit Response</Button>
            </motion.div>
          )}

          {phase === 'scoring' && (
            <motion.div key="scoring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Dave is reviewing your response...</p>
            </motion.div>
          )}

          {phase === 'feedback' && currentResult && (
            <motion.div key="feedback" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
             <FeedbackView currentResult={currentResult} scoreDelta={scoreDelta} retryCount={retryCount} retryResult={retryResult} retryAssessment={retryAssessment} userText={userText} activeFocus={activeFocus} reviewExtras={reviewExtras} roleplayExtras={roleplayExtras} sessionType={sessionType} sessionId={sessionId} skillFocus={scenario.skillFocus} transcriptOrigin={transcriptOrigin} originalCallScore={originalScore} firstAttemptResult={result} assignmentContext={state?.assignmentReason ? { anchor: state.assignmentAnchor!, focusPattern: state.assignmentFocusPattern!, reason: state.assignmentReason } : null} pressureLevel={pressureLevel} pressureDimensions={pressureDimensions} onRetry={handleStartRetry} onNextRep={handleNextRep} />
            </motion.div>
          )}

          {phase === 'retry' && (
            <motion.div key="retry" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-3">
              {activeFocus && (
                <Card className="border-amber-500/30 bg-amber-500/5">
                  <CardContent className="p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Crosshair className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <p className="text-sm"><span className="text-muted-foreground">Focus on: </span><span className="font-semibold text-foreground">{FOCUS_PATTERN_LABELS[activeFocus] || activeFocus.replace(/_/g, ' ')}</span></p>
                    </div>
                    {currentResult?.practiceCue && (
                      <div className="flex items-start gap-1.5 pl-6">
                        <MessageCircle className="h-3 w-3 text-amber-500/70 mt-0.5 shrink-0" />
                        <p className="text-xs font-medium text-foreground">{currentResult.practiceCue}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              <div className="flex items-start gap-2 px-1">
                <Swords className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <p className="text-sm text-foreground leading-relaxed">{currentResult?.feedback}</p>
              </div>
              <p className="text-sm text-muted-foreground font-medium">Try again:</p>
              <Textarea ref={textareaRef} value={retryResponse} onChange={(e) => setRetryResponse(e.target.value)} placeholder="Give it another shot..." className="min-h-[120px] text-sm" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRetrySubmit(); }} />
              <Button className="w-full gap-2" disabled={!retryResponse.trim()} onClick={handleRetrySubmit}><Send className="h-4 w-4" />Submit Retry</Button>
            </motion.div>
          )}
        </AnimatePresence>
        )}

        {/* ── Feedback for Roleplay / Review (non-drill) ── */}
        {sessionType !== 'drill' && phase === 'feedback' && currentResult && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <FeedbackView currentResult={currentResult} scoreDelta={null} retryCount={0} retryResult={null} retryAssessment={null} userText="" activeFocus={activeFocus} reviewExtras={reviewExtras} roleplayExtras={roleplayExtras} sessionType={sessionType} sessionId={sessionId} skillFocus={scenario.skillFocus} transcriptOrigin={transcriptOrigin} assignmentContext={state?.assignmentReason ? { anchor: state.assignmentAnchor!, focusPattern: state.assignmentFocusPattern!, reason: state.assignmentReason } : null} pressureLevel={pressureLevel} pressureDimensions={pressureDimensions} onRetry={handleStartRetry} onNextRep={handleNextRep} />
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ── Extracted Feedback View ──────────────────────────────────────────

interface FeedbackViewProps {
  currentResult: DojoScoreResult;
  scoreDelta: number | null;
  retryCount: number;
  retryResult: DojoScoreResult | null;
  retryAssessment: RetryAssessment | null;
  userText: string;
  activeFocus: string | undefined;
  reviewExtras: ReviewExtras | null;
  roleplayExtras: RoleplayExtras | null;
  sessionType: string;
  sessionId: string | null;
  skillFocus: SkillFocus;
  transcriptOrigin: TranscriptOrigin | null;
  originalCallScore?: DojoScoreResult | null;
  firstAttemptResult?: DojoScoreResult | null;
  assignmentContext?: { anchor: string; focusPattern: string; reason: string } | null;
  pressureLevel?: string | null;
  pressureDimensions?: string[] | null;
  onRetry: () => void;
  onNextRep: () => void;
}

function FeedbackView({
  currentResult, scoreDelta, retryCount, retryResult, retryAssessment,
  userText, activeFocus, reviewExtras, roleplayExtras, sessionType,
  sessionId, skillFocus, transcriptOrigin, originalCallScore, firstAttemptResult,
  assignmentContext, pressureLevel, pressureDimensions, onRetry, onNextRep,
}: FeedbackViewProps) {
  return (
    <>
      {/* Dave's Audio/Text Coaching Delivery */}
      {sessionId && (
        <DaveCoachingDelivery
          scoreResult={currentResult}
          sessionId={sessionId}
          enableVoice={true}
        />
      )}
      {/* Score */}
      <div className="flex items-center gap-4">
        <div className={cn(
          'text-4xl font-bold',
          currentResult.score >= 80 ? 'text-green-500' :
          currentResult.score >= 70 ? 'text-yellow-500' :
          currentResult.score >= 50 ? 'text-orange-500' : 'text-red-500'
        )}>
          {currentResult.score}
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {currentResult.score >= 80 ? 'Strong' :
               currentResult.score >= 70 ? 'Solid' :
               currentResult.score >= 50 ? 'Average' : 'Needs Work'}
            </span>
            {scoreDelta !== null && (
              <Badge variant={scoreDelta > 0 ? 'default' : 'destructive'} className="text-xs">
                {scoreDelta > 0 ? '+' : ''}{scoreDelta} pts
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {retryResult ? `Retry #${retryCount}` :
             sessionType === 'roleplay' ? 'Roleplay' :
             sessionType === 'review' ? 'Review' : 'First attempt'}
          </p>
        </div>
      </div>

      {/* ── V4 Pressure Analysis ── */}
      {pressureLevel && pressureLevel !== 'none' && (
        <PressureAnalysisCard
          pressureLevel={pressureLevel}
          pressureDimensions={pressureDimensions ?? []}
          sessionScore={currentResult.score}
          recentAvg={currentResult.score} // TODO: pass actual recent avg from skill memory
          topMistake={currentResult.topMistake}
          focusPattern={activeFocus}
          retryScore={retryResult?.score}
        />
      )}

      {/* ── V4 Transfer Progress (transcript-origin) ── */}
      {transcriptOrigin && originalCallScore && firstAttemptResult && (
        <TransferProgressCard
          originalScore={originalCallScore.score}
          practiceScore={firstAttemptResult.score}
          retryScore={retryResult?.score}
          originalMistake={originalCallScore.topMistake}
          practiceMistake={currentResult.topMistake}
        />
      )}

      {/* ── Review-specific: Diagnosis & Rewrite badges ── */}
      {reviewExtras && sessionType === 'review' && (
        <div className="space-y-3">
          {/* Score cards */}
          {(reviewExtras.diagnosisScore != null || reviewExtras.rewriteScore != null) && (
            <div className="grid grid-cols-2 gap-2">
              {reviewExtras.diagnosisScore != null && (
                <Card className="border-border/60">
                  <CardContent className="p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Diagnosis</p>
                    <p className="text-xl font-bold">{reviewExtras.diagnosisScore}<span className="text-xs text-muted-foreground font-normal">/50</span></p>
                  </CardContent>
                </Card>
              )}
              {reviewExtras.rewriteScore != null && (
                <Card className="border-border/60">
                  <CardContent className="p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Rewrite</p>
                    <p className="text-xl font-bold">{reviewExtras.rewriteScore}<span className="text-xs text-muted-foreground font-normal">/50</span></p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Accuracy + Fixed badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {reviewExtras.diagnosisAccuracy && (
              <Badge variant="outline" className={cn('text-xs font-semibold gap-1',
                reviewExtras.diagnosisAccuracy === 'correct' && 'border-green-500 text-green-600 dark:text-green-400',
                reviewExtras.diagnosisAccuracy === 'partial' && 'border-amber-500 text-amber-600 dark:text-amber-400',
                reviewExtras.diagnosisAccuracy === 'missed' && 'border-red-500 text-red-600 dark:text-red-400',
              )}>
                <Eye className="h-3 w-3" />
                {reviewExtras.diagnosisAccuracy === 'correct' ? 'Diagnosis Correct' :
                 reviewExtras.diagnosisAccuracy === 'partial' ? 'Partial Diagnosis' :
                 'Missed the Issue'}
              </Badge>
            )}
            {reviewExtras.rewriteFixedIssue != null && (
              <Badge variant="outline" className={cn('text-xs font-semibold gap-1',
                reviewExtras.rewriteFixedIssue
                  ? 'border-green-500 text-green-600 dark:text-green-400'
                  : 'border-red-500 text-red-600 dark:text-red-400',
              )}>
                <PenLine className="h-3 w-3" />
                {reviewExtras.rewriteFixedIssue ? 'Rewrite Fixed the Issue' : 'Rewrite Still Missed the Issue'}
              </Badge>
            )}
          </div>

          {/* Diagnosis feedback card */}
          {reviewExtras.diagnosisFeedback && (
            <Card className="border-border/40">
              <CardContent className="p-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Diagnosis Assessment</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{reviewExtras.diagnosisFeedback}</p>
              </CardContent>
            </Card>
          )}

          {/* Rewrite feedback card */}
          {reviewExtras.rewriteFeedback && (
            <Card className="border-border/40">
              <CardContent className="p-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <PenLine className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Rewrite Assessment</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{reviewExtras.rewriteFeedback}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Retry Outcome Summary ── */}
      {retryAssessment && retryResult && (
        <Card className="border-border/60">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {retryAssessment.retryOutcome === 'breakthrough' ? <TrendingUp className="h-4 w-4 text-green-500" /> :
                 retryAssessment.retryOutcome === 'improved' ? <TrendingUp className="h-4 w-4 text-blue-500" /> :
                 retryAssessment.retryOutcome === 'partial' ? <Minus className="h-4 w-4 text-amber-500" /> :
                 <TrendingDown className="h-4 w-4 text-red-500" />}
                <span className={cn('text-sm font-semibold', RETRY_OUTCOME_COLORS[retryAssessment.retryOutcome])}>
                  {RETRY_OUTCOME_LABELS[retryAssessment.retryOutcome]}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {retryAssessment.liveReady ? (
                  <Badge className="text-xs bg-green-600 hover:bg-green-600"><Shield className="h-3 w-3 mr-1" />Live Ready</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">Keep Drilling</Badge>
                )}
              </div>
            </div>
            {currentResult.focusApplied && (
              <div className="flex items-center gap-2.5">
                <Badge variant={currentResult.focusApplied === 'yes' ? 'default' : 'outline'} className={cn('text-xs font-semibold',
                  currentResult.focusApplied === 'yes' && 'bg-green-600 hover:bg-green-600',
                  currentResult.focusApplied === 'partial' && 'border-amber-500 text-amber-600 dark:text-amber-400',
                  currentResult.focusApplied === 'no' && 'border-red-500 text-red-600 dark:text-red-400',
                )}>
                  <Target className="h-3 w-3 mr-1" />
                  {currentResult.focusApplied === 'yes' ? 'Focus Applied' : currentResult.focusApplied === 'partial' ? 'Partially Applied' : 'Missed Focus'}
                </Badge>
                {currentResult.focusAppliedReason && <p className="text-xs text-muted-foreground leading-tight flex-1">{currentResult.focusAppliedReason}</p>}
              </div>
            )}
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p><span className="font-medium text-foreground">Improved most:</span> {retryAssessment.whatImprovedMost}</p>
              <p><span className="font-medium text-foreground">Still needs work:</span> {retryAssessment.whatStillNeedsWork}</p>
              <p className="text-[11px] italic">{retryAssessment.liveReadyReason}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Transcript Origin Context (scenarios extracted from real calls) ── */}
      {transcriptOrigin && currentResult && (
        <Card className="border-l-4 border-l-primary/60 border-border/60">
          <CardContent className="p-4 space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              From Real Call: {transcriptOrigin.transcriptTitle}
            </p>
            <div className="bg-muted/50 rounded-md p-2 border border-border/40">
              <p className="text-xs italic text-muted-foreground">"{transcriptOrigin.sourceExcerpt}"</p>
            </div>
            <p className="text-xs text-primary/80 font-medium">💡 Original coaching hint: {transcriptOrigin.coachingHint}</p>
            {currentResult.score >= 75 ? (
              <p className="text-xs text-green-600 font-medium">✅ Your trained response is strong enough for a real call. The original mistake has been addressed.</p>
            ) : currentResult.score >= 55 ? (
              <p className="text-xs text-amber-600 font-medium">⚡ You're improving on the original call behavior. Keep drilling to reach live-ready.</p>
            ) : (
              <p className="text-xs text-muted-foreground">🔄 This is the same pattern from your real call. Apply the coaching hint and retry.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Three-Stage Comparison (Live Call → Practice → Retry) ── */}
      {originalCallScore && firstAttemptResult && (
        <ThreeStageComparison
          original={originalCallScore}
          attempt1={firstAttemptResult}
          retry={retryResult}
        />
      )}

      {/* ── Before vs After on Retry (fallback when no original call score) ── */}
      {!originalCallScore && transcriptOrigin && retryResult && retryAssessment && scoreDelta !== null && (
        <ImprovementVerdictCard
          verdict={assessImprovement({
            originalScore: currentResult.score - (scoreDelta ?? 0),
            trainedScore: currentResult.score,
            originalTopMistake: currentResult.topMistake,
            trainedTopMistake: currentResult.topMistake,
            trainedFocusApplied: currentResult.focusApplied,
          })}
          originalScore={currentResult.score - (scoreDelta ?? 0)}
          trainedScore={currentResult.score}
        />
      )}

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
      {currentResult.topMistake && (
        <div className="flex items-center gap-2 px-1">
          <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
          <p className="text-sm">
            <span className="text-muted-foreground">Main issue: </span>
            <span className="font-medium">{MISTAKE_LABELS[currentResult.topMistake] || currentResult.topMistake.replace(/_/g, ' ')}</span>
          </p>
        </div>
      )}

      {/* ── Roleplay-specific: Turn Analysis ── */}
      {sessionType === 'roleplay' && roleplayExtras?.turnAnalysis && roleplayExtras.turnAnalysis.length > 0 && (
        <Card className="border-border/60">
          <CardContent className="p-4 space-y-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Turn-by-Turn Analysis</p>
            <div className="space-y-2.5">
              {roleplayExtras.turnAnalysis.map((ta, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-muted-foreground w-5 text-right">T{ta.turn}</span>
                    <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0',
                      ta.verdict === 'strong' && 'border-green-500 text-green-600 dark:text-green-400',
                      ta.verdict === 'adequate' && 'border-amber-500 text-amber-600 dark:text-amber-400',
                      ta.verdict === 'weak' && 'border-red-500 text-red-600 dark:text-red-400',
                    )}>
                      {ta.verdict}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{ta.assessment}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Roleplay-specific: Control Arc + Adaptation ── */}
      {sessionType === 'roleplay' && (roleplayExtras?.controlArc || roleplayExtras?.adaptationNote) && (
        <div className="grid grid-cols-1 gap-2">
          {roleplayExtras?.controlArc && (
            <Card className="border-border/40">
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-primary/70" />
                  <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wider">Conversation Control</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{roleplayExtras.controlArc}</p>
              </CardContent>
            </Card>
          )}
          {roleplayExtras?.adaptationNote && (
            <Card className="border-border/40">
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-primary/70" />
                  <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wider">Adaptation</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{roleplayExtras.adaptationNote}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Your Response (drill only) ── */}
      {sessionType === 'drill' && userText && (
        <Card className="border-border/40">
          <CardContent className="p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Your Response</p>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed italic">"{userText}"</p>
          </CardContent>
        </Card>
      )}

      {/* ── Stronger Answer ── */}
      {currentResult.improvedVersion && (
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5 text-green-500" />
              <p className="text-[10px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">Stronger Answer</p>
            </div>
            <p className="text-sm text-foreground leading-relaxed italic">"{currentResult.improvedVersion}"</p>
          </CardContent>
        </Card>
      )}

      {/* ── Delta Note ── */}
      {currentResult.deltaNote && currentResult.worldClassResponse && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-primary/5 border border-primary/15">
          <ChevronRight className="h-3.5 w-3.5 text-primary/60 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed italic">{currentResult.deltaNote}</p>
        </div>
      )}

      {/* ── World-Class Standard ── */}
      {currentResult.worldClassResponse && (
        <Card className="border-primary/40 bg-gradient-to-br from-primary/5 to-primary/10 shadow-md ring-1 ring-primary/10">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-primary" />
              <p className="text-xs font-bold text-primary uppercase tracking-wider">World-Class Standard</p>
            </div>
            <p className="text-sm text-foreground leading-relaxed italic pl-0.5">"{currentResult.worldClassResponse}"</p>

            {currentResult.whyItWorks.length > 0 && (
              <div className="pt-3 border-t border-primary/15 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary/70" />
                  <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wider">Why It Works</p>
                </div>
                <ul className="space-y-1.5">
                  {currentResult.whyItWorks.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
                      <span className="text-primary/50 mt-0.5 shrink-0">•</span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {currentResult.moveSequence.length > 0 && (
              <div className="pt-3 border-t border-primary/15 space-y-2">
                <div className="flex items-center gap-1.5">
                  <ListOrdered className="h-3.5 w-3.5 text-primary/70" />
                  <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wider">Move Sequence</p>
                </div>
                <ol className="space-y-1">
                  {currentResult.moveSequence.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="text-primary/60 font-bold shrink-0 w-4 text-right">{i + 1}.</span>
                      <span className="capitalize">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {currentResult.patternTags.length > 0 && (
              <div className="pt-3 border-t border-primary/15 space-y-2">
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wider">Reusable Patterns</p>
                <div className="flex flex-wrap gap-1.5">
                  {currentResult.patternTags.map((tag, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px] font-medium">
                      {PATTERN_TAG_LABELS[tag] || tag.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Focus on This Next ── */}
      {activeFocus && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Focus on This Next</p>
                <p className="text-sm font-semibold text-foreground">{FOCUS_PATTERN_LABELS[activeFocus] || activeFocus.replace(/_/g, ' ')}</p>
              </div>
            </div>
            {currentResult.focusReason && (
              <p className="text-xs text-muted-foreground pl-6 leading-relaxed">{currentResult.focusReason}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Practice Cue ── */}
      {currentResult.practiceCue && (
        <Card className="border-amber-600/20 bg-amber-600/5">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <Target className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1">
                  {sessionType === 'drill' ? 'Practice This on the Retry' : 'Practice This Next'}
                </p>
                <p className="text-sm font-medium text-foreground leading-relaxed">{currentResult.practiceCue}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Teaching Note ── */}
      {currentResult.teachingNote && (
        <div className="flex items-start gap-2.5 px-3 py-3 rounded-lg bg-muted/30 border border-border/40">
          <GraduationCap className="h-4 w-4 text-muted-foreground/70 mt-0.5 shrink-0" />
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-1">Coach's Takeaway</p>
            <p className="text-sm text-muted-foreground italic leading-relaxed">"{currentResult.teachingNote}"</p>
          </div>
        </div>
      )}

      {/* ── Session Feedback Loop ── */}
      <SessionFeedbackCard
        skillFocus={skillFocus}
        score={currentResult.score}
        topMistake={currentResult.topMistake}
        focusPattern={activeFocus}
        practiceCue={currentResult.practiceCue}
        retryCount={retryCount}
        sessionType={sessionType}
      />

      {/* ── Post-Session: Today's Assignment Summary ── */}
      {assignmentContext && (
        <Card className="border-primary/15 bg-primary/5">
          <CardContent className="p-4 space-y-2">
            <p className="text-[10px] font-bold text-primary uppercase tracking-wider">Today's Assignment</p>
            <div className="flex items-center gap-2">
              <span className="text-base">{DAY_ANCHORS[assignmentContext.anchor as DayAnchor]?.icon ?? '📋'}</span>
              <span className="text-sm font-semibold text-foreground">
                {DAY_ANCHORS[assignmentContext.anchor as DayAnchor]?.label ?? assignmentContext.anchor}
              </span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">
                {FOCUS_PATTERN_LABELS[assignmentContext.focusPattern] || assignmentContext.focusPattern.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{assignmentContext.reason}</p>
            {currentResult.focusApplied && (
              <div className="flex items-center gap-2 pt-1 border-t border-primary/10">
                {currentResult.focusApplied === 'yes' ? (
                  <Badge className="text-[10px] bg-green-600 hover:bg-green-600">✅ Focus Applied</Badge>
                ) : currentResult.focusApplied === 'partial' ? (
                  <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">⚡ Partially Applied</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] border-red-500 text-red-600">❌ Focus Missed</Badge>
                )}
                {currentResult.focusAppliedReason && (
                  <span className="text-[10px] text-muted-foreground">{currentResult.focusAppliedReason}</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        {sessionType === 'drill' && (
          <Button variant="outline" className="flex-1 gap-2" onClick={onRetry}>
            <RotateCcw className="h-4 w-4" />Try Again
          </Button>
        )}
        <Button variant="ghost" className="flex-1 gap-2 text-muted-foreground" onClick={onNextRep}>
          Back to Dojo<ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </>
  );
}
