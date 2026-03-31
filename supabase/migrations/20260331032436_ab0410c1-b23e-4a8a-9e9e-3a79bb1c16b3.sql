
-- Asset provenance: trace every promoted asset back to its source segment
CREATE TABLE public.asset_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  asset_type text NOT NULL CHECK (asset_type IN ('template', 'example', 'tactic')),
  asset_id text NOT NULL,
  source_resource_id text NOT NULL,
  source_segment_index integer,
  source_char_range jsonb,
  source_heading text,
  transformed_content text,
  removed_lines jsonb DEFAULT '[]'::jsonb,
  high_risk_removals jsonb DEFAULT '[]'::jsonb,
  original_content text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.asset_provenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own provenance" ON public.asset_provenance FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own provenance" ON public.asset_provenance FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Cluster resolutions: durable audit trail
CREATE TABLE public.cluster_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  cluster_id text NOT NULL,
  canonical_resource_id text NOT NULL,
  canonical_role text NOT NULL,
  reasoning text NOT NULL,
  demoted_members jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid NOT NULL
);

ALTER TABLE public.cluster_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own resolutions" ON public.cluster_resolutions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own resolutions" ON public.cluster_resolutions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_asset_provenance_resource ON public.asset_provenance(source_resource_id);
CREATE INDEX idx_asset_provenance_asset ON public.asset_provenance(asset_type, asset_id);
CREATE INDEX idx_cluster_resolutions_canonical ON public.cluster_resolutions(canonical_resource_id);
