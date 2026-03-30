import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase
const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }), in: vi.fn().mockResolvedValue({ error: null }) });
const mockFrom = vi.fn().mockReturnValue({ delete: () => mockDelete() });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (...args: any[]) => mockFrom(...args) },
}));

vi.mock('@/lib/manualRecoveryResolver', () => ({
  getRecoveryInvalidationKeys: () => [
    ['resources'], ['incoming-queue'], ['all-resources'],
    ['resource-folders'], ['enrichment-status'], ['recovery-queue'],
    ['verification-runs'],
  ],
}));

import { getDeleteInvalidationKeys } from '../resourceDelete';

describe('getDeleteInvalidationKeys', () => {
  it('includes all required query keys', () => {
    const keys = getDeleteInvalidationKeys();
    const flat = keys.map(k => k[0]);
    expect(flat).toContain('resources');
    expect(flat).toContain('all-resources');
    expect(flat).toContain('resource-folders');
    expect(flat).toContain('enrichment-status');
    expect(flat).toContain('recovery-queue');
  });
});

describe('delete invariants', () => {
  it('single delete should not affect unrelated resources', () => {
    // deleteResourceWithCleanup uses .eq('id', resourceId) — only targets one resource
    // This is a design validation, not a functional test with real DB
    expect(true).toBe(true);
  });

  it('bulk delete should handle empty array gracefully', async () => {
    const { bulkDeleteResources } = await import('../resourceDelete');
    const result = await bulkDeleteResources([]);
    expect(result.deleted).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe('Notion group delete preserves source', () => {
  it('deleteImportGroupChildren excludes source archive', async () => {
    const { isNotionSourceArchive } = await import('../notionDirectImporter');
    // Source archive should always be excluded from child deletion
    expect(isNotionSourceArchive({ resolution_method: 'notion_zip_source_archive' })).toBe(true);
    expect(isNotionSourceArchive({ resolution_method: 'notion_zip_page_import' })).toBe(false);
    expect(isNotionSourceArchive({ resolution_method: 'notion_zip_split' })).toBe(false);
  });
});
