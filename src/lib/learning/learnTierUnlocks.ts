/**
 * Tier Unlocks — defines what new capabilities each tier unlocks per skill.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';

const TIER_UNLOCKS: Record<SkillFocus, Record<number, string[]>> = {
  discovery: {
    1: ['Basic questioning patterns', 'Single-thread discovery'],
    2: ['Depth-creation techniques', 'Pain quantification drills'],
    3: ['Business impact framing', 'Urgency testing scenarios'],
    4: ['Multi-thread discovery', 'Timeline triangulation', 'Trigger event analysis'],
    5: ['Cross-stakeholder orchestration', 'Strategic discovery architecture'],
    6: ['Discovery coaching frameworks', 'Methodology design'],
  },
  objection_handling: {
    1: ['Composure drills', 'Concise response patterns'],
    2: ['Isolation techniques', 'Reframing to business impact'],
    3: ['Proof deployment', 'Commitment-driven responses'],
    4: ['Preemptive objection handling', 'Resistance pattern recognition'],
    5: ['Cross-deal resistance analysis', 'Executive-level objections'],
    6: ['Objection framework design', 'Team coaching patterns'],
  },
  deal_control: {
    1: ['Next-step ownership', 'Commitment testing'],
    2: ['Risk naming', 'Deal drift identification'],
    3: ['Mutual action plans', 'Stakeholder alignment'],
    4: ['Multi-stakeholder orchestration', 'Power mapping scenarios'],
    5: ['Deal structure design', 'Commercial strategy drills'],
    6: ['Deal methodology design', 'Pipeline coaching'],
  },
  executive_response: {
    1: ['Brevity drills', 'Certainty projection'],
    2: ['Number-led framing', 'Priority anchoring'],
    3: ['Strategic closing', 'Executive-level asks'],
    4: ['Multi-executive dynamics', 'Audience adaptation'],
    5: ['C-suite influence scenarios', 'Strategic advisory positioning'],
    6: ['Executive presence coaching', 'Framework transfer'],
  },
  qualification: {
    1: ['Pain validation', 'Interest vs. intent detection'],
    2: ['Stakeholder mapping', 'Decision process analysis'],
    3: ['Pipeline discipline', 'Disqualification conversations'],
    4: ['Strategic qualification', 'Competitive positioning via questions'],
    5: ['Segment-based qualification', 'Scalable frameworks'],
    6: ['Pipeline culture coaching', 'Qualification instinct transfer'],
  },
};

export function getTierUnlocks(skill: SkillFocus, tier: number): string[] {
  return TIER_UNLOCKS[skill]?.[tier] ?? [];
}
