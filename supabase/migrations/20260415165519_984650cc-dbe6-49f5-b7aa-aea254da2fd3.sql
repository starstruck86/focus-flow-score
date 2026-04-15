
-- Saved command shortcuts (reusable workflows)
CREATE TABLE public.command_shortcuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  raw_command TEXT NOT NULL,
  template_id TEXT,
  template_name TEXT,
  account_id UUID,
  account_name TEXT,
  opportunity_id UUID,
  opportunity_name TEXT,
  free_text TEXT,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  times_used INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.command_shortcuts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own shortcuts"
  ON public.command_shortcuts
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Lightweight feedback signals for adaptive learning
CREATE TABLE public.command_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id TEXT,
  template_name TEXT,
  account_id UUID,
  signal_type TEXT NOT NULL, -- 'regenerated', 'edited', 'copied_section', 'copied_all', 'saved_template', 'trimmed', 'reused_shortcut'
  section_heading TEXT,       -- which section was interacted with
  metadata JSONB,             -- arbitrary context (e.g. original_length, edited_length)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.command_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own feedback"
  ON public.command_feedback
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Trigger for updated_at on shortcuts
CREATE TRIGGER update_command_shortcuts_updated_at
  BEFORE UPDATE ON public.command_shortcuts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
