/**
 * Deal lifecycle stage configuration for the Deal Execution Command Center.
 * Each stage defines actions, tactics examples, and next-step suggestions.
 */

import {
  Send, Search, MessageSquare, Phone, Mail, DollarSign,
  BarChart3, Shield, Users, Handshake, Repeat, FileText,
  Target, Presentation, Scale, BookOpen, TrendingUp,
  type LucideIcon,
} from 'lucide-react';

export interface StageAction {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  systemPrompt: string;
}

export interface StageTactic {
  statement: string;
  keywords: string[];
}

export interface StageNextStep {
  label: string;
  actionId?: string; // link to an action within same or different stage
  targetStage?: string; // link to another stage
}

export interface StageConfig {
  id: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  description: string;
  actions: StageAction[];
  defaultTactics: StageTactic[];
  nextSteps: StageNextStep[];
}

export const STAGES: StageConfig[] = [
  {
    id: 'outbound',
    label: 'Outbound',
    shortLabel: 'Outbound',
    icon: Send,
    description: 'Cold outreach, prospecting, and initial engagement.',
    actions: [
      {
        id: 'cold-email', label: 'Draft Cold Email', description: 'Personalized outreach email based on account research.',
        icon: Mail,
        systemPrompt: `OBJECTIVE: Write a cold outreach email that earns a reply by leading with relevance, not product.
AUDIENCE: The prospect receiving a cold email.
OUTPUT STRUCTURE:
Start with "Subject: <subject line>" then:
1. HOOK — One sentence connecting to something specific about their business or role.
2. INSIGHT — One sentence sharing a relevant observation or trend.
3. VALUE PROP — One sentence on what you help companies like theirs achieve.
4. SOCIAL PROOF — One brief reference (optional, only if relevant).
5. ASK — One clear, low-friction CTA (15-min call, quick question, etc.).
TONE: Conversational, peer-to-peer, zero fluff. Under 120 words total.
WHAT GOOD LOOKS LIKE: An email the recipient reads fully because the first line is about THEM.`,
      },
      {
        id: 'outbound-sequence', label: 'Build Outreach Sequence', description: 'Multi-touch cadence across email, phone, and LinkedIn.',
        icon: Repeat,
        systemPrompt: `OBJECTIVE: Create a 5-7 touch outreach sequence mixing email, phone, and social.
AUDIENCE: The sales rep executing the sequence.
OUTPUT STRUCTURE:
For each touch:
- DAY X — CHANNEL (Email/Phone/LinkedIn)
- Subject or Opening
- Full message or talk track
- Goal of this touch
TONE: Varied per touch — first is curious, middle is value-driven, last is direct.
WHAT GOOD LOOKS LIKE: A sequence where each touch adds new value and doesn't repeat the same message.`,
      },
      {
        id: 'linkedin-message', label: 'Draft LinkedIn Message', description: 'Connection request or InMail message.',
        icon: MessageSquare,
        systemPrompt: `OBJECTIVE: Write a LinkedIn message that feels personal, not templated.
AUDIENCE: The prospect on LinkedIn.
OUTPUT STRUCTURE:
1. CONNECTION CONTEXT — Why you're reaching out (shared interest, mutual connection, their content).
2. VALUE — One sentence on relevance.
3. ASK — Simple next step.
TONE: Casual professional. Under 75 words.
WHAT GOOD LOOKS LIKE: A message that gets accepted because it feels human.`,
      },
    ],
    defaultTactics: [
      { statement: 'Lead with account-specific insight, not product', keywords: ['personalize', 'research', 'insight'] },
      { statement: 'Reference trigger events in first sentence', keywords: ['trigger', 'news', 'signal'] },
      { statement: 'Keep cold emails under 120 words', keywords: ['short', 'concise', 'brief'] },
    ],
    nextSteps: [
      { label: 'Prep for Discovery Call', targetStage: 'discovery' },
      { label: 'Draft Follow-up Email', actionId: 'cold-email' },
    ],
  },
  {
    id: 'discovery',
    label: 'Discovery',
    shortLabel: 'Discovery',
    icon: Search,
    description: 'Understanding needs, qualifying pain, and building trust.',
    actions: [
      {
        id: 'discovery-plan', label: 'Build Discovery Plan', description: 'Structured plan with objectives, questions, and research.',
        icon: Search,
        systemPrompt: `OBJECTIVE: Create a comprehensive discovery call preparation plan.
AUDIENCE: The sales rep preparing for this call.
OUTPUT STRUCTURE:
1. CALL OBJECTIVE — What must we learn?
2. PRE-CALL RESEARCH — Key facts, industry trends, signals.
3. OPENING FRAMEWORK — How to open (trigger reference, hypothesis, insight).
4. DISCOVERY QUESTIONS — By theme: Current State, Pain & Impact, Decision Process, Vision & Priorities. Include follow-up probes.
5. COMPETITIVE LANDMINES — Questions exposing competitor weaknesses.
6. RED FLAGS — Signals the deal may stall.
7. DESIRED OUTCOME — What success looks like.
TONE: Consultative, strategic. Write as if coaching an elite rep.
WHAT GOOD LOOKS LIKE: A plan making the rep feel over-prepared.`,
      },
      {
        id: 'discovery-questions', label: 'Generate Discovery Questions', description: 'Persona-specific questions revealing business pain.',
        icon: MessageSquare,
        systemPrompt: `OBJECTIVE: Generate high-quality discovery questions revealing real business pain.
AUDIENCE: The sales rep — questions ready to ask verbatim.
OUTPUT STRUCTURE:
1. OPENING QUESTION — One strong opener.
2. CURRENT STATE — 3-4 questions.
3. PAIN & IMPACT — 3-4 questions quantifying cost of status quo.
4. DECISION PROCESS — 2-3 questions on stakeholders, timeline, budget.
5. VISION — 2-3 questions on what "better" looks like.
6. COMPETITIVE CONTEXT — 2 questions surfacing dynamics.
7. NEXT STEP — 1-2 questions leading to action.
Include WHY each question matters.
TONE: Natural, conversational.
WHAT GOOD LOOKS LIKE: Questions making the prospect think "that's really good."`,
      },
      {
        id: 'prep-for-call', label: 'Prep for Call', description: 'Complete call prep with talking points and risks.',
        icon: Phone,
        systemPrompt: `OBJECTIVE: Create an actionable call prep brief reviewable in 5 minutes.
AUDIENCE: The sales rep — this is their cheat sheet.
OUTPUT STRUCTURE:
1. MEETING OBJECTIVE — One line.
2. CONTEXT SNAPSHOT — 3-5 bullets: what we know, where we are.
3. KEY TALKING POINTS — 3-5 specific things to say.
4. QUESTIONS TO ASK — 3-5 targeted questions.
5. OBJECTIONS TO EXPECT — 2-3 with responses.
6. COMPETITIVE POSITIONING — Key differentiator + weakness to exploit.
7. RISKS & WATCHOUTS — What could go wrong.
8. DESIRED NEXT STEP — Commitment to ask for.
TONE: Direct, tactical, scannable.
WHAT GOOD LOOKS LIKE: Read in 3 minutes, walk in fully armed.`,
      },
      {
        id: 'recap-email', label: 'Create Recap Email', description: 'Recap summarizing key points and next steps.',
        icon: Mail,
        systemPrompt: `OBJECTIVE: Write a professional recap email reinforcing discussion points and next steps.
AUDIENCE: The prospect/customer from the meeting.
OUTPUT STRUCTURE:
Start with "Subject: <subject line>" then:
1. GREETING — One line, genuine.
2. KEY TAKEAWAYS — 3-5 bullets framed as THEIR priorities.
3. AGREED NEXT STEPS — Numbered: action, owner, timeline.
4. OPEN QUESTIONS — Items needing follow-up.
5. CLOSING — Reinforce value and enthusiasm.
TONE: Executive, concise, professional.
WHAT GOOD LOOKS LIKE: An email the recipient forwards to their boss.`,
      },
      {
        id: 'meeting-agenda', label: 'Create Meeting Agenda', description: 'Structured agenda email for next meeting.',
        icon: FileText,
        systemPrompt: `OBJECTIVE: Write a meeting agenda email that sets expectations and shows preparation.
AUDIENCE: The prospect/customer attending.
OUTPUT STRUCTURE:
Start with "Subject: <subject line>" then:
1. GREETING — Quick context for the meeting.
2. AGENDA ITEMS — Numbered with time allocations.
3. PREPARATION — Any pre-reads or materials.
4. DESIRED OUTCOMES — What we'll accomplish.
TONE: Organized, professional, collaborative.
WHAT GOOD LOOKS LIKE: An agenda that makes the meeting productive before it starts.`,
      },
    ],
    defaultTactics: [
      { statement: 'Ask impact questions before solution questions', keywords: ['impact', 'pain', 'cost'] },
      { statement: 'Confirm understanding before moving to next topic', keywords: ['confirm', 'summarize', 'playback'] },
      { statement: 'Identify the decision-making process early', keywords: ['decision', 'stakeholder', 'process'] },
    ],
    nextSteps: [
      { label: 'Schedule Demo', targetStage: 'demo' },
      { label: 'Send Recap Email', actionId: 'recap-email' },
      { label: 'Build Discovery Plan for Next Call', actionId: 'discovery-plan' },
    ],
  },
  {
    id: 'demo',
    label: 'Demo',
    shortLabel: 'Demo',
    icon: Presentation,
    description: 'Demonstrating value aligned to their specific needs.',
    actions: [
      {
        id: 'demo-prep', label: 'Prep for Demo', description: 'Demo prep with use cases, flow, and talking points.',
        icon: Presentation,
        systemPrompt: `OBJECTIVE: Create a demo preparation plan focused on their specific needs.
AUDIENCE: The sales rep running the demo.
OUTPUT STRUCTURE:
1. DEMO OBJECTIVE — What must the prospect believe after this demo?
2. PERSONA-SPECIFIC USE CASES — 2-3 scenarios matching their world.
3. DEMO FLOW — Ordered list of what to show and WHY.
4. KEY MESSAGES — 3-4 value statements to weave in.
5. "WOW" MOMENTS — 1-2 features that directly solve their stated pain.
6. OBJECTION PREP — 2-3 likely objections mid-demo with responses.
7. TRANSITION TO NEXT STEP — How to end with momentum.
TONE: Strategic, customer-centric.
WHAT GOOD LOOKS LIKE: A demo that feels like it was built for them.`,
      },
      {
        id: 'demo-followup', label: 'Draft Demo Follow-Up', description: 'Follow-up email reinforcing demo value.',
        icon: Mail,
        systemPrompt: `OBJECTIVE: Write a demo follow-up email that reinforces value and drives next steps.
AUDIENCE: Everyone who attended the demo.
OUTPUT STRUCTURE:
Start with "Subject: <subject line>" then:
1. THANK YOU + HIGHLIGHT — Reference the most impactful moment.
2. VALUE RECAP — 3-4 bullets connecting features shown to their pain.
3. RESOURCES — Any relevant materials (case studies, ROI data).
4. NEXT STEPS — Clear, specific, with timeline.
TONE: Enthusiastic but professional.
WHAT GOOD LOOKS LIKE: An email that makes them want to show the recording to their team.`,
      },
      {
        id: 'demo-script', label: 'Build Demo Script', description: 'Guided demo script with transitions and questions.',
        icon: BookOpen,
        systemPrompt: `OBJECTIVE: Create a structured demo script with natural transitions.
AUDIENCE: The sales rep delivering the demo.
OUTPUT STRUCTURE:
1. OPENING (2 min) — Set context, recap their goals.
2. USE CASE 1 — Show → Explain → Connect to their pain.
3. USE CASE 2 — Show → Explain → Connect.
4. DIFFERENTIATOR MOMENT — What competitors can't do.
5. ENGAGEMENT QUESTIONS — Ask between sections.
6. CLOSING — Summarize value, propose next step.
Include transition phrases between sections.
TONE: Conversational, not scripted.
WHAT GOOD LOOKS LIKE: A guide that keeps the demo feeling like a conversation, not a presentation.`,
      },
    ],
    defaultTactics: [
      { statement: 'Lead with their use case, not your feature tour', keywords: ['use case', 'scenario', 'their world'] },
      { statement: 'Pause after key moments to check understanding', keywords: ['pause', 'check', 'reaction'] },
      { statement: 'End demo with a clear next step, not "any questions?"', keywords: ['next step', 'close', 'commitment'] },
    ],
    nextSteps: [
      { label: 'Send Demo Follow-Up', actionId: 'demo-followup' },
      { label: 'Move to Pricing Discussion', targetStage: 'pricing' },
      { label: 'Align Champion', targetStage: 'champion' },
    ],
  },
  {
    id: 'pricing',
    label: 'Pricing / ROI',
    shortLabel: 'Pricing',
    icon: DollarSign,
    description: 'Value framing, business case, and pricing conversations.',
    actions: [
      {
        id: 'pricing-call-prep', label: 'Prep Pricing Call', description: 'Pricing playbook with objection handling and value framing.',
        icon: DollarSign,
        systemPrompt: `OBJECTIVE: Create a pricing conversation playbook leading with value.
AUDIENCE: The sales rep going into pricing.
OUTPUT STRUCTURE:
1. VALUE NARRATIVE — 3-4 sentence value story.
2. PRICING STRATEGY — How to present the number.
3. ANTICIPATED OBJECTIONS — Top 3-5 with responses and reframes.
4. ROI TALKING POINTS — 3-4 specific metrics.
5. COMPETITIVE PRICING — Why price difference is expected.
6. NEGOTIATION BOUNDARIES — Flex points and trades.
7. CLOSING MOVE — Transition to commitment.
TONE: Confident, consultative. Never defensive about price.
WHAT GOOD LOOKS LIKE: Pricing feels like a natural value conversation.`,
      },
      {
        id: 'cfo-email', label: 'Generate CFO Email', description: 'Executive email focused on ROI and business impact.',
        icon: Mail,
        systemPrompt: `OBJECTIVE: Write a CFO-facing email speaking the language of financial decision-makers.
AUDIENCE: CFO, VP Finance, or financial decision-maker.
OUTPUT STRUCTURE:
Start with "Subject: <subject line>" then:
1. HOOK — One sentence on their business priority.
2. BUSINESS CASE — Problem solved in financial terms, quantified impact, time to value.
3. RISK MITIGATION — 2-3 bullets on why this is safe.
4. URGENCY — One line on why now.
5. ASK — Clear, specific CTA.
TONE: Executive, data-driven, under 200 words.
WHAT GOOD LOOKS LIKE: Short, credible, actionable.`,
      },
      {
        id: 'roi-summary', label: 'Build ROI Summary', description: 'Quantified ROI document with metrics and business case.',
        icon: BarChart3,
        systemPrompt: `OBJECTIVE: Create a quantified ROI summary for financial stakeholders.
AUDIENCE: CFO, procurement, evaluators.
OUTPUT STRUCTURE:
1. EXECUTIVE SUMMARY — Investment, return, timeline.
2. CURRENT STATE COSTS — Breakdown of today's spending.
3. PROJECTED IMPACT — Revenue, cost savings, risk reduction.
4. TIMELINE — Phases with milestones.
5. PAYBACK PERIOD — Break-even analysis.
6. COMPETITIVE COMPARISON — Cost, capability, risk vs alternatives.
7. RECOMMENDATION — Clear recommendation with rationale.
TONE: Professional, analytical, evidence-based.
WHAT GOOD LOOKS LIKE: A document a CFO hands to their team saying "this is why."`,
      },
      {
        id: 'business-case', label: 'Build Business Case', description: 'Internal business case document for champion to share.',
        icon: FileText,
        systemPrompt: `OBJECTIVE: Create a business case document a champion can present internally.
AUDIENCE: Internal stakeholders evaluating the purchase.
OUTPUT STRUCTURE:
1. PROBLEM STATEMENT — What problem this solves.
2. CURRENT IMPACT — Cost of inaction.
3. PROPOSED SOLUTION — What and why.
4. EXPECTED OUTCOMES — Quantified benefits.
5. INVESTMENT — Cost and timeline.
6. RISK ASSESSMENT — Low risk factors.
7. RECOMMENDATION — Clear next steps.
TONE: Professional, data-driven, objective (not salesy).
WHAT GOOD LOOKS LIKE: A doc the champion copies into their internal memo.`,
      },
    ],
    defaultTactics: [
      { statement: 'Lead with ROI before showing price', keywords: ['roi', 'value', 'impact'] },
      { statement: 'Anchor value before revealing number', keywords: ['anchor', 'value', 'price'] },
      { statement: 'Reframe price objections to cost of inaction', keywords: ['objection', 'reframe', 'cost'] },
    ],
    nextSteps: [
      { label: 'Align Champion', targetStage: 'champion' },
      { label: 'Send CFO Email', actionId: 'cfo-email' },
      { label: 'Prepare for Procurement', targetStage: 'procurement' },
    ],
  },
  {
    id: 'champion',
    label: 'Champion / Alignment',
    shortLabel: 'Champion',
    icon: Users,
    description: 'Building internal champions and stakeholder alignment.',
    actions: [
      {
        id: 'champion-email', label: 'Draft Champion Email', description: 'Email arming champion with talking points for internal selling.',
        icon: Mail,
        systemPrompt: `OBJECTIVE: Write an email that arms your champion to sell internally.
AUDIENCE: Your internal champion.
OUTPUT STRUCTURE:
Start with "Subject: <subject line>" then:
1. CONTEXT — Quick recap of where things stand.
2. INTERNAL TALKING POINTS — 3-5 bullets they can use with their leadership.
3. OBJECTION HANDLING — Anticipated internal pushback with responses.
4. SUPPORTING DATA — Key stats and proof points.
5. ASK — What you need from them next.
TONE: Collaborative, empowering. Make them look good.
WHAT GOOD LOOKS LIKE: An email your champion forwards directly to their boss.`,
      },
      {
        id: 'stakeholder-map', label: 'Map Stakeholders', description: 'Identify decision-makers and their priorities.',
        icon: Users,
        systemPrompt: `OBJECTIVE: Create a stakeholder analysis for this deal.
AUDIENCE: The sales rep planning their multi-threaded approach.
OUTPUT STRUCTURE:
1. DECISION-MAKER — Role, priorities, what they care about.
2. CHAMPION — Who, why they support us, what they need.
3. INFLUENCERS — Technical, financial, operational. Each with priorities.
4. POTENTIAL BLOCKERS — Who might resist and why.
5. ENGAGEMENT STRATEGY — How to approach each stakeholder.
6. GAPS — Who we haven't reached yet and why it matters.
TONE: Strategic, analytical.
WHAT GOOD LOOKS LIKE: A map that reveals the political landscape of the deal.`,
      },
      {
        id: 'mutual-action-plan', label: 'Build Mutual Action Plan', description: 'Shared plan with milestones to close.',
        icon: Target,
        systemPrompt: `OBJECTIVE: Create a mutual action plan (MAP) that aligns both sides on path to close.
AUDIENCE: Shared between rep and champion.
OUTPUT STRUCTURE:
1. OBJECTIVE — What we're working toward.
2. KEY MILESTONES — Ordered list with dates:
   - Technical evaluation
   - Business case approval
   - Legal/security review
   - Final decision
3. ACTION ITEMS — For each milestone: task, owner, deadline.
4. SUCCESS CRITERIA — What "yes" looks like.
5. RISKS — What could delay and mitigation.
TONE: Professional, collaborative, clear.
WHAT GOOD LOOKS LIKE: A plan both sides reference weekly.`,
      },
    ],
    defaultTactics: [
      { statement: 'Arm champion with specific internal talking points', keywords: ['champion', 'internal', 'talking points'] },
      { statement: 'Multi-thread across at least 3 stakeholders', keywords: ['multi-thread', 'stakeholder', 'contact'] },
      { statement: 'Create urgency through business impact, not discounts', keywords: ['urgency', 'impact', 'timeline'] },
    ],
    nextSteps: [
      { label: 'Prepare for Procurement', targetStage: 'procurement' },
      { label: 'Build Mutual Action Plan', actionId: 'mutual-action-plan' },
      { label: 'Move to Closing', targetStage: 'closing' },
    ],
  },
  {
    id: 'procurement',
    label: 'Procurement / Legal / IT',
    shortLabel: 'Procurement',
    icon: Scale,
    description: 'Navigating procurement, legal review, and IT/security requirements.',
    actions: [
      {
        id: 'procurement-email', label: 'Draft Procurement Email', description: 'Professional email addressing procurement requirements.',
        icon: Mail,
        systemPrompt: `OBJECTIVE: Write an email that moves procurement forward efficiently.
AUDIENCE: Procurement, legal, or IT stakeholder.
OUTPUT STRUCTURE:
Start with "Subject: <subject line>" then:
1. CONTEXT — What's been agreed and where we are.
2. DOCUMENTATION — List of materials being provided.
3. TIMELINE — Expected process and milestones.
4. PROACTIVE ANSWERS — Address common procurement questions.
5. CONTACT — Who to reach for what.
TONE: Professional, efficient, thorough. Show you've done this before.
WHAT GOOD LOOKS LIKE: An email that reduces back-and-forth by 50%.`,
      },
      {
        id: 'security-questionnaire', label: 'Prep Security Responses', description: 'Common security and compliance question responses.',
        icon: Shield,
        systemPrompt: `OBJECTIVE: Prepare responses to common security and compliance questions.
AUDIENCE: IT/Security team evaluating your solution.
OUTPUT STRUCTURE:
1. DATA SECURITY — Encryption, access controls, data residency.
2. COMPLIANCE — SOC2, GDPR, HIPAA (as applicable).
3. INTEGRATION — SSO, API security, audit logs.
4. INCIDENT RESPONSE — Breach notification, SLAs.
5. BUSINESS CONTINUITY — Uptime, disaster recovery, backups.
TONE: Technical, precise, confident. No marketing language.
WHAT GOOD LOOKS LIKE: Responses that pass security review on first try.`,
      },
    ],
    defaultTactics: [
      { statement: 'Proactively provide all standard documents upfront', keywords: ['documents', 'proactive', 'procurement'] },
      { statement: 'Keep champion engaged during procurement to prevent stalls', keywords: ['champion', 'stall', 'momentum'] },
    ],
    nextSteps: [
      { label: 'Move to Closing', targetStage: 'closing' },
      { label: 'Update Champion', actionId: 'procurement-email' },
    ],
  },
  {
    id: 'closing',
    label: 'Closing',
    shortLabel: 'Closing',
    icon: Handshake,
    description: 'Final negotiations, approvals, and deal close.',
    actions: [
      {
        id: 'closing-email', label: 'Draft Closing Email', description: 'Email driving final decision and contract signature.',
        icon: Mail,
        systemPrompt: `OBJECTIVE: Write an email that drives the final decision.
AUDIENCE: Decision-maker or champion.
OUTPUT STRUCTURE:
Start with "Subject: <subject line>" then:
1. MOMENTUM RECAP — Brief summary of value validated.
2. TERMS SUMMARY — Key commercial terms agreed.
3. TIMELINE — What happens next and when.
4. URGENCY — Why closing now matters (business reasons, not artificial).
5. ASK — Specific next action to finalize.
TONE: Confident, direct, professional.
WHAT GOOD LOOKS LIKE: An email that makes signing feel like the obvious next step.`,
      },
      {
        id: 'negotiation-prep', label: 'Prep for Negotiation', description: 'Negotiation strategy with positions and concessions.',
        icon: Scale,
        systemPrompt: `OBJECTIVE: Prepare a negotiation strategy.
AUDIENCE: The sales rep entering final negotiation.
OUTPUT STRUCTURE:
1. IDEAL OUTCOME — Best case scenario.
2. WALK-AWAY POINT — Minimum acceptable terms.
3. THEIR LIKELY POSITIONS — What they'll push on.
4. YOUR LEVERAGE — Why they need you.
5. CONCESSION STRATEGY — What to give vs. what to trade.
6. TALKING POINTS — Key phrases for each scenario.
7. CLOSING TECHNIQUE — How to move from negotiation to signature.
TONE: Strategic, confident.
WHAT GOOD LOOKS LIKE: Walking in knowing every scenario.`,
      },
    ],
    defaultTactics: [
      { statement: 'Summarize all agreed value before discussing final terms', keywords: ['summarize', 'value', 'terms'] },
      { statement: 'Create mutual urgency through business timeline, not discounts', keywords: ['urgency', 'timeline', 'close'] },
    ],
    nextSteps: [
      { label: 'Plan Post-Sale Handoff', targetStage: 'post-sale' },
    ],
  },
  {
    id: 'post-sale',
    label: 'Post-Sale / Expansion',
    shortLabel: 'Post-Sale',
    icon: TrendingUp,
    description: 'Onboarding, expansion, and renewal conversations.',
    actions: [
      {
        id: 'kickoff-email', label: 'Draft Kickoff Email', description: 'Welcome email setting expectations for onboarding.',
        icon: Mail,
        systemPrompt: `OBJECTIVE: Write a kickoff email that sets the tone for a successful partnership.
AUDIENCE: The new customer.
OUTPUT STRUCTURE:
Start with "Subject: <subject line>" then:
1. CELEBRATION — Acknowledge the partnership.
2. WHAT'S NEXT — Onboarding timeline and milestones.
3. KEY CONTACTS — Who they'll work with.
4. FIRST ACTIONS — What they need to do.
5. COMMITMENT — Your dedication to their success.
TONE: Enthusiastic, organized, reassuring.
WHAT GOOD LOOKS LIKE: An email that makes them feel they chose the right partner.`,
      },
      {
        id: 'expansion-plan', label: 'Build Expansion Plan', description: 'Strategy for growing within the account.',
        icon: TrendingUp,
        systemPrompt: `OBJECTIVE: Create an expansion strategy for this account.
AUDIENCE: The account team.
OUTPUT STRUCTURE:
1. CURRENT STATE — What they have, adoption level, satisfaction.
2. EXPANSION OPPORTUNITIES — New use cases, departments, or products.
3. STAKEHOLDER MAP — Who to approach for expansion.
4. VALUE EVIDENCE — Results to reference.
5. TIMING — When to propose and why.
6. APPROACH — How to position expansion.
TONE: Strategic, data-informed.
WHAT GOOD LOOKS LIKE: A plan that turns one deal into many.`,
      },
      {
        id: 'renewal-prep', label: 'Prep for Renewal', description: 'Renewal conversation strategy.',
        icon: Repeat,
        systemPrompt: `OBJECTIVE: Prepare for a renewal conversation.
AUDIENCE: The sales rep.
OUTPUT STRUCTURE:
1. ACCOUNT HEALTH — Usage, satisfaction, risks.
2. VALUE DELIVERED — Key outcomes achieved.
3. RISKS — Churn signals or competitive threats.
4. EXPANSION OPPORTUNITY — Upsell possibilities.
5. PRICING STRATEGY — How to approach renewal pricing.
6. TALKING POINTS — Key messages for the conversation.
TONE: Consultative, data-driven.
WHAT GOOD LOOKS LIKE: Walking in knowing exactly what to say.`,
      },
    ],
    defaultTactics: [
      { statement: 'Reference specific outcomes achieved before discussing renewal', keywords: ['outcomes', 'results', 'renewal'] },
      { statement: 'Identify expansion opportunities before renewal conversation', keywords: ['expansion', 'upsell', 'opportunity'] },
    ],
    nextSteps: [
      { label: 'Start New Outbound for Expansion', targetStage: 'outbound' },
    ],
  },
];

export function getStageById(id: string): StageConfig | undefined {
  return STAGES.find(s => s.id === id);
}
