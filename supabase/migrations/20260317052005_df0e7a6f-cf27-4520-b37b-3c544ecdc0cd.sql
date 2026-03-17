
CREATE TABLE public.daily_plan_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_start_time time NOT NULL DEFAULT '09:00'::time,
  work_end_time time NOT NULL DEFAULT '17:00'::time,
  no_meetings_before time DEFAULT '09:00'::time,
  no_meetings_after time DEFAULT '17:00'::time,
  lunch_start time DEFAULT '12:00'::time,
  lunch_end time DEFAULT '13:00'::time,
  min_block_minutes integer NOT NULL DEFAULT 25,
  prefer_new_logo_morning boolean NOT NULL DEFAULT true,
  max_back_to_back_meetings integer DEFAULT 3,
  personal_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.daily_plan_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences" ON public.daily_plan_preferences
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences" ON public.daily_plan_preferences
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences" ON public.daily_plan_preferences
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_daily_plan_preferences_updated_at
  BEFORE UPDATE ON public.daily_plan_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
