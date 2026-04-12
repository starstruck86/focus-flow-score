/**
 * V6 Multi-Thread QA Fixtures
 *
 * Deterministic test scenarios covering all six validation groups.
 * Each fixture includes input + expected V6 behavior.
 */

import type { MultiThreadAssessment, DealMomentum, MultiThreadContext } from './multiThreadTypes';

// ── Fixture shape ─────────────────────────────────────────────────

export interface V6Fixture {
  id: string;
  group: V6FixtureGroup;
  label: string;
  /** Scenario context shown to scorer */
  context: string;
  /** Buyer prompt */
  objection: string;
  /** Rep response to evaluate */
  userResponse: string;
  /** Multi-thread context attached to scenario (if any) */
  multiThreadContext?: MultiThreadContext;
  /** Expected V6 behavior */
  expected: V6FixtureExpectation;
}

export type V6FixtureGroup =
  | 'no_activation'
  | 'light_activation'
  | 'strong_orchestration'
  | 'weak_orchestration'
  | 'ambiguous'
  | 'simulation';

export interface V6FixtureExpectation {
  shouldActivate: boolean;
  minStakeholdersDetected?: number;
  maxStakeholdersDetected?: number;
  expectedMomentum?: DealMomentum;
  expectMissedStakeholders?: boolean;
  coachingNoteKeywords?: string[];
  /** For no-activation: verify these are absent */
  mustBeAbsent?: ('multiThread' | 'DealMovementCard')[];
}

// ── Group 1: Should NOT activate ──────────────────────────────────

const NO_ACTIVATION_FIXTURES: V6Fixture[] = [
  {
    id: 'v6-no-1',
    group: 'no_activation',
    label: 'Simple cold call opener — single buyer',
    context: 'You are cold-calling a Director of Marketing at a $15M DTC brand. First touch.',
    objection: "I have 30 seconds. Why are you calling?",
    userResponse: "Your lifecycle revenue is leaking — brands like yours typically lose 15% of repeat revenue to gaps in segmentation. I'd need 15 minutes to show you where. Can we do Thursday?",
    expected: {
      shouldActivate: false,
      mustBeAbsent: ['multiThread', 'DealMovementCard'],
    },
  },
  {
    id: 'v6-no-2',
    group: 'no_activation',
    label: 'Single objection from one buyer',
    context: 'VP of Marketing at a DTC brand. Mid-discovery. Only one buyer present.',
    objection: "We just renewed Braze three months ago. I'm not ripping that out.",
    userResponse: "Totally get it — this isn't about ripping out Braze. Help me understand: when you think about lifecycle revenue, where is the biggest gap today?",
    expected: {
      shouldActivate: false,
      mustBeAbsent: ['multiThread', 'DealMovementCard'],
    },
  },
  {
    id: 'v6-no-3',
    group: 'no_activation',
    label: 'Linear discovery — single person',
    context: 'Sr. Manager of Retention at a mid-market DTC brand. Solo call.',
    objection: "Yeah, churn's been up about 12% quarter over quarter.",
    userResponse: "12% QoQ — is that concentrated in any segment, or is it broad-based?",
    expected: {
      shouldActivate: false,
      mustBeAbsent: ['multiThread', 'DealMovementCard'],
    },
  },
];

// ── Group 2: Should activate lightly ──────────────────────────────

const LIGHT_ACTIVATION_FIXTURES: V6Fixture[] = [
  {
    id: 'v6-light-1',
    group: 'light_activation',
    label: 'Marketing wants improvement, Ops worried about implementation',
    context: 'Discovery call with two stakeholders: Marketing Director (wants growth) and Ops Manager (worried about another integration).',
    objection: "We need better segmentation to hit revenue targets, but Ops is concerned about adding another tool to maintain.",
    userResponse: "I hear both sides. Let me ask — if we could show Ops that integration takes under 2 weeks and Marketing gets the segmentation lift, would that change the conversation?",
    multiThreadContext: {
      active: true,
      stakeholders: [
        { id: 'sh-1', role: 'marketing', stance: 'supportive', priority: 'growth', influenceLevel: 'high', perspective: 'We need better segmentation to hit revenue targets.' },
        { id: 'sh-2', role: 'ops', stance: 'skeptical', priority: 'efficiency', influenceLevel: 'medium', perspective: 'Another tool means another integration to maintain.' },
      ],
      tensionType: 'competing_priorities',
    },
    expected: {
      shouldActivate: true,
      minStakeholdersDetected: 2,
      expectedMomentum: 'forward',
      coachingNoteKeywords: ['Marketing', 'Ops'],
    },
  },
  {
    id: 'v6-light-2',
    group: 'light_activation',
    label: 'Lifecycle wants change, Analytics thinks reporting is enough',
    context: 'Discovery with Lifecycle Manager and Analytics Lead. Lifecycle owns retention; Analytics thinks dashboards solve the problem.',
    objection: "Churn is our biggest problem and we need new tooling. But Analytics thinks we can solve this with better dashboards.",
    userResponse: "That's a fair tension. Quick question — are the dashboards telling you why customers churn, or just that they churned? Because the 'why' is where the action is.",
    multiThreadContext: {
      active: true,
      stakeholders: [
        { id: 'sh-1', role: 'lifecycle', stance: 'supportive', priority: 'growth', influenceLevel: 'medium', perspective: 'Churn is our biggest problem and we need new tooling.' },
        { id: 'sh-2', role: 'analytics', stance: 'neutral', priority: 'efficiency', influenceLevel: 'low', perspective: 'We can probably solve this with better dashboards.' },
      ],
      tensionType: 'internal_misalignment',
    },
    expected: {
      shouldActivate: true,
      minStakeholdersDetected: 2,
      expectedMomentum: 'forward',
    },
  },
];

// ── Group 3: Strong positive orchestration ────────────────────────

const STRONG_ORCHESTRATION_FIXTURES: V6Fixture[] = [
  {
    id: 'v6-strong-1',
    group: 'strong_orchestration',
    label: 'Rep aligns conflicting stakeholders into shared problem',
    context: 'Deal control call. Champion (Director of CRM) is supportive but procurement wants two alternatives and VP Ops is skeptical after a bad migration.',
    objection: "I believe in this solution but procurement needs alternatives and our VP Ops is still burned from the last platform migration.",
    userResponse: "Let me help you frame this internally. Procurement's job is risk mitigation — so let's build a side-by-side that shows total cost of ownership including migration risk. For VP Ops, the question isn't whether migration is hard — it's whether staying put costs more. We can quantify that with your current churn data. Want me to build that comparison doc so you can walk it into the meeting with ammunition?",
    multiThreadContext: {
      active: true,
      stakeholders: [
        { id: 'sh-1', role: 'champion', stance: 'supportive', priority: 'growth', influenceLevel: 'medium', perspective: 'I believe in this solution but I need help getting buy-in.' },
        { id: 'sh-2', role: 'procurement', stance: 'neutral', priority: 'efficiency', influenceLevel: 'medium', perspective: 'We need to evaluate at least two alternatives.' },
        { id: 'sh-3', role: 'vp_ops', stance: 'skeptical', priority: 'stability', influenceLevel: 'high', perspective: 'Last platform migration cost us 3 months of productivity.' },
      ],
      tensionType: 'internal_misalignment',
    },
    expected: {
      shouldActivate: true,
      minStakeholdersDetected: 3,
      expectedMomentum: 'forward',
      expectMissedStakeholders: false,
      coachingNoteKeywords: ['champion', 'alignment'],
    },
  },
];

// ── Group 4: Weak orchestration / miss ────────────────────────────

const WEAK_ORCHESTRATION_FIXTURES: V6Fixture[] = [
  {
    id: 'v6-weak-1',
    group: 'weak_orchestration',
    label: 'Rep answers Marketing, ignores IT',
    context: 'Objection handling. Marketing wants the new platform for segmentation. Engineering/IT says they can build 80% in-house.',
    objection: "Marketing needs this for growth, but engineering says they can build it in-house for less.",
    userResponse: "Your Marketing team is right — the segmentation capabilities we offer are best-in-class. Let me show you a case study from a similar brand that saw 30% lift in retention after switching.",
    multiThreadContext: {
      active: true,
      stakeholders: [
        { id: 'sh-1', role: 'marketing', stance: 'supportive', priority: 'growth', influenceLevel: 'medium', perspective: 'We need this capability now, not in 6 months.' },
        { id: 'sh-2', role: 'engineering', stance: 'status_quo_champion', priority: 'stability', influenceLevel: 'high', perspective: 'We can build 80% of this in-house for less.' },
      ],
      tensionType: 'build_vs_buy',
    },
    expected: {
      shouldActivate: true,
      minStakeholdersDetected: 2,
      expectedMomentum: 'at_risk',
      expectMissedStakeholders: true,
      coachingNoteKeywords: ['engineering', 'ignored'],
    },
  },
  {
    id: 'v6-weak-2',
    group: 'weak_orchestration',
    label: 'Rep misses internal blocker entirely',
    context: 'Executive meeting. CMO is supportive, CTO is skeptical about stack complexity, CFO needs payback period.',
    objection: "Revenue growth is the board mandate but our CTO has concerns about stack complexity and the CFO wants clear payback data.",
    userResponse: "I appreciate that. Our platform is really powerful and we have over 200 integrations. Let me send you a deck with some case studies and we can follow up next week.",
    multiThreadContext: {
      active: true,
      stakeholders: [
        { id: 'sh-1', role: 'cmo', stance: 'supportive', priority: 'growth', influenceLevel: 'high', perspective: 'Revenue growth is the board mandate.' },
        { id: 'sh-2', role: 'cto', stance: 'skeptical', priority: 'stability', influenceLevel: 'high', perspective: 'We have 14 tools in the stack already.' },
        { id: 'sh-3', role: 'cfo', stance: 'neutral', priority: 'risk', influenceLevel: 'high', perspective: 'Show me the payback period.' },
      ],
      tensionType: 'competing_priorities',
    },
    expected: {
      shouldActivate: true,
      minStakeholdersDetected: 3,
      expectedMomentum: 'at_risk',
      expectMissedStakeholders: true,
    },
  },
];

// ── Group 5: Ambiguous wording ────────────────────────────────────

const AMBIGUOUS_FIXTURES: V6Fixture[] = [
  {
    id: 'v6-ambig-1',
    group: 'ambiguous',
    label: 'Buyer says "we" without clearly separate roles',
    context: 'Discovery call. Single buyer on the line uses "we" to represent the team.',
    objection: "We've been looking at this for a while. We think it could work but we're not sure about timing.",
    userResponse: "When you say 'we' — who's involved in making this decision? I want to make sure we're building a case that works for everyone.",
    expected: {
      shouldActivate: false,
      mustBeAbsent: ['multiThread'],
    },
  },
  {
    id: 'v6-ambig-2',
    group: 'ambiguous',
    label: 'Implied multiple interests but no explicit stakeholders',
    context: 'Mid-funnel conversation. Buyer mentions "the team" has different views but doesn\'t specify who.',
    objection: "The team has mixed feelings about switching. Some people like the current tool, others want something better.",
    userResponse: "That's common. Help me understand — who on the team is most impacted by the current limitations? I want to make sure we're solving the right problem for the right people.",
    expected: {
      shouldActivate: false,
      mustBeAbsent: ['multiThread'],
    },
  },
];

// ── Group 6: Simulation coverage ──────────────────────────────────

const SIMULATION_FIXTURES: V6Fixture[] = [
  {
    id: 'v6-sim-1',
    group: 'simulation',
    label: 'Friday sim with executive stakeholder tension',
    context: 'Executive ROI simulation. VP Marketing is supportive, Director IT is a status-quo champion, Head of Analytics is neutral.',
    objection: "We're leaving money on the table every quarter without this. But IT says integration complexity is being underestimated and Analytics wants unified data first.",
    userResponse: "Let me address each concern. IT is right that integration matters — that's why we start with a phased rollout that doesn't touch your existing data layer for 90 days. Analytics, unified data is actually the endgame here — this platform creates the single source of truth you're asking for. VP, the money-on-the-table number — can we quantify that? If it's $500K+ per quarter, the phased approach pays for itself in Q1.",
    multiThreadContext: {
      active: true,
      stakeholders: [
        { id: 'sh-1', role: 'vp_marketing', stance: 'supportive', priority: 'growth', influenceLevel: 'high', perspective: 'We are leaving money on the table every quarter without this.' },
        { id: 'sh-2', role: 'director_it', stance: 'status_quo_champion', priority: 'stability', influenceLevel: 'medium', perspective: 'Integration complexity is being underestimated.' },
        { id: 'sh-3', role: 'head_of_analytics', stance: 'neutral', priority: 'efficiency', influenceLevel: 'medium', perspective: 'We need unified data before adding more sources.' },
      ],
      tensionType: 'internal_misalignment',
    },
    expected: {
      shouldActivate: true,
      minStakeholdersDetected: 3,
      expectedMomentum: 'forward',
      expectMissedStakeholders: false,
    },
  },
];

// ── All fixtures ──────────────────────────────────────────────────

export const V6_FIXTURES: V6Fixture[] = [
  ...NO_ACTIVATION_FIXTURES,
  ...LIGHT_ACTIVATION_FIXTURES,
  ...STRONG_ORCHESTRATION_FIXTURES,
  ...WEAK_ORCHESTRATION_FIXTURES,
  ...AMBIGUOUS_FIXTURES,
  ...SIMULATION_FIXTURES,
];

export function getFixturesByGroup(group: V6FixtureGroup): V6Fixture[] {
  return V6_FIXTURES.filter(f => f.group === group);
}
