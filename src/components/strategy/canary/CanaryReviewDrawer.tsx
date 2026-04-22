/**
 * CanaryReviewDrawer — hosts parser → summary → decision actions.
 *
 * Modes:
 *   - 'edit'     : empty parser, ready for a new paste.
 *   - 'readonly' : renders a previously saved review (no parser, no actions).
 *
 * After a successful save, drawer auto-collapses (caller closes via onOpenChange)
 * and the parent CanaryReviewPill picks up the new lastReview.
 */
import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { CanaryResultParser } from './CanaryResultParser';
import { EvidenceSummaryCard } from './EvidenceSummaryCard';
import { ProductionDecisionActions } from './ProductionDecisionActions';
import { buildEvidenceSummary, getRecommendation } from '@/lib/strategy/canary/recommend';
import { fetchLatestCanaryReview } from '@/lib/strategy/canary/repository';
import type {
  CanaryReviewRow,
  EvidenceSummary,
  ParsedCanary,
} from '@/lib/strategy/canary/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, drawer opens read-only on this saved review. */
  readonlyReview?: CanaryReviewRow | null;
  /** Notify parent so it can refresh the pill. */
  onSaved?: (review: CanaryReviewRow) => void;
}

export function CanaryReviewDrawer({
  open,
  onOpenChange,
  readonlyReview,
  onSaved,
}: Props) {
  const { user } = useAuth();
  const [parsed, setParsed] = useState<ParsedCanary | null>(null);
  const [rawInput, setRawInput] = useState('');
  const [evidence, setEvidence] = useState<EvidenceSummary | null>(null);
  const [mode, setMode] = useState<'edit' | 'readonly'>(
    readonlyReview ? 'readonly' : 'edit',
  );

  // Sync mode + content when the drawer is opened with a readonly review.
  useEffect(() => {
    if (!open) return;
    if (readonlyReview) {
      setMode('readonly');
      setParsed(readonlyReview.parsed_json);
      setEvidence(readonlyReview.evidence_summary);
      setRawInput(readonlyReview.raw_input);
    } else {
      setMode('edit');
      setParsed(null);
      setEvidence(null);
      setRawInput('');
    }
  }, [open, readonlyReview]);

  const handleParsed = (next: ParsedCanary, raw: string) => {
    setParsed(next);
    setRawInput(raw);
    setEvidence(buildEvidenceSummary(next));
  };

  const handleSaved = async (row: CanaryReviewRow) => {
    onSaved?.(row);
    // Refresh pill via parent; close the drawer.
    onOpenChange(false);
    // Best-effort no-op fetch to ensure RLS round-trip succeeded.
    if (user) await fetchLatestCanaryReview(user.id).catch(() => null);
  };

  const recommendation = evidence?.recommendation ?? 'fix';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-[640px]"
      >
        <SheetHeader>
          <SheetTitle>Canary review</SheetTitle>
          <SheetDescription>
            Paste raw canary results, review evidence, record a decision.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-4">
          {mode === 'readonly' && readonlyReview && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-foreground">Saved review</div>
                  <div className="text-muted-foreground">
                    {new Date(readonlyReview.created_at).toLocaleString()} · decision:{' '}
                    <span className="font-medium text-foreground">
                      {readonlyReview.decision}
                    </span>
                    {readonlyReview.decision !== readonlyReview.recommendation && (
                      <span className="ml-1 text-warning-foreground">
                        (override of recommendation: {readonlyReview.recommendation})
                      </span>
                    )}
                  </div>
                  {readonlyReview.decision_notes && (
                    <div className="mt-1 text-muted-foreground">
                      Notes: {readonlyReview.decision_notes}
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMode('edit');
                    setParsed(null);
                    setEvidence(null);
                    setRawInput('');
                  }}
                >
                  Start new review
                </Button>
              </div>
            </div>
          )}

          {mode === 'edit' && (
            <CanaryResultParser onParsed={handleParsed} />
          )}

          {evidence && parsed && (
            <EvidenceSummaryCard evidence={evidence} />
          )}

          {mode === 'edit' && evidence && parsed && (
            <ProductionDecisionActions
              parsed={parsed}
              evidence={evidence}
              rawInput={rawInput}
              recommendation={recommendation}
              onSaved={handleSaved}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
