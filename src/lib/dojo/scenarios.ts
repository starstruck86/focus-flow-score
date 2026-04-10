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
  // ── Objection Handling ──────────────────────────────────────────────
  // Each tests a distinct resistance pattern: incumbent loyalty, budget, stall, resources, price, past failure, delay, internal build

  { id: 'oh-1', skillFocus: 'objection_handling', title: 'Incumbent loyalty',
    context: "You're mid-discovery with a VP of Marketing at a DTC skincare brand doing $12M ARR. They've used Braze for 2 years, renewed 3 months ago, and their lifecycle team of 4 built all automations in Braze. The VP personally championed the Braze deal.",
    objection: "We just renewed Braze three months ago and my team built everything in it. I'm not ripping that out.", difficulty: 'standard' },

  { id: 'oh-2', skillFocus: 'objection_handling', title: 'Budget freeze',
    context: "You're in final stages with a Director of E-Commerce at a PE-backed fashion brand ($20M revenue). She got VP sign-off, and the $95K proposal is on her desk. Yesterday, the CFO froze all discretionary spend for Q2 after a revenue miss. She texted you this morning.",
    objection: "My CFO just froze everything. I literally cannot get a PO signed until July at the earliest. My hands are tied.", difficulty: 'standard' },

  { id: 'oh-3', skillFocus: 'objection_handling', title: 'The brush-off stall',
    context: "First call with a VP of CRM at a 200-person home goods retailer. She took the call because her CEO forwarded your email after a board meeting about retention. She's been polite but guarded — one-word answers to your first two questions. She's clearly multitasking.",
    objection: "Yeah, this is interesting. Can you just send me a deck or something? I'll pass it around internally.", difficulty: 'standard' },

  { id: 'oh-4', skillFocus: 'objection_handling', title: 'No bandwidth to implement',
    context: "Director of Lifecycle at a DTC supplements brand ($8M ARR). Team of 3 managing email, SMS, loyalty, and reviews across 4 tools. They lost their senior lifecycle manager last month and haven't backfilled. She's doing the work of two people.",
    objection: "I believe it's better, but I cannot ask my team to implement another platform right now. We're barely keeping the lights on.", difficulty: 'standard' },

  { id: 'oh-5', skillFocus: 'objection_handling', title: 'Competitor is 40% cheaper',
    context: "Enterprise retail company ($150M revenue) evaluating 3 vendors in final round. Procurement has been transparent: your competitor quoted 40% less for what they see as equivalent functionality. The Director of Marketing likes your product but can't justify the gap to her CFO.",
    objection: "Look, I like your product. But Klaviyo quoted us $110K and you're at $180K. My CFO is going to ask me why, and 'it's a better experience' isn't going to cut it.", difficulty: 'standard' },

  { id: 'oh-6', skillFocus: 'objection_handling', title: 'Burned by last vendor',
    context: "VP of Digital at a $50M outdoor apparel brand. Two years ago they bought a competing platform, spent 6 months implementing, and never got adoption. The project was killed, the VP who led it was fired, and the team is deeply skeptical of vendor promises. This VP inherited the mess.",
    objection: "The last time we did this it cost us $200K, six months, and a VP. My team will mutiny if I bring in another platform that promises the same thing.", difficulty: 'standard' },

  { id: 'oh-7', skillFocus: 'objection_handling', title: 'Post-demo stall',
    context: "You just finished a strong demo with a Sr. Director of Growth at a beauty brand ($18M ARR). She was engaged — asked about segmentation, leaned in during the AI section, said 'this is really impressive.' You proposed a technical review with her team next Tuesday.",
    objection: "This is great, I just need some time to think about it. Let me circle back in a couple weeks after our planning cycle wraps.", difficulty: 'standard' },

  { id: 'oh-8', skillFocus: 'objection_handling', title: 'Build vs. buy',
    context: "Head of Engineering at a $30M ecomm company. Their marketing team asked for a tool like yours, but the eng team is confident they can replicate core functionality using their existing Snowflake warehouse, a few APIs, and a React dashboard. They've already scoped it at one quarter of work.",
    objection: "We're going to build this in-house. My team already scoped it — we can get 80% of what you do in about 3 months using our own data warehouse.", difficulty: 'standard' },

  // ── Discovery ───────────────────────────────────────────────────────
  // Each tests a distinct discovery behavior: deepening pain, creating urgency, uncovering process, quantifying impact, building a business case, handling competitor deflection

  { id: 'd-1', skillFocus: 'discovery', title: 'Surface pain — won\'t go deeper',
    context: "First discovery call with a Sr. Manager of Retention at a DTC skincare brand ($6M revenue). She mentioned churn is a problem but immediately pivoted to asking about your segmentation features. She's treating this like a vendor demo, not a business conversation.",
    objection: "Yeah, churn's been up. Anyway — can you walk me through your segmentation? That's really what I want to see.", difficulty: 'standard' },

  { id: 'd-2', skillFocus: 'discovery', title: 'No urgency — "nice to have"',
    context: "Second call with Director of Growth at a $15M ecomm brand. They did a demo last week and said it was 'cool.' No timeline exists, no project is defined, no budget is allocated. Their current tool (Mailchimp) is 'fine.' They took this call because they had a free slot.",
    objection: "Honestly, this is more of a nice-to-have for us right now. We've got bigger fires. Maybe next quarter.", difficulty: 'standard' },

  { id: 'd-3', skillFocus: 'discovery', title: 'Vague buying process',
    context: "Twenty minutes into a strong discovery with a Sr. Director of CRM at a $40M health & wellness brand. She's sharing real pain — poor SMS ROI, no lifecycle attribution, manual reporting. But every time you ask about decision process, timeline, or who else is involved, she deflects or goes vague.",
    objection: "I'll just run this by my boss and see what she thinks. We don't really have a formal process for this kind of thing.", difficulty: 'standard' },

  { id: 'd-4', skillFocus: 'discovery', title: 'Unquantified impact',
    context: "Discovery with Head of CRM at a multi-brand retail company ($80M revenue across 3 brands). They want 'better engagement' but can't say what improvement means in revenue. When you asked about current metrics, they said open rates are 'around 18%' and click rates are 'low.' No revenue attribution exists.",
    objection: "We just want to improve our email engagement rates. They've been flat for about a year. We don't really track revenue per email — that's something we want to get better at.", difficulty: 'standard' },

  { id: 'd-5', skillFocus: 'discovery', title: 'Enthusiast with no power',
    context: "Discovery with a Marketing Manager at a $10M DTC food brand. She's watched your webinar, follows your company on LinkedIn, and loves your product. But she has no budget authority, hasn't mentioned this to her VP, and doesn't know what the buying process would look like. She wants pricing.",
    objection: "This is exactly what we need! I've been wanting something like this for months. What's pricing look like? I want to put together a quick business case.", difficulty: 'standard' },

  { id: 'd-6', skillFocus: 'discovery', title: 'Competitor comparison as deflection',
    context: "First call with Director of Marketing at a $25M fashion retailer. Instead of answering discovery questions, she keeps redirecting to a Klaviyo comparison. She's already using Klaviyo and likes it — she's evaluating you because her CEO told her to look at alternatives after a board meeting.",
    objection: "Can you just tell me how you're different from Klaviyo? That's all I really need. We're happy with them — I'm just doing my due diligence.", difficulty: 'standard' },

  { id: 'd-7', skillFocus: 'discovery', title: 'Multi-stakeholder complexity',
    context: "Discovery with a Director of E-commerce at a $60M CPG brand. She's interested but keeps referencing other teams — IT needs to approve integrations, Finance controls budget, and the CMO has final say. She doesn't seem confident she can champion this alone.",
    objection: "I think this could work, but honestly, I'd need to get IT, Finance, and my CMO aligned. It's a whole process here. I'm not sure how to even start that.", difficulty: 'standard' },

  // ── Executive Response ──────────────────────────────────────────────
  // Each tests a distinct exec scenario: time pressure, ROI demand, cost-cutting mode, board prep, category skepticism, strategic pivot

  { id: 'ex-1', skillFocus: 'executive_response', title: 'CMO wants 30-second version',
    context: "You get pulled into a meeting with the CMO of a $100M DTC brand. She walked in late, has 4 minutes before her next call, and is checking her phone. Your champion introduced you as 'the vendor I mentioned for our retention problem.' She hasn't seen a demo or any materials.",
    objection: "Give me the 30-second version. Why should I care?", difficulty: 'standard' },

  { id: 'ex-2', skillFocus: 'executive_response', title: 'CFO wants payback math',
    context: "CFO joins the final call at a PE-backed beauty brand ($35M revenue). He wasn't in any prior meetings. He has the $180K proposal open on his screen and is looking at the pricing page. The room goes quiet and everyone looks at him.",
    objection: "Walk me through the payback period. I need to see 3x ROI in year one or this doesn't clear our investment committee. What's your math?", difficulty: 'standard' },

  { id: 'ex-3', skillFocus: 'executive_response', title: 'CEO in cost-cutting mode',
    context: "CEO of a PE-backed supplements brand ($50M revenue) in a profitability review quarter. She's cut headcount 15% and eliminated 3 tools already. Your champion positioned your product as a growth investment, but the CEO has explicitly said 'no growth bets this year.'",
    objection: "We're not spending on growth right now. Everything I approve has to protect margin or reduce cost. Tell me why this isn't just another expense.", difficulty: 'standard' },

  { id: 'ex-4', skillFocus: 'executive_response', title: 'VP needs board-ready pitch',
    context: "Your champion's VP of Marketing calls you directly. She presents to the board in 48 hours. She has 1 slide and 60 seconds. The board cares about two things: customer LTV and CAC efficiency. She needs your help making the case.",
    objection: "I'm presenting to the board Thursday morning. I have one slide. Tell me exactly what I should say to make this a no-brainer — keep it under a minute.", difficulty: 'standard' },

  { id: 'ex-5', skillFocus: 'executive_response', title: 'CRO is a category skeptic',
    context: "CRO of a $200M retail company with 20 years in the industry. He's been pitched by companies like yours many times. He doesn't believe your product category moves the needle — he thinks it's 'marketing fluff that doesn't impact pipeline.' He agreed to 10 minutes because his VP insisted.",
    objection: "I've heard this pitch a dozen times from companies that look just like yours. None of them moved the needle. You've got 2 minutes — what's actually different?", difficulty: 'standard' },

  { id: 'ex-6', skillFocus: 'executive_response', title: 'CEO pivoting strategy',
    context: "CEO of a $70M ecomm company just announced a strategic pivot from acquisition to retention at their all-hands. She's meeting with vendors her CMO recommended. She's smart, impatient, and thinks in terms of unit economics and customer lifetime value. This is a 15-minute slot.",
    objection: "We just shifted our entire company strategy from acquisition to retention. I need to know — concretely — how you fit into that and what the first 90 days look like. Don't give me a sales pitch.", difficulty: 'standard' },
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
