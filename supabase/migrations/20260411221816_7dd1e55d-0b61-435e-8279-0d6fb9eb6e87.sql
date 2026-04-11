
-- =============================================
-- Learning Engine V1 Schema
-- =============================================

-- 1. learning_courses
CREATE TABLE public.learning_courses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  difficulty_level TEXT NOT NULL DEFAULT 'beginner',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.learning_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read courses"
  ON public.learning_courses FOR SELECT
  TO authenticated
  USING (true);

-- 2. learning_modules
CREATE TABLE public.learning_modules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES public.learning_courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.learning_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read modules"
  ON public.learning_modules FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_learning_modules_course_id ON public.learning_modules(course_id);

-- 3. learning_lessons
CREATE TABLE public.learning_lessons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  difficulty_level TEXT NOT NULL DEFAULT 'beginner',
  order_index INT NOT NULL DEFAULT 0,
  -- Structured lesson content (concept, what_good_looks_like, breakdown, when_to_use, when_not_to_use)
  lesson_content JSONB,
  -- Quiz content (mc_questions[], open_ended_prompt, answer_key, rubric)
  quiz_content JSONB,
  -- Generation metadata
  source_ki_ids UUID[] DEFAULT '{}',
  generation_status TEXT NOT NULL DEFAULT 'not_started',
  generated_at TIMESTAMPTZ,
  generation_model TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.learning_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read lessons"
  ON public.learning_lessons FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_learning_lessons_module_id ON public.learning_lessons(module_id);

-- 4. learning_progress
CREATE TABLE public.learning_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  lesson_id UUID NOT NULL REFERENCES public.learning_lessons(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started',
  mastery_score FLOAT,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

ALTER TABLE public.learning_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own progress"
  ON public.learning_progress FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own progress"
  ON public.learning_progress FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own progress"
  ON public.learning_progress FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_learning_progress_user_id ON public.learning_progress(user_id);
CREATE INDEX idx_learning_progress_lesson_id ON public.learning_progress(lesson_id);

-- 5. learning_quiz_answers
CREATE TABLE public.learning_quiz_answers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  lesson_id UUID NOT NULL REFERENCES public.learning_lessons(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL,
  question_id TEXT NOT NULL,
  user_answer JSONB,
  is_correct BOOLEAN,
  ai_feedback TEXT,
  score FLOAT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.learning_quiz_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own quiz answers"
  ON public.learning_quiz_answers FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own quiz answers"
  ON public.learning_quiz_answers FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_learning_quiz_answers_user_id ON public.learning_quiz_answers(user_id);
CREATE INDEX idx_learning_quiz_answers_lesson_id ON public.learning_quiz_answers(lesson_id);
