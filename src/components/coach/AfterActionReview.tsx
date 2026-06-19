import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, ChevronRight, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

const QUESTIONS = [
  { id: 'q1', label: 'What did you plan to accomplish on this call?', placeholder: 'Outcome you were aiming for going in...' },
  { id: 'q2', label: 'What signals did you get from the buyer?', placeholder: 'Verbal, non-verbal, what they said vs what they meant...' },
  { id: 'q3', label: 'What specifically did you miss or mishandle?', placeholder: 'The moment(s) where the call lost momentum...' },
  { id: 'q4', label: 'If you ran it again, what would you do differently in the first 5 minutes?', placeholder: 'One specific change to opening or framing...' },
  { id: 'q5', label: 'What will you drill this week because of this call?', placeholder: 'Specific skill or KI to practice...' },
];

interface AfterActionReviewProps {
  transcriptGradeId: string;
  existingResponses?: Record<string, string> | null;
  onSaved?: () => void;
}

export function AfterActionReview({ transcriptGradeId, existingResponses, onSaved }: AfterActionReviewProps) {
  const [responses, setResponses] = useState<Record<string, string>>(existingResponses ?? {});
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!!existingResponses?.completed_at);
  const [expanded, setExpanded] = useState(!existingResponses?.completed_at);

  const hasAnyAnswer = QUESTIONS.some(q => responses[q.id]?.trim());
  const isComplete = QUESTIONS.every(q => responses[q.id]?.trim());
  const answeredCount = QUESTIONS.filter(q => responses[q.id]?.trim()).length;

  const save = async () => {
    if (!isComplete) return;
    setSaving(true);
    await supabase
      .from('transcript_grades' as any)
      .update({ aar_responses: { ...responses, completed_at: new Date().toISOString() } })
      .eq('id', transcriptGradeId);
    setSaving(false);
    setSaved(true);
    setExpanded(false);
    onSaved?.();
  };

  if (saved && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full text-left p-3 rounded-lg border border-green-500/20 bg-green-500/5 flex items-center gap-2"
      >
        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">After-Action Review Complete</p>
          <p className="text-xs text-muted-foreground">{responses.q5 ? `Drilling: ${responses.q5.substring(0, 60)}…` : 'Tap to review'}</p>
        </div>
      </button>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">After-Action Review</p>
            <p className="text-xs text-muted-foreground">{answeredCount}/5 questions · your call debrief</p>
          </div>
          {answeredCount > 0 && (
            <Badge variant="outline" className="text-xs">{answeredCount}/5</Badge>
          )}
        </div>

        <div className="space-y-3">
          {QUESTIONS.map((q, idx) => (
            <div key={q.id} className={cn('space-y-1.5', idx > currentStep && !responses[q.id] && 'opacity-40')}>
              <p className="text-xs font-medium text-foreground">{idx + 1}. {q.label}</p>
              <Textarea
                placeholder={q.placeholder}
                className="min-h-[72px] text-xs resize-none"
                value={responses[q.id] ?? ''}
                onChange={e => {
                  setResponses(prev => ({ ...prev, [q.id]: e.target.value }));
                  if (e.target.value && idx === currentStep) setCurrentStep(Math.min(idx + 1, QUESTIONS.length - 1));
                }}
                onFocus={() => setCurrentStep(idx)}
              />
            </div>
          ))}
        </div>

        <Button
          className="w-full"
          variant={isComplete ? 'default' : 'outline'}
          disabled={!hasAnyAnswer || saving}
          onClick={save}
        >
          {saving ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</>
          ) : isComplete ? (
            <>Save Review <ChevronRight className="h-4 w-4 ml-1" /></>
          ) : (
            <>Save Progress ({answeredCount}/5)</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
