/**
 * Client-side PDF text extraction using pdf.js.
 * Falls back to AI vision OCR for scanned/image-only PDFs.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { supabase } from '@/integrations/supabase/client';

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const MIN_USEFUL_TEXT = 50;
const MAX_PAGES_FOR_OCR = 30;
const OCR_SCALE = 1.5; // render at 1.5x for readable OCR without huge images

/**
 * Extract all text from a PDF file.
 * Tries native text extraction first; falls back to AI vision OCR if too little text.
 */
export async function extractTextFromPdf(
  file: File,
  onProgress?: (msg: string) => void
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  // Phase 1: try native text extraction
  onProgress?.('Extracting text from PDF...');
  const nativeText = await extractNativeText(pdf);

  if (nativeText.length >= MIN_USEFUL_TEXT) {
    return nativeText;
  }

  // Phase 2: OCR fallback — render pages to images and send to AI vision
  onProgress?.(`No selectable text found. Running AI vision OCR on ${Math.min(pdf.numPages, MAX_PAGES_FOR_OCR)} pages...`);
  return await extractViaOcr(pdf, onProgress);
}

async function extractNativeText(pdf: pdfjsLib.PDFDocumentProxy): Promise<string> {
  const pageTexts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    if (pageText.trim()) {
      pageTexts.push(pageText.trim());
    }
  }

  return pageTexts.join('\n\n');
}

/**
 * Render PDF pages to images and send to AI vision for OCR.
 * Batches pages to stay within payload limits.
 */
async function extractViaOcr(
  pdf: pdfjsLib.PDFDocumentProxy,
  onProgress?: (msg: string) => void
): Promise<string> {
  const totalPages = Math.min(pdf.numPages, MAX_PAGES_FOR_OCR);
  const BATCH_SIZE = 5; // pages per AI call
  const allTexts: string[] = [];

  for (let batchStart = 1; batchStart <= totalPages; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalPages);
    onProgress?.(`OCR processing pages ${batchStart}–${batchEnd} of ${totalPages}...`);

    const imageDataUrls: string[] = [];

    for (let i = batchStart; i <= batchEnd; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: OCR_SCALE });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Convert to JPEG for smaller payload
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      imageDataUrls.push(dataUrl);

      // Clean up
      canvas.width = 0;
      canvas.height = 0;
    }

    // Send batch to edge function
    const { data, error } = await supabase.functions.invoke('pdf-ocr', {
      body: {
        images: imageDataUrls,
        page_start: batchStart,
        page_end: batchEnd,
      },
    });

    if (error) {
      console.error(`OCR batch ${batchStart}-${batchEnd} failed:`, error);
      allTexts.push(`[OCR failed for pages ${batchStart}-${batchEnd}]`);
      continue;
    }

    if (data?.text) {
      allTexts.push(data.text);
    }
  }

  const result = allTexts.join('\n\n').trim();
  if (!result || result.length < MIN_USEFUL_TEXT) {
    throw new Error('AI vision OCR could not extract meaningful text from this PDF. The pages may be blank or contain only graphics.');
  }

  return result;
}
