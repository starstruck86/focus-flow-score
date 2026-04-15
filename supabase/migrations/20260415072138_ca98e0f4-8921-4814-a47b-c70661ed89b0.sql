-- Add provider metadata to strategy_messages
ALTER TABLE public.strategy_messages
  ADD COLUMN IF NOT EXISTS provider_used text,
  ADD COLUMN IF NOT EXISTS model_used text,
  ADD COLUMN IF NOT EXISTS fallback_used boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS latency_ms integer;

-- Add provider metadata to strategy_outputs
ALTER TABLE public.strategy_outputs
  ADD COLUMN IF NOT EXISTS provider_used text,
  ADD COLUMN IF NOT EXISTS model_used text,
  ADD COLUMN IF NOT EXISTS fallback_used boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS latency_ms integer;

-- Add provider metadata to strategy_artifacts
ALTER TABLE public.strategy_artifacts
  ADD COLUMN IF NOT EXISTS provider_used text,
  ADD COLUMN IF NOT EXISTS model_used text;