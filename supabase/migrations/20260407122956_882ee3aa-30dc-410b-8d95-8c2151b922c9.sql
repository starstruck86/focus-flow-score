
-- Durable background jobs table
CREATE TABLE public.background_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  type TEXT NOT NULL,
  entity_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  substatus TEXT,
  progress_mode TEXT DEFAULT 'indeterminate',
  progress_current INTEGER DEFAULT 0,
  progress_total INTEGER DEFAULT 0,
  progress_percent INTEGER,
  step_label TEXT,
  error TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

-- Users can only see their own jobs
CREATE POLICY "Users can view their own jobs"
  ON public.background_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own jobs"
  ON public.background_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own jobs"
  ON public.background_jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own jobs"
  ON public.background_jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Fast lookup for rehydration
CREATE INDEX idx_background_jobs_user_status ON public.background_jobs (user_id, status);
CREATE INDEX idx_background_jobs_entity ON public.background_jobs (entity_id);

-- Auto-update timestamp
CREATE TRIGGER update_background_jobs_updated_at
  BEFORE UPDATE ON public.background_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for live progress
ALTER PUBLICATION supabase_realtime ADD TABLE public.background_jobs;
