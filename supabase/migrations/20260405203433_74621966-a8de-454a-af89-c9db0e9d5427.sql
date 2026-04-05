-- Add extraction_method to knowledge_items
ALTER TABLE public.knowledge_items
ADD COLUMN IF NOT EXISTS extraction_method text DEFAULT 'llm';

-- Backfill existing KIs
UPDATE public.knowledge_items
SET extraction_method = 'llm'
WHERE extraction_method IS NULL;

-- Index for method mix aggregation
CREATE INDEX IF NOT EXISTS idx_knowledge_items_extraction_method
ON public.knowledge_items (extraction_method);