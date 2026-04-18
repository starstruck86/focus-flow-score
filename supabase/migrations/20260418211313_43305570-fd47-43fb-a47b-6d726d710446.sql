-- Close the provenance hole on account_contacts so CRM writes from Strategy
-- carry the same lineage as the contacts row itself. Rule XII of Mode A.
ALTER TABLE public.account_contacts
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_strategy_thread_id uuid REFERENCES public.strategy_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_by uuid,
  ADD COLUMN IF NOT EXISTS promoted_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_account_contacts_source_proposal
  ON public.account_contacts(source_proposal_id) WHERE source_proposal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_contacts_source_thread
  ON public.account_contacts(source_strategy_thread_id) WHERE source_strategy_thread_id IS NOT NULL;