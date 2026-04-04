/**
 * attachmentDetection.ts — Detects references to external attachments in resource content.
 *
 * HARD RULE: A resource that says "see PDF" or "download the worksheet" must NOT be
 * classified as reference_only or needs_auth until linked attachments have been checked.
 *
 * This module provides:
 * 1. Detection of attachment references in content text
 * 2. Classification of whether a resource is genuinely low-density vs. a wrapper for an attachment
 */

/** Patterns that indicate the content references an external attachment */
const ATTACHMENT_REFERENCE_PATTERNS = [
  /\bsee\s+(the\s+)?pdf\b/i,
  /\bpdf\s+attached\b/i,
  /\bdownload\s+(the\s+)?(worksheet|workbook|template|checklist|guide|pdf|slides?|deck)\b/i,
  /\bsee\s+(the\s+)?(slide|attachment|document|handout|worksheet|workbook)\b/i,
  /\brefer\s+to\s+(the\s+)?(document|pdf|slide|attachment|worksheet)\b/i,
  /\b(attached|enclosed)\s+(pdf|document|file|worksheet|slide)\b/i,
  /\bclick\s+(here\s+)?to\s+download\b/i,
  /\bdownload\s+(below|above|here)\b/i,
  /\bsee\s+attached\b/i,
];

/** Content patterns that indicate this is just a wrapper/reference page, not real content */
const REFERENCE_ONLY_PATTERNS = [
  /^(this\s+)?(lesson|page|section)\s+(is\s+)?(a\s+)?reference/i,
  /^no\s+(additional\s+)?content/i,
  /^placeholder/i,
];

export interface AttachmentDetectionResult {
  hasAttachmentReferences: boolean;
  referencePatterns: string[];
  isLikelyWrapper: boolean;
  /** True if this is genuinely low-density content with no attachment references */
  isGenuineReferenceOnly: boolean;
}

/**
 * Detect attachment references in content text.
 * Returns structured result for use in classification decisions.
 */
export function detectAttachmentReferences(content: string | null | undefined): AttachmentDetectionResult {
  const text = content || '';
  const referencePatterns: string[] = [];

  for (const pattern of ATTACHMENT_REFERENCE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      referencePatterns.push(match[0]);
    }
  }

  const hasAttachmentReferences = referencePatterns.length > 0;
  
  // A "wrapper" page is short content that mainly exists to point to an attachment
  const isLikelyWrapper = hasAttachmentReferences && text.length < 1000;

  // Reference-only is ONLY true when:
  // 1. Content is short/low-density
  // 2. There are NO attachment references (the attachment itself might have the real content)
  // 3. Content doesn't match explicit reference patterns either
  const isExplicitReference = REFERENCE_ONLY_PATTERNS.some(p => p.test(text.trim()));
  const isGenuineReferenceOnly = !hasAttachmentReferences && (text.length < 300 || isExplicitReference);

  return {
    hasAttachmentReferences,
    referencePatterns,
    isLikelyWrapper,
    isGenuineReferenceOnly,
  };
}

/**
 * Determines whether a resource should be classified as reference_only.
 * 
 * HARD RULES:
 * - Never classify as reference_only if attachment references exist
 * - Never classify as reference_only if content > 500 chars (enough for extraction)
 * - Only classify as reference_only for genuinely low-density, self-contained content
 */
export function shouldClassifyAsReferenceOnly(
  content: string | null | undefined,
  contentLength: number,
  kiCount: number,
  extractionAttempted: boolean,
): boolean {
  // If extraction hasn't been attempted yet, don't pre-classify as reference
  if (!extractionAttempted) return false;
  
  // If extraction produced KIs, it's not reference-only
  if (kiCount > 0) return false;
  
  // If content is substantial, don't classify as reference — extraction should handle it
  if (contentLength >= 500) return false;

  const detection = detectAttachmentReferences(content);
  
  // If there are attachment references, this is a wrapper, not reference-only
  if (detection.hasAttachmentReferences) return false;

  // Genuinely short, no attachments, extraction already tried = reference_only
  return detection.isGenuineReferenceOnly;
}
