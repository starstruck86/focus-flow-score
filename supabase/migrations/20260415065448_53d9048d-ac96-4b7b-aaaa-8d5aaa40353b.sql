-- Add strategic memory columns
ALTER TABLE public.account_strategy_memory 
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_irrelevant boolean NOT NULL DEFAULT false;

ALTER TABLE public.opportunity_strategy_memory 
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_irrelevant boolean NOT NULL DEFAULT false;

ALTER TABLE public.territory_strategy_memory 
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_irrelevant boolean NOT NULL DEFAULT false;

-- Add artifact reusability columns
ALTER TABLE public.strategy_artifacts 
  ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_chain text[] DEFAULT '{}';

-- Create artifact feedback table
CREATE TABLE public.strategy_artifact_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES public.strategy_artifacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  rating integer NOT NULL,
  feedback_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.strategy_artifact_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own artifact feedback"
  ON public.strategy_artifact_feedback
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_artifact_feedback_artifact ON public.strategy_artifact_feedback(artifact_id);
CREATE INDEX idx_memory_last_used_account ON public.account_strategy_memory(last_used_at);
CREATE INDEX idx_memory_last_used_opportunity ON public.opportunity_strategy_memory(last_used_at);
CREATE INDEX idx_memory_last_used_territory ON public.territory_strategy_memory(last_used_at);