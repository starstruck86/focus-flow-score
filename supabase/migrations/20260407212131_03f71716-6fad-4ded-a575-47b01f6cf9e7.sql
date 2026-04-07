-- Fix: make the view use SECURITY INVOKER so RLS on accounts is respected
ALTER VIEW public.active_accounts SET (security_invoker = on);