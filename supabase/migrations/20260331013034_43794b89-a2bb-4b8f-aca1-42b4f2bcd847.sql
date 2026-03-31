
CREATE TABLE public.pipeline_diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL,
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  terminal_state text NOT NULL DEFAULT 'needs_review',
  failure_reasons text[] NOT NULL DEFAULT '{}',
  trust_failures text[] NOT NULL DEFAULT '{}',
  recommended_fix text,
  retryable boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'medium',
  human_review_required boolean NOT NULL DEFAULT false,
  most_similar_existing text,
  assets_created jsonb NOT NULL DEFAULT '{"knowledge_items":0,"knowledge_activated":0,"templates":0,"examples":0}',
  route text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_diagnoses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own diagnoses" ON public.pipeline_diagnoses
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can insert own diagnoses" ON public.pipeline_diagnoses
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own diagnoses" ON public.pipeline_diagnoses
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can delete own diagnoses" ON public.pipeline_diagnoses
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE UNIQUE INDEX idx_pipeline_diagnoses_resource_run ON public.pipeline_diagnoses (resource_id, run_id);
CREATE INDEX idx_pipeline_diagnoses_user_state ON public.pipeline_diagnoses (user_id, terminal_state);
CREATE INDEX idx_pipeline_diagnoses_run ON public.pipeline_diagnoses (run_id);

CREATE TRIGGER update_pipeline_diagnoses_updated_at
  BEFORE UPDATE ON public.pipeline_diagnoses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.pipeline_diagnoses;
