ALTER TABLE public.strategy_artifacts ADD COLUMN IF NOT EXISTS fallback_used boolean DEFAULT false;
ALTER TABLE public.strategy_artifacts ADD COLUMN IF NOT EXISTS latency_ms integer;