
-- Phase 2: Approved users allowlist table
CREATE TABLE public.approved_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'user',
  is_active boolean NOT NULL DEFAULT true,
  approved_at timestamp with time zone NOT NULL DEFAULT now(),
  approved_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.approved_users ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can check if they are approved (read own row)
CREATE POLICY "Users can check own approval"
  ON public.approved_users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR auth.jwt() ->> 'email' = email);

-- No insert/update/delete from client — admin only via service_role
-- (no additional policies needed; deny-by-default)

-- Seed owner account
INSERT INTO public.approved_users (email, role, is_active, approved_by)
VALUES ('Corey.hartin@gmail.com', 'owner', true, 'system-seed');

-- Security definer function to check approval without RLS recursion
CREATE OR REPLACE FUNCTION public.is_approved_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.approved_users
    WHERE (user_id = _user_id OR email = (SELECT email FROM auth.users WHERE id = _user_id))
      AND is_active = true
  )
$$;
