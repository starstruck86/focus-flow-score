ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS enriched_at timestamptz;
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS content_length integer;
UPDATE public.resources SET enriched_at = updated_at, content_length = length(coalesce(content, ''))
  WHERE content_status = 'enriched' AND enriched_at IS NULL;