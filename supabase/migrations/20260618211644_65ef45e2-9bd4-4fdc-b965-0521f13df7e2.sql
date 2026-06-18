CREATE TABLE IF NOT EXISTS public.skill_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall_avg integer,
  dimension_count integer,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT ON public.skill_benchmarks TO authenticated;
GRANT ALL ON public.skill_benchmarks TO service_role;
ALTER TABLE public.skill_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own benchmarks" ON public.skill_benchmarks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);