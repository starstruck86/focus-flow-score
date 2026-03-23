REVOKE SELECT (access_token, refresh_token) ON public.whoop_connections FROM authenticated;
REVOKE SELECT (access_token, refresh_token) ON public.whoop_connections FROM anon;