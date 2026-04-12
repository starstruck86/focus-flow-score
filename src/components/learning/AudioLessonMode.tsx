/**
 * AudioLessonMode — Audio-first learning component.
 *
 * Dave teaches the lesson by speaking each section sequentially.
 * For quizzes: Dave reads the question, user answers by voice or text.
 * For application: Dave reads the prompt, user responds.
 * After completion: seamless handoff to Dojo.
 *
 * Constraints:
 * - Dave only reads system-generated lesson content
 * - No chat behavior
 * - Falls back to text if mic unavailable
 * - Reuses existing TTS/STT infrastructure
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Mic, MicOff, Pause, Play, SkipForward,
  Loader2, Volume2, Square, Swords, CheckCircle2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import { supabase } from '@/integrations/supabase/client';
import { emitSaveStatus } from '@/components/SaveIndicator';
import { saveLearnState, clearLearnState, loadLearnState } from '@/lib/sessionDurability';
import {
  type RecoveryState,
  createInitialRecoveryState,
  executeWithRecovery,
  type RecoveryController,
} from '@/lib/sessionRecovery';
import RecoveryBanner from '@/components/RecoveryBanner';
import type { LearningLesson, MCQuestion } from '@/lib/learning/types';
import {
  buildLessonAudioSections,
  buildHandoffText,
  type LessonAudioSection,
} from '@/lib/learning/lessonAudioSequencer';
import { getPracticeMapping } from '@/lib/learning/practiceMapping';
import { useUpsertProgress, useSaveQuizAnswer } from '@/lib/learning/hooks';

interface AudioLessonModeProps {
  lesson: LearningLesson;
}

type LessonPhase = 'teaching' | 'waiting_mc' | 'waiting_open' | 'grading' | 'handoff' | 'complete';

export default function AudioLessonMode({ lesson }: AudioLessonModeProps) {
  const navigate = useNavigate();
  const voice = useVoiceMode();
  const upsertProgress = useUpsertProgress();
  const saveAnswer = useSaveQuizAnswer();

  // Restore from saved state if resuming the same lesson
  const savedLearn = useRef(loadLearnState()).current;
  const isLearnResuming = savedLearn && savedLearn.lessonId === lesson.id && savedLearn.phase !== 'complete';

  const [sections] = useState<LessonAudioSection[]>(() =>
    buildLessonAudioSections(lesson.id, lesson.lesson_content!, lesson.quiz_content)
  );
  const [currentIndex, setCurrentIndex] = useState(isLearnResuming ? savedLearn!.currentSectionIndex : 0);
  const [phase, setPhase] = useState<LessonPhase>(
    isLearnResuming ? (savedLearn!.phase as LessonPhase) : 'teaching'
  );
  const [isPaused, setIsPaused] = useState(false);
  const [completedSections, setCompletedSections] = useState<Set<string>>(
    isLearnResuming ? new Set(savedLearn!.completedSectionIds) : new Set()
  );

  // Quiz state
  const [mcAnswers, setMcAnswers] = useState<Record<string, string>>(
    isLearnResuming ? savedLearn!.mcAnswers : {}
  );
  const [mcScore, setMcScore] = useState(isLearnResuming ? savedLearn!.mcScore : 0);
  const [openAnswer, setOpenAnswer] = useState(isLearnResuming ? savedLearn!.openAnswer : '');
  const [openFeedback, setOpenFeedback] = useState<string | null>(null);
  const [openScore, setOpenScore] = useState(0);
  const [micAvailable, setMicAvailable] = useState(true);

  const indexRef = useRef(currentIndex);
  indexRef.current = currentIndex;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const currentSection = sections[currentIndex] ?? null;

  // Save Learn state on every meaningful change
  useEffect(() => {
    saveLearnState({
      lessonId: lesson.id,
      currentSectionIndex: currentIndex,
      phase,
      mcAnswers,
      mcScore,
      openAnswer,
      completedSectionIds: Array.from(completedSections),
      savedAt: Date.now(),
    });
  }, [currentIndex, phase, mcAnswers, mcScore, openAnswer, completedSections, lesson.id]);

  // Clear on completion
  useEffect(() => {
    if (phase === 'complete') clearLearnState();
  }, [phase]);
  // Auto-play current section
  const hasStartedRef = useRef(false);
  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    upsertProgress.mutate({ lessonId: lesson.id, status: 'in_progress' });
    playSection(0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const playSection = useCallback(async (idx: number) => {
    if (idx >= sections.length) {
      setPhase('handoff');
      await doHandoff();
      return;
    }

    const section = sections[idx];
    setCurrentIndex(idx);
    setPhase('teaching');

    try {
      await voice.playTTS(section.text);
      setCompletedSections(prev => new Set([...prev, section.id]));

      // After speaking, check if we need user input
      if (section.pauseAfter && section.expectsInput === 'mc') {
        setPhase('waiting_mc');
      } else if (section.pauseAfter && section.expectsInput === 'open_ended') {
        setPhase('waiting_open');
        // Auto-activate mic for open-ended
        tryActivateMic();
      } else {
        // Auto-advance to next section
        await playSection(idx + 1);
      }
    } catch (err) {
      console.error('TTS failed for section, advancing:', err);
      setCompletedSections(prev => new Set([...prev, section.id]));
      // Still advance even if TTS fails
      if (section.pauseAfter) {
        if (section.expectsInput === 'mc') setPhase('waiting_mc');
        else if (section.expectsInput === 'open_ended') {
          setPhase('waiting_open');
          tryActivateMic();
        }
      } else {
        await playSection(idx + 1);
      }
    }
  }, [sections, voice]); // eslint-disable-line react-hooks/exhaustive-deps

  const tryActivateMic = useCallback(async () => {
    try {
      await voice.startRecording();
    } catch {
      setMicAvailable(false);
    }
  }, [voice]);

  // MC answer handling
  const handleMCAnswer = useCallback(async (answer: string) => {
    if (!currentSection?.mcQuestion) return;
    const q = currentSection.mcQuestion;
    const isCorrect = answer === q.correct_answer;

    setMcAnswers(prev => ({ ...prev, [q.id]: answer }));
    if (isCorrect) setMcScore(prev => prev + 1);

    saveAnswer.mutate({
      lessonId: lesson.id,
      questionType: 'mc',
      questionId: q.id,
      userAnswer: answer,
      isCorrect,
      score: isCorrect ? 1 : 0,
    });

    // Dave explains the answer
    const explanation = isCorrect
      ? `Correct. ${q.explanation}`
      : `Not quite — the answer is ${q.correct_answer}. ${q.explanation}`;

    try {
      await voice.playTTS(explanation);
    } catch { /* continue anyway */ }

    // Advance to next section
    await playSection(indexRef.current + 1);
  }, [currentSection, lesson.id, saveAnswer, voice, playSection]);

  // Voice MC answer (parse letter from speech)
  const handleVoiceMCAnswer = useCallback(async () => {
    try {
      const text = await voice.stopRecording();
      // Extract letter answer (A, B, C, D) from speech
      const match = text.match(/\b([A-Da-d])\b/);
      if (match) {
        await handleMCAnswer(match[1].toUpperCase());
      } else {
        toast.error('Could not understand answer. Please tap your choice.');
        setMicAvailable(false);
      }
    } catch {
      setMicAvailable(false);
    }
  }, [voice, handleMCAnswer]);

  // Open-ended answer handling
  const handleOpenSubmit = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setPhase('grading');

    try {
      const { data, error } = await supabase.functions.invoke('grade-lesson-response', {
        body: {
          lessonId: lesson.id,
          userResponse: text,
          prompt: lesson.quiz_content?.open_ended_prompt,
          rubric: lesson.quiz_content?.rubric,
          lessonTitle: lesson.title,
          concept: lesson.lesson_content?.concept,
        },
      });
      if (error) throw error;

      setOpenFeedback(data.feedback);
      setOpenScore(data.score ?? 0);

      saveAnswer.mutate({
        lessonId: lesson.id,
        questionType: 'open_ended',
        questionId: 'open_1',
        userAnswer: text,
        aiFeedback: data.feedback,
        score: data.score,
      });

      // Dave reads the feedback
      try {
        await voice.playTTS(data.feedback);
      } catch { /* continue */ }

      // Complete the lesson
      const totalMC = lesson.quiz_content?.mc_questions?.length || 1;
      const mcPct = mcScore / totalMC;
      const overallMastery = (mcPct * 0.4 + ((data.score ?? 0) / 100) * 0.6);
      upsertProgress.mutate({
        lessonId: lesson.id,
        status: 'completed',
        mastery_score: Math.round(overallMastery * 100) / 100,
      });

      // Handoff
      setPhase('handoff');
      await doHandoff();
    } catch (err) {
      console.error('Grading failed:', err);
      toast.error('Grading failed. Please try again.');
      setPhase('waiting_open');
    }
  }, [lesson, mcScore, voice, saveAnswer, upsertProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVoiceOpenSubmit = useCallback(async () => {
    try {
      const text = await voice.stopRecording();
      setOpenAnswer(text);
      await handleOpenSubmit(text);
    } catch {
      setMicAvailable(false);
      setPhase('waiting_open');
    }
  }, [voice, handleOpenSubmit]);

  const handleTextOpenSubmit = useCallback(async () => {
    await handleOpenSubmit(openAnswer);
  }, [openAnswer, handleOpenSubmit]);

  const doHandoff = useCallback(async () => {
    try {
      await voice.playTTS(buildHandoffText());
    } catch { /* continue */ }
    setPhase('complete');
  }, [voice]);

  const handleGoToDojo = useCallback(() => {
    const practice = getPracticeMapping(lesson.topic);
    navigate('/dojo/session', {
      state: {
        skillFocus: practice.skillFocus,
        mode: 'custom',
        sessionType: 'audio',
        fromLesson: true,
        lessonTitle: lesson.title,
      },
    });
  }, [lesson, navigate]);

  // Controls
  const handlePause = useCallback(() => {
    voice.stopPlayback();
    setIsPaused(true);
  }, [voice]);

  const handleResume = useCallback(() => {
    setIsPaused(false);
    if (phase === 'teaching' && currentSection) {
      playSection(currentIndex);
    }
  }, [phase, currentSection, currentIndex, playSection]);

  const handleSkip = useCallback(() => {
    voice.stopPlayback();
    setIsPaused(false);
    setCompletedSections(prev => new Set([...prev, currentSection?.id ?? '']));
    playSection(currentIndex + 1);
  }, [voice, currentSection, currentIndex, playSection]);

  const handleReplay = useCallback(() => {
    voice.stopPlayback();
    setIsPaused(false);
    playSection(currentIndex);
  }, [voice, currentIndex, playSection]);

  const progress = sections.length > 0 ? Math.round((completedSections.size / sections.length) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Progress & status */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {phase === 'teaching' && voice.isPlaying && (
              <>
                <Volume2 className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-primary">Dave is teaching</span>
                <div className="flex items-center gap-0.5 ml-1">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-1 bg-primary rounded-full animate-pulse"
                      style={{ height: `${8 + Math.random() * 8}px`, animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </>
            )}
            {phase === 'teaching' && !voice.isPlaying && !isPaused && (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Preparing next section...</span>
              </>
            )}
            {isPaused && (
              <>
                <Pause className="h-4 w-4 text-amber-500" />
                <span className="text-xs font-medium text-amber-500">Paused</span>
              </>
            )}
            {(phase === 'waiting_mc' || phase === 'waiting_open') && (
              <>
                <Mic className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-foreground">Your turn</span>
              </>
            )}
            {phase === 'grading' && (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Evaluating...</span>
              </>
            )}
            {phase === 'complete' && (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-xs font-medium text-green-500">Lesson complete</span>
              </>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">
            {completedSections.size}/{sections.length}
          </span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Current section label */}
      {currentSection && phase !== 'complete' && (
        <div className="px-1">
          <Badge variant="outline" className="text-[10px]">{currentSection.label}</Badge>
        </div>
      )}

      {/* Section text (shows as transcript after spoken) */}
      {currentSection && completedSections.has(currentSection.id) && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-3 py-2 rounded-lg bg-muted/30 border border-border/40"
        >
          <p className="text-sm text-foreground leading-relaxed">{currentSection.text}</p>
        </motion.div>
      )}

      {/* MC Quiz input */}
      {phase === 'waiting_mc' && currentSection?.mcQuestion && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          {currentSection.mcQuestion.options.map((opt) => {
            const letter = opt.charAt(0);
            return (
              <button
                key={opt}
                onClick={() => handleMCAnswer(letter)}
                className="w-full text-left p-3 rounded-lg border border-border/60 bg-card hover:bg-accent/50 transition-colors text-sm"
              >
                {opt}
              </button>
            );
          })}

          {/* Voice answer option */}
          {micAvailable && (
            <div className="flex items-center justify-center pt-2">
              {voice.isRecording ? (
                <button
                  onClick={handleVoiceMCAnswer}
                  className="h-12 w-12 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
                >
                  <Square className="h-5 w-5 text-white" />
                </button>
              ) : (
                <button
                  onClick={() => tryActivateMic()}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Mic className="h-3.5 w-3.5" />
                  Or say your answer
                </button>
              )}
            </div>
          )}
        </motion.div>
      )}

      {/* Open-ended input */}
      {phase === 'waiting_open' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          {/* Mic recording */}
          {micAvailable && voice.isRecording && (
            <div className="flex flex-col items-center gap-3 py-4">
              <button
                onClick={handleVoiceOpenSubmit}
                className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors shadow-lg"
              >
                <Square className="h-6 w-6 text-white" />
              </button>
              <p className="text-xs text-muted-foreground">Tap to stop and submit</p>
            </div>
          )}

          {/* Text fallback */}
          {(!micAvailable || !voice.isRecording) && (
            <>
              {!micAvailable && (
                <div className="flex items-center gap-2 text-xs text-amber-500">
                  <MicOff className="h-3.5 w-3.5" />
                  <span>Mic unavailable — type your response</span>
                </div>
              )}
              <Textarea
                value={openAnswer}
                onChange={(e) => setOpenAnswer(e.target.value)}
                placeholder="Type your response..."
                className="min-h-[100px] text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleTextOpenSubmit();
                }}
              />
              <Button className="w-full" disabled={!openAnswer.trim()} onClick={handleTextOpenSubmit}>
                Submit Response
              </Button>
              {micAvailable && (
                <button
                  onClick={() => tryActivateMic()}
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1"
                >
                  <Mic className="h-3.5 w-3.5" />
                  Or speak your answer
                </button>
              )}
            </>
          )}
        </motion.div>
      )}

      {/* Feedback display */}
      {openFeedback && (
        <Card className="border-primary/20">
          <CardContent className="p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium text-muted-foreground uppercase">Feedback</p>
              <Badge variant="secondary" className="text-[10px]">{Math.round(openScore)}/100</Badge>
            </div>
            <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{openFeedback}</p>
          </CardContent>
        </Card>
      )}

      {/* Playback controls */}
      {phase === 'teaching' && (
        <div className="flex items-center gap-2">
          {voice.isPlaying && !isPaused && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={handlePause}>
              <Pause className="h-3.5 w-3.5" />
              Pause
            </Button>
          )}
          {isPaused && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleResume}>
              <Play className="h-3.5 w-3.5" />
              Resume
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleReplay}>
            Replay
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleSkip}>
            <SkipForward className="h-3.5 w-3.5" />
            Skip
          </Button>
        </div>
      )}

      {/* Handoff / Complete */}
      {phase === 'complete' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 py-4">
          <div className="text-center space-y-2">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
            <p className="text-base font-semibold">Lesson Complete</p>
            {lesson.quiz_content && (
              <p className="text-xs text-muted-foreground">
                Quiz: {mcScore}/{lesson.quiz_content.mc_questions?.length ?? 0} · Application: {Math.round(openScore)}/100
              </p>
            )}
          </div>

          <Button
            size="lg"
            className="w-full h-14 text-base font-semibold gap-2"
            onClick={handleGoToDojo}
          >
            <Swords className="h-5 w-5" />
            Practice This Now
          </Button>

          <Button variant="ghost" onClick={() => navigate('/learn')} className="w-full text-muted-foreground">
            Back to Courses
          </Button>
        </motion.div>
      )}
    </div>
  );
}
