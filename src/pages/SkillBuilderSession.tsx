/**
 * Skill Builder Session Page
 *
 * Runs a structured skill training session block by block.
 * KI intro → Rep (via Dojo) → Reflection
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { generateSkillTrack, type SkillTrack, type SkillBlock } from '@/lib/learning/skillBuilderEngine';
import { SKILL_LABELS, type SkillFocus } from '@/lib/dojo/scenarios';
import { FOCUS_PATTERN_LABELS } from '@/lib/dojo/focusPatterns';
import { Loader2, BookOpen, Dumbbell, Brain, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { LevelProgressFeedbackCard } from '@/components/learn/LevelProgressFeedbackCard';
import { useSkillLevels } from '@/hooks/useSkillLevels';

type SessionState = 'generating' | 'active' | 'completed' | 'error';

export default function SkillBuilderSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const state = location.state as { skill?: SkillFocus; duration?: number } | null;

  const [sessionState, setSessionState] = useState<SessionState>('generating');
  const [track, setTrack] = useState<SkillTrack | null>(null);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [repScores, setRepScores] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

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
        // Persist session
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

        if (dbErr) {
          console.error('Failed to persist session:', dbErr);
        }

        setTrack(generatedTrack);
        setSessionId((data as any)?.id ?? null);
        setSessionState('active');
      })
      .catch((err) => {
        console.error('Failed to generate track:', err);
        setError('Failed to generate training session.');
        setSessionState('error');
      });
  }, [user, state?.skill, state?.duration]);

  const currentBlock = track?.blocks[currentBlockIndex] ?? null;
  const totalBlocks = track?.blocks.length ?? 0;
  const progress = totalBlocks > 0 ? Math.round(((currentBlockIndex) / totalBlocks) * 100) : 0;

  const advanceBlock = useCallback(() => {
    if (!track) return;
    const next = currentBlockIndex + 1;
    if (next >= track.blocks.length) {
      // Session complete
      completeSession();
    } else {
      setCurrentBlockIndex(next);
    }
  }, [currentBlockIndex, track]);

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
    if (!sessionId) return;

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

    toast.success('Skill Builder session complete!');
  }, [sessionId, repScores]);

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

  return (
    <Layout>
      <div className={cn('px-4 pt-4 space-y-4', SHELL.main.bottomPad)}>
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              Skill Builder — {track.skillLabel}
            </p>
            <Badge variant="outline" className="text-[10px]">
              Level {track.currentLevel}: {track.levelName}
            </Badge>
          </div>
          {/* Progress bar */}
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
              <CheckCircle2 className="h-5 w-5 text-green-500" />
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
            <div className="flex gap-2">
              <button
                onClick={() => navigate('/learn')}
                className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              >
                Back to Learn
              </button>
            </div>
          </div>
        )}

        {/* Active block rendering */}
        {sessionState === 'active' && currentBlock && (
          <BlockRenderer
            block={currentBlock}
            onAdvance={advanceBlock}
            onStartRep={startRep}
            onRepComplete={handleRepComplete}
          />
        )}
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
}: {
  block: SkillBlock;
  onAdvance: () => void;
  onStartRep: (block: SkillBlock) => void;
  onRepComplete: (score?: number) => void;
}) {
  switch (block.type) {
    case 'mental_model':
      return <MentalModelBlock block={block} onAdvance={onAdvance} />;
    case 'ki_intro':
      return <KIIntroBlock block={block} onAdvance={onAdvance} />;
    case 'rep':
      return <RepBlock block={block} onStartRep={onStartRep} />;
    case 'reflection':
      return <ReflectionBlock block={block} onAdvance={onAdvance} />;
    default:
      return null;
  }
}

function MentalModelBlock({ block, onAdvance }: { block: SkillBlock & { type: 'mental_model' }; onAdvance: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium">Mental Model</p>
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

function KIIntroBlock({ block, onAdvance }: { block: SkillBlock & { type: 'ki_intro' }; onAdvance: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium">Knowledge Focus</p>
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

function RepBlock({ block, onStartRep }: { block: SkillBlock & { type: 'rep' }; onStartRep: (block: SkillBlock) => void }) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Dumbbell className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium">Practice Rep</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm text-foreground">{block.scenarioContext}</p>
        <div className="rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground italic">"{block.scenarioObjection}"</p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {block.difficulty}
        </Badge>
      </div>
      <button
        onClick={() => onStartRep(block)}
        className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-1"
      >
        Run This Rep <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ReflectionBlock({ block, onAdvance }: { block: SkillBlock & { type: 'reflection' }; onAdvance: () => void }) {
  const [reflection, setReflection] = useState('');

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-amber-500" />
        <p className="text-sm font-medium">Reflect</p>
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
