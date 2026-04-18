-- 1. Extend strategy_threads with trust state columns
ALTER TABLE public.strategy_threads
  ADD COLUMN IF NOT EXISTS trust_state TEXT NOT NULL DEFAULT 'safe',
  ADD COLUMN IF NOT EXISTS trust_state_reason TEXT,
  ADD COLUMN IF NOT EXISTS entity_signals JSONB,
  ADD COLUMN IF NOT EXISTS trust_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cloned_from_thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL;

ALTER TABLE public.strategy_threads
  DROP CONSTRAINT IF EXISTS strategy_threads_trust_state_check;
ALTER TABLE public.strategy_threads
  ADD CONSTRAINT strategy_threads_trust_state_check
  CHECK (trust_state IN ('safe','warning','blocked'));

-- 2. Conflicts table — durable record of every conflict raised by the detector
CREATE TABLE IF NOT EXISTS public.strategy_thread_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.strategy_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  conflict_kind TEXT NOT NULL,           -- 'content_vs_account' | 'opp_account_mismatch' | 'person_company_mismatch' | 'artifact_company_mismatch' | 'relink_target_mismatch'
  severity TEXT NOT NULL,                -- 'warning' | 'blocking'
  reason TEXT NOT NULL,                  -- plain-English explanation
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_account_name TEXT,            -- the OTHER company seen in content (e.g. "Lima One")
  linked_account_id UUID,                -- snapshot of what the thread was linked to at detection time
  linked_account_name TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution_action TEXT,                -- 'unlinked' | 'cloned' | 'override_confirmed' | 'detector_recleared'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT strategy_thread_conflicts_severity_check CHECK (severity IN ('warning','blocking'))
);

CREATE INDEX IF NOT EXISTS strategy_thread_conflicts_thread_idx
  ON public.strategy_thread_conflicts(thread_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS strategy_thread_conflicts_user_idx
  ON public.strategy_thread_conflicts(user_id);

ALTER TABLE public.strategy_thread_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners select their conflicts" ON public.strategy_thread_conflicts;
DROP POLICY IF EXISTS "Owners insert their conflicts" ON public.strategy_thread_conflicts;
DROP POLICY IF EXISTS "Owners update their conflicts" ON public.strategy_thread_conflicts;
DROP POLICY IF EXISTS "Owners delete their conflicts" ON public.strategy_thread_conflicts;

CREATE POLICY "Owners select their conflicts"
  ON public.strategy_thread_conflicts FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Owners insert their conflicts"
  ON public.strategy_thread_conflicts FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners update their conflicts"
  ON public.strategy_thread_conflicts FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "Owners delete their conflicts"
  ON public.strategy_thread_conflicts FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER strategy_thread_conflicts_updated_at
  BEFORE UPDATE ON public.strategy_thread_conflicts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Trust-state computation helper used by both UI and edge functions.
-- Returns the worst unresolved severity for a thread, mapped to trust_state.
CREATE OR REPLACE FUNCTION public.compute_thread_trust_state(p_thread_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.strategy_thread_conflicts
      WHERE thread_id = p_thread_id AND resolved_at IS NULL AND severity = 'blocking'
    ) THEN 'blocked'
    WHEN EXISTS (
      SELECT 1 FROM public.strategy_thread_conflicts
      WHERE thread_id = p_thread_id AND resolved_at IS NULL AND severity = 'warning'
    ) THEN 'warning'
    ELSE 'safe'
  END;
$$;