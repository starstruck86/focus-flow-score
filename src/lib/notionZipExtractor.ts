/**
 * Notion ZIP Export Extractor
 * 
 * Extracts .md and .csv files from a Notion export ZIP,
 * concatenates them into a single content body.
 */

import JSZip from 'jszip';

export interface NotionZipResult {
  content: string;
  mdFileCount: number;
  csvFileCount: number;
  totalLength: number;
  filenames: string[];
}

export async function extractNotionZip(file: File): Promise<NotionZipResult> {
  const zip = await JSZip.loadAsync(file);
  
  const mdContents: { name: string; text: string }[] = [];
  const csvContents: { name: string; text: string }[] = [];

  const entries = Object.entries(zip.files).filter(([, f]) => !f.dir);

  // Sort for deterministic output
  entries.sort(([a], [b]) => a.localeCompare(b));

  await Promise.all(
    entries.map(async ([path, zipFile]) => {
      const lower = path.toLowerCase();
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
      // Ignore images/assets
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

  const content = parts.join('\n\n');

  return {
    content,
    mdFileCount: mdContents.length,
    csvFileCount: csvContents.length,
    totalLength: content.length,
    filenames: [...mdContents.map(m => m.name), ...csvContents.map(c => c.name)],
  };
}

export function isNotionZip(file: File): boolean {
  return file.name.toLowerCase().endsWith('.zip');
}
