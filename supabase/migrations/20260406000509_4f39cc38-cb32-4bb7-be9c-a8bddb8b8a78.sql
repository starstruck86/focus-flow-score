ALTER TABLE public.resources 
  ADD COLUMN IF NOT EXISTS extraction_batch_total integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extraction_batches_completed integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extraction_batch_status text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS extraction_is_resumable boolean DEFAULT false;