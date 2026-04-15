
ALTER TABLE public.strategy_uploaded_resources
ADD COLUMN IF NOT EXISTS metadata_json jsonb DEFAULT NULL;
