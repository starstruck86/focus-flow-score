/**
 * Context item types for structured context tracking in Prep.
 */

export type ParseStatus = 'parsed' | 'reference_only' | 'image_preview' | 'pending' | 'unsupported';

export interface ContextItem {
  id: string;
  label: string;
  type: 'text' | 'file' | 'image';
  content: string;
  fileName?: string;
  mimeType?: string;
  previewUrl?: string;
  parseStatus: ParseStatus;
}

export function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function parseStatusLabel(s: ParseStatus): string {
  switch (s) {
    case 'parsed': return 'Parsed successfully';
    case 'reference_only': return 'Attached as reference only';
    case 'image_preview': return 'Image preview only';
    case 'pending': return 'Extraction pending';
    case 'unsupported': return 'Unsupported format';
  }
}

export function parseStatusColor(s: ParseStatus): string {
  switch (s) {
    case 'parsed': return 'text-emerald-600 dark:text-emerald-400';
    case 'reference_only': return 'text-amber-600 dark:text-amber-400';
    case 'image_preview': return 'text-blue-600 dark:text-blue-400';
    case 'pending': return 'text-muted-foreground';
    case 'unsupported': return 'text-destructive';
  }
}
