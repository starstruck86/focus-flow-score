/**
 * Notion Direct Importer — Structure-first ZIP import.
 *
 * Iterates ZIP file entries directly, creating one resource per real
 * Notion page (.md) or database (.csv). No merge-then-split.
 */

import JSZip from 'jszip';
import { supabase } from '@/integrations/supabase/client';

// ── Constants ────────────────────────────────────────────────
const MAX_PAGE_LENGTH = 75_000;
const MIN_CONTENT_LENGTH = 200;
const MIN_WORD_COUNT = 15;
const MIN_ALPHA_RATIO = 0.4;
const BATCH_SIZE = 20;

// ── Types ────────────────────────────────────────────────────

export interface NotionImportProgress {
  stage: 'reading' | 'parsing' | 'creating' | 'finalizing' | 'done' | 'error';
  message: string;
  pagesFound?: number;
  databasesFound?: number;
  skipped?: number;
  created?: number;
  total?: number;
}

export interface NotionImportResult {
  success: boolean;
  message: string;
  importGroupId: string;
  sourceArchiveId: string | null;
  pagesCreated: number;
  databasesCreated: number;
  chunksCreated: number;
  skipped: number;
  folderId: string | null;
  errors: string[];
}

interface ParsedFile {
  path: string;
  filename: string;
  content: string;
  type: 'page' | 'database';
  folderParts: string[];
  title: string;
}

interface ResourceInsert {
  user_id: string;
  title: string;
  content: string;
  content_length: number;
  content_status: string;
  resource_type: string;
  manual_content_present: boolean;
  resolution_method: string;
  extraction_method: string;
  enrichment_status: string;
  folder_id: string | null;
  tags: string[];
  description: string;
}

// ── Title Cleanup ────────────────────────────────────────────

export function cleanNotionTitle(filename: string, content?: string): string {
  let title = filename
    .replace(/\.[^.]+$/, '')            // strip extension
    .replace(/\s+[a-f0-9]{20,}$/i, '')  // strip Notion hash suffix
    .replace(/\s+[a-f0-9]{8,12}$/i, '') // shorter hash variants
    .trim();

  // Prefer first H1 from content if it looks cleaner
  if (content) {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
      const h1Title = h1Match[1].trim();
      // Use H1 if it's cleaner (no hash, reasonable length)
      if (h1Title.length > 3 && h1Title.length < 200 && !/[a-f0-9]{16,}/i.test(h1Title)) {
        title = h1Title;
      }
    }
  }

  return title || filename;
}

// ── Content Quality Filter ───────────────────────────────────

export function passesQualityCheck(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < MIN_CONTENT_LENGTH) return false;

  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  if (words.length < MIN_WORD_COUNT) return false;

  // Check alphabetic ratio
  const alphaChars = (trimmed.match(/[a-zA-Z]/g) || []).length;
  if (trimmed.length > 0 && alphaChars / trimmed.length < MIN_ALPHA_RATIO) return false;

  // Skip mostly-heading pages (>80% lines are headings or empty)
  const lines = trimmed.split('\n');
  const noiseLines = lines.filter(l => /^#{1,6}\s*$/.test(l.trim()) || l.trim() === '' || /^[-=_*]{3,}$/.test(l.trim()));
  if (lines.length > 3 && noiseLines.length / lines.length > 0.8) return false;

  return true;
}

// ── Path Parsing ─────────────────────────────────────────────

function parseFilePath(path: string): { folderParts: string[]; filename: string } {
  const parts = path.split('/').filter(Boolean);
  const filename = parts.pop() || path;
  return { folderParts: parts, filename };
}

// ── Chunking (only for oversized pages) ──────────────────────

export function chunkLargePage(title: string, content: string): { title: string; content: string }[] {
  if (content.length <= MAX_PAGE_LENGTH) return [{ title, content }];

  const chunks: { title: string; content: string }[] = [];

  // Try splitting by H2 headings first
  const h2Parts = content.split(/(?=^##\s)/m).filter(p => p.trim().length > 0);
  if (h2Parts.length > 1) {
    let current = '';
    let idx = 1;
    for (const part of h2Parts) {
      if (current.length + part.length > MAX_PAGE_LENGTH && current.length > 0) {
        chunks.push({ title: `${title} (Part ${idx})`, content: current.trim() });
        idx++;
        current = '';
      }
      current += part + '\n\n';
    }
    if (current.trim()) {
      chunks.push({ title: idx > 1 ? `${title} (Part ${idx})` : title, content: current.trim() });
    }
    return chunks;
  }

  // Fall back to paragraph splitting
  const paragraphs = content.split(/\n{2,}/);
  let current = '';
  let idx = 1;
  for (const para of paragraphs) {
    if (current.length + para.length > MAX_PAGE_LENGTH && current.length > 0) {
      chunks.push({ title: `${title} (Part ${idx})`, content: current.trim() });
      idx++;
      current = '';
    }
    current += para + '\n\n';
  }
  if (current.trim()) {
    chunks.push({ title: idx > 1 ? `${title} (Part ${idx})` : title, content: current.trim() });
  }

  return chunks;
}

// ── Deduplication within import ──────────────────────────────

function deduplicateFiles(files: ParsedFile[]): ParsedFile[] {
  const seen = new Map<string, ParsedFile>();
  for (const f of files) {
    const key = `${f.title.toLowerCase()}::${f.content.slice(0, 500)}`;
    if (!seen.has(key)) {
      seen.set(key, f);
    }
  }
  return Array.from(seen.values());
}

// ── ZIP Extraction ───────────────────────────────────────────

async function extractZipFiles(file: File): Promise<ParsedFile[]> {
  let zip = await JSZip.loadAsync(file);

  // Handle nested ZIP (Notion wraps large exports)
  const topEntries = Object.entries(zip.files).filter(([, f]) => !f.dir);
  const nestedZips = topEntries.filter(([p]) => p.toLowerCase().endsWith('.zip'));
  if (nestedZips.length > 0 && topEntries.length === nestedZips.length) {
    const merged = new JSZip();
    for (const [, zipFile] of nestedZips) {
      try {
        const buf = await zipFile.async('arraybuffer');
        const inner = await JSZip.loadAsync(buf);
        for (const [innerPath, innerFile] of Object.entries(inner.files)) {
          if (!innerFile.dir) merged.files[innerPath] = innerFile;
        }
      } catch (e: any) {
        console.warn('[NotionImport] Failed to unwrap nested ZIP:', e.message);
      }
    }
    zip = merged;
  }

  const entries = Object.entries(zip.files).filter(([, f]) => !f.dir);
  entries.sort(([a], [b]) => a.localeCompare(b));

  const files_out: ParsedFile[] = [];

  await Promise.all(entries.map(async ([path, zipFile]) => {
    const lower = path.toLowerCase();
    try {
      if (lower.endsWith('.md')) {
        const text = await zipFile.async('string');
        if (text.trim().length === 0) return;
        const { folderParts, filename } = parseFilePath(path);
        const title = cleanNotionTitle(filename, text);
        files_out.push({ path, filename, content: text.trim(), type: 'page', folderParts, title });
      } else if (lower.endsWith('.csv')) {
        const text = await zipFile.async('string');
        if (text.trim().length === 0) return;
        const { folderParts, filename } = parseFilePath(path);
        const title = cleanNotionTitle(filename);
        files_out.push({ path, filename, content: text.trim(), type: 'database', folderParts, title });
      }
      // Skip all other file types (images, PDFs, etc.)
    } catch (e: any) {
      console.warn(`[NotionImport] Failed to read ${path}:`, e.message);
    }
  }));

  // Re-sort after parallel extraction
  files_out.sort((a, b) => a.path.localeCompare(b.path));
  return files_out;
}

// ── Folder Resolution ────────────────────────────────────────

async function resolveImportFolder(
  userId: string,
  zipName: string,
): Promise<string> {
  const folderName = `Notion Import – ${zipName.replace(/\.zip$/i, '')}`;

  const { data: existing } = await supabase
    .from('resource_folders')
    .select('id')
    .eq('user_id', userId)
    .eq('name', folderName)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('resource_folders')
    .insert({ user_id: userId, name: folderName, icon: 'archive' })
    .select('id')
    .single();

  if (error || !created) throw new Error(`Failed to create folder: ${error?.message}`);
  return created.id;
}

// ── Main Import Function ─────────────────────────────────────

export async function importNotionZipDirect(
  file: File,
  userId: string,
  onProgress?: (p: NotionImportProgress) => void,
): Promise<NotionImportResult> {
  const importGroupId = crypto.randomUUID();
  const errors: string[] = [];
  let sourceArchiveId: string | null = null;
  let folderId: string | null = null;

  try {
    // Stage 1: Read ZIP
    onProgress?.({ stage: 'reading', message: 'Reading ZIP file…' });
    let parsedFiles: ParsedFile[];
    try {
      parsedFiles = await extractZipFiles(file);
    } catch (e: any) {
      return {
        success: false, message: `ZIP parse failed: ${e.message}`,
        importGroupId, sourceArchiveId: null, pagesCreated: 0,
        databasesCreated: 0, chunksCreated: 0, skipped: 0,
        folderId: null, errors: [e.message],
      };
    }

    if (parsedFiles.length === 0) {
      return {
        success: false, message: 'ZIP contains no usable Notion content (.md or .csv files)',
        importGroupId, sourceArchiveId: null, pagesCreated: 0,
        databasesCreated: 0, chunksCreated: 0, skipped: 0,
        folderId: null, errors: ['No .md or .csv files found'],
      };
    }

    // Stage 2: Parse & Filter
    onProgress?.({ stage: 'parsing', message: 'Filtering content…', pagesFound: parsedFiles.filter(f => f.type === 'page').length, databasesFound: parsedFiles.filter(f => f.type === 'database').length });

    const qualityPassed: ParsedFile[] = [];
    let skipped = 0;
    for (const f of parsedFiles) {
      if (f.type === 'page' && !passesQualityCheck(f.content)) {
        skipped++;
        continue;
      }
      // CSVs pass if they have any content
      if (f.type === 'database' && f.content.trim().length < 50) {
        skipped++;
        continue;
      }
      qualityPassed.push(f);
    }

    // Deduplicate
    const dedupedFiles = deduplicateFiles(qualityPassed);
    skipped += qualityPassed.length - dedupedFiles.length;

    onProgress?.({
      stage: 'parsing', message: `${dedupedFiles.length} files pass quality filter, ${skipped} skipped`,
      pagesFound: dedupedFiles.filter(f => f.type === 'page').length,
      databasesFound: dedupedFiles.filter(f => f.type === 'database').length,
      skipped,
    });

    // Stage 3: Create folder
    folderId = await resolveImportFolder(userId, file.name);

    // Stage 4: Upload ZIP to storage (best-effort)
    let storedZipPath: string | null = null;
    try {
      const zipPath = `${userId}/${Date.now()}-${file.name}`;
      const { error: storageErr } = await supabase.storage.from('resource-files').upload(zipPath, file);
      if (!storageErr) storedZipPath = zipPath;
    } catch { /* non-fatal */ }

    // Stage 5: Create source archive resource
    onProgress?.({ stage: 'creating', message: 'Creating source archive…' });
    const { data: archive, error: archiveErr } = await supabase
      .from('resources')
      .insert({
        user_id: userId,
        title: `[Archive] ${file.name.replace(/\.zip$/i, '')}`,
        description: `Notion ZIP source archive — ${dedupedFiles.length} files extracted`,
        content: `Source archive for Notion import.\n\nFiles: ${dedupedFiles.length}\nPages: ${dedupedFiles.filter(f => f.type === 'page').length}\nDatabases: ${dedupedFiles.filter(f => f.type === 'database').length}\nSkipped: ${skipped}`,
        content_length: 0,
        content_status: 'full',
        resource_type: 'document',
        manual_content_present: true,
        resolution_method: 'notion_zip_source_archive',
        extraction_method: 'notion_zip_source_archive',
        enrichment_status: 'deep_enriched',
        folder_id: folderId,
        file_url: storedZipPath,
        tags: ['notion-archive', `notion-group:${importGroupId}`],
      } as any)
      .select('id')
      .single();

    if (archiveErr || !archive) {
      errors.push(`Archive creation failed: ${archiveErr?.message}`);
    } else {
      sourceArchiveId = archive.id;
    }

    // Stage 6: Build inserts — chunk oversized pages
    const inserts: ResourceInsert[] = [];
    let chunksCreated = 0;

    for (const f of dedupedFiles) {
      const baseTags = [
        'notion-import',
        `notion-group:${importGroupId}`,
        ...(sourceArchiveId ? [`notion-source:${sourceArchiveId}`] : []),
      ];

      const provenance = JSON.stringify({
        import_group_id: importGroupId,
        source_zip_resource_id: sourceArchiveId,
        source_path_in_zip: f.path,
        original_filename: f.filename,
        import_type: f.type,
        folder_path: f.folderParts.join('/'),
      });

      if (f.type === 'page') {
        const chunks = chunkLargePage(f.title, f.content);
        for (let ci = 0; ci < chunks.length; ci++) {
          const isChunked = chunks.length > 1;
          if (isChunked && ci > 0) chunksCreated++;
          inserts.push({
            user_id: userId,
            title: chunks[ci].title,
            content: chunks[ci].content,
            content_length: chunks[ci].content.length,
            content_status: 'full',
            resource_type: 'document',
            manual_content_present: true,
            resolution_method: isChunked ? 'notion_zip_page_chunk' : 'notion_zip_page_import',
            extraction_method: isChunked ? 'notion_zip_page_chunk' : 'notion_zip_page_import',
            enrichment_status: 'not_enriched',
            folder_id: folderId,
            tags: [...baseTags, ...(isChunked ? [`chunk-index:${ci}`] : [])],
            description: `${provenance}`,
          });
        }
      } else {
        inserts.push({
          user_id: userId,
          title: f.title,
          content: f.content,
          content_length: f.content.length,
          content_status: 'full',
          resource_type: 'document',
          manual_content_present: true,
          resolution_method: 'notion_zip_database_import',
          extraction_method: 'notion_zip_database_import',
          enrichment_status: 'not_enriched',
          folder_id: folderId,
          tags: baseTags,
          description: `${provenance}`,
        });
      }
    }

    // Stage 7: Batch insert
    let pagesCreated = 0;
    let databasesCreated = 0;

    for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
      const batch = inserts.slice(i, i + BATCH_SIZE);
      onProgress?.({
        stage: 'creating',
        message: `Creating resources ${i + 1}–${Math.min(i + BATCH_SIZE, inserts.length)} of ${inserts.length}…`,
        created: i,
        total: inserts.length,
      });

      const { error: insertErr, data: inserted } = await supabase
        .from('resources')
        .insert(batch as any)
        .select('id, resolution_method');

      if (insertErr) {
        errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${insertErr.message}`);
        continue;
      }

      for (const row of inserted || []) {
        if ((row as any).resolution_method === 'notion_zip_database_import') databasesCreated++;
        else pagesCreated++;
      }
    }

    onProgress?.({
      stage: 'done',
      message: `Imported ${pagesCreated} pages, ${databasesCreated} databases`,
      pagesFound: pagesCreated,
      databasesFound: databasesCreated,
      skipped,
      created: pagesCreated + databasesCreated,
      total: inserts.length,
    });

    return {
      success: errors.length === 0,
      message: errors.length > 0
        ? `Partial import: ${pagesCreated + databasesCreated} created, ${errors.length} errors`
        : `Imported ${pagesCreated} pages, ${databasesCreated} databases, ${skipped} skipped`,
      importGroupId,
      sourceArchiveId,
      pagesCreated,
      databasesCreated,
      chunksCreated,
      skipped,
      folderId,
      errors,
    };
  } catch (e: any) {
    onProgress?.({ stage: 'error', message: e.message });
    return {
      success: false, message: `Import failed: ${e.message}`,
      importGroupId, sourceArchiveId, pagesCreated: 0,
      databasesCreated: 0, chunksCreated: 0, skipped: 0,
      folderId, errors: [e.message],
    };
  }
}

// ── Cleanup: delete children from an import group ────────────

export async function deleteImportGroupChildren(
  importGroupId: string,
  userId: string,
): Promise<{ deleted: number; errors: string[] }> {
  const tag = `notion-group:${importGroupId}`;
  const { data: children, error: fetchErr } = await (supabase as any)
    .from('resources')
    .select('id, resolution_method')
    .eq('user_id', userId)
    .contains('tags', [tag])
    .neq('resolution_method', 'notion_zip_source_archive');

  if (fetchErr) return { deleted: 0, errors: [fetchErr.message] };
  if (!children?.length) return { deleted: 0, errors: [] };

  const ids = children.map((c: any) => c.id);
  const errs: string[] = [];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('resources').delete().in('id', batch);
    if (error) errs.push(error.message);
  }

  return { deleted: ids.length - (errs.length * BATCH_SIZE), errors: errs };
}

// ── Detect import group from a resource ──────────────────────

export function getImportGroupId(resource: any): string | null {
  const tags: string[] = resource.tags || [];
  const groupTag = tags.find((t: string) => t.startsWith('notion-group:'));
  return groupTag ? groupTag.replace('notion-group:', '') : null;
}

export function isNotionSourceArchive(resource: any): boolean {
  return resource?.resolution_method === 'notion_zip_source_archive'
    || resource?.extraction_method === 'notion_zip_source_archive';
}

export function isNotionDirectImport(resource: any): boolean {
  const rm = resource?.resolution_method;
  return rm === 'notion_zip_page_import'
    || rm === 'notion_zip_database_import'
    || rm === 'notion_zip_page_chunk'
    || rm === 'notion_zip_source_archive';
}
