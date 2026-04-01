
CREATE TABLE public.playbook_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('section_useful', 'section_not_useful', 'wrong_section', 'too_generic')),
  target_type TEXT NOT NULL CHECK (target_type IN ('section', 'ki_placement', 'playbook_item')),
  target_id TEXT,
  framework TEXT,
  section_heading TEXT,
  ki_title TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.playbook_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own feedback"
  ON public.playbook_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can read own feedback"
  ON public.playbook_feedback FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_playbook_feedback_user_stage ON public.playbook_feedback(user_id, stage_id);
