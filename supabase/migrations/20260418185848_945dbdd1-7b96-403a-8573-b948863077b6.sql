-- Phase 3: Strategy promotion proposals (detect → propose → review)
-- NO writes to shared tables happen here. This table only captures candidates.

CREATE TABLE public.strategy_promotion_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  thread_id UUID NOT NULL REFERENCES public.strategy_threads(id) ON DELETE CASCADE,

  -- Provenance: at least one of these should be set
  source_message_id UUID NULL REFERENCES public.strategy_messages(id) ON DELETE SET NULL,
  source_artifact_id UUID NULL,

  -- What was detected
  proposal_type TEXT NOT NULL CHECK (proposal_type IN (
    'contact',
    'account_note',
    'account_intelligence',
    'opportunity_note',
    'opportunity_intelligence',
    'transcript',
    'resource_promotion',
    'artifact_promotion',
    'stakeholder',
    'risk',
    'blocker',
    'champion'
  )),

  -- Where it would land
  target_table TEXT NOT NULL,
  target_scope TEXT NOT NULL CHECK (target_scope IN ('account', 'opportunity', 'both')),
  target_account_id UUID NULL REFERENCES public.accounts(id) ON DELETE SET NULL,
  target_opportunity_id UUID NULL REFERENCES public.opportunities(id) ON DELETE SET NULL,

  -- The candidate payload + reasoning
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale TEXT NULL,
  scope_rationale TEXT NULL,

  -- Dedupe (e.g. "contact:email:foo@bar.com" or "risk:hash:abc123")
  dedupe_key TEXT NOT NULL,

  -- Review state
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'rejected', 'promoted', 'failed', 'superseded'
  )),
  confirmed_by UUID NULL,
  confirmed_at TIMESTAMPTZ NULL,
  rejected_reason TEXT NULL,

  -- Promoter state (filled in Phase 4 — kept null here)
  promoted_record_id UUID NULL,
  promoted_at TIMESTAMPTZ NULL,
  promotion_error TEXT NULL,

  -- Detector versioning (so we can iterate detector without losing audit)
  detector_version TEXT NOT NULL DEFAULT 'v1',
  detector_confidence NUMERIC(3,2) NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedupe within a thread+type (so the same detection from re-runs doesn't spam)
CREATE UNIQUE INDEX strategy_promotion_proposals_dedupe_uq
  ON public.strategy_promotion_proposals (thread_id, proposal_type, dedupe_key)
  WHERE status IN ('pending', 'confirmed');

CREATE INDEX strategy_promotion_proposals_user_status_idx
  ON public.strategy_promotion_proposals (user_id, status, created_at DESC);

CREATE INDEX strategy_promotion_proposals_thread_idx
  ON public.strategy_promotion_proposals (thread_id, status, created_at DESC);

CREATE INDEX strategy_promotion_proposals_account_idx
  ON public.strategy_promotion_proposals (target_account_id) WHERE target_account_id IS NOT NULL;

CREATE INDEX strategy_promotion_proposals_opp_idx
  ON public.strategy_promotion_proposals (target_opportunity_id) WHERE target_opportunity_id IS NOT NULL;

-- RLS
ALTER TABLE public.strategy_promotion_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own proposals"
  ON public.strategy_promotion_proposals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own proposals"
  ON public.strategy_promotion_proposals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own proposals"
  ON public.strategy_promotion_proposals FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own proposals"
  ON public.strategy_promotion_proposals FOR DELETE
  USING (auth.uid() = user_id);

-- Service role bypass (for detector edge function running with service key)
CREATE POLICY "Service role full access"
  ON public.strategy_promotion_proposals FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Updated-at trigger
CREATE TRIGGER set_strategy_promotion_proposals_updated_at
  BEFORE UPDATE ON public.strategy_promotion_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();