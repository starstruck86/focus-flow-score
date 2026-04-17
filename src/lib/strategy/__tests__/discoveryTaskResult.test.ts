import { describe, it, expect } from 'vitest';
import {
  normalizeTaskRunResultPayload,
  hasRenderableDiscoveryContent,
  normalizeDiscoverySections,
} from '@/lib/strategy/discoveryTaskResult';

/**
 * Fixture-driven sanitization tests.
 *
 * These cover every observed state of a `task_runs` row that the Strategy
 * page can encounter — including the malformed shapes that previously
 * crashed `TaskOutputViewer` and the DOCX/PDF exporters.
 *
 * Goal: prove that for ANY input shape, the normalizer returns a fully
 * shaped TaskRunResult — never null sub-fields, never throws.
 */

const FIXTURES = {
  empty_queued: undefined,
  null_payload: { draft: null, review: null },
  // background job partially populated (e.g. mid-`document_authoring`)
  partial_authoring: {
    draft: {
      sections: [
        { id: 'cockpit', name: 'Page-1 Cockpit', content: { cards: null } },
        { id: 'cover', name: 'Cover', content: 'string-instead-of-object' },
      ],
    },
    review: undefined,
  },
  // completed with valid payload (typical happy path)
  completed_full: {
    draft: {
      sections: [
        {
          id: 'cockpit',
          name: 'Page-1 Cockpit',
          content: {
            cards: [
              { label: 'Account', value: 'Acme — Mid-Market', bullets: [] },
              { label: 'Stage', value: 'Discovery', bullets: ['MEDDPICC: 60%'] },
            ],
          },
        },
        {
          id: 'participants',
          name: 'Participants',
          content: {
            prospect: [{ name: 'Jane Doe', title: 'CMO', role: 'EB' }],
            internal: [{ name: 'Corey', role: 'AE' }],
          },
        },
        {
          id: 'discovery_questions',
          name: 'Discovery Questions',
          content: { questions: ['Q1?', 'Q2?'] },
        },
      ],
      sources: [{ id: 's1', label: 'Acme website', url: 'https://acme.com' }],
    },
    review: {
      strengths: ['Strong cockpit'],
      redlines: [
        {
          id: 'r1',
          section_id: 'cockpit',
          section_name: 'Cockpit',
          current_text: 'old',
          proposed_text: 'new',
          rationale: 'tighter',
        },
      ],
      library_coverage: { used: [], gaps: [], score: 0.7 },
      rubric_check: { citation_density: 'pass' },
    },
  },
  // completed but with arrays where strings are expected and vice-versa
  completed_malformed_sections: {
    draft: {
      sections: [
        // section.content is an array (cockpit expects object) — must not throw
        { id: 'cockpit', name: 'Cockpit', content: ['unexpected', 'array'] },
        // section.content is a number
        { id: 'value_selling', name: 'Value', content: 42 },
        // grounded_by is a string instead of array
        { id: 'cover', name: 'Cover', grounded_by: 'KI-1234abcd', content: { rep_name: 'X' } },
      ],
    },
    review: 'not-an-object',
  },
  // failed run with no draft at all
  failed_missing_draft: { review: { redlines: [], strengths: [] } },
  // failed run with malformed sections shape (object, not array)
  failed_malformed_sections: {
    draft: { sections: { not: 'an-array' } },
    review: { redlines: 'also-bad', strengths: null },
  },
  // sections array contains non-objects
  sections_with_non_objects: {
    draft: { sections: ['string', 42, null, undefined, { id: 'cover', content: null }] },
  },
  // deeply nested redline with missing section_id
  redline_missing_section: {
    draft: { sections: [{ id: 'cockpit', name: 'Cockpit', content: {} }] },
    review: { redlines: [{ proposed_text: 'foo' }], strengths: [] },
  },
};

function expectShape(result: ReturnType<typeof normalizeTaskRunResultPayload>) {
  expect(result).toBeTruthy();
  expect(result.run_id).toEqual(expect.any(String));
  expect(result.draft).toBeDefined();
  expect(Array.isArray(result.draft.sections)).toBe(true);
  expect(result.review).toBeDefined();
  expect(Array.isArray(result.review.strengths)).toBe(true);
  expect(Array.isArray(result.review.redlines)).toBe(true);
  // every section must have id, name, and a content (any shape, but defined)
  for (const section of result.draft.sections) {
    expect(section.id).toEqual(expect.any(String));
    expect(section.name).toEqual(expect.any(String));
    expect('content' in section).toBe(true);
  }
  // every redline must have all string fields populated (never undefined)
  for (const redline of result.review.redlines) {
    expect(redline.id).toEqual(expect.any(String));
    expect(redline.section_id).toEqual(expect.any(String));
    expect(redline.section_name).toEqual(expect.any(String));
    expect(typeof redline.current_text).toBe('string');
    expect(typeof redline.proposed_text).toBe('string');
    expect(typeof redline.rationale).toBe('string');
    expect(['pending', 'accepted', 'rejected']).toContain(redline.status);
  }
}

describe('normalizeTaskRunResultPayload — fixture validation', () => {
  for (const [name, payload] of Object.entries(FIXTURES)) {
    it(`returns a safe shape for fixture: ${name}`, () => {
      // Must never throw, regardless of input shape.
      const result = normalizeTaskRunResultPayload(`run-${name}`, payload as any);
      expectShape(result);
    });
  }

  it('completed_full preserves all redlines, sections, sources', () => {
    const result = normalizeTaskRunResultPayload('run-complete', FIXTURES.completed_full as any);
    expect(result.draft.sections).toHaveLength(3);
    expect(result.draft.sources).toHaveLength(1);
    expect(result.review.redlines).toHaveLength(1);
    expect(result.review.strengths).toEqual(['Strong cockpit']);
    expect(result.review.library_coverage?.score).toBe(0.7);
    expect(hasRenderableDiscoveryContent(result)).toBe(true);
  });

  it('partial_authoring degrades — sections preserved with safe content', () => {
    const result = normalizeTaskRunResultPayload('run-partial', FIXTURES.partial_authoring as any);
    expect(result.draft.sections).toHaveLength(2);
    expect(result.review.redlines).toEqual([]);
    expect(result.review.strengths).toEqual([]);
  });

  it('completed_malformed_sections coerces unexpected content shapes', () => {
    const result = normalizeTaskRunResultPayload('run-malformed', FIXTURES.completed_malformed_sections as any);
    expect(result.draft.sections).toHaveLength(3);
    // cockpit content was an array → normalized cockpit returns { cards: [] }
    const cockpit = result.draft.sections.find((s) => s.id === 'cockpit');
    expect(cockpit?.content).toEqual({ cards: [] });
    // grounded_by string is dropped (not coerced to array of one)
    const cover = result.draft.sections.find((s) => s.id === 'cover');
    expect(cover?.grounded_by).toBeUndefined();
  });

  it('failed_missing_draft returns empty sections without throwing', () => {
    const result = normalizeTaskRunResultPayload('run-failed-1', FIXTURES.failed_missing_draft as any);
    expect(result.draft.sections).toEqual([]);
    expect(hasRenderableDiscoveryContent(result)).toBe(false);
  });

  it('failed_malformed_sections coerces non-array sections to []', () => {
    const result = normalizeTaskRunResultPayload('run-failed-2', FIXTURES.failed_malformed_sections as any);
    expect(result.draft.sections).toEqual([]);
    expect(result.review.redlines).toEqual([]);
    expect(result.review.strengths).toEqual([]);
  });

  it('sections_with_non_objects skips primitives, keeps real records', () => {
    const sections = normalizeDiscoverySections(
      FIXTURES.sections_with_non_objects.draft.sections,
    );
    // Only the one real section object survives with meaningful id
    expect(sections.find((s) => s.id === 'cover')).toBeTruthy();
  });

  it('redline_missing_section back-fills section_id from sections array', () => {
    const result = normalizeTaskRunResultPayload('run-redline', FIXTURES.redline_missing_section as any);
    expect(result.review.redlines).toHaveLength(1);
    expect(result.review.redlines[0].section_id).toBeTruthy();
    expect(result.review.redlines[0].section_name).toBeTruthy();
  });
});
