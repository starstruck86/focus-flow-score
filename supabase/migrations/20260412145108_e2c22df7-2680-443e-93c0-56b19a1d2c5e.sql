
-- =============================================
-- SALES DOJO V3 — PHASE 1 MIGRATION
-- =============================================

-- 1. Training Blocks
CREATE TABLE public.training_blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  block_number INT NOT NULL DEFAULT 1,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  current_week INT NOT NULL DEFAULT 1 CHECK (current_week BETWEEN 1 AND 8),
  phase TEXT NOT NULL DEFAULT 'benchmark' CHECK (phase IN ('benchmark', 'foundation', 'build', 'peak', 'retest')),
  stage TEXT NOT NULL DEFAULT 'foundation' CHECK (stage IN ('foundation', 'integration', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  completed_sessions_this_week INT NOT NULL DEFAULT 0,
  benchmark_snapshot JSONB DEFAULT NULL,
  retest_snapshot JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, block_number)
);

ALTER TABLE public.training_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own blocks"
  ON public.training_blocks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own blocks"
  ON public.training_blocks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own blocks"
  ON public.training_blocks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_training_blocks_updated_at
  BEFORE UPDATE ON public.training_blocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Daily Assignments
CREATE TABLE public.daily_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  assignment_date DATE NOT NULL,
  block_id UUID NOT NULL REFERENCES public.training_blocks(id) ON DELETE CASCADE,
  block_week INT NOT NULL,
  block_phase TEXT NOT NULL,
  day_anchor TEXT NOT NULL CHECK (day_anchor IN (
    'opening_cold_call', 'discovery_qualification', 'objection_pricing',
    'deal_control_negotiation', 'executive_roi_mixed'
  )),
  primary_skill TEXT NOT NULL,
  focus_pattern TEXT NOT NULL,
  kis JSONB NOT NULL DEFAULT '[]'::jsonb,
  scenarios JSONB NOT NULL DEFAULT '[]'::jsonb,
  difficulty TEXT NOT NULL DEFAULT 'intermediate' CHECK (difficulty IN ('foundational', 'intermediate', 'advanced')),
  retry_strategy TEXT NOT NULL DEFAULT 'weakest' CHECK (retry_strategy IN ('weakest', 'variation', 'skip')),
  transcript_scenario_used BOOLEAN NOT NULL DEFAULT false,
  benchmark_tag BOOLEAN NOT NULL DEFAULT false,
  scenario_family_id TEXT DEFAULT NULL,
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'weakness' CHECK (source IN ('weakness', 'coverage', 'transcript', 'progression', 'benchmark')),
  completed BOOLEAN NOT NULL DEFAULT false,
  session_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, assignment_date)
);

ALTER TABLE public.daily_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own assignments"
  ON public.daily_assignments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own assignments"
  ON public.daily_assignments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own assignments"
  ON public.daily_assignments FOR UPDATE
  USING (auth.uid() = user_id);

-- 3. Block Snapshots
CREATE TABLE public.block_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  block_id UUID NOT NULL REFERENCES public.training_blocks(id) ON DELETE CASCADE,
  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('benchmark', 'retest', 'weekly')),
  week_number INT NOT NULL,
  scores_by_anchor JSONB NOT NULL DEFAULT '{}'::jsonb,
  mistakes_active TEXT[] DEFAULT '{}',
  mistakes_resolved TEXT[] DEFAULT '{}',
  stage TEXT NOT NULL DEFAULT 'foundation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.block_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own snapshots"
  ON public.block_snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own snapshots"
  ON public.block_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 4. Extend dojo_sessions
ALTER TABLE public.dojo_sessions
  ADD COLUMN IF NOT EXISTS assignment_id UUID DEFAULT NULL REFERENCES public.daily_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS benchmark_tag BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scenario_family_id TEXT DEFAULT NULL;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_daily_assignments_user_date ON public.daily_assignments(user_id, assignment_date);
CREATE INDEX IF NOT EXISTS idx_training_blocks_user_active ON public.training_blocks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_block_snapshots_block ON public.block_snapshots(block_id, snapshot_type);
CREATE INDEX IF NOT EXISTS idx_dojo_sessions_assignment ON public.dojo_sessions(assignment_id);
