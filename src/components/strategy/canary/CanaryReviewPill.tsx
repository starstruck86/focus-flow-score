/**
 * CanaryReviewPill — compact "Last canary: …" badge in the Strategy header.
 */
import type { CanaryReviewRow, Decision } from '@/lib/strategy/canary/types';

interface Props {
  lastReview: CanaryReviewRow | null;
  onClick: () => void;
}

const DECISION_LABEL: Record<Decision, string> = {
  continue: 'Continue',
  fix: 'Fix',
  rollback: 'Roll back',
};

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function CanaryReviewPill({ lastReview, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-7 items-center gap-2 rounded-[4px] border border-border bg-background px-2 text-[11px] font-mono text-muted-foreground hover:bg-accent/50"
      title="Open canary review"
    >
      <span>Canary</span>
      {lastReview ? (
        <>
          <span aria-hidden>·</span>
          <span>{relativeDate(lastReview.created_at)}</span>
          <span aria-hidden>·</span>
          <span className="font-medium text-foreground">
            {DECISION_LABEL[lastReview.decision]}
          </span>
        </>
      ) : (
        <span className="italic">no reviews yet</span>
      )}
    </button>
  );
}
