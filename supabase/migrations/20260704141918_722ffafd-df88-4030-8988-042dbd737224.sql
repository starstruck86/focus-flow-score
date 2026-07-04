
-- products: user-scoped catalog
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  list_price numeric NULL,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products owner all" ON public.products
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- account_product_ownership
CREATE TABLE public.account_product_ownership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  owned boolean NOT NULL DEFAULT true,
  noted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_product_ownership TO authenticated;
GRANT ALL ON public.account_product_ownership TO service_role;
ALTER TABLE public.account_product_ownership ENABLE ROW LEVEL SECURITY;
CREATE POLICY "apo owner all" ON public.account_product_ownership
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER apo_updated_at BEFORE UPDATE ON public.account_product_ownership
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX apo_account_idx ON public.account_product_ownership(account_id);
CREATE INDEX apo_product_idx ON public.account_product_ownership(product_id);
CREATE INDEX apo_user_idx ON public.account_product_ownership(user_id);

-- Seed starter Branch catalog for current owner (no ownership rows).
INSERT INTO public.products (user_id, name, sort_order)
SELECT '9f11e308-4028-4527-b7ba-5ea365dc1441'::uuid, n.name, n.ord
FROM (VALUES
  ('Deep Linking', 10),
  ('Attribution', 20),
  ('Journeys', 30),
  ('Universal Email', 40),
  ('Universal Ads', 50),
  ('Data Feeds', 60)
) AS n(name, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.products
  WHERE user_id = '9f11e308-4028-4527-b7ba-5ea365dc1441'::uuid
);
