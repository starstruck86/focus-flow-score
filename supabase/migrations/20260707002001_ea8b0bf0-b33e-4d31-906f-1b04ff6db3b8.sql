-- F3: harden approved_users SELECT policy.
-- Prior policy: (auth.uid() = user_id) applied to {authenticated}.
-- New policy: same identity check, additionally require is_active,
-- and explicitly scoped to the authenticated role only (no anon, no public).
-- Email-based row exposure is prohibited: rows with user_id IS NULL are
-- invisible to any caller and must be reached only via SECURITY DEFINER
-- function public.is_approved_user (unchanged).

DROP POLICY IF EXISTS "Users can check own approval" ON public.approved_users;

CREATE POLICY "Users can read own active approval row"
  ON public.approved_users
  FOR SELECT
  TO authenticated
  USING (
    user_id IS NOT NULL
    AND auth.uid() = user_id
    AND is_active = true
  );
