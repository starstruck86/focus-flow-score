
-- 1. Create pipeline_runs parent table
CREATE TABLE public.pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  mode text NOT NULL DEFAULT 'standard',
  total_resources integer DEFAULT 0,
  total_processed integer DEFAULT 0,
  converged boolean DEFAULT false,
  iterations_run integer DEFAULT 0,
  stall_reason text,
  no_progress_iterations integer DEFAULT 0,
  stalled_resources integer DEFAULT 0,
  repeated_failure_resources integer DEFAULT 0,
  summary_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own pipeline runs"
  ON public.pipeline_runs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own pipeline runs"
  ON public.pipeline_runs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own pipeline runs"
  ON public.pipeline_runs FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER update_pipeline_runs_updated_at
  BEFORE UPDATE ON public.pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Add resolution fields to pipeline_diagnoses
ALTER TABLE public.pipeline_diagnoses
  ADD COLUMN IF NOT EXISTS resolution_status text DEFAULT 'unresolved',
  ADD COLUMN IF NOT EXISTS resolution_action text,
  ADD COLUMN IF NOT EXISTS resolution_notes text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- 3. Add foreign key from pipeline_diagnoses to pipeline_runs
ALTER TABLE public.pipeline_diagnoses
  ADD CONSTRAINT pipeline_diagnoses_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES public.pipeline_runs(id) ON DELETE CASCADE;

-- 4. Index for resolution filtering
CREATE INDEX idx_pipeline_diagnoses_resolution ON public.pipeline_diagnoses(resolution_status);
CREATE INDEX idx_pipeline_runs_user_status ON public.pipeline_runs(user_id, status);
