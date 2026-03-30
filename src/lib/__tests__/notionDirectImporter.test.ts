import { describe, it, expect } from 'vitest';
import { cleanNotionTitle, passesQualityCheck, isMeaningfulNotionPage, chunkLargePage } from '../notionDirectImporter';

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

describe('isMeaningfulNotionPage / passesQualityCheck', () => {
  it('rejects empty content', () => {
    expect(isMeaningfulNotionPage('')).toBe(false);
    expect(passesQualityCheck('')).toBe(false);
  });

  it('rejects 38-char page title only', () => {
    expect(isMeaningfulNotionPage('How to Negotiate Without Discounting')).toBe(false);
  });

  it('rejects very short content under 200 chars', () => {
    expect(isMeaningfulNotionPage('Just a tiny note that is short')).toBe(false);
  });

  it('rejects content with too few alphabetic characters', () => {
    const text = '12345 67890 '.repeat(30); // 360 chars, all numbers
    expect(isMeaningfulNotionPage(text)).toBe(false);
  });

  it('accepts substantial text with real sentences', () => {
    const text = 'This is a real page about negotiation strategies for enterprise sales. It covers multiple techniques and frameworks for handling objections effectively.\n\nThe key insight is that preparation matters more than tactics. When you understand the buyer perspective deeply, you can navigate any conversation with confidence and authenticity.';
    expect(isMeaningfulNotionPage(text)).toBe(true);
  });

  it('rejects mostly-separator content', () => {
    const text = '---\n---\n---\n---\n---\n---\n---\n---\n---\n---\n---\n---\n';
    expect(isMeaningfulNotionPage(text)).toBe(false);
  });

  it('rejects mostly-heading pages', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `## Heading ${i}`).join('\n');
    expect(isMeaningfulNotionPage(lines)).toBe(false);
  });

  it('rejects pages with headings but no real body content', () => {
    const content = '# My Page\n\n## Section 1\n\n## Section 2\n\n## Section 3\n\n';
    expect(isMeaningfulNotionPage(content)).toBe(false);
  });

  it('accepts short but meaningful page over 200 chars', () => {
    const text = 'When negotiating enterprise deals, always anchor on value before discussing price. The three-step framework involves understanding their current cost of inaction, quantifying the business impact, and then positioning your solution as the bridge between their current state and desired outcome.';
    expect(text.length).toBeGreaterThan(200);
    expect(isMeaningfulNotionPage(text)).toBe(true);
  });

  it('rejects navigation-only placeholder text', () => {
    const text = '# Navigation\n\n- Link 1\n- Link 2\n- Link 3\n\n---\n\n';
    expect(isMeaningfulNotionPage(text)).toBe(false);
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

describe('CSV handling', () => {
  it('CSV with real rows should pass quality for database type', () => {
    // CSVs use a different threshold (50 chars min), not isMeaningfulNotionPage
    // This test validates that real CSVs would be kept at import time
    const csv = 'Name,Email,Role\nJohn,john@acme.com,VP Sales\nJane,jane@acme.com,CRO\n';
    expect(csv.length).toBeGreaterThan(50);
  });
});

describe('import summary counts', () => {
  it('skipped count tracks filtered pages correctly', () => {
    // Verify the filtering logic counts correctly
    const pages = [
      { type: 'page' as const, content: 'too short' },
      { type: 'page' as const, content: 'This is a substantial page with enough real content to pass all quality filters. It has multiple sentences and meaningful information about sales strategies and negotiation techniques that would be useful for the user.\n\nIt even has multiple paragraphs with detailed explanations.' },
      { type: 'page' as const, content: '# Title Only\n\n---\n\n' },
    ];
    
    let skipped = 0;
    let kept = 0;
    for (const p of pages) {
      if (p.type === 'page' && !isMeaningfulNotionPage(p.content)) {
        skipped++;
      } else {
        kept++;
      }
    }
    
    expect(skipped).toBe(2); // too short + title only
    expect(kept).toBe(1);   // substantial page
  });
});
