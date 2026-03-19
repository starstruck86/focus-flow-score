CREATE TABLE public.voice_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  message text NOT NULL,
  remind_at timestamptz NOT NULL,
  delivered boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.voice_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their reminders" ON public.voice_reminders
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);