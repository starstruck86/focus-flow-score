ALTER TABLE public.knowledge_items
  ADD COLUMN IF NOT EXISTS macro_situation text,
  ADD COLUMN IF NOT EXISTS micro_strategy text,
  ADD COLUMN IF NOT EXISTS how_to_execute text,
  ADD COLUMN IF NOT EXISTS what_this_unlocks text;