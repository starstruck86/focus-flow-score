-- Add War Room fields to opportunities
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS role_title text,
  ADD COLUMN IF NOT EXISTS process_stage text,
  ADD COLUMN IF NOT EXISTS verdict text,
  ADD COLUMN IF NOT EXISTS work_model text,
  ADD COLUMN IF NOT EXISTS comp_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS next_interview_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS jd_url text,
  ADD COLUMN IF NOT EXISTS company_url text,
  ADD COLUMN IF NOT EXISTS recruiter_name text,
  ADD COLUMN IF NOT EXISTS hiring_manager_name text,
  ADD COLUMN IF NOT EXISTS open_questions text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS intelligence_notes text,
  ADD COLUMN IF NOT EXISTS logistics_notes text,
  ADD COLUMN IF NOT EXISTS office_location text,
  ADD COLUMN IF NOT EXISTS primary_strategy_thread_id uuid REFERENCES public.strategy_threads(id);

-- Add interview tracking fields to contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS interview_role text,
  ADD COLUMN IF NOT EXISTS met_on date,
  ADD COLUMN IF NOT EXISTS impression text,
  ADD COLUMN IF NOT EXISTS key_concerns text;