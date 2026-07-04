DROP POLICY IF EXISTS "Users can check own approval" ON public.approved_users;
CREATE POLICY "Users can check own approval"
  ON public.approved_users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

ALTER VIEW public.active_accounts SET (security_invoker = true);
ALTER VIEW public.dimension_scores SET (security_invoker = true);
ALTER VIEW public.ki_curriculum_full SET (security_invoker = true);