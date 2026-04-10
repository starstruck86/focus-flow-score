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
  { id: 'oh-1', skillFocus: 'objection_handling', title: 'Incumbent loyalty', context: "You're talking to a VP of Marketing at a mid-market DTC brand. They've used Braze for 2 years and renewed 3 months ago.", objection: "We already use Braze and it works fine. I don't see why we'd switch.", difficulty: 'standard' },
  { id: 'oh-2', skillFocus: 'objection_handling', title: 'Budget freeze', context: "You're mid-cycle with a Director of E-Commerce at a $20M brand. The deal was progressing — they did a demo, liked the product, got a proposal. Then finance froze all new spend for Q2.", objection: "Our CFO just froze all new software purchases until next quarter. Nothing I can do.", difficulty: 'standard' },
  { id: 'oh-3', skillFocus: 'objection_handling', title: 'Send me something', context: "First discovery call with a VP of CRM at a large retail brand. She took the call but has been short on details. You've asked two discovery questions and gotten surface answers.", objection: "This is interesting. Can you just send me some materials and I'll share it with the team?", difficulty: 'standard' },
  { id: 'oh-4', skillFocus: 'objection_handling', title: 'No resources to implement', context: "Director of Lifecycle Marketing at a fast-growing ecomm brand. Team of 3, managing 8 tools. They see the value but are drowning.", objection: "We don't have the bandwidth to implement another tool right now. My team is at capacity.", difficulty: 'standard' },
  { id: 'oh-5', skillFocus: 'objection_handling', title: 'Competitor is cheaper', context: "Enterprise retail company evaluating 3 vendors. You're the most expensive. The buyer's been transparent about pricing pressure from procurement.", objection: "Your competitor quoted us 40% less for essentially the same thing. I need to justify the delta.", difficulty: 'standard' },
  { id: 'oh-6', skillFocus: 'objection_handling', title: 'Failed before', context: "VP of Digital at a $50M retail brand. 2 years ago they bought a similar platform, spent 6 months implementing, and it never got adoption. The project was killed and the VP who championed it left.", objection: "We tried something like this before and it was a disaster. My team won't go through that again.", difficulty: 'standard' },

  // ── Discovery ──
  { id: 'd-1', skillFocus: 'discovery', title: 'Surface-level pain', context: "First discovery call with a Sr. Manager of Retention at a DTC skincare brand. They mentioned churn is a concern but haven't said anything specific about why or how bad it is.", objection: "Yeah, churn has been an issue. We're looking at a few things.", difficulty: 'standard' },
  { id: 'd-2', skillFocus: 'discovery', title: 'No urgency', context: "Second call with Director of Growth at a $15M ecomm brand. They did a demo last week and said it was 'cool.' No timeline, no defined project, no pain articulated.", objection: "This is a nice-to-have for us. We're focused on other priorities right now.", difficulty: 'standard' },
  { id: 'd-3', skillFocus: 'discovery', title: 'Vague buying process', context: "You're 20 minutes into a discovery call with a Sr. Director of CRM. She's engaged, asking good questions, but every time you ask about process she goes vague.", objection: "I'll probably just run this by my boss and see what she thinks.", difficulty: 'standard' },
  { id: 'd-4', skillFocus: 'discovery', title: 'Unquantified problem', context: "Discovery with a Head of CRM at a multi-brand retail company. They want 'better engagement' but can't say what that means in dollars, conversion, or churn impact.", objection: "We just want to improve our email engagement rates. They've been flat.", difficulty: 'standard' },
  { id: 'd-5', skillFocus: 'discovery', title: 'Happy path buyer', context: "Discovery with a Marketing Manager who loves your product. She's saying all the right things — but you haven't uncovered any real pain, business case, or decision driver.", objection: "This looks great! I think it could really help us. What's the pricing?", difficulty: 'standard' },

  // ── Executive Response ──
  { id: 'ex-1', skillFocus: 'executive_response', title: 'CMO wants the 30-second version', context: "You get pulled into a meeting with the CMO of a $100M DTC brand. She walked in late, has 4 minutes, and is visibly impatient. Your champion introduced you as 'the vendor I mentioned.'", objection: "Give me the 30-second version. Why should I care about this?", difficulty: 'standard' },
  { id: 'ex-2', skillFocus: 'executive_response', title: 'CFO wants ROI proof', context: "CFO joins the final call at a PE-backed brand. He wasn't in any prior meetings. He has the proposal open and is scanning the pricing page.", objection: "What's the payback period? I need to see 3x ROI in the first year or this doesn't make it through our investment committee.", difficulty: 'standard' },
  { id: 'ex-3', skillFocus: 'executive_response', title: 'CEO focused on margin', context: "CEO of a PE-backed brand doing a profitability review. She's cutting costs across the board. Your champion positioned your tool as a growth investment, but the CEO is not in growth mode.", objection: "We're not investing in growth tools right now. Everything has to drive margin.", difficulty: 'standard' },
  { id: 'ex-4', skillFocus: 'executive_response', title: 'Board meeting in 48 hours', context: "Your champion's VP calls you directly. She needs to present your solution to the board in 48 hours and wants you to give her the elevator pitch she should use.", objection: "I need to pitch this to my board Thursday. Give me exactly what I should say — keep it under a minute.", difficulty: 'standard' },
];

export function getRandomScenario(skillFocus?: SkillFocus): DojoScenario {
  const pool = skillFocus ? SCENARIOS.filter(s => s.skillFocus === skillFocus) : SCENARIOS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Simple MVP autopilot: picks least-practiced or lowest-scoring skill, falls back to random */
export function getAutopilotScenario(
  stats?: { skill: SkillFocus; count: number; avgScore: number }[]
): DojoScenario {
  if (!stats || stats.length === 0) {
    return getRandomScenario();
  }

  const allSkills: SkillFocus[] = ['objection_handling', 'discovery', 'executive_response'];

  // Find skills with zero practice — prioritize those
  const practiced = new Set(stats.map(s => s.skill));
  const unpracticed = allSkills.filter(s => !practiced.has(s));
  if (unpracticed.length > 0) {
    return getRandomScenario(unpracticed[Math.floor(Math.random() * unpracticed.length)]);
  }

  // Otherwise pick the skill with the lowest average score
  const sorted = [...stats].sort((a, b) => a.avgScore - b.avgScore);
  return getRandomScenario(sorted[0].skill);
}

export function getAutopilotMessage(
  scenario: DojoScenario,
  stats?: { skill: SkillFocus; count: number; avgScore: number }[]
): string {
  const skill = scenario.skillFocus;

  // If we have stats, give a reason-based message
  if (stats && stats.length > 0) {
    const practiced = new Set(stats.map(s => s.skill));

    if (!practiced.has(skill)) {
      const msgs: Record<SkillFocus, string> = {
        objection_handling: "You haven't drilled objection handling yet. Let's fix that.",
        discovery: "No discovery reps logged. That's where deals are won or lost — let's go.",
        executive_response: "You haven't practiced exec responses yet. Executives punish the unprepared.",
      };
      return msgs[skill];
    }

    const skillStat = stats.find(s => s.skill === skill);
    if (skillStat && skillStat.avgScore < 65) {
      const msgs: Record<SkillFocus, string> = {
        objection_handling: `Your objection handling is averaging ${skillStat.avgScore}. Let's sharpen it.`,
        discovery: `Discovery is at ${skillStat.avgScore}. You're leaving depth on the table — let's fix it.`,
        executive_response: `Exec responses averaging ${skillStat.avgScore}. Brevity and impact need work.`,
      };
      return msgs[skill];
    }
  }

  // Default messages — sharp, not fluffy
  const defaults: Record<SkillFocus, string[]> = {
    objection_handling: [
      "5 minutes. Let's handle an objection.",
      "Time for a rep. Objection drill — stay tight.",
    ],
    discovery: [
      "Discovery drill. Go deeper than you think you need to.",
      "Let's run a discovery rep. No surface-level questions.",
    ],
    executive_response: [
      "Exec drill. You get 30 seconds — make them count.",
      "Quick rep: respond to a skeptical exec. Be brief, be specific.",
    ],
  };

  const msgs = defaults[skill];
  return msgs[Math.floor(Math.random() * msgs.length)];
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
