/**
 * Lightweight inline feedback controls for playbook sections and KI placements.
 */
import { useState } from 'react';
import { ThumbsUp, ThumbsDown, ArrowRightLeft, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePlaybookFeedback, type FeedbackType, type TargetType } from '@/hooks/usePlaybookFeedback';

interface SectionFeedbackProps {
  stageId: string;
  framework?: string;
  sectionHeading: string;
}

export function SectionFeedback({ stageId, framework, sectionHeading }: SectionFeedbackProps) {
  const [submitted, setSubmitted] = useState<FeedbackType | null>(null);
  const feedback = usePlaybookFeedback();

  const submit = (type: 'section_useful' | 'section_not_useful') => {
    if (submitted) return;
    setSubmitted(type);
    feedback.mutate({
      stageId,
      feedbackType: type,
      targetType: 'section',
      framework,
      sectionHeading,
    });
  };

  if (submitted) {
    return (
      <span className="text-[9px] text-muted-foreground/60 italic">
        {submitted === 'section_useful' ? '✓ Helpful' : '✗ Not helpful'}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5 opacity-0 group-hover/section:opacity-100 transition-opacity">
      <button
        onClick={(e) => { e.stopPropagation(); submit('section_useful'); }}
        className="p-0.5 rounded hover:bg-accent/50 text-muted-foreground/50 hover:text-emerald-500 transition-colors"
        title="This section is useful"
      >
        <ThumbsUp className="h-3 w-3" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); submit('section_not_useful'); }}
        className="p-0.5 rounded hover:bg-accent/50 text-muted-foreground/50 hover:text-destructive transition-colors"
        title="This section is not useful"
      >
        <ThumbsDown className="h-3 w-3" />
      </button>
    </span>
  );
}

interface KIFeedbackProps {
  stageId: string;
  framework?: string;
  sectionHeading: string;
  kiId: string;
  kiTitle: string;
}

export function KIPlacementFeedback({ stageId, framework, sectionHeading, kiId, kiTitle }: KIFeedbackProps) {
  const [submitted, setSubmitted] = useState(false);
  const feedback = usePlaybookFeedback();

  const submit = () => {
    if (submitted) return;
    setSubmitted(true);
    feedback.mutate({
      stageId,
      feedbackType: 'wrong_section',
      targetType: 'ki_placement',
      targetId: kiId,
      framework,
      sectionHeading,
      kiTitle,
    });
  };

  if (submitted) {
    return <span className="text-[9px] text-muted-foreground/60 italic">Noted</span>;
  }

  return (
    <button
      onClick={submit}
      className="p-0.5 rounded hover:bg-accent/50 text-muted-foreground/40 hover:text-amber-500 transition-colors opacity-0 group-hover/ki:opacity-100"
      title="Wrong section for this KI"
    >
      <ArrowRightLeft className="h-3 w-3" />
    </button>
  );
}

interface ItemFeedbackProps {
  stageId: string;
  framework?: string;
  sectionHeading: string;
  itemContent: string;
}

export function PlaybookItemFeedback({ stageId, framework, sectionHeading, itemContent }: ItemFeedbackProps) {
  const [submitted, setSubmitted] = useState(false);
  const feedback = usePlaybookFeedback();

  const submit = () => {
    if (submitted) return;
    setSubmitted(true);
    feedback.mutate({
      stageId,
      feedbackType: 'too_generic',
      targetType: 'playbook_item',
      framework,
      sectionHeading,
      metadata: { content_preview: itemContent.slice(0, 120) },
    });
  };

  if (submitted) {
    return <span className="text-[9px] text-destructive/60 italic">Flagged</span>;
  }

  return (
    <button
      onClick={submit}
      className="p-0.5 rounded hover:bg-accent/50 text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover/item:opacity-100"
      title="Too generic"
    >
      <AlertTriangle className="h-2.5 w-2.5" />
    </button>
  );
}
