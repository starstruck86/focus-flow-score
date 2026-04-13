/**
 * AudioSessionMode — Audio-first Dojo training component.
 *
 * Flow: Dave speaks scenario → mic auto-activates → user speaks →
 * system transcribes & scores → Dave delivers feedback sequentially.
 *
 * Constraints:
 * - Does NOT change scoring logic (uses existing dojo-score edge function)
 * - Dave only reads system outputs
 * - Falls back to text input if mic unavailable
 * - Reuses existing TTS/STT via useDaveVoiceController
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  Mic, MicOff, Pause, Play, SkipForward, RotateCcw,
  Loader2, Volume2, Square,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { emitSaveStatus } from '@/components/SaveIndicator';
import {
  saveDojoState,
  clearDojoState,
  loadDojoState,
  enqueuePendingWrite,
  type DojoLocalState,
} from '@/lib/sessionDurability';
import { processPendingWrites } from '@/lib/pendingWriteSync';
import {
  type RecoveryState,
  createInitialRecoveryState,
  executeWithRecovery,
  type RecoveryController,
} from '@/lib/sessionRecovery';
import RecoveryBanner from '@/components/RecoveryBanner';
import type { DojoScenario } from '@/lib/dojo/scenarios';
import type { DojoScoreResult } from '@/lib/dojo/types';
import { normalizeScoreResult } from '@/lib/dojo/types';
import DaveCoachingDelivery from './DaveCoachingDelivery';
import {
  type AudioSessionPhase,
  buildIntroText,
  buildPromptText,
  buildRetryPromptText,
  isSpeakingPhase,
  isListeningPhase,
  isProcessingPhase,
  isFeedbackPhase,
} from '@/lib/dojo/audioSessionFlow';
import type { Json } from '@/integrations/supabase/types';
import { completeAssignment } from '@/lib/dojo/v3/assignmentManager';
import { useDaveVoiceController } from '@/hooks/useDaveVoiceController';
import { prefetchDojoScenario } from '@/lib/daveSessionPrefetch';
import DaveSignalBanner from '@/components/DaveSignalBanner';

interface AudioSessionModeProps {
  scenario: DojoScenario;
  userId: string;
  mode?: string;
  onComplete: () => void;
  assignmentId?: string | null;
  benchmarkTag?: boolean;
  scenarioFamilyId?: string | null;
}

/** Safely cast DojoScoreResult to Json for DB storage */
function scoreToJson(score: DojoScoreResult): Json {
  return JSON.parse(JSON.stringify(score)) as Json;
}

const PHASE_LABELS: Partial<Record<AudioSessionPhase, string>> = {
  intro: 'Dave is setting the scene',
  prompt: 'Dave is reading the objection',
  listening: 'Your turn — speak now',
  transcribing: 'Processing your response...',
  scoring: 'Dave is evaluating...',
  feedback: 'Dave is coaching you',
  retry_prompt: 'Dave is setting up your retry',
  retry_listening: 'Try again — speak now',
  retry_transcribing: 'Processing...',
  retry_scoring: 'Evaluating retry...',
  retry_feedback: 'Dave is coaching you',
  complete: 'Session complete',
};

export default function AudioSessionMode({
  scenario,
  userId,
  mode,
  onComplete,
  assignmentId,
  benchmarkTag = false,
  scenarioFamilyId,
}: AudioSessionModeProps) {
  // Restore from saved state if resuming
  const savedState = useRef(loadDojoState()).current;
  const isResuming = savedState && savedState.scenario.title === scenario.title && savedState.phase !== 'intro';

  const [phase, setPhase] = useState<AudioSessionPhase>(
    isResuming ? (savedState!.phase as AudioSessionPhase) : 'intro'
  );
  const [micAvailable, setMicAvailable] = useState(true);
  const [textFallback, setTextFallback] = useState('');
  const [result, setResult] = useState<DojoScoreResult | null>(null);
  const [retryResult, setRetryResult] = useState<DojoScoreResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(isResuming ? savedState!.dbSessionId : null);
  const [firstTurnId, setFirstTurnId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(isResuming ? savedState!.retryCount : 0);
  const [isPaused, setIsPaused] = useState(false);
  const [transcribedText, setTranscribedText] = useState(isResuming ? savedState!.transcribedText : '');
  const [recovery, setRecovery] = useState<RecoveryState>(createInitialRecoveryState());
  // Client-generated session ID for durability
  const clientSessionId = useRef(crypto.randomUUID()).current;
  const recoveryRef = useRef<RecoveryController | null>(null);

  const dave = useDaveVoiceController({
    surface: 'dojo',
    sessionKey: `dojo-${scenario.title}`,
    mode: 'audio',
  });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Save local state on every meaningful change
  useEffect(() => {
    const currentResult = retryResult || result;
    saveDojoState({
      sessionId: clientSessionId,
      scenario: {
        title: scenario.title,
        skillFocus: scenario.skillFocus,
        context: scenario.context,
        objection: scenario.objection,
      },
      phase,
      transcribedText,
      retryCount,
      lastScore: currentResult?.score ?? null,
      lastFeedback: currentResult?.feedback ?? null,
      sessionType: 'audio',
      mode: mode || 'autopilot',
      savedAt: Date.now(),
      dbSessionId: sessionId,
    });
  }, [phase, transcribedText, retryCount, result, retryResult, sessionId]);

  // Clear state on complete or unmount after completion
  useEffect(() => {
    if (phase === 'complete') {
      clearDojoState();
    }
  }, [phase]);

  // Prefetch scenario content for driving resilience
  useEffect(() => {
    const prefetched = prefetchDojoScenario(scenario);
    dave.prefetchCache.add(prefetched);
  }, [scenario.title]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear buffer on complete
  useEffect(() => {
    if (phase === 'complete') dave.clearBuffer();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start: Dave introduces scenario (skip if resuming mid-session)
  const hasStartedRef = useRef(false);
  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    // If resuming from a later phase, skip intro — go straight to correct step
    if (isResuming) {
      const resumePhase = savedState!.phase as AudioSessionPhase;
      if (resumePhase !== 'intro' && resumePhase !== 'prompt') {
        toast.success('Session recovered — continue where you left off');

        // If scoring was interrupted but transcript exists, auto-retry scoring
        if ((resumePhase === 'scoring' || resumePhase === 'retry_scoring') && savedState!.transcribedText) {
          const isRetry = resumePhase === 'retry_scoring';
          scoreAndDeliver(savedState!.transcribedText, isRetry);
          return;
        }

        // If they had a score already (feedback/complete), stay in current phase
        if (savedState!.lastScore) {
          return;
        }

        // Otherwise (listening was interrupted), activate mic
        activateMic();
        return;
      }
    }

    const startIntro = async () => {
      try {
        const introText = buildIntroText(scenario);
        await dave.speak(introText);

        const phaseAfterIntro = phaseRef.current;
        if (phaseAfterIntro !== 'intro') return;
        setPhase('prompt');

        const promptText = buildPromptText(scenario);
        await dave.speak(promptText);

        const phaseAfterPrompt = phaseRef.current;
        if (phaseAfterPrompt !== 'prompt') return;
        // Auto-activate mic
        await activateMic();
      } catch (err) {
        console.error('TTS intro failed, continuing anyway:', err);
        // If TTS fails, still advance
        const currentPhase = phaseRef.current;
        if (currentPhase === 'intro') setPhase('prompt');
        setTimeout(() => {
          const p = phaseRef.current;
          if (p === 'prompt') activateMic();
        }, 500);
      }
    };

    startIntro();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activateMic = useCallback(async () => {
    const targetPhase = phaseRef.current === 'prompt' ? 'listening' : 'retry_listening';
    setPhase(targetPhase);

    try {
      await dave.startListening();
    } catch {
      setMicAvailable(false);
      toast.error('Microphone unavailable', {
        description: 'Type your response instead.',
      });
    }
  }, [dave]);

  const handleStopRecording = useCallback(async () => {
    try {
      const text = await dave.stopListening();
      setTranscribedText(text);
      dave.recordTranscript('user', text);
      dave.setPendingTranscript(text);

      const isRetry = phaseRef.current === 'retry_listening';
      setPhase(isRetry ? 'retry_scoring' : 'scoring');
      dave.updatePosition(isRetry ? retryCount + 1 : 0, { phase: isRetry ? 'retry_scoring' : 'scoring' });
      await scoreAndDeliver(text, isRetry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recording failed';
      toast.error(msg);
      // Fall back to text input
      setMicAvailable(false);
      setPhase(phaseRef.current === 'retry_listening' ? 'retry_listening' : 'listening');
    }
  }, [dave]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTextSubmit = useCallback(async () => {
    if (!textFallback.trim()) return;
    const text = textFallback.trim();
    setTranscribedText(text);
    const isRetry = phaseRef.current === 'retry_listening';
    setPhase(isRetry ? 'retry_scoring' : 'scoring');
    setTextFallback('');
    await scoreAndDeliver(text, isRetry);
  }, [textFallback]); // eslint-disable-line react-hooks/exhaustive-deps
  // Persist score to DB with pending-write fallback (used by both normal and recovery paths)
  const persistScore = useCallback(async (scoreData: DojoScoreResult, text: string, isRetry: boolean) => {
    try {
      if (!isRetry) {
        const dbSessionId = crypto.randomUUID();
        const turnId = crypto.randomUUID();
        try {
          const { data: session, error: sessionErr } = await supabase
            .from('dojo_sessions')
            .insert({
              id: dbSessionId,
              user_id: userId,
              mode: (mode as 'autopilot' | 'custom') || 'autopilot',
              session_type: 'drill',
              skill_focus: scenario.skillFocus,
              scenario_title: scenario.title,
              scenario_context: scenario.context,
              scenario_objection: scenario.objection,
              best_score: scoreData.score,
              latest_score: scoreData.score,
              status: 'completed',
              completed_at: new Date().toISOString(),
              assignment_id: assignmentId ?? null,
              benchmark_tag: benchmarkTag,
              scenario_family_id: scenarioFamilyId ?? null,
            })
            .select('id')
            .single();
          if (sessionErr) throw sessionErr;
          if (session) {
            setSessionId(session.id);
            const { data: turn } = await supabase
              .from('dojo_session_turns')
              .insert({
                id: turnId,
                session_id: session.id,
                user_id: userId,
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
          }
          emitSaveStatus('saved');
        } catch (dbErr) {
          console.warn('DB write failed (persist helper), queuing:', dbErr);
          enqueuePendingWrite({ turnId: dbSessionId, table: 'dojo_sessions', action: 'insert', data: {
            id: dbSessionId, user_id: userId, mode: (mode as 'autopilot' | 'custom') || 'autopilot',
            session_type: 'drill', skill_focus: scenario.skillFocus, scenario_title: scenario.title,
            scenario_context: scenario.context, scenario_objection: scenario.objection,
            best_score: scoreData.score, latest_score: scoreData.score, status: 'completed',
            completed_at: new Date().toISOString(),
            assignment_id: assignmentId ?? null, benchmark_tag: benchmarkTag,
            scenario_family_id: scenarioFamilyId ?? null,
          }});
          enqueuePendingWrite({ turnId, table: 'dojo_session_turns', action: 'insert', data: {
            id: turnId, session_id: dbSessionId, user_id: userId, turn_index: 0,
            prompt_text: scenario.objection, user_response: text, score: scoreData.score,
            feedback: scoreData.feedback, top_mistake: scoreData.topMistake,
            improved_version: scoreData.improvedVersion, score_json: scoreToJson(scoreData),
          }});
          setSessionId(dbSessionId);
          emitSaveStatus('offline');
        }
      }
      processPendingWrites();
    } catch { /* already handled */ }
  }, [scenario, userId, mode]);

  const scoreAndDeliver = useCallback(async (text: string, isRetry: boolean) => {
    try {
      emitSaveStatus('saving');
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

      // Persist to DB with pending-write fallback
      if (!isRetry) {
        const dbSessionId = crypto.randomUUID();
        const turnId = crypto.randomUUID();
        try {
          const { data: session, error: sessionErr } = await supabase
            .from('dojo_sessions')
            .insert({
              id: dbSessionId,
              user_id: userId,
              mode: (mode as 'autopilot' | 'custom') || 'autopilot',
              session_type: 'drill',
              skill_focus: scenario.skillFocus,
              scenario_title: scenario.title,
              scenario_context: scenario.context,
              scenario_objection: scenario.objection,
              best_score: scoreData.score,
              latest_score: scoreData.score,
              status: 'completed',
              completed_at: new Date().toISOString(),
              assignment_id: assignmentId ?? null,
              benchmark_tag: benchmarkTag,
              scenario_family_id: scenarioFamilyId ?? null,
            })
            .select('id')
            .single();

          if (sessionErr) throw sessionErr;
          if (session) {
            setSessionId(session.id);
            const { data: turn } = await supabase
              .from('dojo_session_turns')
              .insert({
                id: turnId,
                session_id: session.id,
                user_id: userId,
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
              completeAssignment(userId, today, session.id).catch(err =>
                console.error('[AudioSession] completeAssignment failed:', err)
              );
            }
          }
          emitSaveStatus('saved');
        } catch (dbErr) {
          console.warn('DB write failed, queuing session + turn for retry:', dbErr);
          // Queue the parent session first, then the turn
          enqueuePendingWrite({
            turnId: dbSessionId,
            table: 'dojo_sessions',
            action: 'insert',
            data: {
              id: dbSessionId,
              user_id: userId,
              mode: (mode as 'autopilot' | 'custom') || 'autopilot',
              session_type: 'drill',
              skill_focus: scenario.skillFocus,
              scenario_title: scenario.title,
              scenario_context: scenario.context,
              scenario_objection: scenario.objection,
              best_score: scoreData.score,
              latest_score: scoreData.score,
              status: 'completed',
              completed_at: new Date().toISOString(),
            },
          });
          enqueuePendingWrite({
            turnId,
            table: 'dojo_session_turns',
            action: 'insert',
            data: {
              id: turnId,
              session_id: dbSessionId,
              user_id: userId,
              turn_index: 0,
              prompt_text: scenario.objection,
              user_response: text,
              score: scoreData.score,
              feedback: scoreData.feedback,
              top_mistake: scoreData.topMistake,
              improved_version: scoreData.improvedVersion,
              score_json: scoreToJson(scoreData),
            },
          });
          setSessionId(dbSessionId);
          emitSaveStatus('offline');
          toast.info('Connection issue — your response is saved locally');
        }

        setResult(scoreData);
      } else {
        const newRetryCount = retryCount + 1;
        setRetryCount(newRetryCount);
        const retryTurnId = crypto.randomUUID();

        if (sessionId) {
          try {
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
                id: retryTurnId,
                session_id: sessionId,
                user_id: userId,
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
            emitSaveStatus('saved');
          } catch (dbErr) {
            console.warn('Retry DB write failed, queuing:', dbErr);
            enqueuePendingWrite({
              turnId: retryTurnId,
              table: 'dojo_session_turns',
              action: 'insert',
              data: {
                id: retryTurnId,
                session_id: sessionId,
                user_id: userId,
                turn_index: newRetryCount,
                prompt_text: scenario.objection,
                user_response: text,
                score: scoreData.score,
                feedback: scoreData.feedback,
                top_mistake: scoreData.topMistake,
                improved_version: scoreData.improvedVersion,
                score_json: scoreToJson(scoreData),
                retry_of_turn_id: firstTurnId,
              },
            });
            emitSaveStatus('offline');
            toast.info('Connection issue — your response is saved locally');
          }
        }

        setRetryResult(scoreData);
      }

      setPhase(isRetry ? 'retry_feedback' : 'feedback');
      // Try to flush any pending writes
      processPendingWrites();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to score response';
      console.error('Audio session score error — entering recovery:', e);
      emitSaveStatus('recovering');

      // Enter recovery mode: keep retrying scoring with backoff
      const capturedText = text;
      const capturedIsRetry = isRetry;
      
      recoveryRef.current?.cancel();
      recoveryRef.current = executeWithRecovery(
        async () => {
          const { data, error } = await supabase.functions.invoke('dojo-score', {
            body: {
              scenario: {
                skillFocus: scenario.skillFocus,
                context: scenario.context,
                objection: scenario.objection,
              },
              userResponse: capturedText,
              retryCount: capturedIsRetry ? retryCount + 1 : 0,
            },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          return normalizeScoreResult(data as Record<string, unknown>);
        },
        {
          reason: 'scoring_failure',
          interruptedPhase: isRetry ? 'retry_scoring' : 'scoring',
          onStateChange: setRecovery,
          onSuccess: (scoreData) => {
            // Recovery succeeded — continue the normal flow
            setRecovery(createInitialRecoveryState());
            emitSaveStatus('saving');
            // Re-enter the persist path (inline simplified version)
            if (!capturedIsRetry) {
              setResult(scoreData);
            } else {
              setRetryResult(scoreData);
              setRetryCount(prev => prev + 1);
            }
            setPhase(capturedIsRetry ? 'retry_feedback' : 'feedback');
            // Persist asynchronously — failures go to pending queue
            persistScore(scoreData, capturedText, capturedIsRetry);
          },
          onGiveUp: () => {
            setRecovery(createInitialRecoveryState());
            emitSaveStatus('error');
            toast.error('Could not reach scoring service. Your response is saved locally.');
            setPhase(capturedIsRetry ? 'retry_listening' : 'listening');
          },
        },
      );
    }
  }, [scenario, userId, mode, sessionId, firstTurnId, retryCount, result, retryResult]);

  const handleRetry = useCallback(async () => {
    const currentResult = retryResult || result;
    const retryPrompt = buildRetryPromptText(
      currentResult?.feedback ?? '',
      currentResult?.practiceCue,
    );

    setPhase('retry_prompt');
    try {
      await dave.speak(retryPrompt);
      if (phaseRef.current === 'retry_prompt') {
        await activateMic();
      }
    } catch {
      if (phaseRef.current === 'retry_prompt') {
        await activateMic();
      }
    }
  }, [dave, result, retryResult, activateMic]);

  const handlePause = useCallback(() => {
    if (dave.isSpeaking) {
      dave.stopSpeaking();
      setIsPaused(true);
    }
  }, [dave]);

  const handleResume = useCallback(async () => {
    setIsPaused(false);
    // Re-speak current phase content
    if (isSpeakingPhase(phase)) {
      const text = phase === 'intro'
        ? buildIntroText(scenario)
        : phase === 'prompt'
          ? buildPromptText(scenario)
          : buildRetryPromptText(result?.feedback ?? '', result?.practiceCue);
      await dave.speak(text);
    }
  }, [phase, scenario, result, dave]);

  const handleSkip = useCallback(() => {
    dave.stopSpeaking();
    if (phase === 'intro') {
      setPhase('prompt');
    } else if (phase === 'prompt') {
      activateMic();
    } else if (phase === 'retry_prompt') {
      activateMic();
    }
  }, [phase, dave, activateMic]);

  // Cleanup recovery on unmount
  useEffect(() => {
    return () => { recoveryRef.current?.cancel(); };
  }, []);

  const cancelRecovery = useCallback(() => {
    recoveryRef.current?.cancel();
    setRecovery(createInitialRecoveryState());
    emitSaveStatus('idle');
  }, []);

  const handleTextFallbackFromRecovery = useCallback(() => {
    cancelRecovery();
    setMicAvailable(false);
    // Return to listening for text input
    const currentPhase = phaseRef.current;
    if (isProcessingPhase(currentPhase)) {
      setPhase(currentPhase.startsWith('retry') ? 'retry_listening' : 'listening');
    }
  }, [cancelRecovery]);

  const currentResult = retryResult || result;
  const showFeedbackDelivery = isFeedbackPhase(phase) && currentResult && sessionId;
  const isRecovering = recovery.status === 'recovering' || recovery.status === 'waiting_for_connection';

  return (
    <div className="space-y-4">
      {/* Signal loss/recovery banner for driving mode */}
      <DaveSignalBanner
        message={dave.signalMessage}
        isOffline={dave.isOffline}
        pendingOpsCount={dave.pendingOpsCount}
      />
      {/* Recovery banner */}
      <RecoveryBanner
        recovery={recovery}
        onCancel={cancelRecovery}
        onTextFallback={handleTextFallbackFromRecovery}
      />
      {/* Phase indicator */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all duration-300',
        isListeningPhase(phase) && 'bg-red-500/5 border-red-500/30',
        isSpeakingPhase(phase) && 'bg-primary/5 border-primary/20',
        isProcessingPhase(phase) && 'bg-muted/30 border-border/40',
        isFeedbackPhase(phase) && 'bg-primary/5 border-primary/20',
        phase === 'complete' && 'bg-green-500/5 border-green-500/20',
      )}>
        {isProcessingPhase(phase) && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {isSpeakingPhase(phase) && (
          <Volume2 className="h-4 w-4 text-primary" />
        )}
        {isListeningPhase(phase) && dave.isListening && (
          <Mic className="h-4 w-4 text-red-500 animate-pulse" />
        )}
        <span className="text-xs font-medium text-foreground">
          {PHASE_LABELS[phase] ?? ''}
        </span>

        {/* Speaking pulse */}
        {isSpeakingPhase(phase) && dave.isSpeaking && (
          <div className="ml-auto flex items-center gap-0.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1 bg-primary rounded-full animate-pulse"
                style={{
                  height: `${8 + Math.random() * 8}px`,
                  animationDelay: `${i * 150}ms`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Scenario context (always visible) */}
      <div className="text-xs text-muted-foreground px-1">
        <p>{scenario.context}</p>
        <p className="mt-2 font-medium italic text-foreground">"{scenario.objection}"</p>
      </div>

      {/* Transcribed text preview */}
      {transcribedText && (isProcessingPhase(phase) || isFeedbackPhase(phase) || phase === 'complete') && (
        <div className="px-3 py-2 rounded-lg bg-muted/30 border border-border/40">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Your response</p>
          <p className="text-sm text-foreground">{transcribedText}</p>
        </div>
      )}

      {/* Mic recording controls */}
      {isListeningPhase(phase) && micAvailable && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4 py-6"
        >
          {dave.isListening ? (
            <>
              <button
                onClick={handleStopRecording}
                className="h-20 w-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors shadow-lg shadow-red-500/20"
              >
                <Square className="h-8 w-8 text-white" />
              </button>
              <p className="text-xs text-muted-foreground">Tap to stop recording</p>
            </>
          ) : dave.isTranscribing ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Transcribing...</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Activating microphone...</p>
          )}
        </motion.div>
      )}

      {/* Text fallback input */}
      {isListeningPhase(phase) && !micAvailable && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          <div className="flex items-center gap-2 text-xs text-amber-500">
            <MicOff className="h-3.5 w-3.5" />
            <span>Mic unavailable — type your response</span>
          </div>
          <Textarea
            value={textFallback}
            onChange={(e) => setTextFallback(e.target.value)}
            placeholder="Type your response..."
            className="min-h-[100px] text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleTextSubmit();
            }}
          />
          <Button
            className="w-full gap-2"
            disabled={!textFallback.trim()}
            onClick={handleTextSubmit}
          >
            Submit Response
          </Button>
        </motion.div>
      )}

      {/* Dave coaching delivery (reuses existing component) */}
      {showFeedbackDelivery && (
        <DaveCoachingDelivery
          scoreResult={currentResult}
          sessionId={sessionId}
          enableVoice={true}
          onDeliveryComplete={() => {
            // After feedback, offer retry or complete
          }}
        />
      )}

      {/* Playback controls */}
      {(isSpeakingPhase(phase) || isFeedbackPhase(phase)) && (
        <div className="flex items-center gap-2">
          {dave.isSpeaking && isSpeakingPhase(phase) && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={handlePause}>
              <Pause className="h-3.5 w-3.5" />
              Pause
            </Button>
          )}
          {isPaused && isSpeakingPhase(phase) && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleResume}>
              <Play className="h-3.5 w-3.5" />
              Resume
            </Button>
          )}
          {isSpeakingPhase(phase) && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleSkip}>
              <SkipForward className="h-3.5 w-3.5" />
              Skip
            </Button>
          )}
        </div>
      )}

      {/* Post-feedback actions */}
      {isFeedbackPhase(phase) && currentResult && (
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={handleRetry}
          >
            <RotateCcw className="h-4 w-4" />
            Try Again
          </Button>
          <Button
            className="flex-1"
            onClick={onComplete}
          >
            Next Rep
          </Button>
        </div>
      )}

      {/* Score display */}
      {currentResult && (isFeedbackPhase(phase) || phase === 'complete') && (
        <div className="flex items-center justify-center gap-3 py-2">
          <div className={cn(
            'text-3xl font-bold',
            currentResult.score >= 75 ? 'text-green-500' :
            currentResult.score >= 50 ? 'text-amber-500' : 'text-red-500',
          )}>
            {currentResult.score}
          </div>
          <div className="text-xs text-muted-foreground">/ 100</div>
        </div>
      )}
    </div>
  );
}
