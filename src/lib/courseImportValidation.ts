/**
 * Light import-time content validation for course lessons.
 * Catches auth walls, empty content, and UI junk before saving.
 * This is NOT the full downstream firewall — just a quick pre-save guard.
 */

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  code?: 'auth_wall' | 'empty_content' | 'too_short' | 'ui_junk' | 'html_fragments';
}

const AUTH_WALL_PATTERNS = [
  /member\[password\]/i,
  /new_member_session/i,
  /sign[\s_-]?in to (?:continue|access|view)/i,
  /you must (?:log|sign) in/i,
  /please (?:log|sign) in/i,
  /authentication required/i,
  /access denied/i,
  /login to (?:continue|view|access)/i,
];

const UI_JUNK_PATTERNS = [
  /^(?:\s*(?:Store|My Library|Search|Settings|Logout|Back|Next|Previous|Cancel)\s*\n?){3,}/im,
  /^(?:\s*Module \d+ of \d+\s*\n?\s*\d+ Modules\s*)/im,
];

const HTML_FRAGMENT_PATTERNS = [
  /<div[\s>]/i,
  /<span[\s>]/i,
  /font-family\s*:/i,
  /class="/i,
];

const MIN_USEFUL_LENGTH = 100;

export function validateLessonContent(content: string | undefined | null): ValidationResult {
  if (!content || content.trim().length === 0) {
    return { valid: false, reason: 'Content is empty', code: 'empty_content' };
  }

  const trimmed = content.trim();

  if (trimmed.length < MIN_USEFUL_LENGTH) {
    return { valid: false, reason: `Content too short (${trimmed.length} chars, minimum ${MIN_USEFUL_LENGTH})`, code: 'too_short' };
  }

  // Check for auth wall content
  for (const pattern of AUTH_WALL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: `Content appears to be a login/auth wall page`, code: 'auth_wall' };
    }
  }

  // Check for excessive HTML fragments (indicates failed extraction)
  const htmlMatchCount = HTML_FRAGMENT_PATTERNS.filter(p => p.test(trimmed)).length;
  if (htmlMatchCount >= 3) {
    return { valid: false, reason: 'Content contains raw HTML fragments — extraction likely failed', code: 'html_fragments' };
  }

  // Check for UI junk (too many nav/UI words relative to content)
  const uiWords = (trimmed.match(/\b(?:Store|My Library|Search|Settings|Logout|Log Out|Sign Out|Back|Next|Previous|Cancel|Mark As Complete|Next Lesson|Play Now)\b/gi) || []).length;
  const totalWords = trimmed.split(/\s+/).length;
  if (totalWords > 0 && uiWords / totalWords > 0.3) {
    return { valid: false, reason: 'Content is mostly UI/navigation text', code: 'ui_junk' };
  }

  for (const pattern of UI_JUNK_PATTERNS) {
    if (pattern.test(trimmed) && totalWords < 30) {
      return { valid: false, reason: 'Content is mostly UI/navigation text', code: 'ui_junk' };
    }
  }

  return { valid: true };
}
