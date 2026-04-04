-- Create the dedicated attempt history table
CREATE TABLE public.resource_extraction_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  strategy text NOT NULL,
  ki_count integer NOT NULL DEFAULT 0,
  raw_item_count integer NOT NULL DEFAULT 0,
  validated_count integer NOT NULL DEFAULT 0,
  deduped_count integer NOT NULL DEFAULT 0,
  min_ki_floor integer NOT NULL DEFAULT 0,
  floor_met boolean NOT NULL DEFAULT false,
  failure_type text,
  status text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one row per attempt per resource
CREATE UNIQUE INDEX idx_extraction_attempts_resource_attempt 
  ON public.resource_extraction_attempts (resource_id, attempt_number);

-- Operational query indexes
CREATE INDEX idx_extraction_attempts_resource_id 
  ON public.resource_extraction_attempts (resource_id);
CREATE INDEX idx_extraction_attempts_status 
  ON public.resource_extraction_attempts (status);
CREATE INDEX idx_extraction_attempts_failure_type 
  ON public.resource_extraction_attempts (failure_type);
CREATE INDEX idx_extraction_attempts_completed_at 
  ON public.resource_extraction_attempts (completed_at DESC);

-- Enable RLS
ALTER TABLE public.resource_extraction_attempts ENABLE ROW LEVEL SECURITY;

-- Users can view their own attempt records
CREATE POLICY "Users can view their own extraction attempts"
  ON public.resource_extraction_attempts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role inserts (edge functions use service role)
CREATE POLICY "Service role can manage extraction attempts"
  ON public.resource_extraction_attempts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Backfill from existing JSON history
INSERT INTO public.resource_extraction_attempts (
  resource_id, user_id, attempt_number, strategy, ki_count, raw_item_count,
  validated_count, deduped_count, min_ki_floor, floor_met, failure_type,
  status, duration_ms, started_at, completed_at
)
SELECT
  r.id AS resource_id,
  r.user_id,
  (attempt->>'attempt_number')::integer AS attempt_number,
  COALESCE(attempt->>'strategy', 'standard') AS strategy,
  COALESCE((attempt->>'ki_count')::integer, 0) AS ki_count,
  COALESCE((attempt->>'raw_item_count')::integer, 0) AS raw_item_count,
  COALESCE((attempt->>'validated_count')::integer, 0) AS validated_count,
  COALESCE((attempt->>'deduped_count')::integer, 0) AS deduped_count,
  COALESCE((attempt->>'min_ki_floor')::integer, 0) AS min_ki_floor,
  COALESCE((attempt->>'floor_met')::boolean, false) AS floor_met,
  attempt->>'failure_type' AS failure_type,
  COALESCE(attempt->>'status', 'unknown') AS status,
  COALESCE((attempt->>'duration_ms')::integer, 0) AS duration_ms,
  (attempt->>'started_at')::timestamptz AS started_at,
  (attempt->>'completed_at')::timestamptz AS completed_at
FROM public.resources r,
  jsonb_array_elements(r.extraction_attempt_history) AS attempt
WHERE r.extraction_attempt_history IS NOT NULL
  AND jsonb_array_length(r.extraction_attempt_history) > 0
ON CONFLICT (resource_id, attempt_number) DO NOTHING;