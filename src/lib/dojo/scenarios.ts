export type SkillFocus = 'objection_handling' | 'discovery' | 'executive_response';

export interface DojoScenario {
  id: string;
  skillFocus: SkillFocus;
  title: string;
  context: string;
  objection: string;
  difficulty: 'standard';
}

const SCENARIOS: DojoScenario[] = [
  // ── Objection Handling ──
  { id: 'oh-1', skillFocus: 'objection_handling', title: 'Incumbent loyalty', context: "You're talking to a VP of Marketing at a mid-market DTC brand. They've used Braze for 2 years.", objection: "We already use Braze and it works fine. I don't see why we'd switch.", difficulty: 'standard' },
  { id: 'oh-2', skillFocus: 'objection_handling', title: 'Budget freeze', context: "You're mid-cycle with a Director of E-Commerce. The deal was progressing well until finance froze new spend.", objection: "Our CFO just froze all new software purchases until next quarter.", difficulty: 'standard' },
  { id: 'oh-3', skillFocus: 'objection_handling', title: 'Send me something', context: "You're on a first discovery call with a VP of CRM. She's polite but non-committal.", objection: "This is interesting. Can you just send me some materials and I'll share it with the team?", difficulty: 'standard' },
  { id: 'oh-4', skillFocus: 'objection_handling', title: 'No resources', context: "You're talking to a Director of Lifecycle Marketing. They agree there's a problem but hesitate.", objection: "We don't have the bandwidth to implement another tool right now. My team is at capacity.", difficulty: 'standard' },
  { id: 'oh-5', skillFocus: 'objection_handling', title: 'Competitor is cheaper', context: "Enterprise retail company evaluating 3 vendors. You're in a competitive bake-off.", objection: "Your competitor quoted us 40% less for essentially the same thing.", difficulty: 'standard' },
  { id: 'oh-6', skillFocus: 'objection_handling', title: 'Previous bad experience', context: "VP of Digital at a large retail brand. They tried a similar platform 2 years ago and it failed.", objection: "We tried something like this before and it was a disaster. My team won't go through that again.", difficulty: 'standard' },

  // ── Discovery ──
  { id: 'd-1', skillFocus: 'discovery', title: 'Shallow pain', context: "First discovery call with a Sr. Manager of Retention. They mentioned churn is high but didn't elaborate.", objection: "Yeah, churn has been an issue. We're looking at a few things.", difficulty: 'standard' },
  { id: 'd-2', skillFocus: 'discovery', title: 'No urgency', context: "Second call with Director of Growth. They like your platform but aren't in a rush.", objection: "This is a nice-to-have for us. We're focused on other priorities right now.", difficulty: 'standard' },
  { id: 'd-3', skillFocus: 'discovery', title: 'Decision process unclear', context: "You're 20 minutes into a discovery call. The champion is excited but vague about who else needs to be involved.", objection: "I'll probably just run this by my boss and see what she thinks.", difficulty: 'standard' },
  { id: 'd-4', skillFocus: 'discovery', title: 'Surface-level metrics', context: "Discovery with a Head of CRM. They mention wanting better engagement but can't quantify the impact.", objection: "We just want to improve our email engagement rates.", difficulty: 'standard' },

  // ── Executive Response ──
  { id: 'ex-1', skillFocus: 'executive_response', title: 'C-suite skepticism', context: "You get pulled into a meeting with the CMO. She has 5 minutes and is skeptical.", objection: "Give me the 30-second version. Why should I care about this?", difficulty: 'standard' },
  { id: 'ex-2', skillFocus: 'executive_response', title: 'ROI demand', context: "CFO joins a late-stage call. They want hard numbers.", objection: "What's the payback period? I need to see 3x ROI in the first year.", difficulty: 'standard' },
  { id: 'ex-3', skillFocus: 'executive_response', title: 'Strategic misalignment', context: "CEO of a PE-backed brand. She's focused on profitability, not growth.", objection: "We're not investing in growth tools right now. Everything has to drive margin.", difficulty: 'standard' },
];

export function getRandomScenario(skillFocus?: SkillFocus): DojoScenario {
  const pool = skillFocus ? SCENARIOS.filter(s => s.skillFocus === skillFocus) : SCENARIOS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function getAutopilotRecommendation(): { scenario: DojoScenario; daveMessage: string } {
  const skills: SkillFocus[] = ['objection_handling', 'discovery', 'executive_response'];
  const randomSkill = skills[Math.floor(Math.random() * skills.length)];
  const scenario = getRandomScenario(randomSkill);

  const messages: Record<SkillFocus, string[]> = {
    objection_handling: [
      "You've got 5 minutes — let's sharpen your objection handling.",
      "Time for a rep. Today's focus: handling objections under pressure.",
      "Let's drill an objection. Quick, focused, no fluff.",
    ],
    discovery: [
      "Discovery skills get rusty fast. Let's run a quick drill.",
      "Today's rep: deepening a discovery conversation. Ready?",
      "5 minutes. Let's work on asking better questions.",
    ],
    executive_response: [
      "Executives don't give you time to ramble. Let's practice brevity.",
      "Quick drill: respond to a skeptical exec in 30 seconds or less.",
      "Let's sharpen your executive presence. Fast and focused.",
    ],
  };

  const msgs = messages[randomSkill];
  const daveMessage = msgs[Math.floor(Math.random() * msgs.length)];

  return { scenario, daveMessage };
}

export const SKILL_LABELS: Record<SkillFocus, string> = {
  objection_handling: 'Objection Handling',
  discovery: 'Discovery',
  executive_response: 'Executive Response',
};

export const MISTAKE_LABELS: Record<string, string> = {
  pitched_too_early: 'Pitched too early',
  weak_objection_handle: 'Weak objection handle',
  no_business_impact: 'No business impact',
  lack_of_control: 'Lack of control',
  too_generic: 'Too generic',
  too_long: 'Too long / rambling',
  no_proof: 'No proof points',
  weak_close: 'Weak close',
  stacked_questions: 'Stacked questions',
  failed_to_deepen: 'Failed to deepen pain',
};
