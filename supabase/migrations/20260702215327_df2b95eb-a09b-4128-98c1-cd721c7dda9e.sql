CREATE OR REPLACE FUNCTION public.calib_drills_export() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_agg(row_to_json(t) ORDER BY t.concept_id, t.ki_id) FROM (
    SELECT k.concept_id, k.ki_id, c.topic, c.spoke, c.band,
      k.drill_scenario, k.drill_spoken_task, k.drill_model_answer, k.drill_rubric
    FROM public.ki_curriculum k
    JOIN public.curriculum_concepts c ON c.concept_id = k.concept_id
    WHERE k.drill_ready = true
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.calib_drills_export() TO anon, authenticated;