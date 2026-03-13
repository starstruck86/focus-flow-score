
ALTER TABLE public.daily_journal_entries
  ADD COLUMN IF NOT EXISTS pipeline_moved numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS biggest_blocker text DEFAULT null,
  ADD COLUMN IF NOT EXISTS tomorrow_priority text DEFAULT null,
  ADD COLUMN IF NOT EXISTS daily_reflection text DEFAULT null,
  ADD COLUMN IF NOT EXISTS sentiment_score numeric DEFAULT null,
  ADD COLUMN IF NOT EXISTS sentiment_label text DEFAULT null,
  ADD COLUMN IF NOT EXISTS yesterday_commitment_met boolean DEFAULT null;
