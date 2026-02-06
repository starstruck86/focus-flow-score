-- Work Schedule Configuration (singleton with workday preferences)
CREATE TABLE public.work_schedule_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  working_days INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5], -- 0=Sun, 1=Mon, ..., 6=Sat
  reminder_enabled BOOLEAN NOT NULL DEFAULT true,
  reminder_time TIME NOT NULL DEFAULT '16:30:00',
  grace_window_hours INTEGER NOT NULL DEFAULT 2, -- Hours after midnight to count for previous day
  goal_daily_score_threshold INTEGER NOT NULL DEFAULT 8,
  goal_productivity_threshold INTEGER NOT NULL DEFAULT 75,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert default config
INSERT INTO public.work_schedule_config (working_days) VALUES (ARRAY[1,2,3,4,5]);

-- Holidays table
CREATE TABLE public.holidays (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- PTO days table
CREATE TABLE public.pto_days (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Workday overrides (force a day to be workday or not)
CREATE TABLE public.workday_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  is_workday BOOLEAN NOT NULL,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Daily streak events tracking
CREATE TABLE public.streak_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  is_eligible_day BOOLEAN NOT NULL DEFAULT false,
  checked_in BOOLEAN NOT NULL DEFAULT false,
  check_in_method TEXT, -- 'daily_input', 'task_complete', 'focus_timer', 'manual'
  check_in_time TIMESTAMP WITH TIME ZONE,
  goal_met BOOLEAN NOT NULL DEFAULT false,
  daily_score INTEGER,
  productivity_score INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Badges earned
CREATE TABLE public.badges_earned (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  badge_type TEXT NOT NULL,
  badge_name TEXT NOT NULL,
  earned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Streak summary (computed/cached values)
CREATE TABLE public.streak_summary (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  current_checkin_streak INTEGER NOT NULL DEFAULT 0,
  current_performance_streak INTEGER NOT NULL DEFAULT 0,
  longest_checkin_streak INTEGER NOT NULL DEFAULT 0,
  longest_performance_streak INTEGER NOT NULL DEFAULT 0,
  total_eligible_days INTEGER NOT NULL DEFAULT 0,
  total_checkins INTEGER NOT NULL DEFAULT 0,
  total_goals_met INTEGER NOT NULL DEFAULT 0,
  checkin_level INTEGER NOT NULL DEFAULT 0,
  performance_level INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert default summary
INSERT INTO public.streak_summary (current_checkin_streak) VALUES (0);

-- Add triggers for updated_at
CREATE TRIGGER update_work_schedule_config_updated_at
  BEFORE UPDATE ON public.work_schedule_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_streak_events_updated_at
  BEFORE UPDATE ON public.streak_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_streak_summary_updated_at
  BEFORE UPDATE ON public.streak_summary
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.work_schedule_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pto_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workday_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streak_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badges_earned ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streak_summary ENABLE ROW LEVEL SECURITY;

-- RLS policies (public access for single-user app)
CREATE POLICY "Anyone can view work_schedule_config" ON public.work_schedule_config FOR SELECT USING (true);
CREATE POLICY "Anyone can update work_schedule_config" ON public.work_schedule_config FOR UPDATE USING (true);

CREATE POLICY "Anyone can view holidays" ON public.holidays FOR SELECT USING (true);
CREATE POLICY "Anyone can insert holidays" ON public.holidays FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update holidays" ON public.holidays FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete holidays" ON public.holidays FOR DELETE USING (true);

CREATE POLICY "Anyone can view pto_days" ON public.pto_days FOR SELECT USING (true);
CREATE POLICY "Anyone can insert pto_days" ON public.pto_days FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update pto_days" ON public.pto_days FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete pto_days" ON public.pto_days FOR DELETE USING (true);

CREATE POLICY "Anyone can view workday_overrides" ON public.workday_overrides FOR SELECT USING (true);
CREATE POLICY "Anyone can insert workday_overrides" ON public.workday_overrides FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update workday_overrides" ON public.workday_overrides FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete workday_overrides" ON public.workday_overrides FOR DELETE USING (true);

CREATE POLICY "Anyone can view streak_events" ON public.streak_events FOR SELECT USING (true);
CREATE POLICY "Anyone can insert streak_events" ON public.streak_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update streak_events" ON public.streak_events FOR UPDATE USING (true);

CREATE POLICY "Anyone can view badges_earned" ON public.badges_earned FOR SELECT USING (true);
CREATE POLICY "Anyone can insert badges_earned" ON public.badges_earned FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can view streak_summary" ON public.streak_summary FOR SELECT USING (true);
CREATE POLICY "Anyone can update streak_summary" ON public.streak_summary FOR UPDATE USING (true);