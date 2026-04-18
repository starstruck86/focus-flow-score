-- Phase 4: Promoter write-back provenance
-- Add provenance columns to shared system-of-record tables so any row that
-- originated from a Strategy proposal is fully traceable back to its source.

-- contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_strategy_thread_id uuid REFERENCES public.strategy_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_proposal_id uuid REFERENCES public.strategy_promotion_proposals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_by uuid;

CREATE INDEX IF NOT EXISTS idx_contacts_source_proposal ON public.contacts(source_proposal_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_email_per_user
  ON public.contacts(user_id, lower(email)) WHERE email IS NOT NULL AND email <> '';

-- call_transcripts
ALTER TABLE public.call_transcripts
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_strategy_thread_id uuid REFERENCES public.strategy_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_proposal_id uuid REFERENCES public.strategy_promotion_proposals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_by uuid;

CREATE INDEX IF NOT EXISTS idx_call_transcripts_source_proposal ON public.call_transcripts(source_proposal_id);

-- resources
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_strategy_thread_id uuid REFERENCES public.strategy_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_proposal_id uuid REFERENCES public.strategy_promotion_proposals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_strategy_artifact_id uuid REFERENCES public.strategy_artifacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_by uuid,
  ADD COLUMN IF NOT EXISTS promotion_scope text;

CREATE INDEX IF NOT EXISTS idx_resources_source_proposal ON public.resources(source_proposal_id);
CREATE INDEX IF NOT EXISTS idx_resources_source_artifact ON public.resources(source_strategy_artifact_id);

-- account_contacts: add proposal provenance for join-row dedupe
ALTER TABLE public.account_contacts
  ADD COLUMN IF NOT EXISTS source_proposal_id uuid REFERENCES public.strategy_promotion_proposals(id) ON DELETE SET NULL;

-- account_strategy_memory & opportunity_strategy_memory: link back to the proposal that created them
ALTER TABLE public.account_strategy_memory
  ADD COLUMN IF NOT EXISTS source_proposal_id uuid REFERENCES public.strategy_promotion_proposals(id) ON DELETE SET NULL;

ALTER TABLE public.opportunity_strategy_memory
  ADD COLUMN IF NOT EXISTS source_proposal_id uuid REFERENCES public.strategy_promotion_proposals(id) ON DELETE SET NULL;
