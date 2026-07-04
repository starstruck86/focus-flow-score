CREATE TABLE IF NOT EXISTS public._agent_staging (
  job text NOT NULL,
  row_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job, row_id)
);

GRANT SELECT, INSERT ON public._agent_staging TO authenticated;
GRANT SELECT, INSERT ON public._agent_staging TO service_role;
GRANT SELECT, INSERT ON public._agent_staging TO anon;

ALTER TABLE public._agent_staging DISABLE ROW LEVEL SECURITY;