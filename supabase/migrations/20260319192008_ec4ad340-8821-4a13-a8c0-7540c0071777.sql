
-- Create resource_digests table
CREATE TABLE public.resource_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  takeaways text[] NOT NULL DEFAULT '{}',
  summary text NOT NULL DEFAULT '',
  use_cases text[] NOT NULL DEFAULT '{}',
  grading_criteria jsonb DEFAULT NULL,
  content_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(resource_id)
);

ALTER TABLE public.resource_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own resource_digests"
  ON public.resource_digests
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add custom_scorecard_results to transcript_grades
ALTER TABLE public.transcript_grades
  ADD COLUMN IF NOT EXISTS custom_scorecard_results jsonb DEFAULT NULL;
