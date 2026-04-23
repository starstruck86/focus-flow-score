
CREATE TABLE public.task_run_sections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.task_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  batch_index int NOT NULL,
  section_ids text[] NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | running | completed | failed
  primary_status text,                     -- success | failed
  fallback_status text,                    -- success | failed | null
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  attempts int NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, batch_index)
);

ALTER TABLE public.task_run_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own task_run_sections"
  ON public.task_run_sections FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own task_run_sections"
  ON public.task_run_sections FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own task_run_sections"
  ON public.task_run_sections FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_task_run_sections_run ON public.task_run_sections (run_id, batch_index);
CREATE INDEX idx_task_run_sections_status ON public.task_run_sections (run_id, status);

CREATE TRIGGER trg_task_run_sections_updated_at
  BEFORE UPDATE ON public.task_run_sections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
