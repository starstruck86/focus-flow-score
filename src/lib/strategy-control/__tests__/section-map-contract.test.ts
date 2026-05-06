/**
 * Comprehensive section-map contract tests.
 * Covers: JSON sections[], name-only matching, nested objects,
 * missing parents, markdown fallback, manifest coverage audit.
 */
import { describe, it, expect } from 'vitest';
import { checkSectionCompleteness, findSectionContent } from '../artifactGate';

// ── findSectionContent tests ──────────────────────────────────────

describe('findSectionContent', () => {
  it('finds section by id in JSON sections[]', () => {
    const output = JSON.stringify({
      sections: [
        { id: "risks_mitigation", content: "Budget freeze risk is high because Q3 revenue missed by 12%. The CFO signaled cost cuts." },
        { id: "company_snapshot", content: "Acme Corp is a mid-market SaaS company." },
      ],
    });
    const content = findSectionContent(output, "risks_mitigation");
    expect(content).toContain("Budget freeze risk");
  });

  it('finds section by name (human-readable) in JSON', () => {
    const output = JSON.stringify({
      sections: [
        { name: "Risks & Mitigation", content: "Champion departure risk is medium due to VP Sales tenure of only 14 months." },
      ],
    });
    const content = findSectionContent(output, "risks_mitigation");
    expect(content).toContain("Champion departure risk");
  });

  it('finds section by title in JSON', () => {
    const output = JSON.stringify({
      sections: [
        { title: "Risks Mitigation", body: "Competitive threat from Gong because their pricing undercuts by 30%." },
      ],
    });
    const content = findSectionContent(output, "risks_mitigation");
    expect(content).toContain("Competitive threat");
  });

  it('finds nested objects/arrays', () => {
    const output = JSON.stringify({
      document: {
        parts: [
          {
            sections: [
              { id: "operator_read", content: "The primary risk is timing. Because the CRO mandate expires in 6 months, we must multi-thread immediately." },
            ],
          },
        ],
      },
    });
    const content = findSectionContent(output, "operator_read");
    expect(content).toContain("primary risk");
  });

  it('finds top-level key matching', () => {
    const output = JSON.stringify({
      risks_mitigation: {
        items: [
          { risk: "Budget freeze", level: "high", mitigation: "Executive sponsor engagement" },
        ],
      },
    });
    const content = findSectionContent(output, "risks_mitigation");
    expect(content).toContain("Budget freeze");
  });

  it('returns empty for missing section', () => {
    const output = JSON.stringify({
      sections: [
        { id: "company_snapshot", content: "Acme Corp overview." },
      ],
    });
    const content = findSectionContent(output, "risks_mitigation");
    expect(content).toBe("");
  });

  it('falls back to markdown headings', () => {
    const output = `## Risks & Mitigation

Budget freeze risk is high because Q3 revenue missed by 12%. The CFO has signaled cost reduction initiatives resulting in delayed procurement across all departments.

## Next Moves

Schedule executive briefing.`;
    const content = findSectionContent(output, "risks_mitigation");
    expect(content).toContain("Budget freeze risk");
  });

  it('handles code-fenced JSON', () => {
    const output = '```json\n' + JSON.stringify({
      sections: [{ id: "risks_mitigation", content: "Risk content here about the CFO budget concerns because revenue dropped 15%." }],
    }) + '\n```';
    const content = findSectionContent(output, "risks_mitigation");
    expect(content).toContain("Risk content here");
  });
});

// ── checkSectionCompleteness with sectionMap ──────────────────────

describe('checkSectionCompleteness with sectionMap', () => {
  it('JSON sections[] with id: "risks_mitigation" satisfies risks', () => {
    const output = JSON.stringify({
      sections: [
        { id: "risks_mitigation", content: "Budget freeze risk is high because Q3 revenue missed by 12%. The CFO has signaled cost reduction initiatives resulting in delayed procurement cycles across all departments. Champion departure risk is medium due to VP Sales tenure of only 14 months, which is below the industry median of 24 months." },
        { id: "company_snapshot", content: "Acme Corp is a growing mid-market SaaS company with $50M ARR and 200 employees. The VP of Engineering leads platform modernization." },
      ],
    });

    const result = checkSectionCompleteness(output, ['risks'], [
      { concept: 'risks', location: 'section', parentSection: 'risks_mitigation' },
    ]);
    expect(result.pass).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('JSON sections with only name: "Risks & Mitigation" also satisfies risks', () => {
    const output = JSON.stringify({
      sections: [
        { name: "Risks & Mitigation", content: "Budget freeze risk is high because Q3 revenue missed by 12%. The CFO has signaled cost reduction initiatives resulting in delayed procurement cycles across all departments. Champion departure risk is medium due to VP Sales tenure of only 14 months, consequently the deal timeline is compressed and requires immediate multi-threading." },
      ],
    });

    const result = checkSectionCompleteness(output, ['risks'], [
      { concept: 'risks', location: 'section', parentSection: 'risks_mitigation' },
    ]);
    expect(result.pass).toBe(true);
  });

  it('nested objects/arrays work for embedded concepts', () => {
    const output = JSON.stringify({
      document: {
        parts: [
          {
            sections: [
              { id: "operator_read", content: "The primary risk is champion departure. Because the VP Sales tenure is only 14 months, the deal timeline is compressed. Mitigation requires multi-threading to Director level immediately." },
            ],
          },
        ],
      },
    });

    const result = checkSectionCompleteness(output, ['risks'], [
      { concept: 'risks', location: 'embedded', parentSection: 'operator_read', minWords: 20 },
    ]);
    expect(result.pass).toBe(true);
  });

  it('missing mapped parent section fails', () => {
    const output = JSON.stringify({
      sections: [
        { id: "company_snapshot", content: "Acme Corp overview with detailed analysis of the market." },
      ],
    });

    const result = checkSectionCompleteness(output, ['risks'], [
      { concept: 'risks', location: 'section', parentSection: 'risks_mitigation' },
    ]);
    // Should fall through to standard finding and fail since "risks" is not found
    expect(result.pass).toBe(false);
  });

  it('existing markdown heading behavior still works', () => {
    const output = `## Risks

Budget freeze risk is high because Q3 revenue missed by 12%. The CFO has signaled cost reduction initiatives resulting in delayed procurement cycles across all departments. Champion departure risk is medium due to VP Sales tenure of only 14 months, which is below the industry median of 24 months for this role.`;

    const result = checkSectionCompleteness(output, ['risks']);
    expect(result.pass).toBe(true);
  });

  it('embedded concept absent from parent fails', () => {
    const output = `## Operator Read
The account is doing fine. Everything looks good and there are no concerns. The team is aligned.`;

    const result = checkSectionCompleteness(output, ['risks'], [
      { concept: 'risks', location: 'embedded', parentSection: 'operator_read', minWords: 20 },
    ]);
    expect(result.pass).toBe(false);
  });

  it('ninety_day_plan: embedded concepts pass when present in parent sections', () => {
    const output = `## Account Context
This account requires executive alignment with the VP of Sales and CRO to drive the expansion motion. The stakeholder strategy involves building multi-threaded relationships because the buying committee spans 3 departments. Key metrics show 45% adoption rate which is below the 60% benchmark target.

## Days 1–30 — Learn
Key milestones include completing stakeholder mapping by day 10 and delivering initial ROI analysis by day 20. The target metric is scheduling 3 executive meetings because pipeline velocity depends on early engagement.

## Days 31–60 — Engage
Continue building momentum with expansion triggers from the land motion. Drive adoption from 45% to 55% because this unlocks the upsell conversation.

## Days 61–90 — Advance
Execute expansion triggers: cross-sell into marketing department because their budget cycle opens in Q2. Target $150K expansion ARR milestone.

## Operator Read
The primary risk is champion departure — VP Sales tenure is only 14 months. Because the CRO mandate expires in 6 months, timing risk compounds. Mitigation requires multi-threading to Director level immediately.`;

    const result = checkSectionCompleteness(output,
      ['milestones', 'stakeholder strategy', 'risks', 'metrics', 'executive alignment', 'expansion triggers'],
      [
        { concept: 'milestones', location: 'embedded', parentSection: 'days_1_30', minWords: 20 },
        { concept: 'stakeholder strategy', location: 'embedded', parentSection: 'account_context', minWords: 20 },
        { concept: 'risks', location: 'embedded', parentSection: 'operator_read', minWords: 20 },
        { concept: 'metrics', location: 'embedded', parentSection: 'days_1_30', minWords: 15 },
        { concept: 'executive alignment', location: 'embedded', parentSection: 'account_context', minWords: 15 },
        { concept: 'expansion triggers', location: 'embedded', parentSection: 'days_61_90', minWords: 15 },
      ]
    );

    expect(result.pass).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('without sectionMap, falls back to standard section finding', () => {
    const output = `## Risks
Budget freeze risk is high because Q3 revenue missed by 12%. The CFO has signaled cost reduction initiatives resulting in delayed procurement cycles across all departments. Champion departure risk is medium due to VP Sales tenure of only 14 months, which is below the industry median of 24 months for this role.`;

    const result = checkSectionCompleteness(output, ['risks']);
    expect(result.pass).toBe(true);
  });
});

// ── Manifest coverage audit ────────────────────────────────────────

describe('manifest sectionMap coverage', () => {
  const manifests = {
    account_brief: {
      mustHave: ['situation', 'commercial insight', 'risks', 'strategic why', 'specific asks', 'cited sources'],
      sectionMap: [
        { concept: 'situation', location: 'section', parentSection: 'company_snapshot' },
        { concept: 'commercial insight', location: 'embedded', parentSection: 'operator_read', minWords: 20 },
        { concept: 'risks', location: 'section', parentSection: 'risks_mitigation' },
        { concept: 'strategic why', location: 'embedded', parentSection: 'operator_read', minWords: 20 },
        { concept: 'specific asks', location: 'section', parentSection: 'next_moves' },
        { concept: 'cited sources', location: 'embedded' },
      ],
    },
    discovery_prep: {
      mustHave: ['verified signals', 'current state reasoning', 'change vectors', 'commercial insight', 'strategic why', 'friction', 'cited sources'],
      sectionMap: [
        { concept: 'verified signals', location: 'section', parentSection: 'executive_snapshot' },
        { concept: 'current state reasoning', location: 'section', parentSection: 'value_selling' },
        { concept: 'change vectors', location: 'embedded', parentSection: 'cockpit', minWords: 20 },
        { concept: 'commercial insight', location: 'section', parentSection: 'revenue_pathway' },
        { concept: 'strategic why', location: 'embedded', parentSection: 'cockpit', minWords: 20 },
        { concept: 'friction', location: 'section', parentSection: 'hypotheses_risks' },
        { concept: 'cited sources', location: 'embedded' },
      ],
    },
    ninety_day_plan: {
      mustHave: ['milestones', 'stakeholder strategy', 'risks', 'metrics', 'executive alignment', 'expansion triggers'],
      sectionMap: [
        { concept: 'milestones', location: 'embedded', parentSection: 'days_1_30', minWords: 20 },
        { concept: 'stakeholder strategy', location: 'embedded', parentSection: 'account_context', minWords: 20 },
        { concept: 'risks', location: 'embedded', parentSection: 'operator_read', minWords: 20 },
        { concept: 'metrics', location: 'embedded', parentSection: 'days_1_30', minWords: 15 },
        { concept: 'executive alignment', location: 'embedded', parentSection: 'account_context', minWords: 15 },
        { concept: 'expansion triggers', location: 'embedded', parentSection: 'days_61_90', minWords: 15 },
      ],
    },
  };

  for (const [taskType, manifest] of Object.entries(manifests)) {
    it(`${taskType}: every mustHave has sectionMap coverage`, () => {
      const mappedConcepts = new Set(
        manifest.sectionMap.map(m => m.concept.toLowerCase())
      );
      for (const concept of manifest.mustHave) {
        expect(
          mappedConcepts.has(concept.toLowerCase()),
          `${taskType}: mustHave "${concept}" has no sectionMap entry`
        ).toBe(true);
      }
    });
  }
});