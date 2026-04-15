
-- ═══════════════════════════════════════════════════════════
-- Strategy Workspace — Full Schema
-- ═══════════════════════════════════════════════════════════

-- 1. strategy_threads
CREATE TABLE public.strategy_threads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Thread',
  lane TEXT NOT NULL DEFAULT 'research',
  thread_type TEXT NOT NULL DEFAULT 'freeform',
  linked_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  linked_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  linked_territory_id TEXT,
  linked_artifact_id UUID,
  status TEXT NOT NULL DEFAULT 'active',
  summary TEXT,
  latest_rollup JSONB,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own threads" ON public.strategy_threads FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_strategy_threads_user ON public.strategy_threads(user_id);
CREATE INDEX idx_strategy_threads_account ON public.strategy_threads(linked_account_id) WHERE linked_account_id IS NOT NULL;
CREATE INDEX idx_strategy_threads_opp ON public.strategy_threads(linked_opportunity_id) WHERE linked_opportunity_id IS NOT NULL;

-- 2. strategy_messages
CREATE TABLE public.strategy_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES public.strategy_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  message_type TEXT NOT NULL DEFAULT 'chat',
  content_json JSONB NOT NULL DEFAULT '{}',
  citations_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own messages" ON public.strategy_messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_strategy_messages_thread ON public.strategy_messages(thread_id, created_at);

-- 3. strategy_thread_resources
CREATE TABLE public.strategy_thread_resources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES public.strategy_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  resource_id UUID,
  source_type TEXT NOT NULL DEFAULT 'upload',
  relevance_score NUMERIC,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_thread_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own thread resources" ON public.strategy_thread_resources FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. account_strategy_memory
CREATE TABLE public.account_strategy_memory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  confidence NUMERIC,
  source_thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES public.strategy_messages(id) ON DELETE SET NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.account_strategy_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own account memory" ON public.account_strategy_memory FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_acct_strat_mem_account ON public.account_strategy_memory(account_id);

-- 5. opportunity_strategy_memory
CREATE TABLE public.opportunity_strategy_memory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  confidence NUMERIC,
  source_thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES public.strategy_messages(id) ON DELETE SET NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.opportunity_strategy_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own opp memory" ON public.opportunity_strategy_memory FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_opp_strat_mem_opp ON public.opportunity_strategy_memory(opportunity_id);

-- 6. territory_strategy_memory
CREATE TABLE public.territory_strategy_memory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  territory_id TEXT NOT NULL,
  memory_type TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  confidence NUMERIC,
  source_thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES public.strategy_messages(id) ON DELETE SET NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.territory_strategy_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own territory memory" ON public.territory_strategy_memory FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 7. strategy_rollups
CREATE TABLE public.strategy_rollups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  rollup_type TEXT NOT NULL DEFAULT 'summary',
  content_json JSONB NOT NULL DEFAULT '{}',
  generated_from_thread_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_rollups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own rollups" ON public.strategy_rollups FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_strategy_rollups_object ON public.strategy_rollups(object_type, object_id);

-- 8. strategy_outputs
CREATE TABLE public.strategy_outputs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL,
  workflow_run_id UUID,
  output_type TEXT NOT NULL DEFAULT 'memo',
  title TEXT NOT NULL DEFAULT 'Untitled Output',
  content_json JSONB NOT NULL DEFAULT '{}',
  rendered_text TEXT,
  linked_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  linked_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  linked_territory_id TEXT,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own outputs" ON public.strategy_outputs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_strategy_outputs_thread ON public.strategy_outputs(thread_id) WHERE thread_id IS NOT NULL;

-- 9. strategy_uploaded_resources
CREATE TABLE public.strategy_uploaded_resources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  storage_path TEXT NOT NULL,
  parsed_text TEXT,
  summary TEXT,
  suggested_object_type TEXT,
  suggested_object_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_uploaded_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own uploads" ON public.strategy_uploaded_resources FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 10. strategy_workflow_runs
CREATE TABLE public.strategy_workflow_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  thread_id UUID NOT NULL REFERENCES public.strategy_threads(id) ON DELETE CASCADE,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  input_json JSONB,
  result_json JSONB,
  error_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_workflow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own workflow runs" ON public.strategy_workflow_runs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Wire workflow_run_id FK on strategy_outputs
ALTER TABLE public.strategy_outputs
  ADD CONSTRAINT strategy_outputs_workflow_run_fk
  FOREIGN KEY (workflow_run_id) REFERENCES public.strategy_workflow_runs(id) ON DELETE SET NULL;

-- Updated_at triggers for tables that need it
CREATE TRIGGER update_strategy_threads_updated_at BEFORE UPDATE ON public.strategy_threads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_account_strategy_memory_updated_at BEFORE UPDATE ON public.account_strategy_memory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_opportunity_strategy_memory_updated_at BEFORE UPDATE ON public.opportunity_strategy_memory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_territory_strategy_memory_updated_at BEFORE UPDATE ON public.territory_strategy_memory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_strategy_outputs_updated_at BEFORE UPDATE ON public.strategy_outputs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_strategy_workflow_runs_updated_at BEFORE UPDATE ON public.strategy_workflow_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
