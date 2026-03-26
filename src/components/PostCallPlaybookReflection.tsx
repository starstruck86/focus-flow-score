/**
 * Post-call playbook reflection prompt.
 * Appears after meetings to capture whether the recommended playbook was used.
 */
import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, ThumbsUp, ThumbsDown, X, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { usePlaybookUsageTracking } from '@/hooks/usePlaybookUsageTracking';

interface Props {
  playbookTitle: string;
  playbookId?: string;
  accountId?: string;
  opportunityId?: string;
  onDismiss: () => void;
  className?: string;
}

export const PostCallPlaybookReflection = memo(function PostCallPlaybookReflection({
  playbookTitle,
  playbookId,
  accountId,
  opportunityId,
  onDismiss,
  className,
}: Props) {
  const { track } = usePlaybookUsageTracking();
  const [usedApproach, setUsedApproach] = useState<boolean | null>(null);
  const [whatWorked, setWhatWorked] = useState('');
  const [whatDidnt, setWhatDidnt] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    track({
      playbookTitle,
      playbookId,
      eventType: 'post_call_feedback',
      accountId,
      opportunityId,
      feedbackUsedApproach: usedApproach ?? undefined,
      feedbackWhatWorked: whatWorked || undefined,
      feedbackWhatDidnt: whatDidnt || undefined,
    });
    if (usedApproach) {
      track({
        playbookTitle,
        playbookId,
        eventType: 'used_in_call',
        accountId,
        opportunityId,
      });
    }
    setSubmitted(true);
    setTimeout(onDismiss, 1500);
  };

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={cn("px-3 py-2 rounded-md bg-status-green/10 border border-status-green/20 text-center", className)}
      >
        <p className="text-xs text-status-green font-medium">✓ Feedback captured</p>
      </motion.div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className={cn(
          "rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2.5",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-xs font-medium text-foreground">
              Did you use "{playbookTitle}"?
            </span>
          </div>
          <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {usedApproach === null ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1 flex-1 border-status-green/30 text-status-green hover:bg-status-green/10"
              onClick={() => setUsedApproach(true)}
            >
              <ThumbsUp className="h-3 w-3" />
              Yes, used it
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1 flex-1 border-muted-foreground/30 text-muted-foreground hover:bg-muted/50"
              onClick={() => setUsedApproach(false)}
            >
              <ThumbsDown className="h-3 w-3" />
              No
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Textarea
              placeholder={usedApproach ? "What worked well?" : "Why not? What happened?"}
              value={usedApproach ? whatWorked : whatDidnt}
              onChange={e => usedApproach ? setWhatWorked(e.target.value) : setWhatDidnt(e.target.value)}
              className="min-h-[48px] text-xs resize-none bg-background/50"
              rows={2}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] text-muted-foreground"
                onClick={handleSubmit}
              >
                Skip
              </Button>
              <Button
                size="sm"
                className="h-6 text-[10px] gap-1 flex-1"
                onClick={handleSubmit}
              >
                <Send className="h-3 w-3" />
                Submit
              </Button>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
});
