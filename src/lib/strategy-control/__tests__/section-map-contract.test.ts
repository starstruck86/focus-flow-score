/**
 * Regression tests: every mustHave concept must have a sectionMap entry
 * when sectionMap is provided. Gate uses embedded mapping correctly.
 */
import { describe, it, expect } from 'vitest';
import { checkSectionCompleteness } from '../artifactGate';

describe('sectionMap contract', () => {
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
