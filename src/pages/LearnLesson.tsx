import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Loader2, BookOpen, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, Lightbulb, AlertTriangle, Send,
  Volume2, VolumeX,
} from 'lucide-react';
import { useLesson, useGenerateLesson, useUpsertProgress, useSaveQuizAnswer } from '@/lib/learning/hooks';
import { supabase } from '@/integrations/supabase/client';
import type { MCQuestion } from '@/lib/learning/types';
import { getPracticeMapping } from '@/lib/learning/practiceMapping';
import { Swords } from 'lucide-react';
import { useAudioPreference } from '@/hooks/useAudioPreference';
import AudioLessonMode from '@/components/learning/AudioLessonMode';

type Phase = 'learn' | 'quiz' | 'open_ended' | 'results';

export default function LearnLesson() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: lesson, isLoading, refetch } = useLesson(id);
  const generateLesson = useGenerateLesson();
  const upsertProgress = useUpsertProgress();
  const saveAnswer = useSaveQuizAnswer();
  const { isAudio, toggleMode } = useAudioPreference();

  const [phase, setPhase] = useState<Phase>('learn');
  const [expandedSection, setExpandedSection] = useState<string | null>('concept');

  // Quiz state
  const [mcAnswers, setMcAnswers] = useState<Record<string, string>>({});
  const [mcSubmitted, setMcSubmitted] = useState(false);
  const [openAnswer, setOpenAnswer] = useState('');
  const [openFeedback, setOpenFeedback] = useState<string | null>(null);
  const [gradingOpen, setGradingOpen] = useState(false);
  const [mcScore, setMcScore] = useState(0);
  const [openScore, setOpenScore] = useState(0);

  // Generate content if needed
  const handleGenerate = useCallback(async () => {
    if (!id) return;
    await generateLesson.mutateAsync(id);
    refetch();
  }, [id, generateLesson, refetch]);

  // Submit MC answers
  const handleSubmitMC = useCallback(() => {
    if (!lesson?.quiz_content?.mc_questions) return;
    let correct = 0;
    lesson.quiz_content.mc_questions.forEach((q) => {
      const isCorrect = mcAnswers[q.id] === q.correct_answer;
      if (isCorrect) correct++;
      saveAnswer.mutate({
        lessonId: lesson.id,
        questionType: 'mc',
        questionId: q.id,
        userAnswer: mcAnswers[q.id],
        isCorrect,
        score: isCorrect ? 1 : 0,
      });
    });
    setMcScore(correct);
    setMcSubmitted(true);
  }, [lesson, mcAnswers, saveAnswer]);

  // Grade open-ended with AI
  const handleSubmitOpen = useCallback(async () => {
    if (!lesson || !openAnswer.trim()) return;
    setGradingOpen(true);
    try {
      const { data, error } = await supabase.functions.invoke('grade-lesson-response', {
        body: {
          lessonId: lesson.id,
          userResponse: openAnswer,
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
        userAnswer: openAnswer,
        aiFeedback: data.feedback,
        score: data.score,
      });
    } catch (err) {
      console.error('Grading failed:', err);
      setOpenFeedback('Grading failed. Please try again.');
    } finally {
      setGradingOpen(false);
    }
  }, [lesson, openAnswer, saveAnswer]);

  // Complete lesson
  const handleComplete = useCallback(() => {
    if (!lesson) return;
    const totalMC = lesson.quiz_content?.mc_questions?.length || 1;
    const mcPct = mcScore / totalMC;
    const overallMastery = (mcPct * 0.4 + (openScore / 100) * 0.6);
    upsertProgress.mutate({
      lessonId: lesson.id,
      status: 'completed',
      mastery_score: Math.round(overallMastery * 100) / 100,
    });
    setPhase('results');
  }, [lesson, mcScore, openScore, upsertProgress]);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (!lesson) {
    return (
      <Layout>
        <div className="p-4 text-center text-muted-foreground">Lesson not found.</div>
      </Layout>
    );
  }

  const needsGeneration = lesson.generation_status !== 'complete' || !lesson.lesson_content;

  return (
    <Layout>
      <div className={cn('px-4 pt-3 space-y-4', SHELL.main.bottomPad)}>
        {/* Header */}
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/learn')} className="p-1.5 rounded-md hover:bg-accent/50">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{lesson.title}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{lesson.topic.replace(/_/g, ' ')} · {lesson.difficulty_level}</p>
          </div>
          <button
            onClick={toggleMode}
            className="p-1.5 rounded-md hover:bg-accent/50 transition-colors"
            title={isAudio ? 'Switch to text mode' : 'Switch to audio mode'}
          >
            {isAudio ? <Volume2 className="h-4 w-4 text-primary" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
          </button>
        </div>

        {/* Generation needed */}
        {needsGeneration && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4 text-center space-y-3">
              <BookOpen className="h-8 w-8 text-primary mx-auto" />
              <p className="text-sm text-muted-foreground">
                {lesson.generation_status === 'generating'
                  ? 'Generating lesson content...'
                  : lesson.generation_status === 'failed'
                  ? 'Generation failed. Try again.'
                  : 'This lesson needs to be generated from your knowledge base.'}
              </p>
              <Button
                onClick={handleGenerate}
                disabled={generateLesson.isPending || lesson.generation_status === 'generating'}
              >
                {generateLesson.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
                ) : (
                  'Generate Lesson'
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Audio Mode — Dave teaches the full lesson */}
        {!needsGeneration && isAudio && lesson.lesson_content && (
          <AudioLessonMode lesson={lesson} />
        )}

        {/* Text Mode: Phase: Learn */}
        {!needsGeneration && !isAudio && phase === 'learn' && lesson.lesson_content && (
          <>
            <LessonSection
              title="Core Concept"
              icon={<BookOpen className="h-3.5 w-3.5" />}
              content={lesson.lesson_content.concept}
              expanded={expandedSection === 'concept'}
              onToggle={() => setExpandedSection(expandedSection === 'concept' ? null : 'concept')}
            />
            <LessonSection
              title="What Good Looks Like"
              icon={<Lightbulb className="h-3.5 w-3.5" />}
              content={lesson.lesson_content.what_good_looks_like}
              expanded={expandedSection === 'example'}
              onToggle={() => setExpandedSection(expandedSection === 'example' ? null : 'example')}
            />
            <LessonSection
              title="Why It Works"
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              content={lesson.lesson_content.breakdown}
              expanded={expandedSection === 'breakdown'}
              onToggle={() => setExpandedSection(expandedSection === 'breakdown' ? null : 'breakdown')}
            />
            <LessonSection
              title="When to Use"
              icon={<Lightbulb className="h-3.5 w-3.5" />}
              content={lesson.lesson_content.when_to_use}
              expanded={expandedSection === 'when'}
              onToggle={() => setExpandedSection(expandedSection === 'when' ? null : 'when')}
            />
            <LessonSection
              title="When NOT to Use"
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              content={lesson.lesson_content.when_not_to_use}
              expanded={expandedSection === 'when_not'}
              onToggle={() => setExpandedSection(expandedSection === 'when_not' ? null : 'when_not')}
            />

            <Button
              className="w-full"
              size="lg"
              onClick={() => {
                upsertProgress.mutate({ lessonId: lesson.id, status: 'in_progress' });
                setPhase('quiz');
              }}
            >
              Ready — Test Me
            </Button>
          </>
        )}

        {/* Phase: Quiz (MC) */}
        {phase === 'quiz' && lesson.quiz_content && (
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Quick Check — {lesson.quiz_content.mc_questions.length} Questions
            </p>

            {lesson.quiz_content.mc_questions.map((q) => (
              <MCQuestionCard
                key={q.id}
                question={q}
                selected={mcAnswers[q.id]}
                onSelect={(answer) => setMcAnswers(prev => ({ ...prev, [q.id]: answer }))}
                submitted={mcSubmitted}
              />
            ))}

            {!mcSubmitted ? (
              <Button
                className="w-full"
                disabled={Object.keys(mcAnswers).length < (lesson.quiz_content.mc_questions.length || 0)}
                onClick={handleSubmitMC}
              >
                Check Answers
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium text-center">
                  {mcScore}/{lesson.quiz_content.mc_questions.length} correct
                </p>
                <Button className="w-full" onClick={() => setPhase('open_ended')}>
                  Continue to Application
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Phase: Open-ended */}
        {phase === 'open_ended' && lesson.quiz_content && (
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Apply It
            </p>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm leading-relaxed">{lesson.quiz_content.open_ended_prompt}</p>
              </CardContent>
            </Card>

            <Textarea
              placeholder="Write your response..."
              value={openAnswer}
              onChange={(e) => setOpenAnswer(e.target.value)}
              className="min-h-[120px]"
              disabled={!!openFeedback}
            />

            {!openFeedback ? (
              <Button
                className="w-full"
                disabled={!openAnswer.trim() || gradingOpen}
                onClick={handleSubmitOpen}
              >
                {gradingOpen ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Grading...</>
                ) : (
                  <><Send className="h-4 w-4" /> Submit Response</>
                )}
              </Button>
            ) : (
              <div className="space-y-3">
                <Card className="border-primary/20">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground uppercase">Feedback</p>
                      <Badge variant="secondary">{Math.round(openScore)}/100</Badge>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{openFeedback}</p>
                  </CardContent>
                </Card>
                <Button className="w-full" onClick={handleComplete}>
                  Complete Lesson
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Phase: Results */}
        {phase === 'results' && (() => {
          const practice = getPracticeMapping(lesson.topic);
          return (
            <div className="space-y-4 text-center py-6">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
              <p className="text-lg font-semibold">Lesson Complete</p>
              <p className="text-sm text-muted-foreground">
                MC: {mcScore}/{lesson.quiz_content?.mc_questions?.length || 0} · Application: {Math.round(openScore)}/100
              </p>

              <Button
                size="lg"
                className="w-full h-14 text-base font-semibold gap-2"
                onClick={() => navigate('/dojo', {
                  state: {
                    fromLesson: true,
                    lessonId: lesson.id,
                    lessonTitle: lesson.title,
                    skillFocus: practice.skillFocus,
                    recommendedMode: practice.recommendedMode,
                    modeLabel: practice.label,
                  },
                })}
              >
                <Swords className="h-5 w-5" />
                Practice This in Dojo
              </Button>

              <Button variant="ghost" onClick={() => navigate('/learn')} className="w-full text-muted-foreground">
                Back to Courses
              </Button>
            </div>
          );
        })()}
      </div>
    </Layout>
  );
}

function LessonSection({
  title,
  icon,
  content,
  expanded,
  onToggle,
}: {
  title: string;
  icon: React.ReactNode;
  content: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 text-left"
      >
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-xs font-medium">{title}</p>
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {expanded && (
        <CardContent className="px-3 pb-3 pt-0">
          <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{content}</p>
        </CardContent>
      )}
    </Card>
  );
}

function MCQuestionCard({
  question,
  selected,
  onSelect,
  submitted,
}: {
  question: MCQuestion;
  selected?: string;
  onSelect: (answer: string) => void;
  submitted: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-medium">{question.question}</p>
        <div className="space-y-2">
          {question.options.map((opt) => {
            const letter = opt.charAt(0);
            const isSelected = selected === letter;
            const isCorrect = letter === question.correct_answer;

            let borderColor = 'border-border/60';
            if (submitted) {
              if (isCorrect) borderColor = 'border-green-500 bg-green-500/5';
              else if (isSelected && !isCorrect) borderColor = 'border-red-500 bg-red-500/5';
            } else if (isSelected) {
              borderColor = 'border-primary bg-primary/5';
            }

            return (
              <button
                key={opt}
                disabled={submitted}
                onClick={() => onSelect(letter)}
                className={cn(
                  'w-full text-left p-2.5 rounded-md border text-sm transition-colors',
                  borderColor
                )}
              >
                <div className="flex items-start gap-2">
                  {submitted && isCorrect && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />}
                  {submitted && isSelected && !isCorrect && <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />}
                  <span>{opt}</span>
                </div>
              </button>
            );
          })}
        </div>
        {submitted && (
          <p className="text-xs text-muted-foreground border-t border-border/40 pt-2">
            {question.explanation}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
