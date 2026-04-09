
-- Add transcript metadata columns to course_lesson_imports
ALTER TABLE public.course_lesson_imports
  ADD COLUMN IF NOT EXISTS transcript_word_count integer,
  ADD COLUMN IF NOT EXISTS transcript_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS transcript_source text;
