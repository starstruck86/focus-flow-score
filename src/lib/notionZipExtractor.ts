/**
 * Notion ZIP Export Extractor
 * 
 * Extracts .md and .csv files from a Notion export ZIP,
 * concatenates them into a single content body.
 */

import JSZip from 'jszip';

const MAX_ZIP_SIZE_MOBILE = 25 * 1024 * 1024; // 25MB
const MAX_CONTENT_LENGTH = 1_000_000; // 1MB of text

export interface NotionZipResult {
  content: string;
  mdFileCount: number;
  csvFileCount: number;
  totalLength: number;
  filenames: string[];
  truncated: boolean;
}

function isMobileDevice(): boolean {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export async function extractNotionZip(file: File): Promise<NotionZipResult> {
  console.log('[NotionZIP] Starting extraction:', file.name, 'size:', file.size);

  // Size guard
  if (isMobileDevice() && file.size > MAX_ZIP_SIZE_MOBILE) {
    throw new Error(`ZIP too large for mobile (${(file.size / 1024 / 1024).toFixed(1)}MB, max 25MB)`);
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e: any) {
    console.error('[NotionZIP] Failed to parse ZIP:', e);
    throw new Error(`ZIP too large or failed to parse: ${e.message || 'unknown error'}`);
  }

  const mdContents: { name: string; text: string }[] = [];
  const csvContents: { name: string; text: string }[] = [];

  const entries = Object.entries(zip.files).filter(([, f]) => !f.dir);
  console.log('[NotionZIP] Total entries:', entries.length);

  // Sort for deterministic output
  entries.sort(([a], [b]) => a.localeCompare(b));

  await Promise.all(
    entries.map(async ([path, zipFile]) => {
      const lower = path.toLowerCase();
      try {
        if (lower.endsWith('.md')) {
          const text = await zipFile.async('string');
          if (text.trim().length > 0) {
            mdContents.push({ name: path, text: text.trim() });
          }
        } else if (lower.endsWith('.csv')) {
          const text = await zipFile.async('string');
          if (text.trim().length > 0) {
            csvContents.push({ name: path, text: text.trim() });
          }
        }
      } catch (e: any) {
        console.warn(`[NotionZIP] Failed to extract ${path}:`, e.message);
      }
    }),
  );

  // Re-sort after parallel extraction
  mdContents.sort((a, b) => a.name.localeCompare(b.name));
  csvContents.sort((a, b) => a.name.localeCompare(b.name));

  const parts: string[] = [];

  // Markdown files first
  for (const md of mdContents) {
    const shortName = md.name.split('/').pop() || md.name;
    parts.push(`--- ${shortName} ---\n\n${md.text}`);
  }

  // CSV files as structured data
  if (csvContents.length > 0) {
    parts.push('\n\n========== DATABASE TABLES ==========\n');
    for (const csv of csvContents) {
      const shortName = csv.name.split('/').pop() || csv.name;
      parts.push(`--- ${shortName} ---\n\n${csv.text}`);
    }
  }

  let content = parts.join('\n\n');
  let truncated = false;

  // Truncate safely if content exceeds limit
  if (content.length > MAX_CONTENT_LENGTH) {
    console.warn(`[NotionZIP] Content too large (${content.length} chars), truncating to ${MAX_CONTENT_LENGTH}`);
    content = content.slice(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated — exceeded 1MB limit]';
    truncated = true;
  }

  console.log(`[NotionZIP] Extracted: ${mdContents.length} md, ${csvContents.length} csv, ${content.length} chars, truncated=${truncated}`);

  return {
    content,
    mdFileCount: mdContents.length,
    csvFileCount: csvContents.length,
    totalLength: content.length,
    filenames: [...mdContents.map(m => m.name), ...csvContents.map(c => c.name)],
    truncated,
  };
}

export function isNotionZip(file: File): boolean {
  return file.name.toLowerCase().endsWith('.zip');
}
