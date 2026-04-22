// @vitest-environment node
/**
 * Unit tests for resourceStateResolver.ts — the SINGLE SOURCE OF TRUTH for
 * canonical resource lifecycle state.
 *
 * These tests lock in the invariants the rest of the system relies on:
 *  - KI-backed resources can never resolve to `no_content` or `ready_for_extraction`.
 *  - `hard_blocked` overrides everything.
 *  - `content_length` is the only authoritative content metric (NEVER prefix length).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveResourceState,
  auditResourceInvariants,
  type ResolverResource,
  type ResolverKi,
} from '../resourceStateResolver';

const noKi: ResolverKi = { total: 0, active: 0, activeWithContexts: 0 };

describe('resolveResourceState', () => {
  describe('hard_blocked override', () => {
    it('returns "blocked" when hard_blocked is true, regardless of KIs or content', () => {
      const r: ResolverResource = { content_length: 50_000, hard_blocked: true };
      const ki: ResolverKi = { total: 25, active: 25, activeWithContexts: 25 };
      expect(resolveResourceState(r, ki)).toBe('blocked');
    });

    it('does NOT return "blocked" when hard_blocked is false or undefined', () => {
      expect(resolveResourceState({ content_length: 50_000, hard_blocked: false }, noKi))
        .toBe('ready_for_extraction');
      expect(resolveResourceState({ content_length: 50_000 }, noKi))
        .toBe('ready_for_extraction');
    });
  });

  describe('KI truth always wins', () => {
    it('NEVER resolves to no_content when KIs exist, even with zero content_length', () => {
      const r: ResolverResource = { content_length: 0 };
      const ki: ResolverKi = { total: 5, active: 5, activeWithContexts: 5 };
      const state = resolveResourceState(r, ki);
      expect(state).not.toBe('no_content');
      expect(state).not.toBe('ready_for_extraction');
      expect(state).toBe('ready');
    });

    it('NEVER resolves to no_content when KIs exist and content_length is null', () => {
      const r: ResolverResource = { content_length: null };
      const ki: ResolverKi = { total: 1, active: 0, activeWithContexts: 0 };
      const state = resolveResourceState(r, ki);
      expect(state).not.toBe('no_content');
      expect(state).not.toBe('ready_for_extraction');
      expect(state).toBe('extracted');
    });

    it('returns "extracted" when KIs exist but none are active', () => {
      const r: ResolverResource = { content_length: 10_000 };
      const ki: ResolverKi = { total: 10, active: 0, activeWithContexts: 0 };
      expect(resolveResourceState(r, ki)).toBe('extracted');
    });

    it('returns "needs_context" when active KIs exist but none have contexts', () => {
      const r: ResolverResource = { content_length: 10_000 };
      const ki: ResolverKi = { total: 10, active: 5, activeWithContexts: 0 };
      expect(resolveResourceState(r, ki)).toBe('needs_context');
    });

    it('returns "ready" when there is at least one active KI with contexts', () => {
      const r: ResolverResource = { content_length: 10_000 };
      const ki: ResolverKi = { total: 10, active: 5, activeWithContexts: 1 };
      expect(resolveResourceState(r, ki)).toBe('ready');
    });
  });

  describe('content_length as the only authoritative content metric', () => {
    it('returns "no_content" when content_length is below MIN (500) and no KIs', () => {
      expect(resolveResourceState({ content_length: 0 }, noKi)).toBe('no_content');
      expect(resolveResourceState({ content_length: 200 }, noKi)).toBe('no_content');
      expect(resolveResourceState({ content_length: 499 }, noKi)).toBe('no_content');
    });

    it('returns "ready_for_extraction" when content_length >= MIN (500) and no KIs', () => {
      expect(resolveResourceState({ content_length: 500 }, noKi)).toBe('ready_for_extraction');
      expect(resolveResourceState({ content_length: 50_000 }, noKi)).toBe('ready_for_extraction');
    });

    it('treats null/undefined content_length as zero', () => {
      expect(resolveResourceState({ content_length: null }, noKi)).toBe('no_content');
      expect(resolveResourceState({}, noKi)).toBe('no_content');
    });

    it('regression guard: does NOT accept any prefix-style field as content', () => {
      // Even if a caller passes a giant prefix string anywhere on the object,
      // the resolver MUST only consider content_length. We simulate by attaching
      // an extra property; the resolver should ignore it.
      const r = { content_length: 100, content_prefix: 'x'.repeat(100_000) } as ResolverResource;
      expect(resolveResourceState(r, noKi)).toBe('no_content');
    });

    it('manual_content_present overrides low content_length when no KIs', () => {
      expect(resolveResourceState(
        { content_length: 0, manual_content_present: true },
        noKi,
      )).toBe('ready_for_extraction');
    });
  });

  describe('full state matrix', () => {
    const cases: Array<[string, ResolverResource, ResolverKi, string]> = [
      ['empty resource',                 { content_length: 0 },        noKi, 'no_content'],
      ['big content, no KIs',            { content_length: 50_000 },   noKi, 'ready_for_extraction'],
      ['KIs but none active',            { content_length: 50_000 },   { total: 3, active: 0, activeWithContexts: 0 }, 'extracted'],
      ['active KIs, no contexts',        { content_length: 50_000 },   { total: 3, active: 3, activeWithContexts: 0 }, 'needs_context'],
      ['active KIs with contexts',       { content_length: 50_000 },   { total: 3, active: 3, activeWithContexts: 3 }, 'ready'],
      ['hard_blocked + active KIs',      { content_length: 50_000, hard_blocked: true }, { total: 3, active: 3, activeWithContexts: 3 }, 'blocked'],
    ];
    it.each(cases)('%s → %s', (_label, r, ki, expected) => {
      expect(resolveResourceState(r, ki)).toBe(expected);
    });
  });
});

describe('auditResourceInvariants', () => {
  it('flags KI-positive resources marked as empty_content', () => {
    const v = auditResourceInvariants(
      { id: 'r1', content_length: 0 },
      { total: 5, active: 5, activeWithContexts: 5 },
      'empty_content',
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('empty_content');
    expect(v[0]).toContain('r1');
  });

  it('flags KI-positive resources marked as no_extraction', () => {
    const v = auditResourceInvariants(
      { id: 'r2', content_length: 50_000 },
      { total: 5, active: 0, activeWithContexts: 0 },
      'no_extraction',
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('no_extraction');
  });

  it('returns no violations when blocked_reason is consistent with KI state', () => {
    expect(auditResourceInvariants(
      { id: 'r3', content_length: 50_000 },
      { total: 5, active: 0, activeWithContexts: 0 },
      'no_activation',
    )).toHaveLength(0);

    expect(auditResourceInvariants(
      { id: 'r4', content_length: 50_000 },
      noKi,
      'empty_content',
    )).toHaveLength(0);
  });
});
