/**
 * V5 Simulation Arcs
 *
 * Curated multi-turn conversation flow templates for Friday simulation sessions.
 * Each arc tests 2-3 skills across 3 turns, grounded in the existing KI foundation.
 */

import type { SkillFocus } from '../scenarios';
import type { PressureProfile } from '../v4/pressureModel';

// ── Types ─────────────────────────────────────────────────────────

export type BuyerMoveType =
  | 'initial_prompt'
  | 'pushback'
  | 'clarification_request'
  | 'objection'
  | 'stakeholder_tension'
  | 'close_pressure';

export interface SimulationTurnTemplate {
  turnIndex: number;
  buyerMoveType: BuyerMoveType;
  buyerMessage: string;
  /** Alternate buyer message used when rep scored >= 70 on prior turn */
  buyerMessageStrong?: string;
  testsSkills: SkillFocus[];
  expectedFocusPatterns?: string[];
}

export interface SimulationArc {
  id: string;
  title: string;
  setup: string;
  anchor: 'executive_roi_mixed';
  stage: 'foundation' | 'integration' | 'enterprise';
  skillChain: SkillFocus[];
  turns: SimulationTurnTemplate[];
  targetOutcomes: string[];
  difficulty: 'foundational' | 'intermediate' | 'advanced';
  /** Primary KI focus pattern — used to link to real KIs */
  primaryFocusPattern: string;
  /** Secondary focus pattern (optional) */
  secondaryFocusPattern?: string;
}

// ── Curated Friday Arcs ───────────────────────────────────────────

export const SIMULATION_ARCS: SimulationArc[] = [
  // ── 1. Executive Discovery → ROI Challenge ──
  {
    id: 'arc-exec-discovery-roi',
    title: 'Executive Discovery → ROI Challenge',
    setup: 'You\'re 10 minutes into a first call with the VP of E-Commerce at a $40M DTC brand. They took the meeting because their CEO mentioned retention at the last board meeting. The VP is skeptical but willing to listen.',
    anchor: 'executive_roi_mixed',
    stage: 'integration',
    skillChain: ['discovery', 'executive_response', 'deal_control'],
    turns: [
      {
        turnIndex: 0,
        buyerMoveType: 'initial_prompt',
        buyerMessage: "So our CEO wants us to look at retention tools. Honestly, I think our email is fine — we do about 22% of revenue from it. What exactly would change?",
        testsSkills: ['discovery'],
        expectedFocusPatterns: ['deepen_one_level', 'quantify_the_pain'],
      },
      {
        turnIndex: 1,
        buyerMoveType: 'pushback',
        buyerMessage: "Ok, I hear you on the upside. But our team is three people and we just launched a new site. I can't justify pulling them off revenue-generating work for a platform migration. What's the ROI case that would make my CEO say 'do this now'?",
        buyerMessageStrong: "That's a good point. But I need to bring something concrete to my CEO. She's going to ask me 'what's the dollar impact in the first 90 days?' — what do I tell her?",
        testsSkills: ['executive_response'],
        expectedFocusPatterns: ['lead_with_the_number', 'cut_to_three_sentences'],
      },
      {
        turnIndex: 2,
        buyerMoveType: 'close_pressure',
        buyerMessage: "Alright, this is interesting. But I've got three other vendors reaching out and my Q3 planning starts in two weeks. I'm not going to be able to evaluate everyone. What do you want me to do next?",
        buyerMessageStrong: "Ok, I'm interested enough to keep talking. But I need to know — what does the next step actually look like? I don't have bandwidth for a 6-meeting eval cycle.",
        testsSkills: ['deal_control'],
        expectedFocusPatterns: ['control_next_step', 'lock_mutual_commitment'],
      },
    ],
    targetOutcomes: ['Earned the right to a technical review', 'Quantified ROI clearly', 'Locked a concrete next step'],
    difficulty: 'intermediate',
    primaryFocusPattern: 'lead_with_the_number',
    secondaryFocusPattern: 'control_next_step',
  },

  // ── 2. Pricing Objection → Next-Step Control ──
  {
    id: 'arc-pricing-next-step',
    title: 'Pricing Objection → Deal Control',
    setup: 'You\'re in the final evaluation stage with a Director of Marketing at a $25M fashion brand. They loved the demo, the team is aligned, but procurement just came back with a competing quote that\'s 35% cheaper.',
    anchor: 'executive_roi_mixed',
    stage: 'integration',
    skillChain: ['objection_handling', 'executive_response', 'deal_control'],
    turns: [
      {
        turnIndex: 0,
        buyerMoveType: 'objection',
        buyerMessage: "Look, I like your platform. But procurement is pushing hard on the other vendor — they're 35% cheaper and the feature list looks similar on paper. I need you to help me justify the gap or I have to go with the lower bid.",
        testsSkills: ['objection_handling'],
        expectedFocusPatterns: ['reframe_to_business_impact', 'use_specific_proof'],
      },
      {
        turnIndex: 1,
        buyerMoveType: 'stakeholder_tension',
        buyerMessage: "I hear you on the value. But my CFO doesn't care about 'better segmentation' — she cares about payback period. And she's already approved the lower number. I'd have to go back and ask for more budget. How do I make that case?",
        buyerMessageStrong: "That's helpful. My CFO is going to want to see this in writing though. She approved the other vendor's number already. What specifically should I put in front of her to reopen this?",
        testsSkills: ['executive_response'],
        expectedFocusPatterns: ['lead_with_the_number'],
      },
      {
        turnIndex: 2,
        buyerMoveType: 'close_pressure',
        buyerMessage: "Fine. I'll try. But I need an answer from you — if I go back to my CFO and she says no, is there any flexibility on your end? And what happens in the meantime? We need to make a decision by end of month.",
        testsSkills: ['deal_control'],
        expectedFocusPatterns: ['lock_mutual_commitment', 'control_next_step'],
      },
    ],
    targetOutcomes: ['Reframed price to value', 'Armed champion with CFO-ready language', 'Maintained deal control without discounting'],
    difficulty: 'advanced',
    primaryFocusPattern: 'reframe_to_business_impact',
    secondaryFocusPattern: 'lock_mutual_commitment',
  },

  // ── 3. Champion Yes, CFO No ──
  {
    id: 'arc-champion-cfo-split',
    title: 'Champion Says Yes, CFO Says No',
    setup: 'Your champion (Director of CRM) has been an internal advocate for 6 weeks. Technical eval passed. The team wants to move forward. Yesterday she called to say the CFO blocked the purchase during budget review, citing "unclear ROI on a new platform."',
    anchor: 'executive_roi_mixed',
    stage: 'enterprise',
    skillChain: ['executive_response', 'deal_control', 'objection_handling'],
    turns: [
      {
        turnIndex: 0,
        buyerMoveType: 'stakeholder_tension',
        buyerMessage: "I'm really frustrated. My team wants this, I want this, but the CFO said 'show me the math or it's dead.' She hasn't seen a demo. She just sees the line item. What do we do?",
        testsSkills: ['executive_response', 'deal_control'],
        expectedFocusPatterns: ['lead_with_the_number', 'lock_mutual_commitment'],
      },
      {
        turnIndex: 1,
        buyerMoveType: 'clarification_request',
        buyerMessage: "Ok so you're saying we should try to get a CFO meeting. But she's going to ask me point-blank: 'what does this replace and what's the payback?' I need to be able to answer that in two sentences or she'll shut it down.",
        buyerMessageStrong: "That makes sense. Can you help me build the two-sentence version? If I can answer her question in the hallway, she might agree to the meeting.",
        testsSkills: ['executive_response'],
        expectedFocusPatterns: ['cut_to_three_sentences', 'lead_with_the_number'],
      },
      {
        turnIndex: 2,
        buyerMoveType: 'close_pressure',
        buyerMessage: "Alright, I'll try to get the meeting. But she's only going to give us 20 minutes and she's going to be skeptical. What's your plan for that conversation? Because if it goes badly, this deal is dead and I look bad.",
        testsSkills: ['deal_control'],
        expectedFocusPatterns: ['control_next_step'],
      },
    ],
    targetOutcomes: ['Armed champion with CFO-ready language', 'Secured path to executive meeting', 'Protected champion\'s credibility'],
    difficulty: 'advanced',
    primaryFocusPattern: 'lead_with_the_number',
    secondaryFocusPattern: 'control_next_step',
  },

  // ── 4. Late-Stage Delay / Stall ──
  {
    id: 'arc-late-stage-stall',
    title: 'Late-Stage Deal Stall',
    setup: 'A $95K deal with a mid-market retailer ($30M revenue) was supposed to close last Friday. Legal redlines came back clean. The champion went dark for 4 days. She just responded to your follow-up with a vague text.',
    anchor: 'executive_roi_mixed',
    stage: 'integration',
    skillChain: ['deal_control', 'discovery', 'objection_handling'],
    turns: [
      {
        turnIndex: 0,
        buyerMoveType: 'initial_prompt',
        buyerMessage: "Hey — sorry I went quiet. Things got hectic internally. We're still interested, I just need a bit more time. Can we push the start date to next quarter?",
        testsSkills: ['deal_control'],
        expectedFocusPatterns: ['test_before_accepting', 'control_next_step'],
      },
      {
        turnIndex: 1,
        buyerMoveType: 'pushback',
        buyerMessage: "It's not that anything changed. It's just — we had a reorg announcement and my VP wants to 'reassess all vendor commitments.' I still want to do this, but I can't sign anything until he gives the green light.",
        buyerMessageStrong: "Fair question. Honestly, my new VP wants to review all in-flight vendor deals. He hasn't said no — he just wants to understand what he's inheriting. I think if I position it right, he'll approve it.",
        testsSkills: ['discovery'],
        expectedFocusPatterns: ['deepen_one_level', 'quantify_the_pain'],
      },
      {
        turnIndex: 2,
        buyerMoveType: 'close_pressure',
        buyerMessage: "I appreciate you being patient. What can I bring to my VP that makes this easy for him to approve? He's new and he's going to want to look smart on this decision.",
        testsSkills: ['objection_handling', 'deal_control'],
        expectedFocusPatterns: ['reframe_to_business_impact', 'lock_mutual_commitment'],
      },
    ],
    targetOutcomes: ['Diagnosed real reason for stall', 'Maintained urgency without being pushy', 'Created path to new stakeholder'],
    difficulty: 'intermediate',
    primaryFocusPattern: 'test_before_accepting',
    secondaryFocusPattern: 'deepen_one_level',
  },

  // ── 5. Competitive Pressure in Live Flow ──
  {
    id: 'arc-competitive-pressure',
    title: 'Competitive Pressure in Live Flow',
    setup: 'You\'re in a second call with a Sr. Director of Growth at a beauty brand ($18M ARR). The demo went well last week. She just told you they\'re also evaluating your main competitor and have a demo with them tomorrow.',
    anchor: 'executive_roi_mixed',
    stage: 'integration',
    skillChain: ['objection_handling', 'discovery', 'deal_control'],
    turns: [
      {
        turnIndex: 0,
        buyerMoveType: 'objection',
        buyerMessage: "Before we go further — I want to be transparent. We have a demo with [Competitor] tomorrow. Their pricing came in lower and they have a case study from our industry. I don't want to waste your time if you can't compete on price.",
        testsSkills: ['objection_handling'],
        expectedFocusPatterns: ['isolate_before_answering', 'use_specific_proof'],
      },
      {
        turnIndex: 1,
        buyerMoveType: 'clarification_request',
        buyerMessage: "Ok, so help me understand — if price isn't the only factor, what should I actually be evaluating in their demo tomorrow? What questions should I be asking them that would reveal the gap you're talking about?",
        buyerMessageStrong: "That's useful. Actually — can you give me 2-3 specific questions I should ask them tomorrow? If there really is a gap, I want to see it for myself.",
        testsSkills: ['discovery', 'objection_handling'],
        expectedFocusPatterns: ['use_specific_proof'],
      },
      {
        turnIndex: 2,
        buyerMoveType: 'close_pressure',
        buyerMessage: "Alright, I'll use those. But I need to make a decision by Friday. What's the fastest path to me having enough information to choose? I don't want a month-long evaluation.",
        testsSkills: ['deal_control'],
        expectedFocusPatterns: ['control_next_step', 'lock_mutual_commitment'],
      },
    ],
    targetOutcomes: ['Reframed competitive conversation', 'Armed buyer with evaluation criteria', 'Compressed evaluation timeline'],
    difficulty: 'intermediate',
    primaryFocusPattern: 'use_specific_proof',
    secondaryFocusPattern: 'control_next_step',
  },

  // ── 6. Ambiguous Executive Conversation ──
  {
    id: 'arc-ambiguous-executive',
    title: 'Ambiguous Executive Conversation',
    setup: 'You got pulled into a call with the CEO of a $60M retailer. Your champion (VP of Marketing) set it up but warned you: "She\'s going to be vague and noncommittal. Don\'t try to sell her — try to get her to tell you what she actually cares about."',
    anchor: 'executive_roi_mixed',
    stage: 'enterprise',
    skillChain: ['executive_response', 'discovery', 'deal_control'],
    turns: [
      {
        turnIndex: 0,
        buyerMoveType: 'initial_prompt',
        buyerMessage: "Sarah said I should take this call. I've got about 15 minutes. I know you do email and retention stuff. We're looking at a lot of things right now. What should I know?",
        testsSkills: ['executive_response'],
        expectedFocusPatterns: ['cut_to_three_sentences', 'lead_with_the_number'],
      },
      {
        turnIndex: 1,
        buyerMoveType: 'clarification_request',
        buyerMessage: "Hmm. Interesting. So what does 'better retention' actually mean for a business like ours? We've been growing 25% YoY on acquisition alone. Why should I care about retention right now?",
        buyerMessageStrong: "Ok, that number got my attention. But I need to understand — is this a 'nice to have' or is this something that changes our growth trajectory? Because I have five other initiatives competing for the same dollars.",
        testsSkills: ['discovery', 'executive_response'],
        expectedFocusPatterns: ['quantify_the_pain', 'lead_with_the_number'],
      },
      {
        turnIndex: 2,
        buyerMoveType: 'close_pressure',
        buyerMessage: "Look, you clearly know this space. But I'm not going to commit to anything today. What would you need from me to keep this moving without me having to personally drive it?",
        testsSkills: ['deal_control'],
        expectedFocusPatterns: ['control_next_step'],
      },
    ],
    targetOutcomes: ['Earned executive attention in under 3 sentences', 'Connected retention to growth strategy', 'Secured exec sponsorship without over-asking'],
    difficulty: 'advanced',
    primaryFocusPattern: 'cut_to_three_sentences',
    secondaryFocusPattern: 'lead_with_the_number',
  },

  // ── 7. Multi-Thread: Technical + Business Misalignment ──
  {
    id: 'arc-tech-business-misalign',
    title: 'Technical & Business Stakeholder Misalignment',
    setup: 'You\'re on a call with both the Director of Marketing and the Head of Engineering at a $20M DTC brand. Marketing loves your platform. Engineering is skeptical about the integration effort and wants to build in-house.',
    anchor: 'executive_roi_mixed',
    stage: 'enterprise',
    skillChain: ['objection_handling', 'executive_response', 'deal_control'],
    turns: [
      {
        turnIndex: 0,
        buyerMoveType: 'stakeholder_tension',
        buyerMessage: "[Marketing Director] We really want this. [Head of Eng] I've looked at your API docs. We could build 80% of this ourselves in a quarter. Why would we pay for something we can build?",
        testsSkills: ['objection_handling'],
        expectedFocusPatterns: ['reframe_to_business_impact', 'use_specific_proof'],
      },
      {
        turnIndex: 1,
        buyerMoveType: 'pushback',
        buyerMessage: "[Head of Eng] Fine, maybe it saves some dev time. But the integration still takes my team off our product roadmap for 3 weeks. [Marketing Director] And I need this live before holiday season. Can both of those things be true?",
        buyerMessageStrong: "[Head of Eng] Ok, the build vs buy math makes sense. But I need to know — what does integration actually look like? My team has been burned by vendors who say '2 weeks' and mean '2 months.' [Marketing Director] And I need to know we'll be live by October.",
        testsSkills: ['executive_response', 'objection_handling'],
        expectedFocusPatterns: ['cut_to_three_sentences', 'use_specific_proof'],
      },
      {
        turnIndex: 2,
        buyerMoveType: 'close_pressure',
        buyerMessage: "[Marketing Director] Ok, I want to move forward. [Head of Eng] I'm willing to do a technical review, but I'm not committing eng resources until I see a real integration plan. What's the next step that works for both of us?",
        testsSkills: ['deal_control'],
        expectedFocusPatterns: ['lock_mutual_commitment', 'control_next_step'],
      },
    ],
    targetOutcomes: ['Aligned both stakeholders', 'Reframed build vs buy', 'Locked joint next step'],
    difficulty: 'advanced',
    primaryFocusPattern: 'reframe_to_business_impact',
    secondaryFocusPattern: 'lock_mutual_commitment',
  },

  // ── 8. Renewal Risk: Champion Left ──
  {
    id: 'arc-renewal-champion-left',
    title: 'Renewal at Risk — Champion Left',
    setup: 'Your champion at a $50K ARR account just left the company. The new VP of Marketing has no context on your platform. Renewal is in 45 days. She agreed to a 20-minute intro call.',
    anchor: 'executive_roi_mixed',
    stage: 'integration',
    skillChain: ['discovery', 'executive_response', 'deal_control'],
    turns: [
      {
        turnIndex: 0,
        buyerMoveType: 'initial_prompt',
        buyerMessage: "So I inherited this contract. I don't really know what your platform does or why we have it. My team says they use it but I haven't looked at the numbers. Honestly, I'm evaluating everything I inherited. Convince me this is worth keeping.",
        testsSkills: ['discovery', 'executive_response'],
        expectedFocusPatterns: ['deepen_one_level', 'lead_with_the_number'],
      },
      {
        turnIndex: 1,
        buyerMoveType: 'pushback',
        buyerMessage: "Ok those numbers are interesting, but I've seen vendors cherry-pick metrics before. How do I know this isn't just correlation? And frankly, $50K is a lot for something my team might be able to do with our existing tools.",
        buyerMessageStrong: "Those numbers are solid if they're real. Can you show me a before/after comparison for our specific account? And walk me through what my team would lose if we downgraded to our existing tools?",
        testsSkills: ['objection_handling', 'executive_response'],
        expectedFocusPatterns: ['use_specific_proof', 'reframe_to_business_impact'],
      },
      {
        turnIndex: 2,
        buyerMoveType: 'close_pressure',
        buyerMessage: "Alright. I need to make a renewal decision in the next 3 weeks. What do you recommend we do between now and then so I can make an informed call?",
        testsSkills: ['deal_control'],
        expectedFocusPatterns: ['control_next_step', 'lock_mutual_commitment'],
      },
    ],
    targetOutcomes: ['Re-established value with new stakeholder', 'Used account-specific proof', 'Locked renewal path'],
    difficulty: 'intermediate',
    primaryFocusPattern: 'lead_with_the_number',
    secondaryFocusPattern: 'use_specific_proof',
  },

  // ── 9. Expansion Blocked by Procurement ──
  {
    id: 'arc-expansion-procurement',
    title: 'Expansion Blocked by Procurement',
    setup: 'Your champion wants to expand from $50K to $120K ARR by adding SMS and loyalty. Business case is strong. But procurement flagged the expansion as a "new purchase" requiring a full RFP process and competitive bids.',
    anchor: 'executive_roi_mixed',
    stage: 'enterprise',
    skillChain: ['deal_control', 'objection_handling', 'executive_response'],
    turns: [
      {
        turnIndex: 0,
        buyerMoveType: 'stakeholder_tension',
        buyerMessage: "I'm stuck. Procurement is treating this like a new deal even though we're already a customer. They want me to run an RFP and get three competitive bids. That'll take 8 weeks minimum and I need this live for holiday. What do we do?",
        testsSkills: ['deal_control'],
        expectedFocusPatterns: ['control_next_step', 'lock_mutual_commitment'],
      },
      {
        turnIndex: 1,
        buyerMoveType: 'clarification_request',
        buyerMessage: "Ok, so you think we can position it as an amendment rather than a new purchase. What do I specifically say to procurement to make that case? They're pretty rigid about process.",
        buyerMessageStrong: "That's a good angle. Can you draft the language I'd need to send to procurement? If I can frame it correctly, my VP might be able to fast-track it.",
        testsSkills: ['objection_handling', 'executive_response'],
        expectedFocusPatterns: ['reframe_to_business_impact'],
      },
      {
        turnIndex: 2,
        buyerMoveType: 'close_pressure',
        buyerMessage: "I'll try the amendment path. But if procurement still says no, I need a backup plan. And I need to know — if we delay to Q1, does pricing change? Because I have budget now that I might not have later.",
        testsSkills: ['deal_control'],
        expectedFocusPatterns: ['lock_mutual_commitment', 'name_the_risk'],
      },
    ],
    targetOutcomes: ['Reframed expansion as amendment', 'Armed champion with procurement language', 'Created urgency without pressure'],
    difficulty: 'advanced',
    primaryFocusPattern: 'lock_mutual_commitment',
    secondaryFocusPattern: 'reframe_to_business_impact',
  },

  // ── 10. Discovery Under Time Pressure ──
  {
    id: 'arc-discovery-time-pressure',
    title: 'Discovery Under Time Pressure',
    setup: 'You have a 15-minute call with a VP of Growth at a $35M DTC brand. She moved the meeting from 30 minutes to 15 this morning. She\'s clearly busy but took the call because a board member recommended you.',
    anchor: 'executive_roi_mixed',
    stage: 'foundation',
    skillChain: ['executive_response', 'discovery', 'deal_control'],
    turns: [
      {
        turnIndex: 0,
        buyerMoveType: 'initial_prompt',
        buyerMessage: "Hey, I only have 15 minutes so let's be quick. David from our board said I should look at you. What do you do and why should I care?",
        testsSkills: ['executive_response'],
        expectedFocusPatterns: ['cut_to_three_sentences'],
      },
      {
        turnIndex: 1,
        buyerMoveType: 'pushback',
        buyerMessage: "Ok that's interesting. But I just signed a 2-year deal with our current provider 4 months ago. So even if I wanted to switch, I couldn't right now. Why would I keep talking to you?",
        buyerMessageStrong: "Interesting. We did just sign a new contract, but it's not performing as well as we hoped. If I'm being honest, I'm not sure we made the right choice. What would you need to know to tell me whether it's worth exploring?",
        testsSkills: ['discovery', 'objection_handling'],
        expectedFocusPatterns: ['deepen_one_level'],
      },
      {
        turnIndex: 2,
        buyerMoveType: 'close_pressure',
        buyerMessage: "Look, my next meeting starts in 3 minutes. If there's something here, tell me what the next step is and I'll have my team follow up. But it needs to be simple.",
        testsSkills: ['deal_control'],
        expectedFocusPatterns: ['control_next_step'],
      },
    ],
    targetOutcomes: ['Earned attention in under 30 seconds', 'Opened door despite existing contract', 'Secured next step under time pressure'],
    difficulty: 'foundational',
    primaryFocusPattern: 'cut_to_three_sentences',
    secondaryFocusPattern: 'control_next_step',
  },
];

// ── Helpers ───────────────────────────────────────────────────────

/** Get arcs suitable for a given stage */
export function getArcsForStage(stage: 'foundation' | 'integration' | 'enterprise'): SimulationArc[] {
  const stageOrder = { foundation: 0, integration: 1, enterprise: 2 };
  return SIMULATION_ARCS.filter(a => stageOrder[a.stage] <= stageOrder[stage]);
}

/** Get a specific arc by ID */
export function getArcById(id: string): SimulationArc | undefined {
  return SIMULATION_ARCS.find(a => a.id === id);
}

/** Get the buyer message for a turn, optionally adapting based on prior performance */
export function getBuyerMessage(turn: SimulationTurnTemplate, priorTurnScore?: number): string {
  if (turn.buyerMessageStrong && priorTurnScore !== undefined && priorTurnScore >= 70) {
    return turn.buyerMessageStrong;
  }
  return turn.buyerMessage;
}
