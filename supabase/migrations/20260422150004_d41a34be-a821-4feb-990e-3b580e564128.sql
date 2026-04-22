
CREATE TABLE public.lifecycle_audit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  resource_id UUID NOT NULL,
  resource_title TEXT,
  violation_type TEXT NOT NULL,
  before_blocked_reason TEXT,
  after_blocked_reason TEXT,
  before_canonical_state TEXT,
  after_canonical_state TEXT,
  ki_total INTEGER NOT NULL DEFAULT 0,
  ki_active INTEGER NOT NULL DEFAULT 0,
  ki_active_with_contexts INTEGER NOT NULL DEFAULT 0,
  content_length INTEGER,
  auto_healed BOOLEAN NOT NULL DEFAULT false,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_lifecycle_audit_user_created ON public.lifecycle_audit_events (user_id, created_at DESC);
CREATE INDEX idx_lifecycle_audit_resource ON public.lifecycle_audit_events (resource_id);
CREATE INDEX idx_lifecycle_audit_violation ON public.lifecycle_audit_events (violation_type);

ALTER TABLE public.lifecycle_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own lifecycle audit events"
  ON public.lifecycle_audit_events
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own lifecycle audit events"
  ON public.lifecycle_audit_events
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
