
-- Add missing columns for key_metric_targets and goal completion tracking
ALTER TABLE public.daily_time_blocks 
  ADD COLUMN IF NOT EXISTS key_metric_targets JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS completed_goals JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS block_feedback JSONB DEFAULT '[]'::jsonb;
