
-- Resource Jobs table: tracks entire processing pipelines
CREATE TABLE public.resource_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  resource_id UUID REFERENCES public.resources(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'full_pipeline',
  status TEXT NOT NULL DEFAULT 'queued',
  trace_id TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  error_category TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.resource_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own resource_jobs" ON public.resource_jobs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Resource Job Steps table: tracks individual pipeline steps
CREATE TABLE public.resource_job_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES public.resource_jobs(id) ON DELETE CASCADE NOT NULL,
  step_name TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  error_category TEXT,
  error_message TEXT,
  payload_size INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.resource_job_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own resource_job_steps" ON public.resource_job_steps
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.resource_jobs rj WHERE rj.id = job_id AND rj.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.resource_jobs rj WHERE rj.id = job_id AND rj.user_id = auth.uid())
  );

-- Resource Chunks table: stores chunked transcript/content pieces
CREATE TABLE public.resource_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  resource_id UUID REFERENCES public.resources(id) ON DELETE CASCADE NOT NULL,
  job_id UUID REFERENCES public.resource_jobs(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  summary TEXT,
  actions JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  token_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.resource_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own resource_chunks" ON public.resource_chunks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable realtime for job status
ALTER PUBLICATION supabase_realtime ADD TABLE public.resource_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.resource_job_steps;
