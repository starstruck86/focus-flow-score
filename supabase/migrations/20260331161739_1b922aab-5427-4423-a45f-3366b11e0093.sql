
-- Batch run history
CREATE TABLE public.batch_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL DEFAULT 'pipeline',
  batch_size INTEGER NOT NULL DEFAULT 15,
  concurrency INTEGER NOT NULL DEFAULT 3,
  total_resources INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  cancelled BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Per-resource job records within a batch run
CREATE TABLE public.batch_run_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_run_id UUID NOT NULL REFERENCES public.batch_runs(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL,
  resource_title TEXT,
  source_type TEXT DEFAULT 'unknown',
  final_status TEXT NOT NULL DEFAULT 'queued',
  failure_reason TEXT,
  attempts JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.batch_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_run_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own batch runs"
  ON public.batch_runs FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view own batch run jobs"
  ON public.batch_run_jobs FOR ALL TO authenticated
  USING (batch_run_id IN (SELECT id FROM public.batch_runs WHERE user_id = auth.uid()))
  WITH CHECK (batch_run_id IN (SELECT id FROM public.batch_runs WHERE user_id = auth.uid()));

-- Index for fast lookups
CREATE INDEX idx_batch_run_jobs_batch ON public.batch_run_jobs(batch_run_id);
CREATE INDEX idx_batch_run_jobs_resource ON public.batch_run_jobs(resource_id);
CREATE INDEX idx_batch_runs_user ON public.batch_runs(user_id);
