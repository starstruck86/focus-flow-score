
-- 1) Authoritative agent -> cron jobname mapping (avoids brittle name-guessing).
CREATE TABLE IF NOT EXISTS public.agent_cron_map (
  agent   text PRIMARY KEY,
  jobname text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_cron_map TO authenticated;
GRANT ALL ON public.agent_cron_map TO service_role;

ALTER TABLE public.agent_cron_map ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agent_cron_map' AND policyname='agent_cron_map_owner_read') THEN
    CREATE POLICY "agent_cron_map_owner_read" ON public.agent_cron_map FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Seed known mappings (idempotent).
INSERT INTO public.agent_cron_map (agent, jobname) VALUES
  ('ops_sentinel',         'ops_sentinel_v1'),
  ('lease_reaper',         'lease_reaper_v1'),
  ('decay_evaporator',     'decay_evaporator_v1'),
  ('freshness_warden',     'freshness_warden_v1'),
  ('legacy_calendar_sync', 'sync-calendar-events-every-hour'),
  ('legacy_podcast_queue', 'process-podcast-queue-every-minute'),
  ('legacy_daily_digest',  'generate-daily-digest-6am-et'),
  ('legacy_task_reaper',   'run-strategy-task-reaper-every-minute'),
  ('legacy_daily_plan',    'generate-daily-plan-5am-et'),
  ('cadence_sentinel',     'cadence_sentinel_v1'),
  ('backlog_burner',       'backlog_burner_v1'),
  ('gap_ranker',           'gap_ranker_v1'),
  ('governor',             'governor_v1')
ON CONFLICT (agent) DO NOTHING;

-- 2) Rewrite ops_sentinel_v1 with extended payload.
DO $$ BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ops_sentinel_v1';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('ops_sentinel_v1', '0 3 * * *', $CRON$
WITH
  -- Existing invariants
  base AS (
    SELECT
      (SELECT count(*) FROM branch_pov p
        WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = p.account_id)) AS orphan_pov,
      (SELECT count(*) FROM account_signals WHERE signal_class IS NULL)         AS unclassified_signals,
      (SELECT count(*) FROM agent_events
        WHERE expires_at < now() AND status = 'proposed')                       AS expired_unreaped
  ),

  -- Registry-sync check: agent_configs vs cron.job reality
  registry AS (
    SELECT
      ac.agent,
      ac.enabled AS registry_enabled,
      COALESCE(m.jobname, ac.agent || '_v1') AS jobname,
      cj.jobid IS NOT NULL AS cron_exists,
      COALESCE(cj.active, false) AS cron_active
    FROM public.agent_configs ac
    LEFT JOIN public.agent_cron_map m ON m.agent = ac.agent
    LEFT JOIN cron.job cj ON cj.jobname = COALESCE(m.jobname, ac.agent || '_v1')
    WHERE ac.home = 'pg_cron'
  ),
  registry_mismatches AS (
    SELECT jsonb_agg(jsonb_build_object(
      'agent', agent,
      'jobname', jobname,
      'registry_enabled', registry_enabled,
      'cron_exists', cron_exists,
      'cron_active', cron_active,
      'discrepancy',
        CASE
          WHEN registry_enabled AND NOT cron_exists THEN 'enabled_but_no_cron_job'
          WHEN registry_enabled AND cron_exists AND NOT cron_active THEN 'enabled_but_cron_inactive'
          WHEN NOT registry_enabled AND cron_exists AND cron_active THEN 'disabled_but_cron_active'
        END
    )) AS mismatches
    FROM registry
    WHERE (registry_enabled AND (NOT cron_exists OR NOT cron_active))
       OR (NOT registry_enabled AND cron_exists AND cron_active)
  ),

  -- Execution health: enabled agents joined to actual cron jobs
  enabled_jobs AS (
    SELECT r.agent, r.jobname, cj.jobid, ac.schedule AS schedule_expr
    FROM registry r
    JOIN public.agent_configs ac ON ac.agent = r.agent
    JOIN cron.job cj ON cj.jobname = r.jobname
    WHERE r.registry_enabled AND r.cron_exists AND r.cron_active
  ),
  failures_24h AS (
    SELECT jsonb_agg(jsonb_build_object(
      'agent', ej.agent,
      'jobname', ej.jobname,
      'runid', d.runid,
      'start_time', d.start_time,
      'end_time', d.end_time,
      'status', d.status,
      'error', d.return_message
    ) ORDER BY d.start_time DESC) AS failures
    FROM enabled_jobs ej
    JOIN cron.job_run_details d ON d.jobid = ej.jobid
    WHERE d.status = 'failed'
      AND d.start_time > now() - interval '24 hours'
  ),
  expected_intervals AS (
    -- Derive a permissive "should have run within" window from the crontab.
    SELECT
      ej.agent,
      ej.jobname,
      CASE
        WHEN ej.schedule_expr LIKE '* * * * *'   THEN interval '10 minutes'
        WHEN ej.schedule_expr LIKE '*/1 * * * *' THEN interval '10 minutes'
        WHEN ej.schedule_expr LIKE '*/5 * * * *' THEN interval '20 minutes'
        WHEN ej.schedule_expr LIKE '*/15 * * * *' THEN interval '45 minutes'
        WHEN ej.schedule_expr LIKE '*/30 * * * *' THEN interval '90 minutes'
        WHEN ej.schedule_expr ~ '^0 \* \* \* \*$' THEN interval '2 hours'      -- hourly
        WHEN ej.schedule_expr ~ '^0 [0-9]+ \* \* \*$' THEN interval '26 hours' -- daily
        WHEN ej.schedule_expr ~ '^0 [0-9]+ \* \* [0-9\-,]+$' THEN interval '26 hours' -- daily on weekdays
        WHEN ej.schedule_expr ~ '^0 [0-9]+ \* \* [0-6]$' THEN interval '8 days'  -- weekly
        ELSE NULL
      END AS expected_window
    FROM enabled_jobs ej
  ),
  silently_dead AS (
    SELECT jsonb_agg(jsonb_build_object(
      'agent', ei.agent,
      'jobname', ei.jobname,
      'expected_within', ei.expected_window::text,
      'reason', 'schedule implies recent run, but zero runs in job_run_details for that window'
    )) AS dead
    FROM expected_intervals ei
    WHERE ei.expected_window IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM cron.job_run_details d
        JOIN enabled_jobs ej2 ON ej2.jobid = d.jobid
        WHERE ej2.agent = ei.agent
          AND d.start_time > now() - ei.expected_window
      )
  ),

  totals AS (
    SELECT
      base.orphan_pov,
      base.unclassified_signals,
      base.expired_unreaped,
      COALESCE(jsonb_array_length(rm.mismatches), 0)  AS registry_mismatch_count,
      COALESCE(jsonb_array_length(f.failures), 0)     AS failed_runs_24h_count,
      COALESCE(jsonb_array_length(sd.dead), 0)        AS silently_dead_count,
      rm.mismatches, f.failures, sd.dead
    FROM base
    LEFT JOIN registry_mismatches rm ON true
    LEFT JOIN failures_24h f ON true
    LEFT JOIN silently_dead sd ON true
  )
INSERT INTO agent_events (
  user_id, agent, event_type, so_what, signal_class, confidence, status, provenance, payload
)
SELECT
  (SELECT user_id FROM accounts LIMIT 1),
  'ops_sentinel',
  'nightly_invariants',
  CASE WHEN violations = 0
       THEN 'All invariants passed — the app told the truth today'
       ELSE violations || ' invariant(s) FAILED — see payload; the app may be contradicting itself'
  END,
  'evergreen', 1.0,
  CASE WHEN violations = 0 THEN 'consumed' ELSE 'proposed' END,
  '{"source_label":"agent:ops_sentinel"}'::jsonb,
  jsonb_build_object(
    'orphan_pov',              t.orphan_pov,
    'unclassified_signals',    t.unclassified_signals,
    'expired_unreaped',        t.expired_unreaped,
    'registry_mismatch_count', t.registry_mismatch_count,
    'registry_mismatches',     COALESCE(t.mismatches, '[]'::jsonb),
    'failed_runs_24h_count',   t.failed_runs_24h_count,
    'failed_runs_24h',         COALESCE(t.failures,   '[]'::jsonb),
    'silently_dead_count',     t.silently_dead_count,
    'silently_dead',           COALESCE(t.dead,       '[]'::jsonb)
  )
FROM totals t,
LATERAL (SELECT
  t.orphan_pov
  + t.unclassified_signals
  + t.registry_mismatch_count
  + t.failed_runs_24h_count
  + t.silently_dead_count AS violations
) v;
$CRON$);
