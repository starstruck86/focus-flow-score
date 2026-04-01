import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { isNotionZip } from '@/lib/notionZipExtractor';
import { importNotionZipDirect } from '@/lib/notionDirectImporter';
import { autoOperationalizeResource } from '@/lib/autoOperationalize';

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

export async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (['txt', 'md', 'csv', 'json', 'xml', 'html', 'htm', 'log', 'rtf'].includes(ext || '')) {
    return await file.text();
  }
  // For PDF/DOCX/etc, return empty — server-side parsing handles these
  return '';
}

/**
 * Trigger server-side file parsing for a resource.
 * Returns parsed content length or throws.
 */
export async function parseUploadedFile(resourceId: string): Promise<{
  success: boolean;
  content_length?: number;
  parser_used?: string;
  diagnostics?: Record<string, unknown>;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke('parse-uploaded-file', {
    body: { resource_id: resourceId },
  });
  if (error) throw error;
  return data;
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
        console.log('[ZipUpload] Using direct importer for:', file.name, 'size:', file.size);

        const result = await importNotionZipDirect(file, user.id, (p) => {
          toast.info(p.message, { id: 'notion-import-progress' });
        });

        if (!result.success && result.pagesCreated === 0 && result.databasesCreated === 0) {
          throw new Error(result.message);
        }

        // Return a synthetic resource object for onSuccess
        const synthetic = {
          id: result.sourceArchiveId || 'import-complete',
          title: file.name.replace(/\.zip$/i, ''),
          _zipMeta: {
            mdFileCount: result.pagesCreated + result.chunksCreated,
            csvFileCount: result.databasesCreated,
            totalLength: 0,
            skipped: result.skipped,
            importGroupId: result.importGroupId,
          },
        };
        return synthetic as any;
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
          `Imported Notion export: ${m.mdFileCount} page${m.mdFileCount !== 1 ? 's' : ''}, ${m.csvFileCount} database${m.csvFileCount !== 1 ? 's' : ''}, ${m.skipped ?? 0} skipped`,
          { id: 'notion-import-progress' }
        );
      } else {
        toast.success('Resource uploaded and classified');

        if (data?.id) {
          // Check if this is a binary file that needs server-side parsing
          const ext = variables.file.name.split('.').pop()?.toLowerCase() || '';
          const needsServerParse = ['pdf', 'docx', 'doc', 'pptx', 'ppt'].includes(ext);

          if (needsServerParse) {
            // Trigger server-side file parsing first, then auto-operationalize
            toast.info('Parsing uploaded file…');
            parseUploadedFile(data.id).then(parseResult => {
              qc.invalidateQueries({ queryKey: ['resources'] });
              if (parseResult.success) {
                toast.success(`Parsed: ${parseResult.content_length?.toLocaleString()} chars extracted`);
                // Now auto-operationalize with real content
                autoOperationalizeResource(data.id).then(result => {
                  qc.invalidateQueries({ queryKey: ['knowledge-items'] });
                  if (result.operationalized) {
                    toast.success(`Auto-operationalized — ${result.knowledgeExtracted} extracted, ${result.knowledgeActivated} activated`);
                  } else if (result.stagesCompleted.includes('knowledge_extracted')) {
                    toast.info(`${result.knowledgeExtracted} knowledge items extracted — review to activate`);
                  }
                }).catch(() => { /* non-fatal */ });
              } else {
                toast.warning('File parsing returned limited content — may need manual review');
              }
            }).catch(() => {
              toast.warning('Server-side file parsing failed — try Re-parse later');
            });
          } else {
            // Text-based files: auto-operationalize directly
            autoOperationalizeResource(data.id).then(result => {
              qc.invalidateQueries({ queryKey: ['knowledge-items'] });
              if (result.operationalized) {
                toast.success(`Auto-operationalized — ${result.knowledgeExtracted} extracted, ${result.knowledgeActivated} activated`);
              } else if (result.stagesCompleted.includes('knowledge_extracted')) {
                toast.info(`${result.knowledgeExtracted} knowledge items extracted — review to activate`);
              }
            }).catch(() => { /* non-fatal */ });
          }
        }
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
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['resource-folders'] });
      toast.success('Link added and classified');
      // Fire-and-forget auto-operationalization for URL resources with content
      if (data?.id) {
        autoOperationalizeResource(data.id).then(result => {
          qc.invalidateQueries({ queryKey: ['knowledge-items'] });
          if (result.operationalized) {
            toast.success(`Auto-operationalized — ${result.knowledgeExtracted} extracted, ${result.knowledgeActivated} activated`);
          } else if (result.stagesCompleted.includes('knowledge_extracted')) {
            toast.info(`${result.knowledgeExtracted} knowledge items extracted — review to activate`);
          }
        }).catch(() => { /* non-fatal */ });
      }
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
