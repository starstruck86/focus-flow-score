ALTER TABLE public.daily_journal_entries 
ADD COLUMN IF NOT EXISTS accountability_habits jsonb DEFAULT '{}';