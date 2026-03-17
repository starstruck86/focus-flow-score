
CREATE TABLE public.transcript_grades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  transcript_id UUID NOT NULL REFERENCES public.call_transcripts(id) ON DELETE CASCADE,
  overall_grade TEXT NOT NULL DEFAULT 'C',
  overall_score INTEGER NOT NULL DEFAULT 50,
  style_score INTEGER NOT NULL DEFAULT 50,
  acumen_score INTEGER NOT NULL DEFAULT 50,
  cadence_score INTEGER NOT NULL DEFAULT 50,
  style_notes TEXT,
  acumen_notes TEXT,
  cadence_notes TEXT,
  strengths TEXT[] DEFAULT '{}',
  improvements TEXT[] DEFAULT '{}',
  actionable_feedback TEXT NOT NULL DEFAULT '',
  feedback_focus TEXT NOT NULL DEFAULT 'style',
  summary TEXT,
  methodology_alignment TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(transcript_id)
);

ALTER TABLE public.transcript_grades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transcript grades" ON public.transcript_grades
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transcript grades" ON public.transcript_grades
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transcript grades" ON public.transcript_grades
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own transcript grades" ON public.transcript_grades
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
