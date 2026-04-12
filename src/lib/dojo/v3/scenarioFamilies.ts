/**
 * V3 Scenario Families
 *
 * 25 benchmark/retest paired scenario sets (5 anchors × 5 families each).
 * Each family has a benchmark scenario (Week 1) and a matched retest scenario (Week 8).
 * Same structural challenge, different surface wording.
 */

import type { DojoScenario } from '../scenarios';
import type { DayAnchor } from './dayAnchors';

export interface ScenarioFamily {
  id: string;
  anchor: DayAnchor;
  title: string;
  benchmarkScenario: DojoScenario;
  retestScenario: DojoScenario;
}

// ── Opening / Cold Call Families ──────────────────────────────────

const COLD_CALL_FAMILIES: ScenarioFamily[] = [
  {
    id: 'sf-cc-pattern-interrupt',
    anchor: 'opening_cold_call',
    title: 'Pattern Interrupt',
    benchmarkScenario: {
      id: 'bm-cc-1', skillFocus: 'objection_handling', title: 'Cold call — VP won\'t listen',
      context: "You're cold calling a VP of Marketing at a $15M DTC skincare brand. She answered the phone but is clearly distracted — you can hear typing. She doesn't know you or your company.",
      objection: "I'm really busy right now, can you email me?", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-cc-1', skillFocus: 'objection_handling', title: 'Cold call — Director brushes off',
      context: "You're cold calling a Director of Growth at a $20M DTC supplements brand. He picked up but sounds impatient. He doesn't recognize your company name.",
      objection: "Not interested, we're all set. Send me something if you want.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-cc-gatekeeper',
    anchor: 'opening_cold_call',
    title: 'Gatekeeper Navigation',
    benchmarkScenario: {
      id: 'bm-cc-2', skillFocus: 'deal_control', title: 'Cold call — assistant blocks',
      context: "You're calling the CMO of a $30M fashion retailer. Her executive assistant answered and is screening calls aggressively.",
      objection: "She's in meetings all day. What is this regarding? I can take a message.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-cc-2', skillFocus: 'deal_control', title: 'Cold call — office manager screens',
      context: "You're calling the VP of E-commerce at a $25M home goods brand. The office manager picked up and is clearly trained to block vendors.",
      objection: "He doesn't take unsolicited calls. You can email info@company.com.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-cc-early-objection',
    anchor: 'opening_cold_call',
    title: 'Early Objection Control',
    benchmarkScenario: {
      id: 'bm-cc-3', skillFocus: 'objection_handling', title: 'Cold call — "we already have a vendor"',
      context: "You're cold calling a Sr. Director of CRM at a $40M beauty brand. She answered and within 5 seconds said they're already using a competitor.",
      objection: "We already use Klaviyo and we're happy. Thanks though.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-cc-3', skillFocus: 'objection_handling', title: 'Cold call — "just renewed our contract"',
      context: "You're cold calling a Head of Lifecycle at a $35M wellness brand. He answered and immediately told you they just locked in a 2-year deal with a competitor.",
      objection: "We literally just renewed our contract last month. There's nothing to talk about.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-cc-meeting-set',
    anchor: 'opening_cold_call',
    title: 'Meeting-Setting Close',
    benchmarkScenario: {
      id: 'bm-cc-4', skillFocus: 'deal_control', title: 'Cold call — interest but won\'t commit',
      context: "You're cold calling a Director of Marketing at a $18M DTC food brand. She's actually engaged — asked one question about your platform. But when you try to set a meeting, she hesitates.",
      objection: "That does sound interesting. But I'm slammed this week. Maybe I'll look at your site and reach back out?", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-cc-4', skillFocus: 'deal_control', title: 'Cold call — curious but dodges calendar',
      context: "You're cold calling a VP of Digital at a $22M outdoor brand. He asked a follow-up question about your AI capabilities. When you proposed a 15-minute call, he waffled.",
      objection: "Yeah, maybe. My calendar is crazy right now. Can you try me again in a couple weeks?", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-cc-call-control',
    anchor: 'opening_cold_call',
    title: 'Early Call Control',
    benchmarkScenario: {
      id: 'bm-cc-5', skillFocus: 'deal_control', title: 'Cold call — buyer tries to take over',
      context: "You're cold calling a Head of Growth at a $12M DTC pet brand. She answered and immediately started asking rapid-fire questions about pricing, integrations, and implementation timeline — trying to qualify you before you can qualify her.",
      objection: "How much does it cost? Do you integrate with Shopify Plus? How long is implementation? We need to know all this before we'd even consider a meeting.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-cc-5', skillFocus: 'deal_control', title: 'Cold call — buyer demands a deck first',
      context: "You're cold calling a Director of E-commerce at a $16M accessories brand. He picked up but immediately tried to control the conversation by asking for materials before engaging.",
      objection: "Just send me a one-pager with pricing and case studies. If it looks good, I'll get back to you. I don't do intro calls with vendors I haven't vetted.", difficulty: 'intermediate',
    },
  },
];

// ── Discovery / Qualification Families ────────────────────────────

const DISCOVERY_FAMILIES: ScenarioFamily[] = [
  {
    id: 'sf-disc-surface-pain',
    anchor: 'discovery_qualification',
    title: 'Deepening Surface Pain',
    benchmarkScenario: {
      id: 'bm-d-1', skillFocus: 'discovery', title: 'Surface pain — won\'t go deeper',
      context: "First discovery call with a Sr. Manager of Retention at a $8M DTC brand. She mentioned churn is a problem but immediately pivoted to asking about features.",
      objection: "Yeah, churn's been up. Can you show me your segmentation? That's what I'm here for.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-d-1', skillFocus: 'discovery', title: 'Buyer deflects to product questions',
      context: "First discovery with a Director of Lifecycle at a $10M health brand. He acknowledged low email engagement but keeps steering toward a demo request.",
      objection: "Our open rates are down. But honestly, just show me what your platform does and I'll know if it fits.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-disc-no-urgency',
    anchor: 'discovery_qualification',
    title: 'Creating Urgency from Nothing',
    benchmarkScenario: {
      id: 'bm-d-2', skillFocus: 'discovery', title: 'No urgency — "nice to have"',
      context: "Second call with a Director of Growth at a $15M ecomm brand. No timeline, no project, no budget. Current tool is 'fine.'",
      objection: "Honestly this is more of a nice-to-have. We've got bigger fires. Maybe next quarter.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-d-2', skillFocus: 'discovery', title: 'Buyer has no trigger event',
      context: "Second call with a VP of Marketing at a $18M retail brand. She liked the demo but there's no event forcing a decision. Everything works 'well enough.'",
      objection: "I think it's cool, but nothing's really broken on our end. I'll keep you in mind if something changes.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-disc-quantify',
    anchor: 'discovery_qualification',
    title: 'Quantifying Impact',
    benchmarkScenario: {
      id: 'bm-d-3', skillFocus: 'discovery', title: 'Unquantified impact',
      context: "Discovery with Head of CRM at a $60M multi-brand retailer. They want 'better engagement' but can't quantify what improvement means in revenue.",
      objection: "We just want to improve engagement. We don't really track revenue per email.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-d-3', skillFocus: 'discovery', title: 'Buyer can\'t articulate the cost',
      context: "Discovery with a Director of Marketing at a $50M CPG brand. She knows retention is an issue but can't put a number on the problem.",
      objection: "I know we're losing customers faster than we should, but I don't have the exact churn numbers. We just feel it.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-disc-enthusiast',
    anchor: 'discovery_qualification',
    title: 'Enthusiast Without Power',
    benchmarkScenario: {
      id: 'bm-d-4', skillFocus: 'qualification', title: 'Enthusiast with no power',
      context: "Discovery with a Marketing Manager at a $10M DTC food brand. She loves your product. But she has no budget authority and hasn't mentioned this to her VP.",
      objection: "This is exactly what we need! What's pricing look like? I want to put together a quick business case.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-d-4', skillFocus: 'qualification', title: 'Champion can\'t access decision maker',
      context: "Discovery with a Lifecycle Specialist at a $12M beauty brand. She's done tons of research and wants to buy. But her manager controls budget and she's never brought a vendor recommendation forward.",
      objection: "I've already compared you to 3 other tools and you're the best. How do I make the case to my boss?", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-disc-multi-stakeholder',
    anchor: 'discovery_qualification',
    title: 'Multi-Stakeholder Complexity',
    benchmarkScenario: {
      id: 'bm-d-5', skillFocus: 'qualification', title: 'Multi-stakeholder complexity',
      context: "Discovery with a Director of E-commerce at a $60M CPG brand. She's interested but keeps referencing IT, Finance, and CMO.",
      objection: "I think this could work, but I'd need IT, Finance, and my CMO aligned. It's a whole process here.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-d-5', skillFocus: 'qualification', title: 'Buyer buried in internal process',
      context: "Discovery with a VP of Digital at a $70M retailer. She sees the value but the org has a 5-step vendor approval process she doesn't fully understand.",
      objection: "I want to move forward but there's a vendor review board, a security assessment, and procurement all has to sign off. I don't even know the order.", difficulty: 'intermediate',
    },
  },
];

// ── Objection Handling / Pricing Families ─────────────────────────

const OBJECTION_FAMILIES: ScenarioFamily[] = [
  {
    id: 'sf-obj-incumbent',
    anchor: 'objection_pricing',
    title: 'Incumbent Loyalty',
    benchmarkScenario: {
      id: 'bm-oh-1', skillFocus: 'objection_handling', title: 'Locked into current vendor',
      context: "Mid-discovery with VP of Marketing at a $12M DTC brand. They've used Braze for 2 years and the team built everything in it.",
      objection: "We just renewed Braze three months ago and my team built everything in it. I'm not ripping that out.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-oh-1', skillFocus: 'objection_handling', title: 'Deep platform dependency',
      context: "Discovery with a Director of CRM at a $14M wellness brand. Their lifecycle team of 5 spent 8 months building automations in Iterable. Switching feels impossible.",
      objection: "We have 60+ automations built in Iterable. My team would revolt if I asked them to rebuild all of that.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-obj-budget',
    anchor: 'objection_pricing',
    title: 'Budget Freeze',
    benchmarkScenario: {
      id: 'bm-oh-2', skillFocus: 'objection_handling', title: 'CFO froze spend',
      context: "Final stages with a Director at a PE-backed fashion brand ($20M). She got VP sign-off, but the CFO froze all discretionary spend yesterday.",
      objection: "My CFO just froze everything. I literally cannot get a PO signed until July. My hands are tied.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-oh-2', skillFocus: 'objection_handling', title: 'No budget allocated',
      context: "Third call with a Head of Growth at a $25M outdoor brand. She's convinced but there's no line item for this in the current budget cycle.",
      objection: "There's literally no budget for this right now. I'd have to go back to Finance and request a new line item, and that takes 6-8 weeks.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-obj-competitor-price',
    anchor: 'objection_pricing',
    title: 'Competitor Price Pressure',
    benchmarkScenario: {
      id: 'bm-oh-3', skillFocus: 'objection_handling', title: 'Competitor is 40% cheaper',
      context: "Enterprise retailer ($150M) evaluating 3 vendors. Procurement shared: your competitor quoted 40% less.",
      objection: "Klaviyo quoted us $110K and you're at $180K. My CFO is going to ask why.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-oh-3', skillFocus: 'objection_handling', title: 'Buyer anchored to lower quote',
      context: "Final round with a $120M retailer. Their Director of E-commerce received a quote from a competitor that's 35% less and the CFO is using it as leverage.",
      objection: "I have a quote from your competitor for $85K. You're at $130K. Help me understand why I'd pay 50% more.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-obj-burned-before',
    anchor: 'objection_pricing',
    title: 'Previous Vendor Failure',
    benchmarkScenario: {
      id: 'bm-oh-4', skillFocus: 'objection_handling', title: 'Burned by last vendor',
      context: "VP of Digital at a $50M outdoor brand. Two years ago they spent $200K on a competing platform that was killed after 6 months.",
      objection: "The last time we did this it cost us $200K, six months, and a VP. My team will mutiny.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-oh-4', skillFocus: 'objection_handling', title: 'Trust broken by prior implementation',
      context: "Director of CRM at a $45M retail company. Their last platform migration took 9 months instead of 3, and they lost 2 team members to burnout.",
      objection: "We tried this before and it nearly broke my team. The vendor promised 90 days and it took 9 months. Why would this be different?", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-obj-build-vs-buy',
    anchor: 'objection_pricing',
    title: 'Build vs. Buy',
    benchmarkScenario: {
      id: 'bm-oh-5', skillFocus: 'objection_handling', title: 'Engineering wants to build',
      context: "Head of Engineering at a $30M ecomm company. Their eng team scoped building 80% of your functionality in one quarter.",
      objection: "We're going to build this in-house. My team scoped it — 80% of what you do in 3 months with our own warehouse.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-oh-5', skillFocus: 'objection_handling', title: 'CTO prefers internal solution',
      context: "CTO of a $35M DTC brand. His data team already built a basic email scoring model and he thinks they can extend it.",
      objection: "My data team already built a basic version of this. We're planning to invest in extending it rather than buying another tool.", difficulty: 'intermediate',
    },
  },
];

// ── Deal Control / Negotiation / MAP Families ─────────────────────

const DEAL_CONTROL_FAMILIES: ScenarioFamily[] = [
  {
    id: 'sf-dc-champion-dark',
    anchor: 'deal_control_negotiation',
    title: 'Champion Goes Dark',
    benchmarkScenario: {
      id: 'bm-dc-1', skillFocus: 'deal_control', title: 'Champion goes dark after demo',
      context: "Strong demo 10 days ago with a Director of CRM at a $25M beauty brand. She was engaged. Since then — nothing. Two follow-ups, no response.",
      objection: "Hey — sorry I've been slammed. Can we reconnect in a couple weeks?", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-dc-1', skillFocus: 'deal_control', title: 'Buyer disappears post-proposal',
      context: "You sent a proposal to a VP of Marketing at a $30M outdoor brand 2 weeks ago. She was enthusiastic on the call but hasn't responded to 3 follow-ups.",
      objection: "Things got crazy here. I haven't had a chance to review the proposal yet. Let me get back to you when I have.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-dc-circle-back',
    anchor: 'deal_control_negotiation',
    title: 'Next Quarter Stall',
    benchmarkScenario: {
      id: 'bm-dc-2', skillFocus: 'deal_control', title: 'Buyer wants to "circle back next quarter"',
      context: "Third call with VP of Marketing at a $40M outdoor brand. Discovery and demo went well. She won't commit to a timeline.",
      objection: "I like what you've shown me. Let's circle back in Q3 when things calm down.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-dc-2', skillFocus: 'deal_control', title: 'Deal pushed to "after planning season"',
      context: "Third meeting with a Director of Growth at a $35M retail company. She's aligned on value but keeps deferring to 'after we finish planning.'",
      objection: "We're in the middle of annual planning right now. Can we pick this up in January when we know our budget?", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-dc-procurement',
    anchor: 'deal_control_negotiation',
    title: 'Procurement Hijack',
    benchmarkScenario: {
      id: 'bm-dc-3', skillFocus: 'deal_control', title: 'Procurement hijacks timeline',
      context: "Verbal approval from VP of E-Commerce at a $90M retailer. Procurement requested a security questionnaire, 90-day terms, and 25% discount.",
      objection: "We've sent your proposal to procurement. They handle all vendor agreements from here.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-dc-3', skillFocus: 'deal_control', title: 'Legal review stalls the deal',
      context: "You're in final stages with a $75M brand. The legal team requested 14 contract modifications and the buyer says it's 'out of her hands now.'",
      objection: "Legal has your MSA. They have some redlines. I'd suggest working directly with them — I can't really influence that process.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-dc-no-next-step',
    anchor: 'deal_control_negotiation',
    title: 'No Defined Next Step',
    benchmarkScenario: {
      id: 'bm-dc-4', skillFocus: 'deal_control', title: 'Deal stuck — no defined next step',
      context: "Three solid meetings with a Director of Growth at a $20M DTC brand. Each meeting ends with 'let me think about it.' No next step ever set.",
      objection: "This has been super informative. Let me take this back and think about it. I'll reach out when we're ready.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-dc-4', skillFocus: 'deal_control', title: 'Buyer won\'t commit to a decision date',
      context: "Fourth conversation with a Head of CRM at a $28M wellness brand. She keeps agreeing the product is great but avoids setting any milestones.",
      objection: "I definitely want to move forward at some point. I just don't want to commit to a specific date right now.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-dc-late-competitor',
    anchor: 'deal_control_negotiation',
    title: 'Late Competitor Introduction',
    benchmarkScenario: {
      id: 'bm-dc-5', skillFocus: 'deal_control', title: 'New competitor introduced late',
      context: "Final negotiation with a VP of Digital at a $55M retailer. MSA drafted, pricing agreed. She casually mentions her CMO wants to 'also look at' a competitor.",
      objection: "My CMO wants us to also look at Ometria before we sign. It's not a big deal, just checking a box.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-dc-5', skillFocus: 'deal_control', title: 'Board requests competitive bake-off',
      context: "You're days from signature with a $65M brand. The board member who must approve told the VP to run a formal evaluation against two other vendors.",
      objection: "The board wants us to do a formal evaluation. I know it's frustrating — I'm confident you'll win, but we have to go through the process.", difficulty: 'intermediate',
    },
  },
];

// ── Executive / ROI / Mixed Pressure Families ─────────────────────

const EXECUTIVE_FAMILIES: ScenarioFamily[] = [
  {
    id: 'sf-exec-30-second',
    anchor: 'executive_roi_mixed',
    title: 'Executive Elevator Pitch',
    benchmarkScenario: {
      id: 'bm-ex-1', skillFocus: 'executive_response', title: 'CMO wants 30-second version',
      context: "Pulled into a meeting with the CMO of a $100M DTC brand. She has 4 minutes. Your champion introduced you as 'the vendor for our retention problem.'",
      objection: "Give me the 30-second version. Why should I care?", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-ex-1', skillFocus: 'executive_response', title: 'CEO gives you 60 seconds',
      context: "CEO of a $90M retailer walked into the room unexpectedly. She's heard your name from two VPs. She's standing, not sitting — clearly not planning to stay.",
      objection: "I've heard your name twice this week. You've got one minute — what am I missing?", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-exec-roi-math',
    anchor: 'executive_roi_mixed',
    title: 'CFO ROI Challenge',
    benchmarkScenario: {
      id: 'bm-ex-2', skillFocus: 'executive_response', title: 'CFO wants payback math',
      context: "CFO joins the final call at a PE-backed beauty brand ($35M). He has the $180K proposal open. The room goes quiet.",
      objection: "Walk me through the payback period. I need 3x ROI in year one or this doesn't clear investment committee.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-ex-2', skillFocus: 'executive_response', title: 'Finance VP challenges unit economics',
      context: "VP of Finance at a $40M DTC brand joins the final review. She has a spreadsheet open comparing your cost against projected uplift.",
      objection: "Show me the math. What's the incremental revenue per dollar spent? I need to see this pay for itself in 6 months.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-exec-cost-cutting',
    anchor: 'executive_roi_mixed',
    title: 'Cost-Cutting CEO',
    benchmarkScenario: {
      id: 'bm-ex-3', skillFocus: 'executive_response', title: 'CEO in cost-cutting mode',
      context: "CEO of a PE-backed supplements brand ($50M) in a profitability review quarter. Cut headcount 15%, eliminated 3 tools.",
      objection: "We're not spending on growth right now. Everything I approve has to protect margin or reduce cost.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-ex-3', skillFocus: 'executive_response', title: 'COO demands efficiency framing',
      context: "COO of a $55M ecomm company reviewing all vendor contracts. She's already cut $400K in tools this quarter and your proposal just landed on her desk.",
      objection: "I need you to frame this as an efficiency play, not a growth bet. If it's growth, it's dead. What does this save us?", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-exec-board-ready',
    anchor: 'executive_roi_mixed',
    title: 'Board Presentation Support',
    benchmarkScenario: {
      id: 'bm-ex-4', skillFocus: 'executive_response', title: 'VP needs board-ready pitch',
      context: "Your champion's VP calls you directly. She presents to the board in 48 hours. She needs one slide and 60 seconds.",
      objection: "I'm presenting to the board Thursday. Tell me exactly what to say in under a minute.", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-ex-4', skillFocus: 'executive_response', title: 'Champion needs exec summary',
      context: "Your champion (Director level) has a 30-minute slot with the CEO next week. She needs you to help her build the 3-slide business case.",
      objection: "My CEO is going to ask three questions: why now, what's the ROI, and what's the risk of doing nothing. Help me answer all three.", difficulty: 'intermediate',
    },
  },
  {
    id: 'sf-exec-category-skeptic',
    anchor: 'executive_roi_mixed',
    title: 'Category Skeptic Executive',
    benchmarkScenario: {
      id: 'bm-ex-5', skillFocus: 'executive_response', title: 'CRO is a category skeptic',
      context: "CRO of a $200M retail company. 20 years in industry. Doesn't believe your product category moves the needle. Gave you 2 minutes.",
      objection: "I've heard this pitch a dozen times. None moved the needle. You've got 2 minutes — what's different?", difficulty: 'intermediate',
    },
    retestScenario: {
      id: 'rt-ex-5', skillFocus: 'executive_response', title: 'VP dismisses the category',
      context: "VP of Revenue at a $180M brand. He's seen 5 vendors in your space over the past 3 years and considers it 'commodity tech.' His team asked him to take this meeting.",
      objection: "My team keeps bringing me vendors in this space and nothing has ever worked. Give me one reason to think you're different.", difficulty: 'intermediate',
    },
  },
];

// ── All Families Combined ─────────────────────────────────────────

export const ALL_SCENARIO_FAMILIES: ScenarioFamily[] = [
  ...COLD_CALL_FAMILIES,
  ...DISCOVERY_FAMILIES,
  ...OBJECTION_FAMILIES,
  ...DEAL_CONTROL_FAMILIES,
  ...EXECUTIVE_FAMILIES,
];

/** Get scenario families for a specific anchor */
export function getFamiliesForAnchor(anchor: DayAnchor): ScenarioFamily[] {
  return ALL_SCENARIO_FAMILIES.filter(f => f.anchor === anchor);
}

/** Get a specific family by ID */
export function getScenarioFamily(id: string): ScenarioFamily | undefined {
  return ALL_SCENARIO_FAMILIES.find(f => f.id === id);
}

/** Get the benchmark or retest scenario for a family */
export function getScenarioForPhase(
  familyId: string,
  phase: 'benchmark' | 'retest',
): DojoScenario | null {
  const family = getScenarioFamily(familyId);
  if (!family) return null;
  return phase === 'benchmark' ? family.benchmarkScenario : family.retestScenario;
}
