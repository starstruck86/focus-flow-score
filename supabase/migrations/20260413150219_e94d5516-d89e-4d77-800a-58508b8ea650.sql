CREATE OR REPLACE FUNCTION public.get_resource_content_prefixes(p_user_id uuid)
RETURNS TABLE(id uuid, content_prefix text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, left(r.content, 300) as content_prefix
  FROM resources r
  WHERE r.user_id = p_user_id;
$$;