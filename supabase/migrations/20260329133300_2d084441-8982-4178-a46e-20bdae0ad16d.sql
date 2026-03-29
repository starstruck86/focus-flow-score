-- Enrichment attempt history table
CREATE TABLE public.enrichment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  attempt_type text NOT NULL,
  strategy text NOT NULL,
  platform text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  result text NOT NULL DEFAULT 'pending',
  failure_category text,
  content_found boolean DEFAULT false,
  transcript_url_found boolean DEFAULT false,
  media_url_found boolean DEFAULT false,
  caption_url_found boolean DEFAULT false,
  shell_rejected boolean DEFAULT false,
  runtime_config_found boolean DEFAULT false,
  content_length_extracted integer DEFAULT 0,
  quality_score_after integer,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_enrichment_attempts_resource ON public.enrichment_attempts(resource_id);
CREATE INDEX idx_enrichment_attempts_user ON public.enrichment_attempts(user_id);

ALTER TABLE public.enrichment_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own enrichment attempts"
  ON public.enrichment_attempts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own enrichment attempts"
  ON public.enrichment_attempts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS advanced_extraction_status text DEFAULT null,
  ADD COLUMN IF NOT EXISTS advanced_extraction_attempts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_advanced_extraction_at timestamptz DEFAULT null,
  ADD COLUMN IF NOT EXISTS resolution_method text DEFAULT null,
  ADD COLUMN IF NOT EXISTS platform_status text DEFAULT null;