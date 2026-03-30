/**
 * Tests for notionZipSplitter parsing logic.
 */
import { describe, it, expect } from 'vitest';
import { isNotionZipResource } from '../notionZipSplitter';

describe('isNotionZipResource', () => {
  it('detects by resolution_method', () => {
    expect(isNotionZipResource({ resolution_method: 'notion_zip_import' })).toBe(true);
  });

  it('detects by extraction_method', () => {
    expect(isNotionZipResource({ extraction_method: 'notion_zip_import' })).toBe(true);
  });

  it('detects by content separator pattern', () => {
    const content = '--- Page1.md ---\n\nHello\n\n--- Page2.md ---\n\nWorld';
    expect(isNotionZipResource({ content })).toBe(true);
  });

  it('returns false for normal resource', () => {
    expect(isNotionZipResource({ resolution_method: 'manual_paste', content: 'Just some text' })).toBe(false);
  });

  it('returns false for single separator', () => {
    const content = '--- Page1.md ---\n\nHello world content here';
    expect(isNotionZipResource({ content })).toBe(false);
  });
});
