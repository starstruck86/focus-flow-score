CREATE TABLE public.lesson_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  lesson_import_id UUID REFERENCES public.course_lesson_imports(id) ON DELETE CASCADE,
  parent_resource_id UUID,
  source_url TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes BIGINT,
  storage_path TEXT,
  download_status TEXT NOT NULL DEFAULT 'pending',
  parse_status TEXT NOT NULL DEFAULT 'pending',
  parsed_text_length INT,
  page_count INT,
  child_resource_id UUID,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lesson_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own lesson assets"
  ON public.lesson_assets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own lesson assets"
  ON public.lesson_assets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lesson assets"
  ON public.lesson_assets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own lesson assets"
  ON public.lesson_assets FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_lesson_assets_updated_at
  BEFORE UPDATE ON public.lesson_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();