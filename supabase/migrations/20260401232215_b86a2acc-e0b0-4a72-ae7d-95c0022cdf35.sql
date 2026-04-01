
-- Create course_lesson_imports table for tracking lesson import lineage
CREATE TABLE public.course_lesson_imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  resource_id UUID REFERENCES public.resources(id) ON DELETE SET NULL,
  original_course_url TEXT NOT NULL,
  lesson_url TEXT NOT NULL,
  course_title TEXT,
  platform TEXT,
  module_name TEXT,
  lesson_index INTEGER,
  lesson_type TEXT,
  source_lesson_title TEXT,
  import_status TEXT NOT NULL DEFAULT 'queued',
  import_substatus TEXT,
  import_error TEXT,
  provider_video_url TEXT,
  provider_video_type TEXT,
  transcript_status TEXT,
  transcript_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.course_lesson_imports ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own course lesson imports"
  ON public.course_lesson_imports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own course lesson imports"
  ON public.course_lesson_imports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own course lesson imports"
  ON public.course_lesson_imports FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own course lesson imports"
  ON public.course_lesson_imports FOR DELETE
  USING (auth.uid() = user_id);

-- Index for fast lookups by resource
CREATE INDEX idx_course_lesson_imports_resource_id ON public.course_lesson_imports(resource_id);
CREATE INDEX idx_course_lesson_imports_user_status ON public.course_lesson_imports(user_id, import_status);

-- Trigger for updated_at
CREATE TRIGGER update_course_lesson_imports_updated_at
  BEFORE UPDATE ON public.course_lesson_imports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
