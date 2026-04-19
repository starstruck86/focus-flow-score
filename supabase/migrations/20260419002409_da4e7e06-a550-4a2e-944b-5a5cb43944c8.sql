ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz,
  ADD COLUMN IF NOT EXISTS quarantine_reason text;

CREATE INDEX IF NOT EXISTS idx_resources_quarantined_at
  ON public.resources (quarantined_at)
  WHERE quarantined_at IS NOT NULL;

-- Quarantine the contaminated artifact-promoted resource on Adore Me
UPDATE public.resources
SET quarantined_at = now(),
    quarantine_reason = 'Source Strategy thread d4f99428 references "Lima One" but is linked to "Adore Me". Quarantined pending re-promotion from the correct entity.'
WHERE id = '04edb2aa-8062-4371-ac58-746e3bfa6cbb'
  AND quarantined_at IS NULL;

-- Hide the contaminated account_strategy_memory row from the Adore Me surface
UPDATE public.account_strategy_memory
SET is_irrelevant = true,
    updated_at = now()
WHERE id = '2b8dd172-5506-42ce-b3cc-b871325c3311'
  AND is_irrelevant = false;

-- Reject the pending Matthew Pertgen contact proposal so it cannot be promoted while blocked
UPDATE public.strategy_promotion_proposals
SET status = 'rejected',
    rejected_reason = 'Thread d4f99428 in blocking conflict (content references Lima One but linked to Adore Me). Contact must be re-staged from the correct entity.',
    updated_at = now()
WHERE id = 'd57f23a4-11ff-4313-b28d-718efabf80b3'
  AND status = 'pending';