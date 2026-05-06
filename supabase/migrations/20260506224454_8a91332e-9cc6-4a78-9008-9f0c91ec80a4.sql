
-- Drop failed partial objects if they exist
DROP INDEX IF EXISTS idx_synthesis_cache_lookup;
DROP INDEX IF EXISTS idx_synthesis_cache_expires;
DROP TABLE IF EXISTS public.strategy_synthesis_cache;

-- Phase 4C: Synthesis cache table
CREATE TABLE public.strategy_synthesis_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  task_type text NOT NULL,
  cache_key text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  hit_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, cache_key)
);

-- Standard indexes (no partial predicate)
CREATE INDEX idx_synthesis_cache_lookup ON public.strategy_synthesis_cache(user_id, cache_key);
CREATE INDEX idx_synthesis_cache_expires ON public.strategy_synthesis_cache(expires_at);

-- RLS
ALTER TABLE public.strategy_synthesis_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own cache"
  ON public.strategy_synthesis_cache FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cache"
  ON public.strategy_synthesis_cache FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own cache"
  ON public.strategy_synthesis_cache FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own cache"
  ON public.strategy_synthesis_cache FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Updated_at trigger
CREATE TRIGGER update_synthesis_cache_updated_at
  BEFORE UPDATE ON public.strategy_synthesis_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
