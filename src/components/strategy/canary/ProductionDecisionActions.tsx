/**
 * ProductionDecisionActions — three decision buttons + confirm dialog.
 *
 * The system records the decision only. It never flips flags, deploys, or
 * rolls back. recommendation_matched is computed at runtime, not stored.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { insertCanaryReview } from '@/lib/strategy/canary/repository';
import type {
  CanaryReviewRow,
  Decision,
  EvidenceSummary,
  ParsedCanary,
} from '@/lib/strategy/canary/types';

interface Props {
  parsed: ParsedCanary;
  evidence: EvidenceSummary;
  rawInput: string;
  recommendation: Decision;
  onSaved: (review: CanaryReviewRow) => void;
}

const DECISION_META: Record<Decision, { label: string; confirm: string }> = {
  continue: {
    label: 'Continue canary',
    confirm:
      'Confirm: extend canary to 48h, expand to 1–2 ICs. The system will not perform any rollout — it only records this decision.',
  },
  fix: {
    label: 'Fix before continuing',
    confirm:
      'Confirm: hold canary. You will manually set ROUTER_AUTO_PROMOTE=0 and address the isolated issue.',
  },
  rollback: {
    label: 'Roll back',
    confirm:
      'Confirm: rollback recorded. You will manually set ROUTER_ENABLED=0 and redeploy strategy-chat.',
  },
};

export function ProductionDecisionActions({
  parsed,
  evidence,
  rawInput,
  recommendation,
  onSaved,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [pending, setPending] = useState<Decision | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    if (!pending || !user) return;
    setSaving(true);
    try {
      const row = await insertCanaryReview({
        userId: user.id,
        rawInput,
        parsed,
        evidence,
        recommendation,
        decision: pending,
        decisionNotes: notes.trim() || null,
        flagState: parsed.flag_state,
      });
      toast({ title: 'Canary review saved', description: DECISION_META[pending].label });
      setPending(null);
      setNotes('');
      onSaved(row);
    } catch (err) {
      toast({
        title: 'Failed to save review',
        description: (err as Error)?.message ?? 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const renderButton = (d: Decision) => {
    const isRecommended = d === recommendation;
    return (
      <Button
        key={d}
        variant={isRecommended ? 'default' : 'outline'}
        size="sm"
        onClick={() => setPending(d)}
        disabled={!user}
        title={!user ? 'Sign in to record a decision' : undefined}
      >
        {isRecommended && <span aria-hidden>★</span>}
        {DECISION_META[d].label}
      </Button>
    );
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Production decision
        </div>
        <div className="flex flex-wrap gap-2">
          {(['continue', 'fix', 'rollback'] as Decision[]).map(renderButton)}
        </div>
        <div className="text-[11px] text-muted-foreground">
          The system records your decision only — it does not flip flags or trigger deploys.
        </div>
      </div>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? DECISION_META[pending].label : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? DECISION_META[pending].confirm : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Notes (optional)</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context, follow-ups, owners…"
              className="min-h-[80px] text-xs"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={saving}>
              {saving ? 'Saving…' : 'Confirm & save'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
