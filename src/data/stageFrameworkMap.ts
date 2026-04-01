/**
 * Unified Sales Operating System — maps each Prep page to predefined
 * framework-driven sections that auto-populate with tagged KIs.
 *
 * Each framework owns a specific ROLE across the sales cycle:
 *   GAP Selling      → Discovery (current state, future state, gaps, impact)
 *   Challenger        → POV & teaching (reframes, insights, urgency)
 *   MEDDPICC         → Deal qualification & progression
 *   Command of the Message → Structure & narrative
 */

export interface FrameworkSection {
  /** Section heading displayed in the UI */
  heading: string;
  /** Brief description / prompt for this section */
  description: string;
}

export interface StageFrameworkRole {
  framework: string;
  /** The person behind the framework — used for badge labels */
  who: string;
  /** Short label explaining why this framework appears on this stage */
  role: string;
  /** Predefined sections for this framework on this page */
  sections: FrameworkSection[];
  /** Visual accent — maps to Tailwind color token */
  color: string;
}

/** Framework ↔ author mapping for badges */
export const FRAMEWORK_AUTHORS: Record<string, string> = {
  'GAP Selling': 'Keenan',
  'Challenger': 'Dixon',
  'MEDDPICC': 'McMahon',
  'Command of the Message': 'Force Management',
  '30MPC': 'Cegelski & Farrokh',
};

export const STAGE_FRAMEWORK_MAP: Record<string, StageFrameworkRole[]> = {
  /* ─── Account Snapshot (outbound) ─── */
  outbound: [
    {
      framework: 'Challenger',
      who: 'Dixon',
      role: 'Hypothesis-driven outreach',
      sections: [
        { heading: 'Business Overview', description: 'Key business context and industry positioning' },
        { heading: 'Digital / Lifecycle Signals', description: 'Tech stack, marketing maturity, digital presence' },
        { heading: 'Challenger Hypothesis', description: 'Insight-led hypothesis about what they are missing or getting wrong' },
      ],
      color: 'violet',
    },
    {
      framework: 'GAP Selling',
      who: 'Keenan',
      role: 'Problem-centric messaging',
      sections: [
        { heading: 'Problem Hypotheses', description: 'Likely current-state problems based on signals' },
        { heading: 'Impact Hooks', description: 'Business impact of those problems for outreach' },
      ],
      color: 'emerald',
    },
    {
      framework: 'Command of the Message',
      who: 'Force Management',
      role: 'Value messaging structure',
      sections: [
        { heading: 'Value Pillars for Outreach', description: 'Core value messages to use in prospecting' },
      ],
      color: 'amber',
    },
  ],

  /* ─── Discovery Prep ─── */
  discovery: [
    {
      framework: 'GAP Selling',
      who: 'Keenan',
      role: 'Current state → future state → gap → impact',
      sections: [
        { heading: 'Current State', description: 'Questions to understand where they are today' },
        { heading: 'Desired State', description: 'Questions to define where they want to be' },
        { heading: 'Problems / Gaps', description: 'Identify the gap between current and desired state' },
        { heading: 'Impact', description: 'Quantify the business impact of the gap' },
      ],
      color: 'emerald',
    },
    {
      framework: 'Challenger',
      who: 'Dixon',
      role: 'Blind spots & reframes',
      sections: [
        { heading: 'Blind Spots', description: 'What the prospect likely does not know or is wrong about' },
        { heading: 'Reframe Ideas', description: 'How to shift their thinking toward your solution' },
        { heading: 'Insight Hooks', description: 'Data points or stories that create constructive tension' },
      ],
      color: 'violet',
    },
    {
      framework: 'Command of the Message',
      who: 'Force Management',
      role: 'Conversation structure & pillars',
      sections: [
        { heading: 'Three Conversation Pillars', description: 'The three themes that should anchor every discovery conversation' },
      ],
      color: 'amber',
    },
    {
      framework: 'MEDDPICC',
      who: 'McMahon',
      role: 'Early qualification signals',
      sections: [
        { heading: 'Metrics to Uncover', description: 'What success metrics matter to them' },
        { heading: 'Economic Buyer Signals', description: 'Who controls budget and how to identify them' },
        { heading: 'Champion Indicators', description: 'Early signs of a potential champion' },
      ],
      color: 'blue',
    },
  ],

  /* ─── Call Plan ─── */
  call_plan: [
    {
      framework: 'Command of the Message',
      who: 'Force Management',
      role: 'Conversation structure',
      sections: [
        { heading: 'Opening', description: 'How to open the call — set context, earn permission' },
        { heading: 'Agenda', description: 'Structured agenda with time allocations' },
        { heading: 'Flow', description: 'Conversation flow and transitions between topics' },
      ],
      color: 'amber',
    },
    {
      framework: 'GAP Selling',
      who: 'Keenan',
      role: 'Key discovery questions',
      sections: [
        { heading: 'Key Discovery Questions', description: 'Questions that uncover current state, problems, and impact' },
      ],
      color: 'emerald',
    },
    {
      framework: 'Challenger',
      who: 'Dixon',
      role: 'Where to introduce insights',
      sections: [
        { heading: 'Insight Introduction Points', description: 'When and how to introduce teaching moments during the call' },
      ],
      color: 'violet',
    },
  ],

  /* ─── Demo Prep ─── */
  demo: [
    {
      framework: 'Challenger',
      who: 'Dixon',
      role: 'Teaching moments & insight delivery',
      sections: [
        { heading: 'Teaching Moments', description: 'Insights to share that reframe how they think about the problem' },
        { heading: 'Reframe', description: 'How to shift their perspective during the demo' },
      ],
      color: 'violet',
    },
    {
      framework: 'Command of the Message',
      who: 'Force Management',
      role: 'Narrative flow & structure',
      sections: [
        { heading: 'Demo Narrative', description: 'The story arc — before/after, problem/solution' },
        { heading: 'Demo Flow', description: 'Ordered sequence of what to show and why' },
      ],
      color: 'amber',
    },
    {
      framework: 'GAP Selling',
      who: 'Keenan',
      role: 'Tie to customer problems',
      sections: [
        { heading: 'Problem-to-Feature Mapping', description: 'Connect each feature shown to their specific stated problems' },
      ],
      color: 'emerald',
    },
  ],

  /* ─── Deal Strategy (Pricing / Champion / Procurement / Closing combined) ─── */
  deal_strategy: [
    {
      framework: 'MEDDPICC',
      who: 'McMahon',
      role: 'Full deal qualification & progression',
      sections: [
        { heading: 'Metrics', description: 'Quantifiable measures of success the buyer cares about' },
        { heading: 'Economic Buyer', description: 'Who has budget authority and how to access them' },
        { heading: 'Decision Criteria', description: 'What criteria will they use to evaluate options' },
        { heading: 'Decision Process', description: 'Steps, stakeholders, and timeline to a decision' },
        { heading: 'Paper Process', description: 'Legal, procurement, and administrative steps to close' },
        { heading: 'Competition', description: 'Who else is being evaluated and how to differentiate' },
        { heading: 'Champion', description: 'Who is selling internally for you and how to enable them' },
      ],
      color: 'blue',
    },
    {
      framework: 'GAP Selling',
      who: 'Keenan',
      role: 'Urgency & cost of inaction',
      sections: [
        { heading: 'Urgency', description: 'Why they need to act now — cost of delay, impact timeline' },
      ],
      color: 'emerald',
    },
    {
      framework: 'Challenger',
      who: 'Dixon',
      role: 'Risk framing',
      sections: [
        { heading: 'Risk Framing', description: 'Reframe risk of buying as lower than risk of inaction' },
      ],
      color: 'violet',
    },
  ],

  /* ─── Pricing / ROI ─── */
  pricing: [
    {
      framework: 'Command of the Message',
      who: 'Force Management',
      role: 'Value justification',
      sections: [
        { heading: 'Value Framework Recap', description: 'Revisit value pillars before pricing discussion' },
        { heading: 'ROI Narrative', description: 'Quantified return story for financial decision-makers' },
      ],
      color: 'amber',
    },
    {
      framework: 'GAP Selling',
      who: 'Keenan',
      role: 'Cost of inaction',
      sections: [
        { heading: 'Current State Cost', description: 'What the status quo costs them today' },
        { heading: 'Impact of Delay', description: 'What they lose by waiting' },
      ],
      color: 'emerald',
    },
    {
      framework: 'MEDDPICC',
      who: 'McMahon',
      role: 'Decision process navigation',
      sections: [
        { heading: 'Decision Criteria Alignment', description: 'Ensure pricing aligns to their evaluation criteria' },
        { heading: 'Paper Process Steps', description: 'What must happen administratively to close' },
      ],
      color: 'blue',
    },
  ],

  /* ─── Champion / Alignment ─── */
  champion: [
    {
      framework: 'MEDDPICC',
      who: 'McMahon',
      role: 'Champion development & testing',
      sections: [
        { heading: 'Champion Identification', description: 'Who is your champion and what makes them effective' },
        { heading: 'Champion Testing', description: 'Questions to test if your champion is real' },
        { heading: 'Champion Coaching', description: 'How to arm them for internal conversations' },
      ],
      color: 'blue',
    },
    {
      framework: 'Challenger',
      who: 'Dixon',
      role: 'Equipping with insights',
      sections: [
        { heading: 'Internal Selling Insights', description: 'Insights your champion can use to persuade others' },
        { heading: 'Executive Talking Points', description: 'What your champion should say to their leadership' },
      ],
      color: 'violet',
    },
    {
      framework: 'Command of the Message',
      who: 'Force Management',
      role: 'Arming with value narrative',
      sections: [
        { heading: 'Champion Value Story', description: 'A concise value narrative for your champion to retell' },
      ],
      color: 'amber',
    },
  ],

  /* ─── Procurement ─── */
  procurement: [
    {
      framework: 'MEDDPICC',
      who: 'McMahon',
      role: 'Paper process & decision navigation',
      sections: [
        { heading: 'Decision Process Map', description: 'Every step from verbal to signed contract' },
        { heading: 'Risk Identification', description: 'What could delay or kill the deal in procurement' },
      ],
      color: 'blue',
    },
    {
      framework: 'Command of the Message',
      who: 'Force Management',
      role: 'Maintaining value through procurement',
      sections: [
        { heading: 'Value Recap', description: 'Keep value front and center during procurement' },
        { heading: 'Concession Strategy', description: 'What to give vs. what to trade' },
      ],
      color: 'amber',
    },
  ],

  /* ─── Closing ─── */
  closing: [
    {
      framework: 'MEDDPICC',
      who: 'McMahon',
      role: 'Final qualification & risk check',
      sections: [
        { heading: 'MEDDPICC Scorecard', description: 'Final review of all qualification criteria' },
        { heading: 'Risk Signals', description: 'Red flags that could prevent close' },
      ],
      color: 'blue',
    },
    {
      framework: 'GAP Selling',
      who: 'Keenan',
      role: 'Urgency reinforcement',
      sections: [
        { heading: 'Cost of Inaction', description: 'Final urgency — what they lose by not deciding' },
      ],
      color: 'emerald',
    },
    {
      framework: 'Command of the Message',
      who: 'Force Management',
      role: 'Final value alignment',
      sections: [
        { heading: 'Executive Value Summary', description: 'One-page value story for the final decision-maker' },
      ],
      color: 'amber',
    },
  ],

  /* ─── Post-Sale / Expansion ─── */
  post_sale: [
    {
      framework: 'GAP Selling',
      who: 'Keenan',
      role: 'New gaps for expansion',
      sections: [
        { heading: 'Expansion Gaps', description: 'New problems that have emerged or were not addressed' },
        { heading: 'New Future State', description: 'What their next level of success looks like' },
      ],
      color: 'emerald',
    },
    {
      framework: 'MEDDPICC',
      who: 'McMahon',
      role: 'Expansion qualification',
      sections: [
        { heading: 'New Metrics & Success', description: 'Measurable outcomes for expansion conversation' },
        { heading: 'Expansion Champion', description: 'Who sponsors the next phase' },
      ],
      color: 'blue',
    },
    {
      framework: 'Challenger',
      who: 'Dixon',
      role: 'Ongoing insight delivery',
      sections: [
        { heading: 'Strategic Insights', description: 'New industry insights to share in business reviews' },
        { heading: 'Proactive Teaching', description: 'Thought leadership that deepens the relationship' },
      ],
      color: 'violet',
    },
  ],
};

/** Framework color mapping for UI badges */
export const FRAMEWORK_COLORS: Record<string, string> = {
  'GAP Selling': 'emerald',
  'Challenger': 'violet',
  'MEDDPICC': 'blue',
  'Command of the Message': 'amber',
  '30MPC': 'rose',
};

/** Get the framework color class for badges */
export function getFrameworkColorClasses(framework: string): { bg: string; text: string; border: string } {
  const color = FRAMEWORK_COLORS[framework];
  switch (color) {
    case 'emerald': return { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/20' };
    case 'violet': return { bg: 'bg-violet-500/10', text: 'text-violet-500', border: 'border-violet-500/20' };
    case 'blue': return { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20' };
    case 'amber': return { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/20' };
    case 'rose': return { bg: 'bg-rose-500/10', text: 'text-rose-500', border: 'border-rose-500/20' };
    default: return { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-muted' };
  }
}
