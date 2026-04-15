import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { extractTextFromPdf } from '@/lib/pdfTextExtractor';

export interface UploadMetadata {
  key_points?: string[];
  entities?: Array<{ name: string; type: string }>;
  document_type?: string;
  parse_quality?: 'good' | 'partial' | 'none';
  summarized_at?: string;
}

export type ParseStatus = 'parsed' | 'summarized' | 'partial' | 'unsupported' | 'pending';

export interface StrategyUpload {
  id: string;
  user_id: string;
  thread_id: string | null;
  file_name: string;
  file_type: string | null;
  storage_path: string;
  parsed_text: string | null;
  summary: string | null;
  metadata_json: UploadMetadata | null;
  created_at: string;
}

export function getParseStatus(upload: StrategyUpload): ParseStatus {
  if (upload.summary && upload.metadata_json?.summarized_at) return 'summarized';
  if (upload.parsed_text && upload.parsed_text.length > 50) return 'parsed';
  if (upload.parsed_text && upload.parsed_text.length > 0) return 'partial';
  const ext = upload.file_name?.split('.').pop()?.toLowerCase();
  const textTypes = ['txt', 'md', 'csv', 'json', 'xml', 'html', 'log', 'yml', 'yaml'];
  const richTypes = ['pdf', 'docx', 'pptx', 'xlsx'];
  if (textTypes.includes(ext || '') || richTypes.includes(ext || '')) return 'pending';
  return 'unsupported';
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

  const summarizeUpload = useCallback(async (uploadId: string) => {
    if (!user) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-summarize-upload`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ uploadId }),
        }
      );
      if (resp.ok) {
        await fetchUploads();
        toast.success('File analyzed');
      }
    } catch (e) {
      console.error('Summarize failed:', e);
    }
  }, [user, fetchUploads]);

  const uploadFile = useCallback(async (file: File) => {
    if (!threadId || !user) return;
    setIsUploading(true);
    try {
      const path = `${user.id}/${threadId}/${Date.now()}-${file.name}`;
      const { error: storageErr } = await supabase.storage
        .from('strategy-uploads')
        .upload(path, file);
      if (storageErr) throw storageErr;

      let parsedText: string | null = null;
      const ext = file.name.split('.').pop()?.toLowerCase();

      // Text-based files
      if (file.type.startsWith('text/') || ['md', 'csv', 'json', 'xml', 'html', 'log', 'yml', 'yaml', 'txt'].includes(ext || '')) {
        parsedText = await file.text();
        if (parsedText.length > 15000) parsedText = parsedText.slice(0, 15000);
      }
      // PDF extraction using client-side pdf.js + AI OCR fallback
      else if (ext === 'pdf') {
        try {
          parsedText = await extractTextFromPdf(file, (msg) => {
            console.log('[pdf-extract]', msg);
          });
          if (parsedText.length > 15000) parsedText = parsedText.slice(0, 15000);
        } catch (e) {
          console.error('PDF extraction failed:', e);
          parsedText = `[PDF extraction failed: ${e instanceof Error ? e.message : 'Unknown error'}]`;
        }
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
          metadata_json: {
            parse_quality: parsedText && parsedText.length > 50 ? 'good' : parsedText ? 'partial' : 'none',
          },
        })
        .select()
        .single();
      if (error) throw error;

      const upload = data as StrategyUpload;
      setUploads(prev => [upload, ...prev]);
      toast.success(`Uploaded ${file.name}`);

      // Auto-summarize if we have enough text
      if (parsedText && parsedText.length > 100) {
        summarizeUpload(upload.id);
      }
    } catch (e: any) {
      toast.error(`Upload failed: ${e.message}`);
    } finally {
      setIsUploading(false);
    }
  }, [threadId, user, summarizeUpload]);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      await uploadFile(file);
    }
  }, [uploadFile]);

  return { uploads, isUploading, uploadFile, uploadFiles, summarizeUpload, refetch: fetchUploads };
}
