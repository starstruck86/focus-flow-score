
-- Resource folders for organizing prep materials
CREATE TABLE public.resource_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.resource_folders(id) ON DELETE CASCADE,
  icon TEXT DEFAULT 'folder',
  color TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Resources (documents, templates, prep materials)
CREATE TABLE public.resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  folder_id UUID REFERENCES public.resource_folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  resource_type TEXT NOT NULL DEFAULT 'document',
  content TEXT DEFAULT '',
  is_template BOOLEAN DEFAULT false,
  template_category TEXT,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  file_url TEXT,
  tags TEXT[] DEFAULT '{}',
  current_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Version history for resources
CREATE TABLE public.resource_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID REFERENCES public.resources(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  change_summary TEXT,
  file_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.resource_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_versions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users manage own folders" ON public.resource_folders FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own resources" ON public.resources FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own versions" ON public.resource_versions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Update triggers
CREATE TRIGGER update_resource_folders_updated_at BEFORE UPDATE ON public.resource_folders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_resources_updated_at BEFORE UPDATE ON public.resources FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Storage bucket for resource files
INSERT INTO storage.buckets (id, name, public) VALUES ('resource-files', 'resource-files', false);

-- Storage RLS
CREATE POLICY "Users manage own resource files" ON storage.objects FOR ALL TO authenticated USING (bucket_id = 'resource-files' AND (storage.foldername(name))[1] = auth.uid()::text) WITH CHECK (bucket_id = 'resource-files' AND (storage.foldername(name))[1] = auth.uid()::text);
