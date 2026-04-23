ALTER TABLE public.task_run_sections ADD COLUMN IF NOT EXISTS model_used text;
CREATE INDEX IF NOT EXISTS task_run_sections_model_used_idx ON public.task_run_sections(model_used);