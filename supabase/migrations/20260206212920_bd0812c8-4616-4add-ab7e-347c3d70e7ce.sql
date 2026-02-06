-- =============================================
-- SECURE ALL TABLES WITH USER-SCOPED RLS
-- =============================================

-- Step 1: Add user_id columns to all tables that don't have them
-- This is a single-user app, so we'll scope all data to the authenticated user

-- Add user_id to badges_earned
ALTER TABLE public.badges_earned ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to calendar_events
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to holidays
ALTER TABLE public.holidays ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to pto_days
ALTER TABLE public.pto_days ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to streak_events
ALTER TABLE public.streak_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to streak_summary
ALTER TABLE public.streak_summary ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to work_schedule_config
ALTER TABLE public.work_schedule_config ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to workday_overrides
ALTER TABLE public.workday_overrides ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Drop all existing overly permissive policies

-- badges_earned
DROP POLICY IF EXISTS "Anyone can insert badges_earned" ON public.badges_earned;
DROP POLICY IF EXISTS "Anyone can view badges_earned" ON public.badges_earned;

-- calendar_events
DROP POLICY IF EXISTS "Anyone can view calendar events" ON public.calendar_events;

-- holidays
DROP POLICY IF EXISTS "Anyone can delete holidays" ON public.holidays;
DROP POLICY IF EXISTS "Anyone can insert holidays" ON public.holidays;
DROP POLICY IF EXISTS "Anyone can update holidays" ON public.holidays;
DROP POLICY IF EXISTS "Anyone can view holidays" ON public.holidays;

-- pto_days
DROP POLICY IF EXISTS "Anyone can delete pto_days" ON public.pto_days;
DROP POLICY IF EXISTS "Anyone can insert pto_days" ON public.pto_days;
DROP POLICY IF EXISTS "Anyone can update pto_days" ON public.pto_days;
DROP POLICY IF EXISTS "Anyone can view pto_days" ON public.pto_days;

-- streak_events
DROP POLICY IF EXISTS "Anyone can insert streak_events" ON public.streak_events;
DROP POLICY IF EXISTS "Anyone can update streak_events" ON public.streak_events;
DROP POLICY IF EXISTS "Anyone can view streak_events" ON public.streak_events;

-- streak_summary
DROP POLICY IF EXISTS "Anyone can update streak_summary" ON public.streak_summary;
DROP POLICY IF EXISTS "Anyone can view streak_summary" ON public.streak_summary;

-- work_schedule_config
DROP POLICY IF EXISTS "Anyone can update work_schedule_config" ON public.work_schedule_config;
DROP POLICY IF EXISTS "Anyone can view work_schedule_config" ON public.work_schedule_config;

-- workday_overrides
DROP POLICY IF EXISTS "Anyone can delete workday_overrides" ON public.workday_overrides;
DROP POLICY IF EXISTS "Anyone can insert workday_overrides" ON public.workday_overrides;
DROP POLICY IF EXISTS "Anyone can update workday_overrides" ON public.workday_overrides;
DROP POLICY IF EXISTS "Anyone can view workday_overrides" ON public.workday_overrides;

-- Step 3: Create new user-scoped RLS policies

-- badges_earned policies
CREATE POLICY "Users can view own badges"
  ON public.badges_earned FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own badges"
  ON public.badges_earned FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- calendar_events policies (read-only for users, service role handles writes)
CREATE POLICY "Users can view own calendar events"
  ON public.calendar_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- holidays policies
CREATE POLICY "Users can view own holidays"
  ON public.holidays FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own holidays"
  ON public.holidays FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own holidays"
  ON public.holidays FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own holidays"
  ON public.holidays FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- pto_days policies
CREATE POLICY "Users can view own pto_days"
  ON public.pto_days FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pto_days"
  ON public.pto_days FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pto_days"
  ON public.pto_days FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own pto_days"
  ON public.pto_days FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- streak_events policies
CREATE POLICY "Users can view own streak_events"
  ON public.streak_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own streak_events"
  ON public.streak_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own streak_events"
  ON public.streak_events FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- streak_summary policies
CREATE POLICY "Users can view own streak_summary"
  ON public.streak_summary FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own streak_summary"
  ON public.streak_summary FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own streak_summary"
  ON public.streak_summary FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- work_schedule_config policies
CREATE POLICY "Users can view own work_schedule_config"
  ON public.work_schedule_config FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own work_schedule_config"
  ON public.work_schedule_config FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own work_schedule_config"
  ON public.work_schedule_config FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- workday_overrides policies
CREATE POLICY "Users can view own workday_overrides"
  ON public.workday_overrides FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own workday_overrides"
  ON public.workday_overrides FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workday_overrides"
  ON public.workday_overrides FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own workday_overrides"
  ON public.workday_overrides FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);