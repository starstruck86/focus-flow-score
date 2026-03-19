import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type ClassificationResult = {
  title: string;
  description: string;
  resource_type: string;
  tags: string[];
  suggested_folder: string;
};

async function classifyResource(payload: {
  text?: string;
  filename?: string;
  url?: string;
  existingTitle?: string;
  existingTags?: string[];
}): Promise<ClassificationResult> {
  const { data, error } = await supabase.functions.invoke('classify-resource', {
    body: payload,
  });
  if (error) throw error;
  return data as ClassificationResult;
}

async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (['txt', 'md', 'csv', 'json', 'xml', 'html'].includes(ext || '')) {
    return await file.text();
  }
  // For binary files (pdf, docx, pptx), we can't extract client-side
  // Store the file and use filename for classification
  return '';
}

export function useClassifyResource() {
  return useMutation({
    mutationFn: classifyResource,
  });
}

export function useUploadResource() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      file,
      classification,
      folderId,
    }: {
      file: File;
      classification: ClassificationResult;
      folderId?: string | null;
    }) => {
      if (!user) throw new Error('Not authenticated');

      // Upload file to storage
      const filePath = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('resource-files')
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      // Extract text content if possible
      const content = await extractTextFromFile(file);

      // Ensure folder exists
      let finalFolderId = folderId;
      if (!finalFolderId && classification.suggested_folder) {
        const { data: existingFolders } = await supabase
          .from('resource_folders')
          .select('id, name')
          .eq('user_id', user.id)
          .ilike('name', classification.suggested_folder);

        if (existingFolders?.length) {
          finalFolderId = existingFolders[0].id;
        } else {
          const { data: newFolder } = await supabase
            .from('resource_folders')
            .insert({ name: classification.suggested_folder, user_id: user.id })
            .select()
            .single();
          if (newFolder) finalFolderId = newFolder.id;
        }
      }

      // Create resource
      const { data: resource, error: resourceError } = await supabase
        .from('resources')
        .insert({
          user_id: user.id,
          title: classification.title,
          description: classification.description,
          resource_type: classification.resource_type,
          tags: classification.tags,
          folder_id: finalFolderId,
          file_url: filePath,
          content: content || `[File: ${file.name}]`,
        })
        .select()
        .single();
      if (resourceError) throw resourceError;

      // Create initial version
      await supabase.from('resource_versions').insert({
        resource_id: resource.id,
        user_id: user.id,
        version_number: 1,
        title: classification.title,
        content: content || `[File: ${file.name}]`,
        change_summary: 'Initial upload',
      });

      return resource;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['resource-folders'] });
      toast.success('Resource uploaded and classified');
    },
    onError: (e) => toast.error(`Upload failed: ${e.message}`),
  });
}

export function useAddUrlResource() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      url,
      classification,
      folderId,
    }: {
      url: string;
      classification: ClassificationResult;
      folderId?: string | null;
    }) => {
      if (!user) throw new Error('Not authenticated');

      let finalFolderId = folderId;
      if (!finalFolderId && classification.suggested_folder) {
        const { data: existingFolders } = await supabase
          .from('resource_folders')
          .select('id, name')
          .eq('user_id', user.id)
          .ilike('name', classification.suggested_folder);

        if (existingFolders?.length) {
          finalFolderId = existingFolders[0].id;
        } else {
          const { data: newFolder } = await supabase
            .from('resource_folders')
            .insert({ name: classification.suggested_folder, user_id: user.id })
            .select()
            .single();
          if (newFolder) finalFolderId = newFolder.id;
        }
      }

      const { data: resource, error } = await supabase
        .from('resources')
        .insert({
          user_id: user.id,
          title: classification.title,
          description: classification.description,
          resource_type: classification.resource_type,
          tags: classification.tags,
          folder_id: finalFolderId,
          file_url: url,
          content: `[External Link: ${url}]`,
        })
        .select()
        .single();
      if (error) throw error;

      await supabase.from('resource_versions').insert({
        resource_id: resource.id,
        user_id: user.id,
        version_number: 1,
        title: classification.title,
        content: `[External Link: ${url}]`,
        change_summary: 'Initial link',
      });

      return resource;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['resource-folders'] });
      toast.success('Link added and classified');
    },
    onError: (e) => toast.error(`Failed to add link: ${e.message}`),
  });
}

export function useReorganizeLibrary() {
  return useMutation({
    mutationFn: async (resources: { id: string; title: string; content: string | null; tags: string[] | null }[]) => {
      const results: { id: string; original: { title: string; tags: string[] | null }; suggested: ClassificationResult }[] = [];

      // Process in batches of 3 to avoid rate limits
      for (let i = 0; i < resources.length; i += 3) {
        const batch = resources.slice(i, i + 3);
        const batchResults = await Promise.allSettled(
          batch.map(async (r) => {
            const classification = await classifyResource({
              text: r.content?.slice(0, 3000) || '',
              existingTitle: r.title,
              existingTags: r.tags || [],
            });
            return {
              id: r.id,
              original: { title: r.title, tags: r.tags },
              suggested: classification,
            };
          })
        );
        for (const result of batchResults) {
          if (result.status === 'fulfilled') results.push(result.value);
        }
        // Small delay between batches
        if (i + 3 < resources.length) await new Promise(r => setTimeout(r, 500));
      }

      return results;
    },
  });
}

export function useResourceFileUrl() {
  return async (path: string): Promise<string> => {
    // Check if it's an external URL
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    const { data } = await supabase.storage
      .from('resource-files')
      .createSignedUrl(path, 3600);
    return data?.signedUrl || '';
  };
}
