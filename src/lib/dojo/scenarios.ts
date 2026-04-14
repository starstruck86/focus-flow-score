export type SkillFocus = 'objection_handling' | 'discovery' | 'executive_response' | 'deal_control' | 'qualification';

export interface DojoScenario {
  id: string;
  skillFocus: SkillFocus;
  title: string;
  context: string;
  objection: string;
  difficulty: 'foundational' | 'intermediate' | 'advanced';
}

export interface SkillStat {
  skill: SkillFocus;
  count: number;
  avgScore: number;
  /** Average score of first attempts only (turn_index = 0) */
  avgFirstAttempt: number;
  recentFirstAttempts: number[];
}

export const SCENARIOS: DojoScenario[] = [
  // ── Objection Handling ──────────────────────────────────────────────
  { id: 'oh-1', skillFocus: 'objection_handling', title: 'Incumbent loyalty',
    context: "You're mid-discovery with a VP of Marketing at a DTC skincare brand doing $12M ARR. They've used Braze for 2 years, renewed 3 months ago, and their lifecycle team of 4 built all automations in Braze. The VP personally championed the Braze deal.",
    objection: "We just renewed Braze three months ago and my team built everything in it. I'm not ripping that out.", difficulty: 'intermediate' },

  { id: 'oh-2', skillFocus: 'objection_handling', title: 'Budget freeze',
    context: "You're in final stages with a Director of E-Commerce at a PE-backed fashion brand ($20M revenue). She got VP sign-off, and the $95K proposal is on her desk. Yesterday, the CFO froze all discretionary spend for Q2 after a revenue miss. She texted you this morning.",
    objection: "My CFO just froze everything. I literally cannot get a PO signed until July at the earliest. My hands are tied.", difficulty: 'intermediate' },

  { id: 'oh-3', skillFocus: 'objection_handling', title: 'The brush-off stall',
    context: "First call with a VP of CRM at a 200-person home goods retailer. She took the call because her CEO forwarded your email after a board meeting about retention. She's been polite but guarded — one-word answers to your first two questions. She's clearly multitasking.",
    objection: "Yeah, this is interesting. Can you just send me a deck or something? I'll pass it around internally.", difficulty: 'intermediate' },

  { id: 'oh-4', skillFocus: 'objection_handling', title: 'No bandwidth to implement',
    context: "Director of Lifecycle at a DTC supplements brand ($8M ARR). Team of 3 managing email, SMS, loyalty, and reviews across 4 tools. They lost their senior lifecycle manager last month and haven't backfilled. She's doing the work of two people.",
    objection: "I believe it's better, but I cannot ask my team to implement another platform right now. We're barely keeping the lights on.", difficulty: 'intermediate' },

  { id: 'oh-5', skillFocus: 'objection_handling', title: 'Competitor is 40% cheaper',
    context: "Enterprise retail company ($150M revenue) evaluating 3 vendors in final round. Procurement has been transparent: your competitor quoted 40% less for what they see as equivalent functionality. The Director of Marketing likes your product but can't justify the gap to her CFO.",
    objection: "Look, I like your product. But Klaviyo quoted us $110K and you're at $180K. My CFO is going to ask me why, and 'it's a better experience' isn't going to cut it.", difficulty: 'intermediate' },

  { id: 'oh-6', skillFocus: 'objection_handling', title: 'Burned by last vendor',
    context: "VP of Digital at a $50M outdoor apparel brand. Two years ago they bought a competing platform, spent 6 months implementing, and never got adoption. The project was killed, the VP who led it was fired, and the team is deeply skeptical of vendor promises. This VP inherited the mess.",
    objection: "The last time we did this it cost us $200K, six months, and a VP. My team will mutiny if I bring in another platform that promises the same thing.", difficulty: 'intermediate' },

  { id: 'oh-7', skillFocus: 'objection_handling', title: 'Post-demo stall',
    context: "You just finished a strong demo with a Sr. Director of Growth at a beauty brand ($18M ARR). She was engaged — asked about segmentation, leaned in during the AI section, said 'this is really impressive.' You proposed a technical review with her team next Tuesday.",
    objection: "This is great, I just need some time to think about it. Let me circle back in a couple weeks after our planning cycle wraps.", difficulty: 'intermediate' },

  { id: 'oh-8', skillFocus: 'objection_handling', title: 'Build vs. buy',
    context: "Head of Engineering at a $30M ecomm company. Their marketing team asked for a tool like yours, but the eng team is confident they can replicate core functionality using their existing Snowflake warehouse, a few APIs, and a React dashboard. They've already scoped it at one quarter of work.",
    objection: "We're going to build this in-house. My team already scoped it — we can get 80% of what you do in about 3 months using our own data warehouse.", difficulty: 'intermediate' },

  // ── Discovery ───────────────────────────────────────────────────────
  { id: 'd-1', skillFocus: 'discovery', title: 'Surface pain — won\'t go deeper',
    context: "First discovery call with a Sr. Manager of Retention at a DTC skincare brand ($6M revenue). She mentioned churn is a problem but immediately pivoted to asking about your segmentation features. She's treating this like a vendor demo, not a business conversation.",
    objection: "Yeah, churn's been up. Anyway — can you walk me through your segmentation? That's really what I want to see.", difficulty: 'intermediate' },

  { id: 'd-2', skillFocus: 'discovery', title: 'No urgency — "nice to have"',
    context: "Second call with Director of Growth at a $15M ecomm brand. They did a demo last week and said it was 'cool.' No timeline exists, no project is defined, no budget is allocated. Their current tool (Mailchimp) is 'fine.' They took this call because they had a free slot.",
    objection: "Honestly, this is more of a nice-to-have for us right now. We've got bigger fires. Maybe next quarter.", difficulty: 'intermediate' },

  { id: 'd-3', skillFocus: 'discovery', title: 'Vague buying process',
    context: "Twenty minutes into a strong discovery with a Sr. Director of CRM at a $40M health & wellness brand. She's sharing real pain — poor SMS ROI, no lifecycle attribution, manual reporting. But every time you ask about decision process, timeline, or who else is involved, she deflects or goes vague.",
    objection: "I'll just run this by my boss and see what she thinks. We don't really have a formal process for this kind of thing.", difficulty: 'intermediate' },

  { id: 'd-4', skillFocus: 'discovery', title: 'Unquantified impact',
    context: "Discovery with Head of CRM at a multi-brand retail company ($80M revenue across 3 brands). They want 'better engagement' but can't say what improvement means in revenue. When you asked about current metrics, they said open rates are 'around 18%' and click rates are 'low.' No revenue attribution exists.",
    objection: "We just want to improve our email engagement rates. They've been flat for about a year. We don't really track revenue per email — that's something we want to get better at.", difficulty: 'intermediate' },

  { id: 'd-5', skillFocus: 'discovery', title: 'Enthusiast with no power',
    context: "Discovery with a Marketing Manager at a $10M DTC food brand. She's watched your webinar, follows your company on LinkedIn, and loves your product. But she has no budget authority, hasn't mentioned this to her VP, and doesn't know what the buying process would look like. She wants pricing.",
    objection: "This is exactly what we need! I've been wanting something like this for months. What's pricing look like? I want to put together a quick business case.", difficulty: 'intermediate' },

  { id: 'd-6', skillFocus: 'discovery', title: 'Competitor comparison as deflection',
    context: "First call with Director of Marketing at a $25M fashion retailer. Instead of answering discovery questions, she keeps redirecting to a Klaviyo comparison. She's already using Klaviyo and likes it — she's evaluating you because her CEO told her to look at alternatives after a board meeting.",
    objection: "Can you just tell me how you're different from Klaviyo? That's all I really need. We're happy with them — I'm just doing my due diligence.", difficulty: 'intermediate' },

  { id: 'd-7', skillFocus: 'discovery', title: 'Multi-stakeholder complexity',
    context: "Discovery with a Director of E-commerce at a $60M CPG brand. She's interested but keeps referencing other teams — IT needs to approve integrations, Finance controls budget, and the CMO has final say. She doesn't seem confident she can champion this alone.",
    objection: "I think this could work, but honestly, I'd need to get IT, Finance, and my CMO aligned. It's a whole process here. I'm not sure how to even start that.", difficulty: 'intermediate' },

  // ── Executive Response ──────────────────────────────────────────────
  { id: 'ex-1', skillFocus: 'executive_response', title: 'CMO wants 30-second version',
    context: "You get pulled into a meeting with the CMO of a $100M DTC brand. She walked in late, has 4 minutes before her next call, and is checking her phone. Your champion introduced you as 'the vendor I mentioned for our retention problem.' She hasn't seen a demo or any materials.",
    objection: "Give me the 30-second version. Why should I care?", difficulty: 'intermediate' },

  { id: 'ex-2', skillFocus: 'executive_response', title: 'CFO wants payback math',
    context: "CFO joins the final call at a PE-backed beauty brand ($35M revenue). He wasn't in any prior meetings. He has the $180K proposal open on his screen and is looking at the pricing page. The room goes quiet and everyone looks at him.",
    objection: "Walk me through the payback period. I need to see 3x ROI in year one or this doesn't clear our investment committee. What's your math?", difficulty: 'intermediate' },

  { id: 'ex-3', skillFocus: 'executive_response', title: 'CEO in cost-cutting mode',
    context: "CEO of a PE-backed supplements brand ($50M revenue) in a profitability review quarter. She's cut headcount 15% and eliminated 3 tools already. Your champion positioned your product as a growth investment, but the CEO has explicitly said 'no growth bets this year.'",
    objection: "We're not spending on growth right now. Everything I approve has to protect margin or reduce cost. Tell me why this isn't just another expense.", difficulty: 'intermediate' },

  { id: 'ex-4', skillFocus: 'executive_response', title: 'VP needs board-ready pitch',
    context: "Your champion's VP of Marketing calls you directly. She presents to the board in 48 hours. She has 1 slide and 60 seconds. The board cares about two things: customer LTV and CAC efficiency. She needs your help making the case.",
    objection: "I'm presenting to the board Thursday morning. I have one slide. Tell me exactly what I should say to make this a no-brainer — keep it under a minute.", difficulty: 'intermediate' },

  { id: 'ex-5', skillFocus: 'executive_response', title: 'CRO is a category skeptic',
    context: "CRO of a $200M retail company with 20 years in the industry. He's been pitched by companies like yours many times. He doesn't believe your product category moves the needle — he thinks it's 'marketing fluff that doesn't impact pipeline.' He agreed to 10 minutes because his VP insisted.",
    objection: "I've heard this pitch a dozen times from companies that look just like yours. None of them moved the needle. You've got 2 minutes — what's actually different?", difficulty: 'intermediate' },

  { id: 'ex-6', skillFocus: 'executive_response', title: 'CEO pivoting strategy',
    context: "CEO of a $70M ecomm company just announced a strategic pivot from acquisition to retention at their all-hands. She's meeting with vendors her CMO recommended. She's smart, impatient, and thinks in terms of unit economics and customer lifetime value. This is a 15-minute slot.",
    objection: "We just shifted our entire company strategy from acquisition to retention. I need to know — concretely — how you fit into that and what the first 90 days look like. Don't give me a sales pitch.", difficulty: 'intermediate' },

  { id: 'ex-7', skillFocus: 'executive_response', title: 'Board pressure — justify the line item',
    context: "The CEO of a $120M ecomm company pulls you into an unscheduled call. The board just challenged every SaaS line item over $100K. Your $165K contract is on the cut list. The CEO isn't hostile — she's under pressure and needs ammunition to defend the spend. She has 3 minutes before her next board prep session.",
    objection: "My board is asking me to justify every dollar over $100K. You're at $165K. In two sentences — why should I fight for this line item instead of cutting it?", difficulty: 'advanced' },

  { id: 'ex-8', skillFocus: 'executive_response', title: 'CFO ROI pushback — "show me the math"',
    context: "CFO of a PE-backed fashion brand ($85M revenue). He's been in the role 4 months, inherited a bloated tech stack, and has already killed 2 vendor contracts. He opens the call by sliding your proposal across the table. He doesn't do small talk.",
    objection: "We've spent $2M on tools like this already. None of them delivered what they promised. You have 20 seconds — tell me why this is different and give me actual numbers, not marketing math.", difficulty: 'advanced' },

  { id: 'ex-9', skillFocus: 'executive_response', title: 'CEO impatience — "get to the point"',
    context: "CEO of a $200M multi-brand retailer. She took this call as a favor to your champion, who she trusts. She's checking Slack on her phone, has already glanced at the clock twice, and interrupted your champion's introduction. She runs a company with 1,200 employees and processes information in headlines.",
    objection: "I've got about 90 seconds. My VP says you're important. I don't know why yet. Go.", difficulty: 'advanced' },

  { id: 'ex-10', skillFocus: 'executive_response', title: '"Heard this before" skepticism',
    context: "SVP of Digital at a $300M department store chain. She's evaluated 6 vendors in your category over 3 years and bought two — both underdelivered. She was burned on a $400K implementation that took 9 months and never hit adoption targets. She speaks slowly, asks precise questions, and trusts nothing she can't verify.",
    objection: "Every company in your space says the same three things: 'AI-powered,' 'easy to implement,' 'proven ROI.' The last two vendors told me that too. One cost me $400K and a year of my team's time. What makes you any different — and don't give me a case study from a company that looks nothing like mine.", difficulty: 'advanced' },

  { id: 'ex-11', skillFocus: 'executive_response', title: 'Strategic misalignment — wrong priority',
    context: "COO of a $90M DTC wellness brand. The company just closed a Series D and the board mandate is aggressive international expansion — not retention optimization. Your champion in marketing positioned your tool as a retention play, but the COO controls budget and doesn't see how retention fits the current 18-month plan. He's direct and analytical.",
    objection: "I appreciate the meeting, but I think there's a disconnect. We're laser-focused on international expansion right now. Retention is a 2027 initiative for us. Convince me this matters now, or we're done.", difficulty: 'advanced' },

  // ── Deal Control ────────────────────────────────────────────────────
  { id: 'dc-1', skillFocus: 'deal_control', title: 'Champion goes dark after demo',
    context: "You ran a strong demo 10 days ago with a Director of CRM at a $25M beauty brand. She was engaged, asked great questions, introduced you to her VP on the call. She said she'd set up a technical review that week. Since then — nothing. Two follow-up emails, one voicemail, no response. Your manager is asking for a forecast update.",
    objection: "Hey — sorry I've been slammed. Things got crazy with our product launch. Can we reconnect in a couple weeks? I haven't forgotten about you.", difficulty: 'intermediate' },

  { id: 'dc-2', skillFocus: 'deal_control', title: 'Buyer wants to "circle back next quarter"',
    context: "Third call with VP of Marketing at a $40M outdoor brand. Discovery went well, demo landed, she said 'this makes sense.' But when you proposed a mutual action plan and a decision date, she pushed back. No budget cycle excuse — she just doesn't want to commit.",
    objection: "Look, I like what you've shown me. But we've got a lot going on right now. Let's circle back in Q3 when things calm down and I can give this proper attention.", difficulty: 'intermediate' },

  { id: 'dc-3', skillFocus: 'deal_control', title: 'Procurement hijacks the timeline',
    context: "You have verbal approval from the VP of E-Commerce at a $90M retailer. She sent the proposal to procurement two weeks ago. Since then, procurement has requested a security questionnaire, a 90-day payment term (vs your standard 30), and a 3-year commitment at a 25% discount. Your VP is pressuring you to close this month.",
    objection: "We've sent your proposal to our procurement team. They handle all vendor agreements from here. I'd suggest working directly with them — they'll have some questions about terms.", difficulty: 'intermediate' },

  { id: 'dc-4', skillFocus: 'deal_control', title: 'Evaluation committee wants another demo',
    context: "You're in final stages with a $60M health & wellness company. You've done 2 demos, a technical review, and provided a custom ROI analysis. The Director loves it. Now she tells you the 'evaluation committee' — 4 people you haven't met — wants to see one more demo before making a decision. Your deal has been in pipeline for 67 days.",
    objection: "Great news — the committee wants to see a final demo. Can you do Thursday? They just want to see the SMS and segmentation pieces one more time. I think this will seal it.", difficulty: 'intermediate' },

  { id: 'dc-5', skillFocus: 'deal_control', title: 'Buyer won\'t introduce you to the decision maker',
    context: "Four calls in with a Sr. Manager of Lifecycle at a $35M pet food brand. She's your only contact. She keeps saying her VP 'will be involved at the right time' but won't schedule an intro. She does all her own research and brings recommendations to her VP. Your coach (an industry contact) told you this VP kills 80% of vendor proposals she didn't originate.",
    objection: "I know my VP well. She trusts my recommendations. Let me build the case internally and present it to her. I don't want to bring you in too early — she doesn't like that.", difficulty: 'intermediate' },

  { id: 'dc-6', skillFocus: 'deal_control', title: 'Deal stuck — no defined next step',
    context: "You've had 3 solid meetings with a Director of Growth at a $20M DTC furniture company. Each meeting ends with 'this was really helpful, let me digest this.' No next step has ever been set. No timeline discussed. No other stakeholders surfaced. You're starting to wonder if this is a real opportunity or just research.",
    objection: "This has been super informative. Let me take this back to the team and think about it. I'll reach out when we're ready to take the next step.", difficulty: 'intermediate' },

  { id: 'dc-7', skillFocus: 'deal_control', title: 'Buyer introduces a new competitor late',
    context: "You're in final negotiation with a VP of Digital at a $55M fashion retailer. MSA is drafted, pricing is agreed, and you expected signature this week. In today's call, she casually mentions her CMO asked her to 'also look at' a competitor you've never heard of. She says it's 'just a formality.'",
    objection: "Oh, one thing — my CMO wants us to also look at Ometria before we sign. It's not a big deal, she just wants to check a box. Shouldn't change anything.", difficulty: 'intermediate' },

  { id: 'dc-8', skillFocus: 'deal_control', title: 'Mutual plan agreed but milestones slipping',
    context: "You built a mutual action plan with the Director of CRM at a $45M supplements brand 3 weeks ago. She agreed to complete a technical review by last Friday, share security docs by Monday, and schedule a CFO intro this week. The technical review happened late, security docs haven't been sent, and the CFO intro hasn't been mentioned. She's friendly and responsive but nothing is on track.",
    objection: "I know we're a little behind on the timeline — things just got hectic with our spring launch. We're still on track though, don't worry. Let's just push everything back two weeks.", difficulty: 'intermediate' },

  // ── Qualification ───────────────────────────────────────────────────
  { id: 'q-1', skillFocus: 'qualification', title: 'Enthusiastic but no budget or authority',
    context: "First call with a Marketing Coordinator at a $5M DTC candle company. She's 24, 8 months into the role, incredibly enthusiastic about your product. She watched 3 of your webinars, followed your founder on LinkedIn, and booked this call herself. She has zero budget authority and reports to a Marketing Manager who reports to the founder.",
    objection: "I love this! I've been telling my team we need something like this. I don't have exact budget numbers, but I'm sure we could find room. When can we do a demo for my boss?", difficulty: 'intermediate' },

  { id: 'q-2', skillFocus: 'qualification', title: 'Big company, no defined problem',
    context: "Inbound from a $200M enterprise retailer. A VP of Marketing filled out your contact form. On the call, she's pleasant but vague. When asked what prompted the inquiry, she says 'just exploring options.' No specific problem, no failed project, no upcoming renewal. She has 30 minutes and seems genuinely curious.",
    objection: "We're just doing some market research right now. We're not unhappy with our current setup, but it's always good to know what's out there. Walk me through what you do.", difficulty: 'intermediate' },

  { id: 'q-3', skillFocus: 'qualification', title: 'Real pain but zero urgency',
    context: "Discovery with a Director of E-Commerce at a $30M home goods brand. She clearly articulated that their email program is underperforming — 12% open rates, no lifecycle automation, their team manually segments every send. But when asked about timeline, she said 'no rush.' When asked about consequences of waiting, she said 'we've been living with it.'",
    objection: "Yeah, we know our email program is behind. We've been meaning to fix it for a while. There's no burning platform though — business is fine. We'll get to it eventually.", difficulty: 'intermediate' },

  { id: 'q-4', skillFocus: 'qualification', title: 'Technical buyer with no business case',
    context: "Call with a Sr. Marketing Ops Manager at a $45M ecomm brand. She's extremely technical — asking about API architecture, data models, event schemas. She's done a competitive analysis spreadsheet. But when you ask who else is involved or what problem they're solving for the business, she can't answer. She's evaluating because she wants to — not because anyone asked her to.",
    objection: "Can you send me your API documentation and a sandbox environment? I want to test the integration with our Snowflake warehouse before I bring this to anyone.", difficulty: 'intermediate' },

  { id: 'q-5', skillFocus: 'qualification', title: 'Competitor evaluation as leverage',
    context: "Inbound request from a Sr. Director at a $70M fashion retailer. She's 6 months into a 2-year contract with your biggest competitor. On the call, she's asking detailed pricing and feature questions but being evasive about timeline. Your gut says she's using your proposal to renegotiate her existing deal.",
    objection: "We're evaluating alternatives right now. Can you put together a full proposal with pricing? We want to compare everything side by side. I need it by Friday.", difficulty: 'intermediate' },

  { id: 'q-6', skillFocus: 'qualification', title: 'Decision process is a black box',
    context: "Third call with a VP of Digital at a $50M CPG company. She loves the product, sees the value, and has told you twice that she wants to move forward. But every time you ask about the decision process — who approves, what's the budget cycle, is there a procurement step — she gives a different answer or says 'I'm handling it.' You've never met anyone else from the company.",
    objection: "I told you, I'm the decision maker here. I just need to get my CMO's blessing, which is basically a formality. Don't worry about the process — just get me a proposal and I'll handle the rest.", difficulty: 'intermediate' },

  { id: 'q-7', skillFocus: 'qualification', title: 'Pain exists but wrong buyer',
    context: "Discovery with a Head of Brand at a $40M outdoor gear company. She's sharing real frustration — the lifecycle team is drowning, they're sending batch-and-blast emails, and she knows they're leaving revenue on the table. But lifecycle marketing reports to the VP of Growth, not to her. She has no authority over the budget, team, or tech stack. She's passionate but in the wrong seat.",
    objection: "This is exactly what our lifecycle team needs. I've been pushing for this for months. The problem is, lifecycle reports to our VP of Growth, not me. But I have a lot of influence — I can definitely advocate for this.", difficulty: 'intermediate' },

  { id: 'q-8', skillFocus: 'qualification', title: 'Wants a pilot with no commitment',
    context: "Final stage with a Director of Marketing at a $25M DTC wellness brand. She wants to move forward but proposes a 'no-commitment pilot' — 30 days, no contract, and she'll 'see how it goes.' Your product requires a 2-week implementation and meaningful data integration. A no-commitment pilot would consume significant CS resources with no guarantee of conversion. Your win rate on unpaid pilots is 15%.",
    objection: "Here's what I'm thinking — let's do a 30-day pilot, no contract. If we see results, we'll sign. If not, no hard feelings. That way there's zero risk for us.", difficulty: 'intermediate' },
];

export function getRandomScenario(skillFocus?: SkillFocus): DojoScenario {
  const pool = skillFocus ? SCENARIOS.filter(s => s.skillFocus === skillFocus) : SCENARIOS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export const SKILL_LABELS: Record<SkillFocus, string> = {
  objection_handling: 'Objection Handling',
  discovery: 'Discovery',
  executive_response: 'Executive Response',
  deal_control: 'Deal Control',
  qualification: 'Qualification',
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
  // Deal Control
  vague_next_step: 'Vague next step',
  too_passive: 'Too passive',
  no_mutual_plan: 'No mutual plan',
  accepted_delay: 'Accepted the delay',
  // Qualification
  failed_to_qualify: 'Failed to qualify',
  accepted_weak_pain: 'Accepted weak pain',
  no_urgency: 'Didn\'t test urgency',
  skipped_stakeholders: 'Skipped stakeholder mapping',
  no_disqualification: 'Didn\'t consider disqualifying',
};
