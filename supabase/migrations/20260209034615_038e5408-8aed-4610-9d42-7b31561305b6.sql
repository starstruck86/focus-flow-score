-- Create table for storing header mappings (CSV header -> object.field + transform)
CREATE TABLE public.import_header_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  csv_header TEXT NOT NULL,
  target_object TEXT NOT NULL, -- 'account', 'opportunity', 'renewal', 'contact', 'ignore'
  target_field TEXT, -- null if ignored
  data_transform TEXT DEFAULT 'text', -- 'text', 'url', 'date', 'number', 'picklist', 'extract_domain', 'extract_sfdc_id'
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, csv_header)
);

-- Create table for storing value mappings (CSV value -> app value for picklists)
CREATE TABLE public.import_value_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  field_name TEXT NOT NULL, -- e.g., 'stage', 'status', 'motion', 'deal_type'
  csv_value TEXT NOT NULL,
  app_value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, field_name, csv_value)
);

-- Create table for account aliases (imported name/domain -> canonical account)
CREATE TABLE public.import_account_aliases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  alias_type TEXT NOT NULL, -- 'name' or 'domain'
  alias_value TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, alias_type, alias_value)
);

-- Enable RLS
ALTER TABLE public.import_header_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_value_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_account_aliases ENABLE ROW LEVEL SECURITY;

-- RLS policies for header mappings
CREATE POLICY "Users can view their own header mappings"
  ON public.import_header_mappings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own header mappings"
  ON public.import_header_mappings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own header mappings"
  ON public.import_header_mappings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own header mappings"
  ON public.import_header_mappings FOR DELETE
  USING (auth.uid() = user_id);

-- RLS policies for value mappings
CREATE POLICY "Users can view their own value mappings"
  ON public.import_value_mappings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own value mappings"
  ON public.import_value_mappings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own value mappings"
  ON public.import_value_mappings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own value mappings"
  ON public.import_value_mappings FOR DELETE
  USING (auth.uid() = user_id);

-- RLS policies for account aliases
CREATE POLICY "Users can view their own account aliases"
  ON public.import_account_aliases FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own account aliases"
  ON public.import_account_aliases FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own account aliases"
  ON public.import_account_aliases FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own account aliases"
  ON public.import_account_aliases FOR DELETE
  USING (auth.uid() = user_id);

-- Add triggers for updated_at
CREATE TRIGGER update_import_header_mappings_updated_at
  BEFORE UPDATE ON public.import_header_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_import_value_mappings_updated_at
  BEFORE UPDATE ON public.import_value_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();