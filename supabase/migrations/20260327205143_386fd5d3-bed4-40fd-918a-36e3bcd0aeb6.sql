
CREATE TABLE public.audio_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  source_url text,
  resolved_audio_url text,
  audio_subtype text NOT NULL DEFAULT 'direct_audio_file',
  stage text NOT NULL DEFAULT 'queued',
  failure_code text,
  failure_reason text,
  retryable boolean NOT NULL DEFAULT true,
  recommended_action text,
  attempts_count integer NOT NULL DEFAULT 0,
  last_attempted_stage text,
  transcript_text text,
  transcript_segments jsonb DEFAULT '[]'::jsonb,
  transcript_quality text,
  transcript_word_count integer,
  has_transcript boolean NOT NULL DEFAULT false,
  provider_job_ids jsonb DEFAULT '[]'::jsonb,
  chunk_metadata jsonb DEFAULT '[]'::jsonb,
  quality_result jsonb,
  last_successful_stage text,
  provider_used text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audio_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own audio_jobs"
  ON public.audio_jobs FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_audio_jobs_resource ON public.audio_jobs(resource_id);
CREATE INDEX idx_audio_jobs_user_stage ON public.audio_jobs(user_id, stage);
