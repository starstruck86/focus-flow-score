/**
 * Regression tests for locked invariants.
 * Run: npx vitest run src/lib/__tests__/regression-guards.test.ts
 *
 * These tests protect against silent regressions in:
 *   1. Soft-delete filtering
 *   2. Warning eligibility logic
 *   3. Soft refresh contract (no hard reload)
 */

import { describe, it, expect } from 'vitest';
import { isWarningEligible, filterWarningEligible } from '@/lib/warningEligibility';

// ─── Warning eligibility invariants ────────────────────────────

describe('isWarningEligible — regression lock', () => {
  it('excludes closed-lost opportunities', () => {
    expect(isWarningEligible({ status: 'closed-lost' })).toBe(false);
    expect(isWarningEligible({ status: 'closed_lost' })).toBe(false);
    expect(isWarningEligible({ status: 'Closed-Lost' })).toBe(false);
  });

  it('excludes churned / churning accounts', () => {
    expect(isWarningEligible({ accountStatus: 'churned' })).toBe(false);
    expect(isWarningEligible({ accountStatus: 'churning' })).toBe(false);
    expect(isWarningEligible({ account_status: 'churned' })).toBe(false);
  });

  it('excludes inactive / dead entities', () => {
    expect(isWarningEligible({ status: 'inactive' })).toBe(false);
    expect(isWarningEligible({ status: 'dead' })).toBe(false);
    expect(isWarningEligible({ accountStatus: 'inactive' })).toBe(false);
    expect(isWarningEligible({ accountStatus: 'dead' })).toBe(false);
  });

  it('excludes soft-deleted entities', () => {
    expect(isWarningEligible({ deleted_at: '2025-01-01T00:00:00Z' })).toBe(false);
    expect(isWarningEligible({ deletedAt: '2025-01-01T00:00:00Z' })).toBe(false);
  });

  it('allows active / open entities', () => {
    expect(isWarningEligible({ status: 'active' })).toBe(true);
    expect(isWarningEligible({ status: 'open' })).toBe(true);
    expect(isWarningEligible({})).toBe(true);
  });

  it('allows entities with no status', () => {
    expect(isWarningEligible({ status: null })).toBe(true);
    expect(isWarningEligible({ accountStatus: null })).toBe(true);
  });

  it('soft-deleted entity with active-looking status is still excluded', () => {
    expect(isWarningEligible({ status: 'active', deleted_at: '2025-06-01' })).toBe(false);
    expect(isWarningEligible({ status: 'open', deletedAt: '2025-06-01' })).toBe(false);
  });

  it('handles whitespace and case variants', () => {
    expect(isWarningEligible({ status: ' Churned ' })).toBe(false);
    expect(isWarningEligible({ status: 'INACTIVE' })).toBe(false);
    expect(isWarningEligible({ accountStatus: ' Dead ' })).toBe(false);
  });
});

describe('filterWarningEligible — batch helper', () => {
  it('filters out ineligible items from a list', () => {
    const items = [
      { status: 'active', name: 'Good Deal' },
      { status: 'closed-lost', name: 'Dead Deal' },
      { accountStatus: 'churned', name: 'Gone Account' },
      { deleted_at: '2025-01-01', name: 'Deleted' },
      { status: 'open', name: 'Open Deal' },
    ];
    const result = filterWarningEligible(items);
    expect(result.map(r => r.name)).toEqual(['Good Deal', 'Open Deal']);
  });

  it('returns empty array when all items are ineligible', () => {
    const items = [
      { status: 'closed-lost' },
      { accountStatus: 'churned' },
      { deleted_at: '2025-01-01' },
    ];
    expect(filterWarningEligible(items)).toEqual([]);
  });

  it('returns all items when all are eligible', () => {
    const items = [{ status: 'active' }, { status: 'open' }, {}];
    expect(filterWarningEligible(items)).toHaveLength(3);
  });
});

// ─── Soft-delete structural check ──────────────────────────────

describe('Soft-delete — data layer contract', () => {
  it('activeAccounts helper exists and is importable', async () => {
    const mod = await import('@/data/accounts');
    expect(typeof mod.activeAccounts).toBe('function');
    expect(typeof mod.resolveAccountByName).toBe('function');
    expect(typeof mod.getAccounts).toBe('function');
    expect(typeof mod.getAccountById).toBe('function');
  });
});

// ─── Transcript status guard structural check ─────────────────

describe('Transcript status guard — contract', () => {
  it('detectTranscriptStatusDrift exists and is importable', async () => {
    const mod = await import('@/lib/transcriptStatusGuard');
    expect(typeof mod.detectTranscriptStatusDrift).toBe('function');
    expect(typeof mod.healTranscriptStatusDrift).toBe('function');
    expect(typeof mod.warnIfStatusDrifted).toBe('function');
  });

  it('warnIfStatusDrifted logs warning on drift', () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => { warnings.push(args.join(' ')); };
    try {
      const { warnIfStatusDrifted } = require('@/lib/transcriptStatusGuard');
      warnIfStatusDrifted('Test Lesson', 'transcript_pending', true);
      expect(warnings.some(w => w.includes('DRIFT DETECTED'))).toBe(true);

      warnings.length = 0;
      warnIfStatusDrifted('Good Lesson', 'transcript_complete', true);
      expect(warnings.some(w => w.includes('DRIFT DETECTED'))).toBe(false);
    } finally {
      console.warn = origWarn;
    }
  });
});

// ─── Soft refresh structural check ─────────────────────────────

describe('Soft refresh — contract', () => {
  it('performSoftRefresh exists and is importable', async () => {
    const mod = await import('@/lib/softRefresh');
    expect(typeof mod.performSoftRefresh).toBe('function');
  });

  it('softRefresh.ts does not contain hard reload', async () => {
    // Read the module source at build time isn't practical,
    // but we can verify the export contract is correct
    const mod = await import('@/lib/softRefresh');
    const src = mod.performSoftRefresh.toString();
    expect(src).not.toContain('location.reload');
  });
});
