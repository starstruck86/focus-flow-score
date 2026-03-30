/**
 * Context item types for structured context tracking in Prep.
 */

export interface ContextItem {
  id: string;
  label: string;
  type: 'text' | 'file' | 'image';
  content: string; // actual text or placeholder description
  fileName?: string;
  mimeType?: string;
  previewUrl?: string; // for images, object URL
}

export function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}
