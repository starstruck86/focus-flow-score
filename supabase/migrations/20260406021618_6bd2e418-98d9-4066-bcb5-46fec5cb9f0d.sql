CREATE TABLE public.extraction_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  resource_id UUID NOT NULL,
  user_id UUID NOT NULL,
  extraction_run_id UUID,
  batch_index INTEGER NOT NULL,
  batch_total INTEGER NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  semantic_start_marker TEXT,
  semantic_end_marker TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  raw_count INTEGER DEFAULT 0,
  validated_count INTEGER DEFAULT 0,
  saved_count INTEGER DEFAULT 0,
  duplicates_skipped INTEGER DEFAULT 0,
  cumulative_resource_ki_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(resource_id, batch_index)
);

ALTER TABLE public.extraction_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own batch records"
  ON public.extraction_batches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own batch records"
  ON public.extraction_batches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_extraction_batches_resource ON public.extraction_batches(resource_id, batch_index);