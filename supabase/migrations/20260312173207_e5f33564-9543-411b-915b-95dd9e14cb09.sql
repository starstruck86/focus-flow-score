-- Create storage bucket for screenshot uploads
INSERT INTO storage.buckets (id, name, public) VALUES ('enrichment-screenshots', 'enrichment-screenshots', false);

-- Allow authenticated users to upload to this bucket
CREATE POLICY "Users can upload enrichment screenshots"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'enrichment-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow authenticated users to read their own screenshots
CREATE POLICY "Users can read own enrichment screenshots"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'enrichment-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow authenticated users to delete their own screenshots
CREATE POLICY "Users can delete own enrichment screenshots"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'enrichment-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);