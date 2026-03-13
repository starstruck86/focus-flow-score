ALTER TABLE public.daily_journal_entries
  ADD COLUMN IF NOT EXISTS distracted_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS phone_pickups integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS focus_score numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS focus_label text DEFAULT NULL;