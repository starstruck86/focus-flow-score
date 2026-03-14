
-- Create tasks table for persistent task storage
CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  workstream TEXT NOT NULL DEFAULT 'pg',
  status TEXT NOT NULL DEFAULT 'next',
  priority TEXT NOT NULL DEFAULT 'P1',
  due_date DATE,
  linked_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  linked_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  notes TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  motion TEXT,
  linked_record_type TEXT,
  linked_record_id UUID,
  linked_contact_id UUID,
  category TEXT,
  estimated_minutes INTEGER,
  subtasks JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own tasks" ON public.tasks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own tasks" ON public.tasks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own tasks" ON public.tasks FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own tasks" ON public.tasks FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Updated_at trigger
CREATE TRIGGER set_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
