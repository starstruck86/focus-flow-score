
-- Add manifest_id to strategy_messages for per-surface chat evidence attribution
ALTER TABLE public.strategy_messages
ADD COLUMN IF NOT EXISTS manifest_id text;

CREATE INDEX IF NOT EXISTS idx_strategy_messages_manifest_id
ON public.strategy_messages(manifest_id)
WHERE manifest_id IS NOT NULL;

-- Add manifest_id to strategy_outputs for transform evidence attribution
ALTER TABLE public.strategy_outputs
ADD COLUMN IF NOT EXISTS manifest_id text;

CREATE INDEX IF NOT EXISTS idx_strategy_outputs_manifest_id
ON public.strategy_outputs(manifest_id)
WHERE manifest_id IS NOT NULL;
