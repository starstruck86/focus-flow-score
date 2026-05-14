
CREATE TABLE public.course_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  course_name text NOT NULL,
  course_authors text,
  course_platform text,
  course_url text,
  course_category text,
  primary_use_case text,
  notes text,
  status text NOT NULL DEFAULT 'draft',
  source_registry_id uuid REFERENCES public.source_registry(id) ON DELETE SET NULL,
  ready_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.course_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own course_imports"
  ON public.course_imports FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER course_imports_updated_at
  BEFORE UPDATE ON public.course_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.course_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  course_import_id uuid NOT NULL REFERENCES public.course_imports(id) ON DELETE CASCADE,
  lesson_number integer,
  lesson_name text,
  section_name text,
  lesson_url text,
  transcript_text text,
  lesson_text text,
  resource_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachment_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  user_notes text,
  raw_source_text text,
  status text NOT NULL DEFAULT 'draft',
  source_status text NOT NULL DEFAULT 'not_processed',
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  resource_id uuid REFERENCES public.resources(id) ON DELETE SET NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX course_lessons_course_idx
  ON public.course_lessons(course_import_id, lesson_number);

ALTER TABLE public.course_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own course_lessons"
  ON public.course_lessons FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER course_lessons_updated_at
  BEFORE UPDATE ON public.course_lessons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
