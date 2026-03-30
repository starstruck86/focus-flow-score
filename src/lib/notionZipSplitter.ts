/**
 * Notion ZIP Splitter
 * 
 * Takes a combined Notion ZIP import resource and splits it into
 * individual resources, one per original page/table.
 */

import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';

const MAX_SECTION_LENGTH = 50_000;
const SEPARATOR_REGEX = /^---\s+(.+?)\s+---$/gm;

interface SplitResult {
  success: boolean;
  message: string;
  resourcesCreated: number;
  pagesDetected: number;
  folderId?: string;
}

interface ParsedSection {
  filename: string;
  content: string;
}

function parseSections(content: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const separators: { index: number; length: number; filename: string }[] = [];

  let match: RegExpExecArray | null;
  const regex = new RegExp(SEPARATOR_REGEX.source, 'gm');
  while ((match = regex.exec(content)) !== null) {
    separators.push({ index: match.index, length: match[0].length, filename: match[1].trim() });
  }

  if (separators.length === 0) {
    // Fallback: split by markdown H1/H2 headings
    const headingRegex = /^(#{1,2})\s+(.+)$/gm;
    const headings: { index: number; length: number; title: string }[] = [];
    while ((match = headingRegex.exec(content)) !== null) {
      headings.push({ index: match.index, length: match[0].length, title: match[2].trim() });
    }
    if (headings.length <= 1) {
      // Can't meaningfully split
      return [];
    }
    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].index;
      const end = i + 1 < headings.length ? headings[i + 1].index : content.length;
      const text = content.slice(start, end).trim();
      if (text.length > 0) {
        sections.push({ filename: headings[i].title, content: text });
      }
    }
    return sections;
  }

  // Split by separator markers
  for (let i = 0; i < separators.length; i++) {
    const start = separators[i].index + separators[i].length;
    const end = i + 1 < separators.length ? separators[i + 1].index : content.length;
    const text = content.slice(start, end).trim();
    if (text.length > 0) {
      sections.push({ filename: separators[i].filename, content: text });
    }
  }

  return sections;
}

/** Further split a section that exceeds MAX_SECTION_LENGTH */
function splitLargeSection(section: ParsedSection): ParsedSection[] {
  if (section.content.length <= MAX_SECTION_LENGTH) return [section];

  const chunks: ParsedSection[] = [];
  const paragraphs = section.content.split(/\n{2,}/);
  let current = '';
  let chunkIdx = 1;

  for (const para of paragraphs) {
    if (current.length + para.length > MAX_SECTION_LENGTH && current.length > 0) {
      chunks.push({ filename: `${section.filename} (Part ${chunkIdx})`, content: current.trim() });
      chunkIdx++;
      current = '';
    }
    current += para + '\n\n';
  }
  if (current.trim().length > 0) {
    chunks.push({
      filename: chunkIdx > 1 ? `${section.filename} (Part ${chunkIdx})` : section.filename,
      content: current.trim(),
    });
  }

  return chunks;
}

/** Clean up the filename from Notion's hash suffixes, e.g. "Page Name abc123def.md" → "Page Name" */
function cleanFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, '') // remove extension
    .replace(/\s+[a-f0-9]{20,}$/i, '') // remove Notion hash suffix
    .trim() || name;
}

export function isNotionZipResource(resource: { resolution_method?: string; extraction_method?: string; content?: string }): boolean {
  if (resource.resolution_method === 'notion_zip_import' || resource.extraction_method === 'notion_zip_import') {
    return true;
  }
  if (resource.resolution_method === 'notion_zip_source' || resource.extraction_method === 'notion_zip_source') {
    return true;
  }
  // Check for separator pattern in content
  if (resource.content) {
    const matches = resource.content.match(SEPARATOR_REGEX);
    return (matches?.length ?? 0) >= 2;
  }
  return false;
}

export async function splitNotionImport(
  resourceId: string,
  userId: string,
  onProgress?: (msg: string) => void,
): Promise<SplitResult> {
  onProgress?.('Loading resource…');

  // 1. Fetch the source resource
  const { data: source, error: fetchErr } = await supabase
    .from('resources')
    .select('id, title, content, folder_id, resolution_method, extraction_method, content_length')
    .eq('id', resourceId)
    .single();

  if (fetchErr || !source) {
    return { success: false, message: `Could not load resource: ${fetchErr?.message}`, resourcesCreated: 0, pagesDetected: 0 };
  }

  if (!source.content || source.content.length < 50) {
    return { success: false, message: 'Resource has no content to split', resourcesCreated: 0, pagesDetected: 0 };
  }

  // 2. Parse sections
  onProgress?.('Parsing sections…');
  let sections = parseSections(source.content);
  if (sections.length < 2) {
    return { success: false, message: 'Could not detect multiple pages in this resource. Need at least 2 sections.', resourcesCreated: 0, pagesDetected: sections.length };
  }

  // 3. Split oversized sections
  sections = sections.flatMap(splitLargeSection);
  const pagesDetected = sections.length;
  onProgress?.(`Found ${pagesDetected} pages`);

  // 4. Create/reuse folder
  const folderName = `Notion Import – ${cleanFilename(source.title)}`;
  onProgress?.('Creating folder…');

  let folderId: string;
  const { data: existingFolder } = await supabase
    .from('resource_folders')
    .select('id')
    .eq('user_id', userId)
    .eq('name', folderName)
    .maybeSingle();

  if (existingFolder) {
    folderId = existingFolder.id;
  } else {
    const { data: newFolder, error: folderErr } = await supabase
      .from('resource_folders')
      .insert({ user_id: userId, name: folderName, icon: 'archive' })
      .select('id')
      .single();
    if (folderErr || !newFolder) {
      return { success: false, message: `Failed to create folder: ${folderErr?.message}`, resourcesCreated: 0, pagesDetected };
    }
    folderId = newFolder.id;
  }

  // 5. Create individual resources
  const groupId = crypto.randomUUID();
  const inserts = sections.map((sec, idx) => ({
    user_id: userId,
    title: cleanFilename(sec.filename),
    content: sec.content,
    content_length: sec.content.length,
    content_status: 'full',
    resource_type: 'document',
    manual_content_present: true,
    resolution_method: 'notion_zip_split',
    extraction_method: 'notion_zip_split',
    enrichment_status: 'not_enriched',
    folder_id: folderId,
    tags: ['notion-import', `notion-group:${groupId}`],
    description: `Split from Notion import "${source.title}" (page ${idx + 1}/${sections.length})`,
  }));

  onProgress?.(`Creating ${inserts.length} resources…`);

  // Batch in groups of 20 to avoid payload limits
  let created = 0;
  for (let i = 0; i < inserts.length; i += 20) {
    const batch = inserts.slice(i, i + 20);
    const { error: insertErr, data: inserted } = await supabase
      .from('resources')
      .insert(batch as any)
      .select('id');
    if (insertErr) {
      console.error('[NotionSplit] Batch insert failed:', insertErr);
      return { success: false, message: `Insert failed at batch ${Math.floor(i / 20) + 1}: ${insertErr.message}`, resourcesCreated: created, pagesDetected };
    }
    created += inserted?.length ?? 0;
    onProgress?.(`Created ${created}/${inserts.length} resources…`);
  }

  // 6. Mark original as source (don't delete)
  onProgress?.('Archiving original…');
  await supabase.from('resources').update({
    resolution_method: 'notion_zip_source',
    extraction_method: 'notion_zip_source',
    tags: [...([] as string[]), 'notion-source', `notion-group:${groupId}`],
    description: `[Source] Split into ${created} individual resources`,
    last_status_change_at: new Date().toISOString(),
  } as any).eq('id', resourceId);

  onProgress?.('Done!');
  return {
    success: true,
    message: `Split into ${created} resources across ${pagesDetected} pages`,
    resourcesCreated: created,
    pagesDetected,
    folderId,
  };
}
