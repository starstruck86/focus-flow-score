import { describe, it, expect } from 'vitest';
import { detectResourceSubtype, classifyEnrichability } from '@/lib/salesBrain/resourceSubtype';
import { routeFailure } from '@/lib/failureRouting';
import { validateResourceQuality } from '@/lib/resourceQuality';

describe('Google Sheet subtype detection', () => {
  it('detects docs.google.com/spreadsheets as google_sheet', () => {
    expect(detectResourceSubtype('https://docs.google.com/spreadsheets/d/1gMWmYY94f0_SOtuRKg_zwNZ1qtW10GOo/edit')).toBe('google_sheet');
  });

  it('detects sheets.google.com as google_sheet', () => {
    expect(detectResourceSubtype('https://sheets.google.com/d/abc/edit')).toBe('google_sheet');
  });

  it('does NOT classify Google Sheet as google_doc', () => {
    const subtype = detectResourceSubtype('https://docs.google.com/spreadsheets/d/1abc/edit?usp=sharing');
    expect(subtype).not.toBe('google_doc');
    expect(subtype).toBe('google_sheet');
  });

  it('does NOT classify Google Sheet as google_drive_file', () => {
    const subtype = detectResourceSubtype('https://docs.google.com/spreadsheets/d/1abc/edit');
    expect(subtype).not.toBe('google_drive_file');
  });
});

describe('Google Sheet enrichability', () => {
  it('classifies as partially_enrichable', () => {
    const result = classifyEnrichability('https://docs.google.com/spreadsheets/d/1abc/edit');
    expect(result.enrichability).toBe('partially_enrichable');
    expect(result.canFetchText).toBe(true);
  });
});

describe('Google Sheet failure routing', () => {
  it('routes auth failure to auth_required', () => {
    const r = routeFailure(
      'https://docs.google.com/spreadsheets/d/1abc/edit',
      undefined,
      'failed_needs_auth',
      'Access denied',
    );
    expect(r.bucket).toBe('auth_required');
    expect(r.reason).toContain('Google Sheet');
  });

  it('routes quality failure to retryable, not quarantine', () => {
    const r = routeFailure(
      'https://docs.google.com/spreadsheets/d/1abc/edit',
      undefined,
      'failed_quality',
      'Content too weak',
    );
    expect(r.bucket).toBe('retryable_extraction_failure');
    expect(r.retryable).toBe(true);
  });

  it('private sheet goes to auth_required, not quarantine', () => {
    const r = routeFailure(
      'https://docs.google.com/spreadsheets/d/private123/edit',
      undefined,
      'failed_needs_auth',
      'Forbidden',
    );
    expect(r.bucket).toBe('auth_required');
  });
});

describe('Spreadsheet-aware quality scoring', () => {
  const tabularContent = `# Google Spreadsheet

**Source:** Google Sheets (ID: abc123)
**Rows:** 50

## Headers

| Name | Revenue | Region |
| --- | --- | --- |
| Acme Corp | 120000 | West |
| Beta Inc | 95000 | East |
| Gamma LLC | 180000 | Central |
| Delta Co | 60000 | South |`;

  it('does not penalize tabular content for low vocabulary', () => {
    const result = validateResourceQuality({
      id: 'test-1',
      title: 'Sales Data',
      content: tabularContent,
      content_length: tabularContent.length,
      enrichment_status: 'deep_enriched',
      enrichment_version: 2,
      validation_version: 1,
      enriched_at: new Date().toISOString(),
      failure_reason: null,
      file_url: 'https://docs.google.com/spreadsheets/d/abc123/edit',
      description: 'Sales data spreadsheet',
    });
    // Should not have "low vocabulary" violation
    expect(result.violations.some(v => v.includes('Low vocabulary'))).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('non-spreadsheet with same content gets prose scoring', () => {
    const result = validateResourceQuality({
      id: 'test-2',
      title: 'Sales Data',
      content: tabularContent,
      content_length: tabularContent.length,
      enrichment_status: 'deep_enriched',
      enrichment_version: 2,
      validation_version: 1,
      enriched_at: new Date().toISOString(),
      failure_reason: null,
      file_url: 'https://example.com/page',
      description: 'Some page',
    });
    // Non-spreadsheet uses standard prose scoring
    expect(result.dimensions.semanticUsefulness).toBeLessThanOrEqual(25);
  });
});
