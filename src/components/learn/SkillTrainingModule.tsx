/**
 * SkillTrainingModule — Deep structured learning surface.
 *
 * Replaces shallow Skill Builder content with: mental model, failure/better patterns,
 * before/after examples, mechanism explanation, micro drill with feedback, and practice launch.
 * 
 * Now supports adaptive emphasis: when topBlocker or focusPattern is available,
 * the micro drill is customized to target the user's actual gap.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, XCircle, CheckCircle2, Lightbulb, PenLine, Swords, ChevronRight, AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import type { TrainingContent } from '@/lib/learning/skillBuilderContent';
import type { SkillSession } from '@/lib/learning/skillSession';
import { skillSessionToParams } from '@/lib/learning/skillSession';
import { deriveAdaptiveEmphasis } from '@/lib/learning/adaptiveSkillBuilder';
import { MicroDrillResultCard, type MicroDrillResult } from '@/components/learn/MicroDrillResultCard';

interface Props {
  content: TrainingContent;
  session: SkillSession;
  onComplete?: () => void;
}

type Step = 'mental_model' | 'patterns' | 'mechanism' | 'micro_drill' | 'practice';

const STEPS: Step[] = ['mental_model', 'patterns', 'mechanism', 'micro_drill', 'practice'];
const STEP_LABELS: Record<Step, string> = {
  mental_model: 'Mental Model',
  patterns: 'Pattern Shift',
  mechanism: 'Why It Works',
  micro_drill: 'Micro Drill',
  practice: 'Practice',
};

export function SkillTrainingModule({ content, session, onComplete }: Props) {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [drillResponse, setDrillResponse] = useState('');
  const [drillResult, setDrillResult] = useState<MicroDrillResult | null>(null);
  const [drillScoring, setDrillScoring] = useState(false);
  const [drillCoachingCue, setDrillCoachingCue] = useState<string | null>(null);
  const step = STEPS[currentStep];

  // Derive adaptive emphasis
  const emphasis = deriveAdaptiveEmphasis(session, content);
  const drillPrompt = emphasis.customDrillPrompt ?? content.microDrill.prompt;
  const drillInstruction = emphasis.customDrillInstruction ?? content.microDrill.instruction;

  const advance = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const scoreDrill = useCallback(async () => {
    if (drillResponse.length < 10) return;
    setDrillScoring(true);
    setDrillResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('score-micro-drill', {
        body: {
          skill: session.skillId,
          prompt: drillPrompt,
          instruction: drillInstruction,
          response: drillResponse,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const result = data as MicroDrillResult;
      setDrillResult(result);
      setDrillCoachingCue(result.coachingCue);
    } catch (err) {
      console.error('Micro-drill scoring error:', err);
      // Fallback: let user proceed anyway
      setDrillResult({
        score: 5,
        strength: 'Good effort writing out your response.',
        miss: 'Could not evaluate — try practicing live.',
        betterVersion: drillResponse,
        ready: true,
        coachingCue: 'Focus on applying the pattern you just learned.',
      });
    } finally {
      setDrillScoring(false);
    }
  }, [drillResponse, session.skillId, drillPrompt, drillInstruction]);

  const handleRevise = () => {
    setDrillResult(null);
  };

  const launchPractice = () => {
    navigate(`/dojo/session?${skillSessionToParams(session)}`, {
      state: {
        skillSession: session,
        skillFocus: session.skillId,
        fromSkillBuilder: true,
        ...(drillCoachingCue ? { microDrillCue: drillCoachingCue } : {}),
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            {STEP_LABELS[step]} · {currentStep + 1}/{STEPS.length}
          </p>
          <div className="flex gap-1">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={cn(
                  'h-1.5 w-6 rounded-full transition-colors',
                  i <= currentStep ? 'bg-primary' : 'bg-muted',
                )}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Adaptive emphasis note */}
      {emphasis.emphasisNote && step !== 'practice' && (
        <div className="flex gap-2 px-2.5 py-2 rounded-md bg-amber-500/5 border border-amber-500/15">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-foreground leading-relaxed">{emphasis.emphasisNote}</p>
        </div>
      )}

      {/* Step content */}
      {step === 'mental_model' && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Brain className="h-4.5 w-4.5 text-primary" />
            <p className="text-sm font-bold text-foreground">Mental Model</p>
          </div>
          <p className="text-base font-semibold text-foreground leading-snug">
            {content.mentalModel.title}
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {content.mentalModel.body}
          </p>
          <Button onClick={advance} className="w-full gap-1.5">
            Next: Pattern Shift <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {step === 'patterns' && (
        <div className="space-y-4">
          {/* Failure pattern */}
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" />
              <p className="text-sm font-bold text-foreground">{content.failurePattern.label}</p>
              <Badge variant="outline" className="text-[9px] border-destructive/30 text-destructive">
                Weak Pattern
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {content.failurePattern.description}
            </p>
            <div className="rounded-lg bg-card border border-border p-3">
              <p className="text-sm text-muted-foreground italic leading-relaxed">
                {content.failurePattern.example}
              </p>
            </div>
          </div>

          {/* Better pattern */}
          <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <p className="text-sm font-bold text-foreground">{content.betterPattern.label}</p>
              <Badge variant="outline" className="text-[9px] border-green-500/30 text-green-600 dark:text-green-400">
                Strong Pattern
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {content.betterPattern.description}
            </p>
            <div className="rounded-lg bg-card border border-border p-3">
              <p className="text-sm text-foreground italic leading-relaxed">
                {content.betterPattern.example}
              </p>
            </div>
          </div>

          <Button onClick={advance} className="w-full gap-1.5">
            Next: Why It Works <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {step === 'mechanism' && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4.5 w-4.5 text-amber-500" />
            <p className="text-sm font-bold text-foreground">Why the Better Version Works</p>
          </div>
          <p className="text-sm text-foreground leading-relaxed">
            {content.mechanism}
          </p>
          <div className="rounded-lg bg-primary/5 border border-primary/10 p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Scoring Dimensions
            </p>
            <div className="flex flex-wrap gap-1.5">
              {content.scoringDimensions.map(d => (
                <Badge key={d} variant="secondary" className="text-[10px] capitalize">
                  {d.replace(/([A-Z])/g, ' $1').trim()}
                </Badge>
              ))}
            </div>
          </div>
          <Button onClick={advance} className="w-full gap-1.5">
            Next: Micro Drill <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {step === 'micro_drill' && (
        <div className="rounded-xl border border-primary/20 bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <PenLine className="h-4.5 w-4.5 text-primary" />
            <p className="text-sm font-bold text-foreground">Micro Drill</p>
            {emphasis.drillVariant !== 'default' && (
              <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-600 dark:text-amber-400">
                Adapted
              </Badge>
            )}
          </div>

          {/* Scenario */}
          <div className="rounded-lg bg-muted/50 border border-border p-3">
            <p className="text-sm text-foreground leading-relaxed">{drillPrompt}</p>
          </div>

          {/* Instruction */}
          <p className="text-xs text-muted-foreground leading-relaxed italic">{drillInstruction}</p>

          {/* Response area */}
          <textarea
            value={drillResponse}
            onChange={(e) => setDrillResponse(e.target.value)}
            className="w-full h-24 rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Write your response…"
            disabled={drillScoring}
          />

          {/* Result card — shown after scoring */}
          {(drillResult || drillScoring) && (
            <MicroDrillResultCard result={drillResult!} isLoading={drillScoring} />
          )}

          {/* CTAs — change based on state */}
          {!drillResult && !drillScoring && (
            <>
              <Button
                onClick={scoreDrill}
                className="w-full gap-1.5"
                disabled={drillResponse.length < 10}
              >
                Check My Answer
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">
                Write at least a short response to get feedback
              </p>
            </>
          )}

          {drillResult && (
            <div className="flex gap-2">
              <Button
                onClick={handleRevise}
                variant="outline"
                className="flex-1 gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Revise Answer
              </Button>
              <Button
                onClick={advance}
                className="flex-1 gap-1.5"
              >
                Continue to Practice <Swords className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}

      {step === 'practice' && (
        <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" />
            <p className="text-base font-bold text-foreground">Practice: {session.skillName}</p>
          </div>

          {/* Coaching cue from micro-drill */}
          {drillCoachingCue && (
            <div className="rounded-md bg-primary/5 border border-primary/15 px-3 py-2">
              <p className="text-xs text-foreground leading-relaxed">
                <span className="font-semibold text-primary">Your focus:</span> {drillCoachingCue}
              </p>
            </div>
          )}

          <p className="text-sm text-muted-foreground leading-relaxed">
            You've reviewed the mental model, studied the pattern shift, and completed a micro drill.
            Now apply it in a live simulation. The Dojo will score you on:
          </p>

          <div className="flex flex-wrap gap-1.5">
            {content.scoringDimensions.map(d => (
              <Badge key={d} variant="outline" className="text-[10px] capitalize border-primary/30 text-primary">
                {d.replace(/([A-Z])/g, ' $1').trim()}
              </Badge>
            ))}
          </div>

          <Button onClick={launchPractice} className="w-full gap-1.5" size="lg">
            <Swords className="h-4 w-4" />
            Launch Practice Rep
          </Button>

          {onComplete && (
            <Button onClick={onComplete} variant="ghost" className="w-full text-xs">
              Skip — Back to Learn
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
