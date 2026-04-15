/**
 * Skill Builder Session Page
 *
 * Runs a structured skill training session block by block.
 * Supports both visual and audio (Dave) modes with full resilience.
 * Now supports deep training content via SkillTrainingModule when launched with SkillSession.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { generateSkillTrack, type SkillTrack, type SkillBlock } from '@/lib/learning/skillBuilderEngine';
import { SKILL_LABELS, type SkillFocus } from '@/lib/dojo/scenarios';
import { FOCUS_PATTERN_LABELS } from '@/lib/dojo/focusPatterns';
import {
  Loader2, BookOpen, Dumbbell, Brain, ChevronRight, CheckCircle2,
  Volume2, VolumeX,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { LevelProgressFeedbackCard } from '@/components/learn/LevelProgressFeedbackCard';
import { useSkillLevels } from '@/hooks/useSkillLevels';
import { useDaveVoiceController } from '@/hooks/useDaveVoiceController';
import { prefetchSkillBuilderBlocks } from '@/lib/daveSessionPrefetch';
import DaveSignalBanner from '@/components/DaveSignalBanner';
import { DaveCoachingFocusChip } from '@/components/DaveCoachingFocusChip';
import { useResolvedSkillSession } from '@/lib/learning/skillSessionResolver';
import { getTrainingContent } from '@/lib/learning/skillBuilderContent';
import { SkillTrainingModule } from '@/components/learn/SkillTrainingModule';
import { SkillSessionDebugPanel } from '@/components/learn/SkillSessionDebugPanel';
import { makeOpKey, runIdempotent, clearIdempotencyRecords } from '@/lib/daveIdempotency';
import { monitorLifecycle, getResumeMessage } from '@/lib/daveLifecycleRecovery';
import {
  unlockAudio,
  emitStepTelemetry,
  clearAudioTelemetry,
  clearActivePlayback,
  evaluateModeDowngrade,
  describeMode,
  type AudioDeliveryMode,
} from '@/lib/daveAudioResilience';
import { AudioDebugPanel } from '@/components/debug/AudioDebugPanel';
import { AudioStressHarness } from '@/components/debug/AudioStressHarness';
import { clearLifecycles } from '@/lib/playbackLifecycle';

type SessionState = 'generating' | 'active' | 'completed' | 'error';

/** Canonical step ID: stable across rerenders, unique per session+block */
function makeStepId(sessionId: string | null, blockIndex: number, blockType: string): string {
  return `${sessionId ?? 'pending'}-${blockIndex}-${blockType}`;
}

export default function SkillBuilderSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const resolvedSession = useResolvedSkillSession();
  const state = location.state as {
    skill?: SkillFocus;
    duration?: number;
    mode?: string;
    fromClosedLoop?: boolean;
    closedLoopSessionId?: string;
    taughtConcept?: string;
    subSkill?: string;
    remediationContext?: { concept: string; weakDimensions: string[]; attemptCount: number };
  } | null;

  const effectiveSkill: SkillFocus | undefined = resolvedSession?.session.skillId ?? state?.skill;
  const trainingContent = effectiveSkill ? getTrainingContent(effectiveSkill) : null;
  const [showTrainingFirst, setShowTrainingFirst] = useState(true);

  const [sessionState, setSessionState] = useState<SessionState>('generating');
  const [track, setTrack] = useState<SkillTrack | null>(null);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [repScores, setRepScores] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<AudioDeliveryMode>(
    state?.mode === 'audio' ? 'full' : 'text'
  );
  const [audioFailures, setAudioFailures] = useState(0);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [lastAudioError, setLastAudioError] = useState<string | null>(null);
  const [lastMicError, setLastMicError] = useState<string | null>(null);
  const { data: skillLevels } = useSkillLevels();
  const [lastInterruptSource, setLastInterruptSource] = useState<string | null>(null);
  const [lastStaleSuppression, setLastStaleSuppression] = useState<string | null>(null);
  const [downgradeReason, setDowngradeReason] = useState<string | null>(null);
  const [dedupeBlocked, setDedupeBlocked] = useState(0);

  // Stable session key — generated once, persists for entire lifecycle
  const stableSessionKey = useRef(`sb-${state?.skill ?? 'unknown'}-${Date.now()}`);

  // Track which canonical step IDs have had their transcript recorded
  const recordedStepsRef = useRef<Set<string>>(new Set());

  const dave = useDaveVoiceController({
    surface: 'skill_builder',
    sessionKey: stableSessionKey.current,
    mode: deliveryMode !== 'text' ? 'audio' : 'text',
  });

  // Lifecycle monitoring for backgrounding
  useEffect(() => {
    const cleanup = monitorLifecycle((lifecycle) => {
      if (lifecycle.isVisible && lifecycle.hiddenDurationMs > 3000) {
        const msg = getResumeMessage(lifecycle.hiddenDurationMs);
        if (msg && deliveryMode !== 'text') {
          toast.info(msg);
        }
      }
    });
    return cleanup;
  }, [deliveryMode]);

  // Prefetch blocks when track is ready
  useEffect(() => {
    if (!track) return;
    const prefetched = prefetchSkillBuilderBlocks(
      track.blocks.map(b => ({
        type: b.type,
        text: b.type === 'mental_model' ? b.levelDescription
          : b.type === 'ki_intro' ? b.kiTitle
          : b.type === 'reflection' ? b.prompt
          : undefined,
        title: b.type === 'ki_intro' ? b.kiTitle : b.type === 'mental_model' ? b.levelName : undefined,
        scenarioPrompt: b.type === 'rep' ? b.scenarioObjection : undefined,
      })),
      currentBlockIndex,
      5,
    );
    for (const p of prefetched) dave.prefetchCache.add(p);
  }, [track, currentBlockIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate session on mount
  useEffect(() => {
    if (!user || !state?.skill) {
      setError('Missing skill selection.');
      setSessionState('error');
      return;
    }

    const skill = state.skill;
    const duration = (state.duration ?? 30) as 15 | 30 | 60;

    generateSkillTrack({ userId: user.id, skill, durationMinutes: duration })
      .then(async (generatedTrack) => {
        const { data, error: dbErr } = await supabase
          .from('skill_builder_sessions' as any)
          .insert({
            user_id: user.id,
            skill,
            duration_minutes: duration,
            level: generatedTrack.currentLevel,
            blocks: generatedTrack.blocks as any,
            ki_ids_used: generatedTrack.kiIdsUsed,
            focus_patterns_used: generatedTrack.focusPatternsUsed,
            status: 'in_progress',
          } as any)
          .select('id')
          .single();

        if (dbErr) console.error('Failed to persist session:', dbErr);

        setTrack(generatedTrack);
        setSessionId((data as any)?.id ?? null);
        setSessionState('active');

        if (dave.buffer && dave.buffer.position > 0) {
          setCurrentBlockIndex(dave.buffer.position);
          toast.success('Resuming from where you left off');
        }
      })
      .catch((err) => {
        console.error('Failed to generate track:', err);
        setError('Failed to generate training session.');
        setSessionState('error');
      });
  }, [user, state?.skill, state?.duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentBlock = track?.blocks[currentBlockIndex] ?? null;
  const totalBlocks = track?.blocks.length ?? 0;
  const progress = totalBlocks > 0 ? Math.round(((currentBlockIndex) / totalBlocks) * 100) : 0;

  const advanceBlock = useCallback(() => {
    if (!track) return;
    const next = currentBlockIndex + 1;
    dave.updatePosition(next, { blockType: track.blocks[next]?.type ?? 'complete' });

    if (next >= track.blocks.length) {
      completeSession();
    } else {
      setCurrentBlockIndex(next);
    }
  }, [currentBlockIndex, track]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRepComplete = useCallback((score?: number) => {
    if (score != null) setRepScores(prev => [...prev, score]);
    advanceBlock();
  }, [advanceBlock]);

  const startRep = useCallback((block: SkillBlock) => {
    if (block.type !== 'rep') return;
    navigate('/dojo/session', {
      state: {
        skillBuilderSessionId: sessionId,
        isSkillBuilder: true,
        skillFocus: track?.skill,
        focusPattern: block.focusPattern,
        scenarioContext: block.scenarioContext,
        scenarioObjection: block.scenarioObjection,
        difficulty: block.difficulty,
      },
    });
  }, [navigate, sessionId, track?.skill]);

  const completeSession = useCallback(async () => {
    setSessionState('completed');

    // Full cleanup: stop any playing audio, clear tokens, buffers, telemetry
    dave.stopSpeaking();
    dave.clearBuffer();
    clearIdempotencyRecords();
    clearAudioTelemetry();
    clearActivePlayback();
    clearLifecycles();

    if (!sessionId) return;

    const opKey = makeOpKey('skill_builder', sessionId, -1, 'persist');
    await runIdempotent(opKey, async () => {
      const avgScore = repScores.length > 0
        ? Math.round(repScores.reduce((a, b) => a + b, 0) / repScores.length)
        : null;

      await supabase
        .from('skill_builder_sessions' as any)
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          avg_score: avgScore,
        } as any)
        .eq('id', sessionId);
    });

    toast.success('Skill Builder session complete!');
  }, [sessionId, repScores]); // eslint-disable-line react-hooks/exhaustive-deps

  // Audio: narrate current block (non-blocking — text always shown first)
  useEffect(() => {
    if (deliveryMode === 'text' || sessionState !== 'active' || !currentBlock) return;

    const block = currentBlock;
    let text = '';

    if (block.type === 'mental_model') {
      text = `Mental model. ${block.levelName}. ${block.levelDescription}`;
    } else if (block.type === 'ki_intro') {
      text = `Key insight. ${block.kiTitle}. Pattern: ${FOCUS_PATTERN_LABELS[block.focusPattern] ?? block.focusPattern}.`;
    } else if (block.type === 'reflection') {
      text = `Time to reflect. ${block.prompt}`;
    } else if (block.type === 'rep') {
      text = `Practice rep. ${block.scenarioContext}. The buyer says: "${block.scenarioObjection}"`;
    }

    if (!text) return;

    // Use stableSessionKey (not sessionId) — sessionId resolves async and would
    // produce a different stepId on re-render, bypassing dedupe.
    const stepId = makeStepId(stableSessionKey.current, currentBlockIndex, block.type);

    // Prevent double transcript entries using canonical step ID
    if (!recordedStepsRef.current.has(stepId)) {
      dave.recordTranscript('dave', text);
      recordedStepsRef.current.add(stepId);
      emitStepTelemetry('step_rendered', stepId, { blockType: block.type, blockIndex: currentBlockIndex, transcript: 'recorded' });
    } else {
      setDedupeBlocked(prev => prev + 1);
      emitStepTelemetry('step_rendered', stepId, { blockType: block.type, blockIndex: currentBlockIndex, transcript: 'dedupe_blocked' });
    }

    // Fire-and-forget: audio plays alongside visible text, never blocks flow
    dave.speak(text).then(() => {
      emitStepTelemetry('audio_ended', stepId, {});
    }).catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      setLastAudioError(errMsg);
      setAudioUnavailable(true);
      setAudioFailures(prev => {
        const next = prev + 1;
        const downgraded = evaluateModeDowngrade(deliveryMode, next);
        if (downgraded !== deliveryMode) {
          setDeliveryMode(downgraded);
          setDowngradeReason(`${next} failures: ${deliveryMode} → ${downgraded}`);
          toast.info(
            downgraded === 'text'
              ? 'Audio unavailable — switched to text mode'
              : 'Switched to quiet mode'
          );
        }
        return next;
      });
      emitStepTelemetry('audio_failed', stepId, { error: errMsg });
    });
  }, [currentBlockIndex, deliveryMode, sessionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Browser visibility guard: pause audio when page hidden ──
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        if (deliveryMode !== 'text') {
          dave.stopSpeaking();
          emitStepTelemetry('audio_interrupt', 'visibility', { reason: 'page_hidden' });
        }
      } else {
        emitStepTelemetry('step_rendered', 'visibility', { reason: 'page_visible', mode: deliveryMode });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [deliveryMode, dave]);

  const toggleMode = useCallback(async () => {
    if (deliveryMode === 'text') {
      const unlocked = await unlockAudio();
      if (!unlocked) {
        toast.error('Could not enable audio');
        return;
      }
      setDeliveryMode('full');
      setAudioFailures(0);
      setAudioUnavailable(false);
      setLastAudioError(null);
      setLastMicError(null);
      toast.info('Audio mode enabled');
    } else {
      setDeliveryMode('text');
      dave.stopSpeaking();
      toast.info('Switched to text mode');
    }
  }, [deliveryMode, dave]);

  // Show deep training content first when SkillSession is present and content exists
  if (showTrainingFirst && trainingContent && resolvedSession && !state?.fromClosedLoop) {
    return (
      <Layout>
        <div className={cn('px-4 pt-4 space-y-4', SHELL.main.bottomPad)}>
          <SkillSessionDebugPanel />
          <SkillTrainingModule
            content={trainingContent}
            session={resolvedSession.session}
            onComplete={() => setShowTrainingFirst(false)}
          />
        </div>
      </Layout>
    );
  }

  // Loading state
  if (sessionState === 'generating') {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Building your training session…</p>
        </div>
      </Layout>
    );
  }

  // Error state
  if (sessionState === 'error' || !track) {
    return (
      <Layout>
        <div className={cn('px-4 pt-4 space-y-4', SHELL.main.bottomPad)}>
          <p className="text-sm text-destructive">{error ?? 'Something went wrong.'}</p>
          <button
            onClick={() => navigate('/learn')}
            className="text-sm text-primary underline"
          >
            Back to Learn
          </button>
        </div>
      </Layout>
    );
  }

  const modeInfo = describeMode(deliveryMode);

  return (
    <Layout>
      <div className={cn('px-4 pt-4 space-y-4', SHELL.main.bottomPad)}>
        {/* Signal banner for audio mode */}
        {deliveryMode !== 'text' && (
          <>
            <DaveSignalBanner
              message={dave.signalMessage}
              isOffline={dave.isOffline}
              pendingOpsCount={dave.pendingOpsCount}
            />
            {audioUnavailable && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted border border-border">
                <VolumeX className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <p className="text-[11px] text-muted-foreground">Audio unavailable — showing text instead</p>
              </div>
            )}
          </>
        )}

        {/* Remediation context from closed-loop */}
        {state?.fromClosedLoop && state?.taughtConcept && (
          <div className="space-y-1.5">
            <DaveCoachingFocusChip
              concept={state.taughtConcept}
              skill={state.skill}
              contextLabel={`Reinforcing: ${state.taughtConcept}`}
            />
            {state.remediationContext && (
              <p className="text-[10px] text-muted-foreground italic px-1">
                Routed here because this concept needs structured practice.
              </p>
            )}
          </div>
        )}

        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              Skill Builder — {track.skillLabel}
            </p>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">{modeInfo.icon}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={toggleMode}
                title={`Current: ${modeInfo.label}. Click to switch.`}
              >
                {deliveryMode !== 'text' ? (
                  <Volume2 className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </Button>
              <Badge variant="outline" className="text-[10px]">
                Level {track.currentLevel}: {track.levelName}
              </Badge>
            </div>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Block {currentBlockIndex + 1} of {totalBlocks} · {track.durationMinutes} min session
          </p>
        </div>

        {/* Session complete */}
        {sessionState === 'completed' && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <p className="text-sm font-medium">Session Complete</p>
            </div>
            {repScores.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Average score: {Math.round(repScores.reduce((a, b) => a + b, 0) / repScores.length)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Reps completed: {repScores.length}
                </p>
              </div>
            )}
            {state?.fromClosedLoop && state?.taughtConcept && (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  This session reinforced <span className="font-medium text-foreground">{state.taughtConcept}</span>.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigate('/dojo/session', {
                      state: {
                        closedLoopSessionId: state.closedLoopSessionId,
                        closedLoopSkill: state.skill,
                        closedLoopConcept: state.taughtConcept,
                        closedLoopSubSkill: state.subSkill,
                      },
                    })}
                    className="flex-1 h-9 rounded-md border border-primary text-primary text-sm font-medium"
                  >
                    Retest in Dojo
                  </button>
                  <button
                    onClick={() => navigate('/learn')}
                    className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium"
                  >
                    Back to Learn
                  </button>
                </div>
              </div>
            )}
            {!state?.fromClosedLoop && (
              <>
                {track?.skill && (() => {
                  const lvl = skillLevels?.find(l => l.skill === track.skill);
                  return lvl ? <LevelProgressFeedbackCard current={lvl} /> : null;
                })()}
                <div className="flex gap-2">
                  <button
                    onClick={() => navigate('/learn')}
                    className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium"
                  >
                    Back to Learn
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Active block rendering */}
        {sessionState === 'active' && currentBlock && (
          <BlockRenderer
            block={currentBlock}
            onAdvance={advanceBlock}
            onStartRep={startRep}
            onRepComplete={handleRepComplete}
            dave={deliveryMode !== 'text' ? dave : undefined}
            isFromTraining={!!trainingContent && !!resolvedSession}
          />
        )}

        {/* Audio debug panel — only visible with ?debug=audio */}
        <AudioDebugPanel
          mode={deliveryMode}
          failureCount={audioFailures}
          micStatus={audioUnavailable ? 'unavailable' : deliveryMode === 'full' ? 'ready' : 'off'}
          lastAudioError={lastAudioError}
          lastMicError={lastMicError}
          lastInterruptSource={lastInterruptSource}
          lastStaleSuppression={lastStaleSuppression}
          downgradeReason={downgradeReason}
          dedupeBlocked={dedupeBlocked}
          voiceDiagnostics={dave.getDiagnostics?.() ?? null}
        />

        {/* Stress harness — only visible with ?debug=audio */}
        <AudioStressHarness
          currentMode={deliveryMode}
          failureCount={audioFailures}
          onForceInterrupt={() => {
            dave.stopSpeaking();
            setLastInterruptSource('stress-harness');
          }}
          onForceFailure={() => {
            setAudioFailures(prev => prev + 1);
            setLastAudioError('Forced failure (stress test)');
          }}
          onForceDowngrade={(mode) => {
            setDeliveryMode(mode);
            setDowngradeReason('Forced via stress harness');
          }}
        />
      </div>
    </Layout>
  );
}

// ── Block Renderer ────────────────────────────────────────────────

function BlockRenderer({
  block,
  onAdvance,
  onStartRep,
  onRepComplete,
  dave,
  isFromTraining,
}: {
  block: SkillBlock;
  onAdvance: () => void;
  onStartRep: (block: SkillBlock) => void;
  onRepComplete: (score?: number) => void;
  dave?: ReturnType<typeof useDaveVoiceController>;
  isFromTraining?: boolean;
}) {
  switch (block.type) {
    case 'mental_model':
      return <MentalModelBlock block={block} onAdvance={onAdvance} dave={dave} />;
    case 'ki_intro':
      return <KIIntroBlock block={block} onAdvance={onAdvance} dave={dave} />;
    case 'rep':
      return <RepBlock block={block} onStartRep={onStartRep} isFromTraining={isFromTraining} dave={dave} />;
    case 'reflection':
      return <ReflectionBlock block={block} onAdvance={onAdvance} dave={dave} />;
    default:
      return null;
  }
}

// ── PlayAudioButton with overlap prevention ────────────────────────
type DaveController = ReturnType<typeof useDaveVoiceController>;

function PlayAudioButton({ text, dave }: { text: string; dave?: DaveController }) {
  const [playing, setPlaying] = useState(false);
  const [locked, setLocked] = useState(false);
  if (!dave) return null;

  const handleClick = async () => {
    if (locked) return;
    setLocked(true);

    if (playing) {
      dave.stopSpeaking();
      setPlaying(false);
      setTimeout(() => setLocked(false), 300);
      return;
    }

    // If dave is already speaking (auto-narration or another replay),
    // stopSpeaking first — interruptCurrentPlayback handles token invalidation
    if (dave.isSpeaking) {
      dave.stopSpeaking();
      // Brief pause to let interrupt settle
      await new Promise(r => setTimeout(r, 100));
    }

    setPlaying(true);
    try {
      // speak() will interrupt any existing playback via token system
      await dave.speak(text);
    } catch {
      // ignore
    }
    setPlaying(false);
    setLocked(false);
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
      disabled={locked && !playing}
    >
      <Volume2 className="h-3 w-3" />
      {playing ? 'Stop' : 'Play Audio'}
    </button>
  );
}

function MentalModelBlock({ block, onAdvance, dave }: { block: SkillBlock & { type: 'mental_model' }; onAdvance: () => void; dave?: DaveController }) {
  const narration = `Mental model. ${block.levelName}. ${block.levelDescription}`;
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Mental Model</p>
        </div>
        <PlayAudioButton text={narration} dave={dave} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">{block.levelName}</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{block.levelDescription}</p>
        <div className="flex flex-wrap gap-1 pt-1">
          {block.focusPatterns.map(p => (
            <Badge key={p} variant="secondary" className="text-[10px]">
              {FOCUS_PATTERN_LABELS[p] ?? p.replace(/_/g, ' ')}
            </Badge>
          ))}
        </div>
      </div>
      <button
        onClick={onAdvance}
        className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-1"
      >
        Start Training <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function KIIntroBlock({ block, onAdvance, dave }: { block: SkillBlock & { type: 'ki_intro' }; onAdvance: () => void; dave?: DaveController }) {
  const narration = `Key insight. ${block.kiTitle}. Pattern: ${FOCUS_PATTERN_LABELS[block.focusPattern] ?? block.focusPattern}.`;
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Knowledge Focus</p>
        </div>
        <PlayAudioButton text={narration} dave={dave} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">{block.kiTitle}</p>
        <p className="text-xs text-muted-foreground">
          Pattern: {FOCUS_PATTERN_LABELS[block.focusPattern] ?? block.focusPattern.replace(/_/g, ' ')}
        </p>
      </div>
      <button
        onClick={onAdvance}
        className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-1"
      >
        Practice This <Dumbbell className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function RepBlock({ block, onStartRep, isFromTraining, dave }: { block: SkillBlock & { type: 'rep' }; onStartRep: (block: SkillBlock) => void; isFromTraining?: boolean; dave?: DaveController }) {
  const narration = `Practice rep. ${block.scenarioContext}. The buyer says: "${block.scenarioObjection}"`;
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Dumbbell className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Practice Rep</p>
        </div>
        <PlayAudioButton text={narration} dave={dave} />
      </div>
      {isFromTraining ? (
        <div className="space-y-1.5">
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground italic">"{block.scenarioObjection}"</p>
          </div>
          <Badge variant="outline" className="text-[10px]">{block.difficulty}</Badge>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-foreground">{block.scenarioContext}</p>
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground italic">"{block.scenarioObjection}"</p>
          </div>
          <Badge variant="outline" className="text-[10px]">{block.difficulty}</Badge>
        </div>
      )}
      <button
        onClick={() => onStartRep(block)}
        className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-1"
      >
        Run This Rep <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ReflectionBlock({ block, onAdvance, dave }: { block: SkillBlock & { type: 'reflection' }; onAdvance: () => void; dave?: DaveController }) {
  const [reflection, setReflection] = useState('');
  const narration = `Time to reflect. ${block.prompt}`;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-accent-foreground" />
          <p className="text-sm font-medium">Reflect</p>
        </div>
        <PlayAudioButton text={narration} dave={dave} />
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{block.prompt}</p>
      <textarea
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
        className="w-full h-20 rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder="Your reflection…"
      />
      <button
        onClick={onAdvance}
        className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium"
      >
        Complete Session
      </button>
    </div>
  );
}
