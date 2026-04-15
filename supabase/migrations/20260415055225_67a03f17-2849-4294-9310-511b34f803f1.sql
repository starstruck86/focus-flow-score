
CREATE TABLE public.strategy_artifacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL,
  source_output_id UUID REFERENCES public.strategy_outputs(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL DEFAULT 'custom',
  title TEXT NOT NULL,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  rendered_text TEXT,
  version INT NOT NULL DEFAULT 1,
  parent_artifact_id UUID REFERENCES public.strategy_artifacts(id) ON DELETE SET NULL,
  linked_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  linked_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.strategy_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own artifacts"
  ON public.strategy_artifacts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own artifacts"
  ON public.strategy_artifacts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own artifacts"
  ON public.strategy_artifacts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own artifacts"
  ON public.strategy_artifacts FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_strategy_artifacts_updated_at
  BEFORE UPDATE ON public.strategy_artifacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_strategy_artifacts_user_id ON public.strategy_artifacts(user_id);
CREATE INDEX idx_strategy_artifacts_thread_id ON public.strategy_artifacts(thread_id);
CREATE INDEX idx_strategy_artifacts_source_output_id ON public.strategy_artifacts(source_output_id);
