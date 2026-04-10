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
  { id: 'oh-1', skillFocus: 'objection_handling', title: 'Incumbent loyalty', context: "You're talking to a VP of Marketing at a mid-market DTC brand ($12M revenue). They've used Braze for 2 years, renewed 3 months ago, and their lifecycle team of 4 built all their flows in Braze.", objection: "We already use Braze and it works fine. I don't see why we'd switch.", difficulty: 'standard' },
  { id: 'oh-2', skillFocus: 'objection_handling', title: 'Budget freeze', context: "You're mid-cycle with a Director of E-Commerce at a $20M fashion brand. They did a demo, got internal buy-in from their VP, and had a signed proposal in hand. Then the CFO froze all discretionary spend for Q2 due to a revenue miss.", objection: "Our CFO just froze all new software purchases until next quarter. Nothing I can do.", difficulty: 'standard' },
  { id: 'oh-3', skillFocus: 'objection_handling', title: 'Send me something', context: "First discovery call with a VP of CRM at a 200-person retail brand. She took the call because her boss forwarded your email. She's been polite but hasn't shared any pain or priorities. You've asked two discovery questions and gotten one-word answers.", objection: "This is interesting. Can you just send me some materials and I'll share it with the team?", difficulty: 'standard' },
  { id: 'oh-4', skillFocus: 'objection_handling', title: 'No resources to implement', context: "Director of Lifecycle Marketing at a fast-growing DTC supplements brand ($8M ARR). Team of 3, managing email, SMS, loyalty, and reviews across 4 different tools. They just lost a team member last month.", objection: "We don't have the bandwidth to implement another tool right now. My team is at capacity.", difficulty: 'standard' },
  { id: 'oh-5', skillFocus: 'objection_handling', title: 'Competitor is cheaper', context: "Enterprise retail company ($150M revenue) evaluating 3 vendors. You're the most expensive by ~40%. The buyer has been transparent that procurement is pushing hard on cost. The other vendors have similar core functionality.", objection: "Your competitor quoted us 40% less for essentially the same thing. I need to justify the delta to my CFO.", difficulty: 'standard' },
  { id: 'oh-6', skillFocus: 'objection_handling', title: 'Previous failed implementation', context: "VP of Digital at a $50M outdoor apparel brand. 2 years ago they bought a similar platform from a competitor, spent 6 months implementing, and it never got adoption. The project was killed, the VP who championed it was let go, and the team is gun-shy about vendor promises.", objection: "We tried something like this before and it was a disaster. My team won't go through that again.", difficulty: 'standard' },
  { id: 'oh-7', skillFocus: 'objection_handling', title: 'Need to think about it', context: "You just finished a strong demo with a Sr. Director of Growth at a beauty brand. She was nodding, asked good questions, and said 'this is impressive.' You proposed a next step of a technical review with her team next week.", objection: "I need to think about it. Let me get back to you in a couple weeks.", difficulty: 'standard' },
  { id: 'oh-8', skillFocus: 'objection_handling', title: 'Internal build option', context: "Head of Engineering at a $30M ecomm company. Their marketing team asked for a tool like yours, but the engineering team thinks they can build something in-house using their existing data warehouse and a few APIs.", objection: "We're probably going to build this internally. Our eng team thinks they can do it in a quarter.", difficulty: 'standard' },

  // ── Discovery ──
  { id: 'd-1', skillFocus: 'discovery', title: 'Surface-level pain', context: "First discovery call with a Sr. Manager of Retention at a DTC skincare brand ($6M revenue). They mentioned churn is a concern in the intro but immediately moved to asking about your product features.", objection: "Yeah, churn has been an issue. We're looking at a few things. So tell me about your segmentation capabilities.", difficulty: 'standard' },
  { id: 'd-2', skillFocus: 'discovery', title: 'No urgency — nice to have', context: "Second call with Director of Growth at a $15M ecomm brand. They did a demo last week and said it was 'cool.' No timeline, no defined project, no pain articulated. Their current tool is 'fine.'", objection: "This is a nice-to-have for us. We're focused on other priorities right now.", difficulty: 'standard' },
  { id: 'd-3', skillFocus: 'discovery', title: 'Vague buying process', context: "You're 20 minutes into a strong discovery call with a Sr. Director of CRM at a $40M health & wellness brand. She's engaged, sharing pain, asking thoughtful questions. But every time you ask about decision process or timeline, she deflects.", objection: "I'll probably just run this by my boss and see what she thinks.", difficulty: 'standard' },
  { id: 'd-4', skillFocus: 'discovery', title: 'Unquantified impact', context: "Discovery with a Head of CRM at a multi-brand retail company ($80M revenue). They want 'better engagement' but can't say what improvement means in dollars. You've asked about current performance and they gave vague answers.", objection: "We just want to improve our email engagement rates. They've been flat for about a year.", difficulty: 'standard' },
  { id: 'd-5', skillFocus: 'discovery', title: 'Enthusiastic but no business case', context: "Discovery with a Marketing Manager at a $10M DTC food brand. She loves your product, has been on your website, watched a webinar. But she has no authority, no budget, and hasn't talked to her VP about this.", objection: "This looks great! I think it could really help us. What's the pricing?", difficulty: 'standard' },
  { id: 'd-6', skillFocus: 'discovery', title: 'Competitor comparison as discovery dodge', context: "First call with a Director of Marketing at a $25M fashion retailer. Instead of answering your discovery questions, they keep redirecting to compare you against Klaviyo. They want a feature comparison, not a business conversation.", objection: "Can you just walk me through how you compare to Klaviyo? That's really what I need to understand.", difficulty: 'standard' },

  // ── Executive Response ──
  { id: 'ex-1', skillFocus: 'executive_response', title: 'CMO wants the 30-second version', context: "You get pulled into a meeting with the CMO of a $100M DTC brand. She walked in late, has 4 minutes, and is visibly checking her phone. Your champion introduced you as 'the vendor I mentioned for our retention problem.'", objection: "Give me the 30-second version. Why should I care about this?", difficulty: 'standard' },
  { id: 'ex-2', skillFocus: 'executive_response', title: 'CFO wants hard ROI', context: "CFO joins the final call at a PE-backed beauty brand ($35M revenue). He wasn't in any prior meetings. He has the $180K proposal open and is scanning the pricing page. The room goes quiet.", objection: "What's the payback period? I need to see 3x ROI in the first year or this doesn't make it through our investment committee.", difficulty: 'standard' },
  { id: 'ex-3', skillFocus: 'executive_response', title: 'CEO focused on margin, not growth', context: "CEO of a PE-backed supplements brand ($50M revenue) in a profitability review. She's cutting costs across the board — reduced headcount by 15% last quarter. Your champion positioned your tool as a growth investment, but the CEO is in preservation mode.", objection: "We're not investing in growth tools right now. Everything has to drive margin.", difficulty: 'standard' },
  { id: 'ex-4', skillFocus: 'executive_response', title: 'VP needs board-ready pitch', context: "Your champion's VP of Marketing calls you directly. She needs to present your solution to the board in 48 hours. She has 1 slide allocated. The board cares about customer LTV and CAC.", objection: "I need to pitch this to my board Thursday. Give me exactly what I should say — keep it under a minute.", difficulty: 'standard' },
  { id: 'ex-5', skillFocus: 'executive_response', title: 'CRO challenges your category', context: "CRO of a $200M retail company. He's been in the industry for 20 years and is skeptical of your entire product category. He doesn't think the problem you solve is real.", objection: "Honestly, I've seen a dozen companies pitch this same story. None of them moved the needle. What's actually different?", difficulty: 'standard' },
];

export function getRandomScenario(skillFocus?: SkillFocus): DojoScenario {
  const pool = skillFocus ? SCENARIOS.filter(s => s.skillFocus === skillFocus) : SCENARIOS;
  return pool[Math.floor(Math.random() * pool.length)];
}

interface SkillStat {
  skill: SkillFocus;
  count: number;
  avgScore: number;
  avgFirstAttempt: number;
  recentFirstAttempts: number[];
}

export interface AutopilotResult {
  scenario: DojoScenario;
  daveMessage: string;
  reason: string;
}

/**
 * Autopilot priority:
 * 1. Unpracticed skills
 * 2. Lowest recent first-attempt average (last 10)
 * 3. Least-practiced skill
 * 4. Random
 */
export function getAutopilotRecommendation(stats?: SkillStat[]): AutopilotResult {
  const allSkills: SkillFocus[] = ['objection_handling', 'discovery', 'executive_response'];

  // No data — pick random, say so
  if (!stats || stats.length === 0) {
    const scenario = getRandomScenario();
    return {
      scenario,
      daveMessage: "Let's get your first rep in. No history yet — we'll start building your baseline.",
      reason: 'no_history',
    };
  }

  const practiced = new Set(stats.map(s => s.skill));

  // 1. Unpracticed skills
  const unpracticed = allSkills.filter(s => !practiced.has(s));
  if (unpracticed.length > 0) {
    const skill = unpracticed[Math.floor(Math.random() * unpracticed.length)];
    const scenario = getRandomScenario(skill);
    const reasons: Record<SkillFocus, string> = {
      objection_handling: "You haven't drilled objection handling yet. Let's fix that.",
      discovery: "No discovery reps logged. That's where deals are won or lost.",
      executive_response: "You haven't practiced exec responses. Executives punish the unprepared.",
    };
    return {
      scenario,
      daveMessage: reasons[skill],
      reason: `unpracticed:${skill}`,
    };
  }

  // 2. Lowest recent first-attempt average
  const withFirstAttempts = stats.filter(s => s.recentFirstAttempts.length > 0);
  if (withFirstAttempts.length > 0) {
    const sorted = [...withFirstAttempts].sort((a, b) => a.avgFirstAttempt - b.avgFirstAttempt);
    const weakest = sorted[0];
    const scenario = getRandomScenario(weakest.skill);
    const label = SKILL_LABELS[weakest.skill];
    return {
      scenario,
      daveMessage: `Your recent ${label.toLowerCase()} first-attempts are averaging ${weakest.avgFirstAttempt}. That's your instinct score — let's sharpen it.`,
      reason: `weak_first_attempt:${weakest.skill}:${weakest.avgFirstAttempt}`,
    };
  }

  // 3. Least-practiced skill
  const sortedByCount = [...stats].sort((a, b) => a.count - b.count);
  const leastPracticed = sortedByCount[0];
  if (leastPracticed.count < sortedByCount[sortedByCount.length - 1].count) {
    const scenario = getRandomScenario(leastPracticed.skill);
    const label = SKILL_LABELS[leastPracticed.skill];
    return {
      scenario,
      daveMessage: `${label} is your least-practiced category. Balance matters — let's get a rep in.`,
      reason: `least_practiced:${leastPracticed.skill}:${leastPracticed.count}`,
    };
  }

  // 4. Random fallback
  const scenario = getRandomScenario();
  return {
    scenario,
    daveMessage: "Time for a rep. Stay sharp.",
    reason: 'random',
  };
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
