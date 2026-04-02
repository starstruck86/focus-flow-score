ALTER TABLE public.resources
ADD COLUMN IF NOT EXISTS re_extract_status text NOT NULL DEFAULT 'idle',
ADD COLUMN IF NOT EXISTS re_extract_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_resources_re_extract_status ON public.resources (re_extract_status) WHERE re_extract_status != 'idle';