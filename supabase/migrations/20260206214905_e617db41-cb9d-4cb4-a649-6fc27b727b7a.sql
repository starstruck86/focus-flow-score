-- Create daily_journal_entries table for WHOOP-like check-in system
CREATE TABLE public.daily_journal_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  
  -- Activity Totals (Step 1)
  dials INTEGER NOT NULL DEFAULT 0,
  conversations INTEGER NOT NULL DEFAULT 0,
  prospects_added INTEGER NOT NULL DEFAULT 0,
  manager_plus_messages INTEGER NOT NULL DEFAULT 0,
  manual_emails INTEGER NOT NULL DEFAULT 0,
  automated_emails INTEGER NOT NULL DEFAULT 0,
  meetings_set INTEGER NOT NULL DEFAULT 0,
  customer_meetings_held INTEGER NOT NULL DEFAULT 0,
  opportunities_created INTEGER NOT NULL DEFAULT 0,
  personal_development BOOLEAN NOT NULL DEFAULT false,
  prospecting_block_minutes INTEGER NOT NULL DEFAULT 0,
  account_deep_work_minutes INTEGER NOT NULL DEFAULT 0,
  expansion_touchpoints INTEGER NOT NULL DEFAULT 0,
  focus_mode TEXT NOT NULL DEFAULT 'balanced',
  
  -- Preparedness & Momentum (Step 2)
  accounts_researched INTEGER NOT NULL DEFAULT 0,
  contacts_prepped INTEGER NOT NULL DEFAULT 0,
  prepped_for_all_calls_tomorrow BOOLEAN DEFAULT NULL,
  calls_need_prep_count INTEGER DEFAULT 0,
  calls_prep_note TEXT DEFAULT NULL,
  meeting_prep_done BOOLEAN DEFAULT NULL,
  meetings_unprepared_for BOOLEAN DEFAULT NULL,
  meetings_unprepared_note TEXT DEFAULT NULL,
  
  -- Recovery Journal (Step 3)
  sleep_hours DECIMAL(3,1) DEFAULT NULL,
  energy INTEGER DEFAULT NULL CHECK (energy >= 1 AND energy <= 5),
  focus_quality INTEGER DEFAULT NULL CHECK (focus_quality >= 1 AND focus_quality <= 5),
  stress INTEGER DEFAULT NULL CHECK (stress >= 1 AND stress <= 5),
  clarity INTEGER DEFAULT NULL CHECK (clarity >= 1 AND clarity <= 5),
  distractions TEXT DEFAULT 'low',
  context_switching TEXT DEFAULT 'low',
  admin_heavy_day BOOLEAN NOT NULL DEFAULT false,
  travel_day BOOLEAN NOT NULL DEFAULT false,
  what_drained_you TEXT DEFAULT NULL,
  what_worked_today TEXT DEFAULT NULL,
  
  -- Calculated Scores (after save)
  daily_score INTEGER DEFAULT NULL,
  sales_strain DECIMAL(4,1) DEFAULT NULL,
  sales_recovery INTEGER DEFAULT NULL,
  sales_productivity INTEGER DEFAULT NULL,
  goal_met BOOLEAN NOT NULL DEFAULT false,
  
  -- Journal Status Flags
  checked_in BOOLEAN NOT NULL DEFAULT false,
  check_in_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  confirmation_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Unique constraint: one entry per user per day
  UNIQUE(user_id, date)
);

-- Enable Row Level Security
ALTER TABLE public.daily_journal_entries ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view own journal entries" 
  ON public.daily_journal_entries 
  FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own journal entries" 
  ON public.daily_journal_entries 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own journal entries" 
  ON public.daily_journal_entries 
  FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own journal entries" 
  ON public.daily_journal_entries 
  FOR DELETE 
  USING (auth.uid() = user_id);

-- Add updated_at trigger
CREATE TRIGGER update_daily_journal_entries_updated_at
  BEFORE UPDATE ON public.daily_journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add journal config to work_schedule_config
ALTER TABLE public.work_schedule_config
  ADD COLUMN IF NOT EXISTS eod_checkin_time TIME NOT NULL DEFAULT '16:30:00',
  ADD COLUMN IF NOT EXISTS eod_reminder_time TIME NOT NULL DEFAULT '18:30:00',
  ADD COLUMN IF NOT EXISTS morning_confirm_time TIME NOT NULL DEFAULT '08:00:00',
  ADD COLUMN IF NOT EXISTS grace_window_end_time TIME NOT NULL DEFAULT '02:00:00';

-- Create index for fast date lookups
CREATE INDEX idx_daily_journal_entries_user_date ON public.daily_journal_entries(user_id, date DESC);