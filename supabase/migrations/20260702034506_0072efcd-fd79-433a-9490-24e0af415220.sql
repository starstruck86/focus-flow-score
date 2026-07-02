
CREATE TABLE public.user_train_prefs (
  user_id uuid PRIMARY KEY,
  focus_spokes text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_train_prefs TO authenticated;
GRANT ALL ON public.user_train_prefs TO service_role;

ALTER TABLE public.user_train_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own train prefs select"
  ON public.user_train_prefs FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "own train prefs insert"
  ON public.user_train_prefs FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own train prefs update"
  ON public.user_train_prefs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own train prefs delete"
  ON public.user_train_prefs FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER user_train_prefs_updated_at
  BEFORE UPDATE ON public.user_train_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.user_train_prefs (user_id, focus_spokes)
VALUES ('9f11e308-4028-4527-b7ba-5ea365dc1441', ARRAY['product','expansion','deal_control'])
ON CONFLICT (user_id) DO UPDATE SET focus_spokes = EXCLUDED.focus_spokes, updated_at = now();
