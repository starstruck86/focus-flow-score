-- Create resource_collections table
CREATE TABLE public.resource_collections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  collection_type TEXT NOT NULL DEFAULT 'manual',
  description TEXT,
  parent_resource_id UUID REFERENCES public.resources(id) ON DELETE SET NULL,
  resource_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.resource_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own collections"
  ON public.resource_collections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own collections"
  ON public.resource_collections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own collections"
  ON public.resource_collections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own collections"
  ON public.resource_collections FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_resource_collections_updated_at
  BEFORE UPDATE ON public.resource_collections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create resource_collection_members join table
CREATE TABLE public.resource_collection_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID NOT NULL REFERENCES public.resource_collections(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(collection_id, resource_id)
);

ALTER TABLE public.resource_collection_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own collection members"
  ON public.resource_collection_members FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add to their own collections"
  ON public.resource_collection_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own collection members"
  ON public.resource_collection_members FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can remove from their own collections"
  ON public.resource_collection_members FOR DELETE
  USING (auth.uid() = user_id);

-- Add downstream eligibility to resources
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS downstream_eligibility JSONB DEFAULT '{"dave_grounding": false, "playbook_generation": false, "coaching": false, "search": false}'::jsonb;