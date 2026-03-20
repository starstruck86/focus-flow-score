
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS content_status TEXT NOT NULL DEFAULT 'file';

UPDATE public.resources SET content_status = 'placeholder' WHERE content LIKE '[External Link:%' OR content LIKE '[Enriching%';
UPDATE public.resources SET content_status = 'manual' WHERE content_status = 'file' AND file_url IS NOT NULL AND file_url LIKE 'http%' AND content NOT LIKE '[External Link:%';
