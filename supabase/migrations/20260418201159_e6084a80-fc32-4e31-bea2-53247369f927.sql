-- 1) Add confirmed_class column
ALTER TABLE public.strategy_promotion_proposals
  ADD COLUMN IF NOT EXISTS confirmed_class text;

-- 2) Constrain confirmed_class values (only valid classes)
ALTER TABLE public.strategy_promotion_proposals
  DROP CONSTRAINT IF EXISTS strategy_promotion_proposals_confirmed_class_check;
ALTER TABLE public.strategy_promotion_proposals
  ADD CONSTRAINT strategy_promotion_proposals_confirmed_class_check
  CHECK (
    confirmed_class IS NULL OR confirmed_class IN (
      'research_only', 'shared_intelligence', 'crm_contact'
    )
  );

-- 3) Expand status check constraint to include new explicit confirmed states.
--    We keep 'confirmed' for backward compatibility with already-confirmed rows.
ALTER TABLE public.strategy_promotion_proposals
  DROP CONSTRAINT IF EXISTS strategy_promotion_proposals_status_check;
ALTER TABLE public.strategy_promotion_proposals
  ADD CONSTRAINT strategy_promotion_proposals_status_check
  CHECK (status IN (
    'pending',
    'confirmed',                      -- legacy
    'confirmed_research_only',
    'confirmed_shared_intelligence',
    'confirmed_crm_contact',
    'promoted',
    'rejected',
    'failed',
    'superseded'
  ));

-- 4) Cleanup: remove the prematurely-promoted Matthew Pertgen rows that
--    were created under the old over-aggressive model (research-only person
--    surfaced in prep, never relationship-confirmed).
DELETE FROM public.account_contacts
  WHERE source_proposal_id = 'd57f23a4-11ff-4313-b28d-718efabf80b3';

DELETE FROM public.contacts
  WHERE id = '9ce36311-f6fb-4f52-9ac0-36ce4a45ec4d'
    AND source_proposal_id = 'd57f23a4-11ff-4313-b28d-718efabf80b3';

-- 5) Reset that proposal so the rep can re-review under the safer model
UPDATE public.strategy_promotion_proposals
   SET status = 'pending',
       promoted_record_id = NULL,
       promoted_at = NULL,
       promotion_error = NULL,
       confirmed_class = NULL,
       confirmed_at = NULL,
       confirmed_by = NULL
 WHERE id = 'd57f23a4-11ff-4313-b28d-718efabf80b3';

-- 6) Helpful index for filtering by class in review UI
CREATE INDEX IF NOT EXISTS idx_strategy_proposals_class
  ON public.strategy_promotion_proposals(thread_id, confirmed_class)
  WHERE confirmed_class IS NOT NULL;