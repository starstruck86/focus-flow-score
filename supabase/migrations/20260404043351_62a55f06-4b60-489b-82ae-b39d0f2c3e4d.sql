
-- Reconciliation runs table
CREATE TABLE public.library_reconciliation_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  mode TEXT NOT NULL DEFAULT 'dry_run',
  status TEXT NOT NULL DEFAULT 'pending',
  current_phase TEXT,
  total_resources INTEGER NOT NULL DEFAULT 0,
  buckets JSONB NOT NULL DEFAULT '{}',
  phase_progress JSONB NOT NULL DEFAULT '{}',
  issue_breakdown JSONB NOT NULL DEFAULT '{}',
  final_report JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.library_reconciliation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own runs" ON public.library_reconciliation_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own runs" ON public.library_reconciliation_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own runs" ON public.library_reconciliation_runs FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_library_reconciliation_runs_updated_at
  BEFORE UPDATE ON public.library_reconciliation_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reconciliation items table
CREATE TABLE public.library_reconciliation_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.library_reconciliation_runs(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL,
  user_id UUID NOT NULL,
  bucket TEXT NOT NULL,
  issues TEXT[] NOT NULL DEFAULT '{}',
  severity INTEGER NOT NULL DEFAULT 0,
  phase_outcomes JSONB NOT NULL DEFAULT '{}',
  qa_flagged BOOLEAN NOT NULL DEFAULT false,
  qa_reason TEXT,
  processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.library_reconciliation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own items" ON public.library_reconciliation_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own items" ON public.library_reconciliation_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own items" ON public.library_reconciliation_items FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX idx_recon_items_run_id ON public.library_reconciliation_items(run_id);
CREATE INDEX idx_recon_items_bucket ON public.library_reconciliation_items(bucket);
CREATE INDEX idx_recon_items_resource_id ON public.library_reconciliation_items(resource_id);

CREATE TRIGGER update_library_reconciliation_items_updated_at
  BEFORE UPDATE ON public.library_reconciliation_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
