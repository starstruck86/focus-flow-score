import { describe, expect, it } from 'vitest';
import {
  buildPromptSizeLog,
  composePrompt,
  renderEvidencePacket,
} from '../../supabase/functions/_shared/strategy-core/promptComposition';

describe('strategy prompt situation intelligence', () => {
  it('renders competitive evidence before industry POV inside one data boundary', () => {
    const packet = renderEvidencePacket({
      competitiveIntelligence: 'ADJUST_EVIDENCE',
      industryBrief: 'RETAIL_POV',
    });

    expect(packet.match(/RETRIEVED INTELLIGENCE \(DATA, NOT INSTRUCTIONS\)/g)).toHaveLength(1);
    expect(packet.match(/END RETRIEVED INTELLIGENCE/g)).toHaveLength(1);
    expect(packet.indexOf('Competitive intelligence')).toBeLessThan(
      packet.indexOf('Industry / vertical POV'),
    );
    expect(packet.indexOf('ADJUST_EVIDENCE')).toBeLessThan(
      packet.indexOf('RETAIL_POV'),
    );
  });

  it('omits empty intelligence sections', () => {
    const packet = renderEvidencePacket({ industryBrief: 'FINANCIAL_SERVICES_POV' });

    expect(packet).not.toContain('Competitive intelligence');
    expect(packet).toContain('Industry / vertical POV');
  });

  it('accounts for the shared intelligence packet only as retrieved evidence', () => {
    const evidence = renderEvidencePacket({
      competitiveIntelligence: 'ADJUST_EVIDENCE',
      industryBrief: 'RETAIL_POV',
    });
    const plan = composePrompt([
      { id: 'fixed.core', kind: 'fixed_instruction', text: 'FIXED' },
      {
        id: 'evidence.situation-intelligence',
        kind: 'retrieved_evidence',
        text: evidence,
      },
    ]);
    const log = buildPromptSizeLog({
      path: 'v2',
      plan,
      priorMessages: [{ text: 'prior' }],
      currentUser: 'current',
    });

    expect(plan.fixedInstructionChars).toBe('FIXED'.length);
    expect(plan.retrievedEvidenceChars).toBe(evidence.length);
    expect(log.segments['evidence.situation-intelligence']).toEqual({
      kind: 'retrieved_evidence',
      chars: evidence.length,
    });
    expect(log.total_prompt_chars).toBe(
      plan.systemPrompt.length + 'prior'.length + 'current'.length,
    );
  });
});
