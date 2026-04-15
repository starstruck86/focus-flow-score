
-- Create strategy-uploads bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('strategy-uploads', 'strategy-uploads', false);

-- Users can upload to their own folder
CREATE POLICY "Users upload own strategy files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'strategy-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Users can view their own files
CREATE POLICY "Users view own strategy files"
ON storage.objects FOR SELECT
USING (bucket_id = 'strategy-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Users can delete their own files
CREATE POLICY "Users delete own strategy files"
ON storage.objects FOR DELETE
USING (bucket_id = 'strategy-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
