-- Create a view that enforces soft-delete filtering at the DB level
CREATE OR REPLACE VIEW public.active_accounts AS
SELECT * FROM public.accounts WHERE deleted_at IS NULL;

-- Grant access so RLS-authenticated users can read the view
GRANT SELECT ON public.active_accounts TO authenticated;
GRANT SELECT ON public.active_accounts TO anon;