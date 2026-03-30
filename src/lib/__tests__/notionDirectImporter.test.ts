import { describe, it, expect } from 'vitest';
import { cleanNotionTitle, passesQualityCheck, chunkLargePage } from '../notionDirectImporter';

describe('cleanNotionTitle', () => {
  it('strips extension and Notion hash', () => {
    expect(cleanNotionTitle('How to Negotiate abc123def456789012345.md'))
      .toBe('How to Negotiate');
  });

  it('prefers H1 heading from content', () => {
    const content = '# Better Title\n\nSome paragraph text here.';
    expect(cleanNotionTitle('Ugly Name abc12345678901234567890.md', content))
      .toBe('Better Title');
  });

  it('falls back to cleaned filename if no H1', () => {
    expect(cleanNotionTitle('Sales Playbook.md', 'Just plain text no heading'))
      .toBe('Sales Playbook');
  });

  it('handles filename with short hash variant', () => {
    expect(cleanNotionTitle('Discovery Framework ab12cd34ef.md'))
      .toBe('Discovery Framework');
  });
});

describe('passesQualityCheck', () => {
  it('rejects empty content', () => {
    expect(passesQualityCheck('')).toBe(false);
  });

  it('rejects very short content', () => {
    expect(passesQualityCheck('Just a tiny note')).toBe(false);
  });

  it('accepts substantial text', () => {
    const text = 'This is a real page about negotiation strategies for enterprise sales. '.repeat(10);
    expect(passesQualityCheck(text)).toBe(true);
  });

  it('rejects mostly-separator content', () => {
    const text = '---\n---\n---\n---\n---\n---\n---\n---\n---\n---\n---\n---\n';
    expect(passesQualityCheck(text)).toBe(false);
  });

  it('rejects mostly-heading pages', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `## Heading ${i}`).join('\n');
    expect(passesQualityCheck(lines)).toBe(false);
  });
});

describe('chunkLargePage', () => {
  it('returns single chunk for small content', () => {
    const result = chunkLargePage('Test', 'Short content here');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Test');
  });

  it('chunks oversized content into multiple parts', () => {
    const bigContent = 'A'.repeat(80_000);
    const result = chunkLargePage('Big Page', bigContent);
    expect(result.length).toBeGreaterThan(1);
    expect(result[0].title).toContain('Part 1');
    expect(result[1].title).toContain('Part 2');
  });

  it('preserves title without Part suffix for single chunk', () => {
    const content = 'Normal content that fits easily';
    const result = chunkLargePage('My Page', content);
    expect(result[0].title).toBe('My Page');
  });
});

describe('content-wins for Notion imports', () => {
  it('notion_zip_page_import with content should not be MANUAL_REQUIRED', async () => {
    // Import processingState dynamically to test
    const { deriveProcessingState } = await import('../processingState');

    const resource = {
      id: 'test-1',
      title: 'Test Page',
      file_url: null,
      resource_type: 'document',
      enrichment_status: 'not_enriched',
      content_length: 500,
      manual_content_present: true,
      resolution_method: 'notion_zip_page_import',
      tags: [],
      failure_reason: null,
    } as any;

    const result = deriveProcessingState(resource);
    expect(result.state).not.toBe('MANUAL_REQUIRED');
    expect(result.state).toBe('COMPLETED');
  });

  it('notion_zip_database_import with content should be COMPLETED', async () => {
    const { deriveProcessingState } = await import('../processingState');

    const resource = {
      id: 'test-2',
      title: 'Database Export',
      file_url: null,
      resource_type: 'document',
      enrichment_status: 'not_enriched',
      content_length: 2000,
      manual_content_present: true,
      resolution_method: 'notion_zip_database_import',
      tags: [],
      failure_reason: null,
    } as any;

    const result = deriveProcessingState(resource);
    expect(result.state).toBe('COMPLETED');
  });
});

describe('import group linkage', () => {
  it('getImportGroupId extracts group from tags', async () => {
    const { getImportGroupId } = await import('../notionDirectImporter');
    const resource = { tags: ['notion-import', 'notion-group:abc-123', 'other'] };
    expect(getImportGroupId(resource)).toBe('abc-123');
  });

  it('returns null when no group tag', async () => {
    const { getImportGroupId } = await import('../notionDirectImporter');
    expect(getImportGroupId({ tags: ['random'] })).toBeNull();
    expect(getImportGroupId({ tags: [] })).toBeNull();
    expect(getImportGroupId({})).toBeNull();
  });
});

describe('isNotionSourceArchive', () => {
  it('detects archive resources', async () => {
    const { isNotionSourceArchive } = await import('../notionDirectImporter');
    expect(isNotionSourceArchive({ resolution_method: 'notion_zip_source_archive' })).toBe(true);
    expect(isNotionSourceArchive({ resolution_method: 'notion_zip_page_import' })).toBe(false);
  });
});
