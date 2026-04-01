/**
 * Unified Sales Operating System — maps each Prep stage to the frameworks
 * that should drive its playbook sections.
 *
 * Each framework owns a specific ROLE across the sales cycle:
 *   GAP Selling      → Discovery (current state, future state, gaps, impact)
 *   Challenger        → POV & teaching (reframes, insights, urgency)
 *   MEDDPICC         → Deal qualification & progression
 *   Command of the Message → Structure & narrative
 */

export interface StageFrameworkRole {
  framework: string;
  /** Short label explaining why this framework appears on this stage */
  role: string;
  /** Suggested section headings the AI should produce */
  sections: string[];
  /** Visual accent — maps to Tailwind color token */
  color: string;
}

export const STAGE_FRAMEWORK_MAP: Record<string, StageFrameworkRole[]> = {
  outbound: [
    {
      framework: 'GAP Selling',
      role: 'Problem-centric messaging',
      sections: ['Problem Hypotheses', 'Current State Triggers', 'Impact Hooks'],
      color: 'emerald',
    },
    {
      framework: 'Challenger',
      role: 'Insight-led outreach',
      sections: ['Reframe Angles', 'Teaching POVs', 'Constructive Tension Openers'],
      color: 'violet',
    },
    {
      framework: 'Command of the Message',
      role: 'Value messaging structure',
      sections: ['Value Pillars for Outreach', 'Required Capabilities Hooks'],
      color: 'amber',
    },
  ],
  discovery: [
    {
      framework: 'GAP Selling',
      role: 'Current state → future state → gap → impact',
      sections: ['Current State Questions', 'Future State Vision', 'Gap Identification', 'Impact Quantification'],
      color: 'emerald',
    },
    {
      framework: 'Challenger',
      role: 'Blind spots & reframes',
      sections: ['Blind Spot Insights', 'Reframe Ideas', 'Commercial Teaching Moments'],
      color: 'violet',
    },
    {
      framework: 'Command of the Message',
      role: 'Conversation structure & pillars',
      sections: ['Conversation Flow', 'Required Capabilities', 'Positive Business Outcomes'],
      color: 'amber',
    },
    {
      framework: 'MEDDPICC',
      role: 'Early qualification signals',
      sections: ['Metrics to Uncover', 'Economic Buyer Signals', 'Champion Indicators'],
      color: 'blue',
    },
  ],
  demo: [
    {
      framework: 'Challenger',
      role: 'Teaching moments & insight delivery',
      sections: ['Teaching Moments', 'Insight Sequence', 'Constructive Tension Points'],
      color: 'violet',
    },
    {
      framework: 'Command of the Message',
      role: 'Narrative flow & structure',
      sections: ['Demo Storyline', 'Value Framework Alignment', 'Before/After Narrative'],
      color: 'amber',
    },
    {
      framework: 'GAP Selling',
      role: 'Tie to customer problems',
      sections: ['Problem-to-Feature Mapping', 'Gap Visualization', 'Impact Reinforcement'],
      color: 'emerald',
    },
  ],
  pricing: [
    {
      framework: 'Command of the Message',
      role: 'Value justification',
      sections: ['Value Framework Recap', 'ROI Narrative', 'Positive Business Outcomes'],
      color: 'amber',
    },
    {
      framework: 'GAP Selling',
      role: 'Cost of inaction',
      sections: ['Current State Cost', 'Gap Urgency', 'Impact of Delay'],
      color: 'emerald',
    },
    {
      framework: 'MEDDPICC',
      role: 'Decision process navigation',
      sections: ['Decision Criteria Alignment', 'Decision Process Map', 'Paper Process Steps'],
      color: 'blue',
    },
  ],
  champion: [
    {
      framework: 'MEDDPICC',
      role: 'Champion development & testing',
      sections: ['Champion Identification', 'Champion Testing Questions', 'Champion Coaching Plan'],
      color: 'blue',
    },
    {
      framework: 'Challenger',
      role: 'Equipping champions with insights',
      sections: ['Internal Selling Insights', 'Reframe Ammunition', 'Executive Talking Points'],
      color: 'violet',
    },
    {
      framework: 'Command of the Message',
      role: 'Arming with value narrative',
      sections: ['Champion Value Story', 'Required Capabilities Brief', 'Competitive Differentiation'],
      color: 'amber',
    },
  ],
  procurement: [
    {
      framework: 'MEDDPICC',
      role: 'Paper process & decision navigation',
      sections: ['Decision Process Mapping', 'Paper Process Steps', 'Risk Identification'],
      color: 'blue',
    },
    {
      framework: 'Command of the Message',
      role: 'Maintaining value through procurement',
      sections: ['Value Recap for Procurement', 'Concession Strategy', 'Differentiation Defense'],
      color: 'amber',
    },
  ],
  closing: [
    {
      framework: 'MEDDPICC',
      role: 'Final qualification & risk check',
      sections: ['MEDDPICC Scorecard Review', 'Risk Signals', 'Competition Assessment'],
      color: 'blue',
    },
    {
      framework: 'GAP Selling',
      role: 'Urgency reinforcement',
      sections: ['Gap Urgency Recap', 'Cost of Inaction', 'Impact Timeline'],
      color: 'emerald',
    },
    {
      framework: 'Command of the Message',
      role: 'Final value alignment',
      sections: ['Executive Value Summary', 'Before/After Narrative', 'Decision Confidence'],
      color: 'amber',
    },
  ],
  post_sale: [
    {
      framework: 'GAP Selling',
      role: 'New gaps for expansion',
      sections: ['Expansion Gaps', 'New Future State Vision', 'Adoption Impact'],
      color: 'emerald',
    },
    {
      framework: 'MEDDPICC',
      role: 'Expansion qualification',
      sections: ['New Metrics & Success', 'Expansion Champion', 'Cross-Sell Qualification'],
      color: 'blue',
    },
    {
      framework: 'Challenger',
      role: 'Ongoing insight delivery',
      sections: ['Strategic Business Reviews', 'Industry Insight Sharing', 'Proactive Teaching'],
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
};

/** Get the framework color class for badges */
export function getFrameworkColorClasses(framework: string): { bg: string; text: string; border: string } {
  const color = FRAMEWORK_COLORS[framework];
  switch (color) {
    case 'emerald': return { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/20' };
    case 'violet': return { bg: 'bg-violet-500/10', text: 'text-violet-500', border: 'border-violet-500/20' };
    case 'blue': return { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20' };
    case 'amber': return { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/20' };
    default: return { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-muted' };
  }
}
