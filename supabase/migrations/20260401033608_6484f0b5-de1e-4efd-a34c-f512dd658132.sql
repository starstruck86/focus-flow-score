
-- Create podcast import queue table for server-side processing
CREATE TABLE public.podcast_import_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_registry_id uuid REFERENCES public.source_registry(id),
  episode_url text NOT NULL,
  episode_title text NOT NULL,
  episode_guest text,
  episode_published timestamptz,
  episode_duration text,
  show_author text,
  status text NOT NULL DEFAULT 'queued',
  error_message text,
  resource_id uuid,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- RLS
ALTER TABLE public.podcast_import_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own queue items"
  ON public.podcast_import_queue
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Indexes for queue polling
CREATE INDEX idx_piq_status ON public.podcast_import_queue(status) WHERE status IN ('queued', 'processing');
CREATE INDEX idx_piq_user_status ON public.podcast_import_queue(user_id, status);

-- Updated_at trigger
CREATE TRIGGER update_podcast_import_queue_updated_at
  BEFORE UPDATE ON public.podcast_import_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.podcast_import_queue;
