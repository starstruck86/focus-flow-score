import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { isNotionZip, extractNotionZip } from '@/lib/notionZipExtractor';

export const CORE_FOLDERS = [
  'Frameworks',
  'Playbooks',
  'Templates',
  'Training',
  'Discovery',
  'Presentations',
  'Battlecards',
  'Tools & Reference',
] as const;

export type CoreFolderName = typeof CORE_FOLDERS[number];

export type ClassificationResult = {
  title: string;
  description: string;
  resource_type: string;
  tags: string[];
  top_folder: CoreFolderName;
  sub_folder?: string;
  scraped_content?: string;
  /** @deprecated Use top_folder instead */
  suggested_folder?: string;
};

async function classifyResource(payload: {
  text?: string;
  filename?: string;
  url?: string;
  existingTitle?: string;
  existingTags?: string[];
}): Promise<ClassificationResult> {
  const { data, error } = await trackedInvoke<any>('classify-resource', {
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
  return '';
}

/**
 * Resolves the folder hierarchy: finds/creates top-level folder, then optionally a sub-folder.
 * Returns the target folder ID.
 */
async function resolveFolderHierarchy(
  userId: string,
  topFolderName: string,
  subFolderName?: string
): Promise<string | null> {
  // Find or create top-level folder (parent_id IS NULL)
  let topFolderId: string | null = null;

  const { data: existingTop } = await supabase
    .from('resource_folders')
    .select('id, name')
    .eq('user_id', userId)
    .is('parent_id', null)
    .ilike('name', topFolderName);

  if (existingTop?.length) {
    topFolderId = existingTop[0].id;
  } else {
    const { data: newFolder } = await supabase
      .from('resource_folders')
      .insert({ name: topFolderName, user_id: userId })
      .select()
      .single();
    if (newFolder) topFolderId = newFolder.id;
  }

  if (!topFolderId) return null;

  // If no sub-folder needed, return top-level
  if (!subFolderName) return topFolderId;

  // Find or create sub-folder under top-level
  const { data: existingSub } = await supabase
    .from('resource_folders')
    .select('id, name')
    .eq('user_id', userId)
    .eq('parent_id', topFolderId)
    .ilike('name', subFolderName);

  if (existingSub?.length) {
    return existingSub[0].id;
  }

  const { data: newSub } = await supabase
    .from('resource_folders')
    .insert({ name: subFolderName, user_id: userId, parent_id: topFolderId })
    .select()
    .single();

  return newSub?.id || topFolderId;
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

      // ── Notion ZIP fast-path ──
      if (isNotionZip(file)) {
        console.log('[ZipUpload] ZIP size:', file.size, 'name:', file.name);

        // Stage 1: Extract
        toast.info('Reading ZIP…');
        let zipResult: Awaited<ReturnType<typeof extractNotionZip>>;
        try {
          zipResult = await extractNotionZip(file);
        } catch (e: any) {
          console.error('[ZipUpload] Extraction failed:', e);
          throw new Error(e.message || 'ZIP too large or failed to parse');
        }

        console.log('[ZipUpload] Extracted length:', zipResult.totalLength, 'md:', zipResult.mdFileCount, 'csv:', zipResult.csvFileCount);

        if (zipResult.mdFileCount === 0 && zipResult.csvFileCount === 0) {
          throw new Error('ZIP contains no usable Notion content');
        }
        if (zipResult.totalLength < 50) {
          throw new Error('ZIP contains no usable Notion content');
        }

        // Stage 2: Upload ZIP to storage (with fallback)
        toast.info('Saving file…');
        const filePath = `${user.id}/${Date.now()}-${file.name}`;
        let storedFilePath: string | null = filePath;
        try {
          const { error: storageError } = await supabase.storage.from('resource-files').upload(filePath, file);
          if (storageError) {
            console.warn('[ZipUpload] Storage upload failed, continuing without file:', storageError.message);
            storedFilePath = null;
          }
        } catch (e: any) {
          console.warn('[ZipUpload] Storage upload error, continuing without file:', e.message);
          storedFilePath = null;
        }

        // Stage 3: Resolve folder
        let finalFolderId = folderId;
        if (!finalFolderId && classification.top_folder) {
          finalFolderId = await resolveFolderHierarchy(user.id, classification.top_folder, classification.sub_folder);
        }

        // Stage 4: Insert resource
        toast.info('Saving resource…');
        const { data: resource, error: resourceError } = await supabase
          .from('resources')
          .insert({
            user_id: user.id,
            title: classification.title,
            description: classification.description,
            resource_type: classification.resource_type,
            tags: classification.tags,
            folder_id: finalFolderId,
            file_url: storedFilePath,
            content: zipResult.content,
            content_status: 'full',
            content_length: zipResult.totalLength,
            manual_content_present: true,
            resolution_method: 'notion_zip_import',
            extraction_method: 'notion_zip_import',
          } as any)
          .select()
          .single();
        if (resourceError) {
          console.error('[ZipUpload] Database insert failed:', resourceError);
          throw new Error(`Database insert failed: ${resourceError.message}`);
        }

        // Stage 5: Version + provenance (best-effort)
        try {
          await supabase.from('resource_versions').insert({
            resource_id: resource.id,
            user_id: user.id,
            version_number: 1,
            title: classification.title,
            content: zipResult.content,
            change_summary: `Notion ZIP import — ${zipResult.mdFileCount} pages, ${zipResult.csvFileCount} tables`,
          });
        } catch (e: any) {
          console.warn('[ZipUpload] Version insert failed:', e.message);
        }

        try {
          await (supabase as any).from('enrichment_attempts').insert({
            resource_id: resource.id,
            user_id: user.id,
            attempt_type: 'notion_zip_upload',
            strategy: 'zip_extraction',
            result: 'success',
            content_found: true,
            content_length_extracted: zipResult.totalLength,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            metadata: { md_files: zipResult.mdFileCount, csv_files: zipResult.csvFileCount, filenames: zipResult.filenames },
          });
        } catch (e: any) {
          console.warn('[ZipUpload] Provenance insert failed:', e.message);
        }

        // Fire-and-forget enrichment
        invokeEnrichResource({ resource_id: resource.id, force: true } as any).catch(() => {});

        console.log('[ZipUpload] Done. Resource:', resource.id);

        const result = resource as any;
        result._zipMeta = {
          mdFileCount: zipResult.mdFileCount,
          csvFileCount: zipResult.csvFileCount,
          totalLength: zipResult.totalLength,
        };
        return result;
      }

      // ── Standard file upload ──
      const filePath = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('resource-files')
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const content = await extractTextFromFile(file);

      // Resolve folder via taxonomy
      let finalFolderId = folderId;
      if (!finalFolderId && classification.top_folder) {
        finalFolderId = await resolveFolderHierarchy(
          user.id,
          classification.top_folder,
          classification.sub_folder
        );
      }

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
    onSuccess: (data: any, variables) => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['resource-folders'] });
      if (isNotionZip(variables.file) && data?._zipMeta) {
        const m = data._zipMeta;
        toast.success(
          `Imported Notion export: ${m.mdFileCount} page${m.mdFileCount !== 1 ? 's' : ''}, ${m.csvFileCount} table${m.csvFileCount !== 1 ? 's' : ''}, ${m.totalLength.toLocaleString()} chars`
        );
      } else {
        toast.success('Resource uploaded and classified');
      }
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
      if (!finalFolderId && classification.top_folder) {
        finalFolderId = await resolveFolderHierarchy(
          user.id,
          classification.top_folder,
          classification.sub_folder
        );
      }

      // Use scraped content if available, otherwise placeholder
      const contentToStore = classification.scraped_content && classification.scraped_content.length > 50
        ? classification.scraped_content
        : `[External Link: ${url}]`;
      const contentStatus = contentToStore.startsWith('[External Link:') ? 'placeholder' : 'enriched';

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
          content: contentToStore,
          content_status: contentStatus,
        } as any)
        .select()
        .single();
      if (error) throw error;

      await supabase.from('resource_versions').insert({
        resource_id: resource.id,
        user_id: user.id,
        version_number: 1,
        title: classification.title,
        content: contentToStore,
        change_summary: 'Initial link',
      });

      // Fire-and-forget background deep enrich if still placeholder
      if (contentStatus === 'placeholder') {
        invokeEnrichResource<any>({ resource_id: resource.id }).catch(() => {});
      }

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
        if (i + 3 < resources.length) await new Promise(r => setTimeout(r, 500));
      }

      return results;
    },
  });
}

export function useResourceFileUrl() {
  return async (path: string): Promise<string> => {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    const { data } = await supabase.storage
      .from('resource-files')
      .createSignedUrl(path, 3600);
    return data?.signedUrl || '';
  };
}
