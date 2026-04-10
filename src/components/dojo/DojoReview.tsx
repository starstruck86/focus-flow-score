/**
 * DojoReview — Critique a weak response, then rewrite it.
 * Dave generates a bad answer, user identifies flaws and rewrites.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Send, Loader2, Eye, AlertTriangle } from 'lucide-react';
import type { DojoScenario } from '@/lib/dojo/scenarios';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import type { DojoScoreResult } from '@/lib/dojo/types';
import { normalizeScoreResult } from '@/lib/dojo/types';

type ReviewPhase = 'loading' | 'diagnose' | 'rewrite' | 'scoring';

interface Props {
  scenario: DojoScenario;
  userId: string;
  onComplete: (result: DojoScoreResult & { diagnosisScore?: number; rewriteScore?: number; diagnosisFeedback?: string; rewriteFeedback?: string }) => void;
}

export default function DojoReview({ scenario, userId, onComplete }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [phase, setPhase] = useState<ReviewPhase>('loading');
  const [weakResponse, setWeakResponse] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [rewrite, setRewrite] = useState('');

  // Generate weak response on mount
  useEffect(() => {
    const generate = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('dojo-review-score', {
          body: {
            scenario: {
              skillFocus: scenario.skillFocus,
              context: scenario.context,
              objection: scenario.objection,
            },
            skillFocus: scenario.skillFocus,
            action: 'generate_weak',
          },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        setWeakResponse(data.weakResponse || 'I understand your concern. Our platform is really great and has lots of features that could help you. Let me send over some materials and we can set up a follow-up call to discuss further.');
        setPhase('diagnose');
      } catch (e) {
        console.error('Generate weak response error:', e);
        // Fallback
        setWeakResponse("I totally understand your concern. We actually have a lot of great features that address that. Our platform is used by hundreds of companies and they all love it. I'd love to set up another call to walk you through everything in detail — when works for you?");
        setPhase('diagnose');
      }
    };
    generate();
  }, [scenario]);

  useEffect(() => {
    if (phase === 'diagnose' || phase === 'rewrite') {
      setTimeout(() => textareaRef.current?.focus(), 300);
    }
  }, [phase]);

  const handleSubmitDiagnosis = () => {
    if (!diagnosis.trim()) return;
    setPhase('rewrite');
  };

  const handleSubmitRewrite = async () => {
    if (!rewrite.trim()) return;
    setPhase('scoring');

    try {
      const { data, error } = await supabase.functions.invoke('dojo-review-score', {
        body: {
          scenario: {
            skillFocus: scenario.skillFocus,
            context: scenario.context,
            objection: scenario.objection,
          },
          skillFocus: scenario.skillFocus,
          action: 'score_review',
          weakResponse,
          userDiagnosis: diagnosis,
          userRewrite: rewrite,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const result = normalizeScoreResult(data as Record<string, unknown>);
      onComplete({
        ...result,
        diagnosisScore: data.diagnosisScore,
        rewriteScore: data.rewriteScore,
        diagnosisFeedback: data.diagnosisFeedback,
        rewriteFeedback: data.rewriteFeedback,
      });
    } catch (e) {
      console.error('Score review error:', e);
      toast.error('Failed to score review');
      setPhase('rewrite');
    }
  };

  if (phase === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Dave is writing a weak response for you to critique...</p>
      </div>
    );
  }

  if (phase === 'scoring') {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Dave is scoring your diagnosis and rewrite...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Weak response to critique */}
      <Card className="border-red-500/20 bg-red-500/5">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
            <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">
              Weak Response — Find the Problems
            </p>
          </div>
          <p className="text-sm text-foreground leading-relaxed italic">
            "{weakResponse}"
          </p>
        </CardContent>
      </Card>

      {phase === 'diagnose' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          <p className="text-sm text-muted-foreground font-medium">
            What's wrong with this response? Be specific.
          </p>
          <Textarea
            ref={textareaRef}
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder="Identify the specific problems — what mistakes did this rep make?"
            className="min-h-[100px] text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmitDiagnosis();
            }}
          />
          <Button
            className="w-full gap-2"
            disabled={!diagnosis.trim()}
            onClick={handleSubmitDiagnosis}
          >
            <Eye className="h-4 w-4" />
            Submit Diagnosis
          </Button>
        </motion.div>
      )}

      {phase === 'rewrite' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          {/* Show their diagnosis */}
          <Card className="border-border/40">
            <CardContent className="p-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Your Diagnosis</p>
              <p className="text-xs text-muted-foreground italic">"{diagnosis}"</p>
            </CardContent>
          </Card>

          <p className="text-sm text-muted-foreground font-medium">
            Now rewrite it. What should this rep have said instead?
          </p>
          <Textarea
            ref={textareaRef}
            value={rewrite}
            onChange={(e) => setRewrite(e.target.value)}
            placeholder="Write what a strong rep would actually say..."
            className="min-h-[120px] text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmitRewrite();
            }}
          />
          <Button
            className="w-full gap-2"
            disabled={!rewrite.trim()}
            onClick={handleSubmitRewrite}
          >
            <Send className="h-4 w-4" />
            Submit Rewrite
          </Button>
        </motion.div>
      )}
    </div>
  );
}
