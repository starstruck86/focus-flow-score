-- Add unique constraint on daily_journal_entries for user_id + date
ALTER TABLE public.daily_journal_entries
ADD CONSTRAINT daily_journal_entries_user_date_unique UNIQUE (user_id, date);

-- Add unique constraint on streak_events for user_id + date  
ALTER TABLE public.streak_events
ADD CONSTRAINT streak_events_user_date_unique UNIQUE (user_id, date);