-- Add persisted recovery state fields to resources table
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS recovery_status text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS recovery_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS next_best_action text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manual_input_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS recovery_queue_bucket text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS recovery_attempt_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_recovery_error text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS access_type text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS content_classification text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS extraction_method text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manual_content_present boolean DEFAULT false;

-- Add index for recovery queue queries
CREATE INDEX IF NOT EXISTS idx_resources_recovery_status ON public.resources(recovery_status) WHERE recovery_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resources_recovery_queue_bucket ON public.resources(recovery_queue_bucket) WHERE recovery_queue_bucket IS NOT NULL;