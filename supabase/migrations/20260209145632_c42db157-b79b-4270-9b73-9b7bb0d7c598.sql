
-- Add workday check-in/out and first call tracking fields to daily_journal_entries
ALTER TABLE public.daily_journal_entries
  ADD COLUMN IF NOT EXISTS workday_start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS workday_end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS workday_focus TEXT,
  ADD COLUMN IF NOT EXISTS first_call_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_call_logged BOOLEAN DEFAULT false;
