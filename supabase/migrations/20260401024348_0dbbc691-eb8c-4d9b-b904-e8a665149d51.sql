-- Reset: delete all knowledge items
DELETE FROM public.knowledge_items;

-- Add attribution columns
ALTER TABLE public.knowledge_items
  ADD COLUMN IF NOT EXISTS source_title text,
  ADD COLUMN IF NOT EXISTS source_location text;