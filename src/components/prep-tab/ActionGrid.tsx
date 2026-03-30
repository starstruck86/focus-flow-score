import { cn } from '@/lib/utils';
import { Search, MessageSquare, Phone, Mail, DollarSign, BarChart3 } from 'lucide-react';

export interface PrepAction {
  id: string;
  label: string;
  description: string;
  category: 'discovery' | 'pricing';
  icon: React.ElementType;
  systemPrompt: string;
}

const ACTIONS: PrepAction[] = [
  {
    id: 'discovery-plan',
    label: 'Build Discovery Plan',
    description: 'Structured plan with objectives, questions, and research for a discovery call.',
    category: 'discovery',
    icon: Search,
    systemPrompt: `OBJECTIVE: Create a comprehensive discovery call preparation plan that enables the rep to run a structured, insight-driven first meeting.

AUDIENCE: The sales rep preparing for this call — NOT the prospect.

OUTPUT STRUCTURE (use these exact section headers):
1. CALL OBJECTIVE — One sentence: what must we learn or confirm by the end of this call?
2. PRE-CALL RESEARCH — Key facts about the account, industry trends, and any signals that indicate urgency or fit.
3. OPENING FRAMEWORK — How to open the call (reference a trigger, ask a hypothesis question, or share a relevant insight).
4. DISCOVERY QUESTIONS — Organized by theme:
   - Current State (how they do it today)
   - Pain & Impact (what's broken and what it costs)
   - Decision Process (who decides, what's the timeline)
   - Vision & Priorities (where they want to be)
   Include 2-3 follow-up probes per main question.
5. COMPETITIVE LANDMINES — If a competitor is mentioned, questions that expose competitor weaknesses without bashing.
6. RED FLAGS TO WATCH — Signals that this deal may stall or not be real.
7. DESIRED OUTCOME — What "success" looks like at the end of this call (e.g., agreement to demo, intro to decision-maker).

TONE: Consultative, strategic, not salesy. Write as if coaching an elite rep.

WHAT GOOD LOOKS LIKE: A plan that makes the rep feel over-prepared — like they know more about the prospect's world than the prospect expects.`,
  },
  {
    id: 'discovery-questions',
    label: 'Generate Discovery Questions',
    description: 'Targeted questions based on persona, stage, and competitive landscape.',
    category: 'discovery',
    icon: MessageSquare,
    systemPrompt: `OBJECTIVE: Generate a set of high-quality, persona-specific discovery questions that reveal real business pain, urgency, and decision dynamics.

AUDIENCE: The sales rep — questions should be ready to ask verbatim.

OUTPUT STRUCTURE:
1. OPENING QUESTION — One strong opener that earns the right to ask more.
2. CURRENT STATE — 3-4 questions about how they handle this today.
3. PAIN & BUSINESS IMPACT — 3-4 questions that quantify the cost of the status quo.
4. DECISION PROCESS — 2-3 questions about stakeholders, timeline, and budget.
5. VISION & PRIORITIES — 2-3 questions about what "better" looks like.
6. COMPETITIVE CONTEXT — 2 questions that surface competitive dynamics without asking "who else are you looking at?"
7. CLOSING / NEXT STEP — 1-2 questions that naturally lead to a next step.

For each question, include a brief (one-line) note on WHY this question matters and what answer to listen for.

TONE: Natural, conversational — not robotic. Questions should sound like a smart peer asking, not an interrogation.

WHAT GOOD LOOKS LIKE: Questions that make the prospect think "that's a really good question" and reveal information they hadn't planned to share.`,
  },
  {
    id: 'prep-for-call',
    label: 'Prep for Call',
    description: 'Complete call prep with talking points, risks, and recommended approach.',
    category: 'discovery',
    icon: Phone,
    systemPrompt: `OBJECTIVE: Create a complete, actionable call preparation brief that a rep can review in 5 minutes before walking into any meeting.

AUDIENCE: The sales rep — this is their cheat sheet.

OUTPUT STRUCTURE:
1. MEETING OBJECTIVE — One line: what must happen in this meeting for it to be successful?
2. CONTEXT SNAPSHOT — 3-5 bullet points: what we know, what happened last, where we are in the deal.
3. KEY TALKING POINTS — 3-5 specific things to say or reinforce, ordered by importance.
4. QUESTIONS TO ASK — 3-5 targeted questions for this specific meeting (not generic discovery).
5. OBJECTIONS TO EXPECT — 2-3 likely objections with one-line responses.
6. COMPETITIVE POSITIONING — If competitor is in play: one key differentiator to reinforce, one weakness to exploit (tactfully).
7. RISKS & WATCHOUTS — What could go wrong? Signals that the deal is stalling.
8. DESIRED NEXT STEP — Exactly what commitment to ask for at the end.

TONE: Direct, tactical, scannable. Use bullet points, not paragraphs.

WHAT GOOD LOOKS LIKE: A brief that a rep reads in 3 minutes and walks into the meeting feeling fully armed.`,
  },
  {
    id: 'recap-email',
    label: 'Create Recap Email',
    description: 'Professional recap email summarizing key points and next steps.',
    category: 'discovery',
    icon: Mail,
    systemPrompt: `OBJECTIVE: Write a professional, concise recap email that reinforces key discussion points, confirms next steps, and maintains deal momentum.

AUDIENCE: The prospect / customer who was in the meeting.

OUTPUT STRUCTURE:
Start with "Subject: <subject line>" on the first line, then a blank line, then:
1. GREETING + THANK YOU — One line, genuine, not generic.
2. KEY TAKEAWAYS — 3-5 bullet points summarizing what was discussed. Frame in terms of THEIR priorities, not yours.
3. AGREED NEXT STEPS — Numbered list with: action item, owner, and date/timeline.
4. OPEN QUESTIONS — Any items that need follow-up (optional, only if relevant).
5. CLOSING — One sentence reinforcing value and enthusiasm for the partnership.

TONE: Executive-level, concise, professional. No filler. Every sentence should earn its place.

WHAT GOOD LOOKS LIKE: An email the recipient forwards to their boss because it clearly captures the discussion and makes you look organized and trustworthy.`,
  },
  {
    id: 'pricing-call-prep',
    label: 'Prep for Pricing Call',
    description: 'Pricing call playbook with objection handling and value framing.',
    category: 'pricing',
    icon: DollarSign,
    systemPrompt: `OBJECTIVE: Create a pricing conversation playbook that leads with value, handles objections confidently, and positions the deal for close.

AUDIENCE: The sales rep going into a pricing discussion.

OUTPUT STRUCTURE:
1. VALUE NARRATIVE — 3-4 sentence value story that connects your solution to their specific business outcomes. Lead with impact, not features.
2. PRICING PRESENTATION STRATEGY — How to present the number: anchor high, show tiers, or lead with ROI? Recommend the best approach for this deal.
3. ANTICIPATED OBJECTIONS — Top 3-5 objections with:
   - The objection (verbatim, how they'd say it)
   - The response (1-3 sentences)
   - The reframe (how to redirect to value)
4. ROI TALKING POINTS — 3-4 specific metrics or data points to reference.
5. COMPETITIVE PRICE POSITIONING — If competitor is cheaper: why that's expected and why it's not apples-to-apples.
6. NEGOTIATION BOUNDARIES — What you can flex on, what you can't, and what to trade (e.g., longer term for better rate).
7. CLOSING MOVE — How to transition from pricing discussion to commitment.

TONE: Confident, consultative. Never defensive about price.

WHAT GOOD LOOKS LIKE: A playbook that makes the rep feel like pricing is a natural continuation of the value conversation, not a scary moment.`,
  },
  {
    id: 'cfo-email',
    label: 'Generate CFO Email',
    description: 'Executive-level email focused on ROI, risk mitigation, and business impact.',
    category: 'pricing',
    icon: Mail,
    systemPrompt: `OBJECTIVE: Write a CFO-facing email that speaks the language of financial decision-makers — ROI, risk, efficiency, and strategic value.

AUDIENCE: CFO, VP Finance, or financial decision-maker.

OUTPUT STRUCTURE:
Start with "Subject: <subject line>" on the first line, then a blank line, then:
1. OPENING — One sentence that connects to a business priority they care about (cost reduction, revenue growth, operational efficiency). No small talk.
2. BUSINESS CASE SUMMARY — 3-4 sentences covering:
   - What problem this solves (in financial terms)
   - Quantified impact (save X, gain Y, reduce Z by N%)
   - Time to value
3. RISK MITIGATION — 2-3 bullet points on why this is a safe bet (proven results, implementation support, contract flexibility).
4. COMPETITIVE URGENCY — One line on why acting now matters (market timing, competitor moves, contract alignment).
5. ASK — One clear, specific call to action (15-minute call, review proposal, approve pilot).

TONE: Executive, data-driven, respectful of their time. No jargon. No marketing speak. Every word must earn its place.

WHAT GOOD LOOKS LIKE: An email a CFO actually reads (short), finds credible (data-backed), and acts on (clear ask). Under 200 words.`,
  },
  {
    id: 'roi-summary',
    label: 'Build ROI Summary',
    description: 'Quantified ROI document with metrics, comparisons, and business case.',
    category: 'pricing',
    icon: BarChart3,
    systemPrompt: `OBJECTIVE: Create a quantified ROI summary document that serves as a decision-making tool for financial stakeholders.

AUDIENCE: CFO, VP Finance, procurement, or anyone evaluating the financial case.

OUTPUT STRUCTURE:
1. EXECUTIVE SUMMARY — 3-4 sentences: what's the investment, what's the return, what's the timeline.
2. CURRENT STATE COST ANALYSIS — Break down what they're spending today (people, tools, inefficiency, opportunity cost). Use specific categories.
3. PROJECTED IMPACT — Quantify in three dimensions:
   - Revenue impact (new revenue, retention, expansion)
   - Cost savings (headcount efficiency, tool consolidation, process automation)
   - Risk reduction (compliance, churn prevention, competitive defense)
4. IMPLEMENTATION TIMELINE — Phase 1 / Phase 2 / Full value milestones with dates.
5. PAYBACK PERIOD — When does the investment break even?
6. COMPETITIVE COMPARISON — How this compares to alternatives (cost, capability, risk).
7. RECOMMENDATION — Clear "we recommend" statement with rationale.

TONE: Professional, analytical, evidence-based. Use numbers wherever possible. Where exact numbers aren't available, use reasonable ranges with stated assumptions.

WHAT GOOD LOOKS LIKE: A document a CFO can hand to their team and say "this is why we're doing this."`,
  },
];

interface Props {
  selectedAction: PrepAction | null;
  onSelectAction: (a: PrepAction) => void;
}

export function ActionGrid({ selectedAction, onSelectAction }: Props) {
  const discovery = ACTIONS.filter(a => a.category === 'discovery');
  const pricing = ACTIONS.filter(a => a.category === 'pricing');

  const renderCategory = (label: string, actions: PrepAction[], cols: string) => (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      <div className={cn('grid gap-2', cols)}>
        {actions.map(a => {
          const Icon = a.icon;
          const active = selectedAction?.id === a.id;
          return (
            <button
              key={a.id}
              onClick={() => onSelectAction(a)}
              className={cn(
                'flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all',
                active
                  ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30'
                  : 'border-border hover:border-primary/40 hover:bg-accent/30'
              )}
            >
              <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} />
              <span className={cn('text-xs font-medium leading-tight', active && 'text-primary')}>{a.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">What do you need?</h3>
      {renderCategory('Discovery', discovery, 'grid-cols-2 sm:grid-cols-4')}
      {renderCategory('Pricing', pricing, 'grid-cols-2 sm:grid-cols-3')}
    </div>
  );
}

export { ACTIONS };
