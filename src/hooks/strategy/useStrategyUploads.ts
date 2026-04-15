import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface StrategyUpload {
  id: string;
  user_id: string;
  thread_id: string | null;
  file_name: string;
  file_type: string | null;
  storage_path: string;
  parsed_text: string | null;
  summary: string | null;
  created_at: string;
}

export function useStrategyUploads(threadId: string | null) {
  const { user } = useAuth();
  const [uploads, setUploads] = useState<StrategyUpload[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const fetchUploads = useCallback(async () => {
    if (!threadId || !user) { setUploads([]); return; }
    const { data } = await supabase
      .from('strategy_uploaded_resources')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false });
    if (data) setUploads(data as StrategyUpload[]);
  }, [threadId, user]);

  useEffect(() => { fetchUploads(); }, [fetchUploads]);

  const uploadFile = useCallback(async (file: File) => {
    if (!threadId || !user) return;
    setIsUploading(true);
    try {
      const path = `${user.id}/${threadId}/${Date.now()}-${file.name}`;
      const { error: storageErr } = await supabase.storage
        .from('strategy-uploads')
        .upload(path, file);
      if (storageErr) throw storageErr;

      // Read text content for text files
      let parsedText: string | null = null;
      if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.csv')) {
        parsedText = await file.text();
        if (parsedText.length > 10000) parsedText = parsedText.slice(0, 10000);
      }

      const { data, error } = await supabase
        .from('strategy_uploaded_resources')
        .insert({
          user_id: user.id,
          thread_id: threadId,
          file_name: file.name,
          file_type: file.type || null,
          storage_path: path,
          parsed_text: parsedText,
        })
        .select()
        .single();
      if (error) throw error;

      setUploads(prev => [data as StrategyUpload, ...prev]);
      toast.success(`Uploaded ${file.name}`);
    } catch (e: any) {
      toast.error(`Upload failed: ${e.message}`);
    } finally {
      setIsUploading(false);
    }
  }, [threadId, user]);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      await uploadFile(file);
    }
  }, [uploadFile]);

  return { uploads, isUploading, uploadFile, uploadFiles, refetch: fetchUploads };
}
