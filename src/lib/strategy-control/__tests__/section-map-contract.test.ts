/**
 * Regression tests: every mustHave concept must have a sectionMap entry
 * when sectionMap is provided. Gate uses embedded mapping correctly.
 */
import { describe, it, expect } from 'vitest';
import { checkSectionCompleteness } from '../artifactGate';

// ── Contract: sectionMap completeness ──────────────────────────────

describe('sectionMap contract', () => {
  it('account_brief: sectionMap routes concepts to correct parent sections', () => {
    const output = JSON.stringify({
      sections: [
        { id: "company_snapshot", name: "Company Snapshot", content: "This company operates in the ecommerce space with $50M ARR and 200 employees driving growth across three product lines. The company was founded in 2015 and has grown 40% YoY because of strong retention metrics. Current CEO Jane Smith has been leading a digital transformation initiative since Q1 2024 resulting in significant platform investments." },
        { id: "stakeholders", name: "Stakeholders On File", content: "VP Sales John Smith — high influence, supportive position. Director of Marketing Jane Doe — medium influence. Because the buying committee includes both technical and business stakeholders from 3 departments, multi-threading is critical." },
        { id: "risks_mitigation", name: "Risks & Mitigation", content: "1. Budget Freeze Risk (High) — The CFO has signaled cost reduction initiatives because Q3 revenue missed by 12%. Mitigation: Position ROI within 90-day payback. 2. Champion Departure Risk (Med) — VP Sales tenure is 14 months, below median resulting in urgency. 3. Competitive Displacement (Med) — Incumbent vendor renewal is in 60 days." },
        { id: "operator_read", name: "Operator Read", content: "The strategic thesis centers on customer lifecycle value leakage. The commercial insight is that this account loses approximately $2M annually in preventable churn because their current stack lacks lifecycle automation. The strategic why is the new CRO mandate to reduce churn by 15% within 6 months, creating urgency." },
        { id: "next_moves", name: "Next Moves", content: "1. AE — Schedule executive alignment call with VP Sales to validate churn hypothesis because the CRO has a 6-month mandate. 2. SE — Build ROI model showing 90-day payback per [KI:methodology-abc]. 3. Manager — Engage partner channel according to [PB:partner-playbook]." },
      ],
    });

    const sectionMap = [
      { concept: 'situation', location: 'section' as const, parentSection: 'company_snapshot' },
      { concept: 'commercial insight', location: 'embedded' as const, parentSection: 'operator_read', minWords: 20 },
      { concept: 'risks', location: 'section' as const, parentSection: 'risks_mitigation' },
      { concept: 'strategic why', location: 'embedded' as const, parentSection: 'operator_read', minWords: 20 },
      { concept: 'specific asks', location: 'section' as const, parentSection: 'next_moves' },
      { concept: 'cited sources', location: 'embedded' as const },
    ];

    const result = checkSectionCompleteness(output,
      ['situation', 'commercial insight', 'risks', 'strategic why', 'specific asks', 'cited sources'],
      sectionMap
    );

    // All concepts should be found via their mapped parent sections
    expect(result.diagnostics).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('fails when embedded concept is absent from parent section', () => {
    const output = `## Operator Read
The account is doing fine. Everything looks good and there are no concerns. The team is aligned.`;

    const result = checkSectionCompleteness(output,
      ['risks'],
      [
        { concept: 'risks', location: 'embedded', parentSection: 'operator_read', minWords: 20 },
      ]
    );

    // "risks" concept not found in operator_read
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
