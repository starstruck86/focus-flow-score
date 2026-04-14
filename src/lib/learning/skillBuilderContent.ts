/**
 * Skill Builder Training Content — Deep, structured learning blocks.
 *
 * Each skill has: mental model, failure pattern, better pattern,
 * before/after example, mechanism explanation, micro drill, and practice CTA.
 * Written in realistic B2B AE language.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';

export interface TrainingContent {
  skill: SkillFocus;
  mentalModel: {
    title: string;
    body: string;
  };
  failurePattern: {
    label: string;
    description: string;
    example: string;
  };
  betterPattern: {
    label: string;
    description: string;
    example: string;
  };
  mechanism: string;
  microDrill: {
    prompt: string;
    instruction: string;
  };
  scoringDimensions: string[];
}

export const TRAINING_CONTENT: Record<string, TrainingContent> = {
  executive_response: {
    skill: 'executive_response',
    mentalModel: {
      title: 'Executives buy outcomes, not features',
      body: 'A VP or C-suite buyer has 12 minutes between meetings. They don\'t have time for your discovery framework or your platform walkthrough. They need to know: what\'s broken, what it costs, and how fast you fix it. If you can\'t say it in three sentences, you don\'t know it well enough. Every word that doesn\'t move the deal forward is a word that kills it.',
    },
    failurePattern: {
      label: 'The Feature Tour',
      description: 'Most reps default to explaining what the product does when talking to executives. They lead with capabilities, integrations, and "flexibility." The exec hears noise — not a reason to act.',
      example: '"So basically, our platform integrates with your existing tech stack — we support Shopify, Salesforce, HubSpot — and we have this really powerful segmentation engine that lets you build audiences based on behavioral data, purchase history, and engagement scores, and then you can trigger automations across email, SMS, and push…"',
    },
    betterPattern: {
      label: 'Outcome-First Framing',
      description: 'Strong reps lead with the business problem the exec already knows about, quantify the cost, and name a timeline. Features only appear as proof that the outcome is achievable.',
      example: '"Your team is spending 14 hours a week on manual segmentation — that\'s $280K annually in labor alone, before counting the revenue you\'re leaving on the table from delayed campaigns. We compress that to 2 hours. Most teams are live in 6 weeks."',
    },
    mechanism: 'The better version works because it matches how executives process information: problem → cost → solution → timeline. It respects their time by eliminating everything they don\'t need to hear. The number ($280K) makes the problem concrete and fundable. The timeline (6 weeks) makes the decision feel low-risk. No feature was mentioned — but the exec knows exactly what you do.',
    microDrill: {
      prompt: 'A CMO asks: "What does your platform actually do?"',
      instruction: 'Respond in 3 sentences or fewer. Lead with the business outcome, include a specific number, and end with a timeline. Do NOT name a single feature.',
    },
    scoringDimensions: ['brevity', 'numberLed', 'priorityAnchoring', 'executivePresence'],
  },

  objection_handling: {
    skill: 'objection_handling',
    mentalModel: {
      title: 'Objections are symptoms, not diagnoses',
      body: 'When a buyer says "we\'re happy with our current vendor," that\'s not a decision — it\'s a reflex. Behind every objection is an unspoken concern: risk, effort, timing, or politics. Your job isn\'t to counter the objection. It\'s to understand what\'s actually driving it, then address that. Reps who argue with the surface objection win debates but lose deals.',
    },
    failurePattern: {
      label: 'The Counter-Punch',
      description: 'Most reps hear an objection and immediately start selling harder. They treat "We\'re happy with Braze" as an invitation to list reasons their product is better. The buyer feels dismissed and digs in deeper.',
      example: '"I totally understand, but here\'s the thing — we actually have better deliverability rates, our segmentation is more advanced, and we just released a new AI feature that Braze doesn\'t have. Plus, three of your competitors already switched to us last quarter."',
    },
    betterPattern: {
      label: 'Acknowledge → Diagnose → Redirect',
      description: 'Strong reps validate the objection, then probe for the real concern underneath. They don\'t try to win the argument — they try to understand the landscape. The redirect only comes after the buyer feels heard.',
      example: '"That makes sense — rebuilding automations in a new platform is a real project. Can I ask: when your team built those flows in Braze, were they optimizing for what you need today, or was that 18 months ago when the business looked different?"',
    },
    mechanism: 'The better version works because it does three things simultaneously: (1) it validates the buyer\'s investment and effort, removing the adversarial dynamic; (2) it introduces doubt about whether the status quo still fits — without the rep stating it directly; (3) it invites the buyer to discover the gap themselves, which is far more persuasive than being told. The question "was that 18 months ago" is surgical — it reframes loyalty as potential staleness without attacking the buyer\'s judgment.',
    microDrill: {
      prompt: 'A Director of E-Commerce says: "We just renewed with our current vendor three months ago. There\'s no way I\'m switching now."',
      instruction: 'Respond in 2-3 sentences. Acknowledge their position genuinely, then ask ONE question that surfaces whether the renewal was based on current needs or momentum.',
    },
    scoringDimensions: ['composure', 'isolation', 'reframing', 'proof', 'commitmentControl'],
  },

  discovery: {
    skill: 'discovery',
    mentalModel: {
      title: 'Great discovery makes the buyer sell themselves',
      body: 'Discovery isn\'t an interrogation — it\'s an investigation. The best discovery calls end with the buyer articulating their own problem better than they could before the conversation started. Your questions should go deeper with each layer: from surface symptoms to operational impact to business cost to urgency. When you quantify a problem the buyer hasn\'t quantified, you create the deal.',
    },
    failurePattern: {
      label: 'The Question Checklist',
      description: 'Weak reps run through a list of pre-written questions regardless of what the buyer says. They stack multiple questions in one breath and move to the next topic before the buyer has finished answering.',
      example: '"What are your goals for this year? And what\'s your current tech stack? How many people are on your team? What\'s your budget for this?"',
    },
    betterPattern: {
      label: 'Single-Thread Depth',
      description: 'Strong reps ask one question, listen fully, then go one level deeper on whatever the buyer just said. They let silence work for them and use the buyer\'s own language back to them.',
      example: '"You mentioned your team spends a lot of time on manual segmentation — what does \'a lot\' look like in practice? [pause] And when a campaign launches late because of that, what does your VP actually say?"',
    },
    mechanism: 'The better version works because it demonstrates active listening and builds trust. By using the buyer\'s own words ("manual segmentation"), you show you\'re actually engaged. The follow-up question pushes past operational pain into organizational consequence — which is where budget gets allocated.',
    microDrill: {
      prompt: 'A buyer says: "We need better efficiency in our marketing operations."',
      instruction: 'Ask ONE follow-up question that takes "better efficiency" from a vague desire to a quantifiable business problem.',
    },
    scoringDimensions: ['questionArchitecture', 'painExcavation', 'painQuantification', 'businessImpact', 'urgencyTesting', 'stakeholderDiscovery'],
  },

  deal_control: {
    skill: 'deal_control',
    mentalModel: {
      title: 'If you don\'t own the next step, you don\'t own the deal',
      body: 'Deal control isn\'t about being pushy — it\'s about being organized when the buyer isn\'t. Most deals stall not because the buyer said no, but because nobody defined what happens next. The rep who proposes a specific next step, with a date, a deliverable, and a clear owner, is the rep who closes. Vague follow-ups are deal killers.',
    },
    failurePattern: {
      label: 'The Passive Close',
      description: 'Weak reps end calls with "I\'ll send you some info and we can circle back." There\'s no date, no commitment, no mutual accountability. The deal enters the void.',
      example: '"Great conversation! I\'ll put together some materials and send them over. Feel free to loop in anyone else who should see this. Let me know when you want to reconnect."',
    },
    betterPattern: {
      label: 'Mutual Commitment',
      description: 'Strong reps propose a specific next step with a date, name who should be involved, and get verbal commitment before the call ends.',
      example: '"Based on what you shared about the Q3 deadline, here\'s what I\'d suggest: I\'ll send a one-page business case by Thursday. You review it with Sarah from finance. We reconvene next Tuesday at 2pm to decide whether a technical evaluation makes sense. Does that work?"',
    },
    mechanism: 'The better version works because it creates mutual accountability. The buyer has a specific deliverable (review with Sarah), the rep has a deliverable (business case by Thursday), and there\'s a decision point (Tuesday). This eliminates the most common deal-killer: ambiguity about what happens next.',
    microDrill: {
      prompt: 'You just had a strong discovery call. The buyer says: "This is interesting — let me think about it and get back to you."',
      instruction: 'Respond with a specific next step proposal. Include a date, a deliverable, and who needs to be involved.',
    },
    scoringDimensions: ['nextStepControl', 'riskNaming', 'mutualPlan', 'stakeholderAlignment'],
  },

  qualification: {
    skill: 'qualification',
    mentalModel: {
      title: 'The best qualification is knowing when to walk away',
      body: 'Qualification isn\'t about checking boxes — it\'s about protecting your time and the buyer\'s. A deal without validated pain, a decision-maker, and a timeline is a deal that will waste 3 months of your pipeline. The discipline to disqualify early is what separates quota-carrying reps from everyone else. Ask the hard questions in the first call, not the fourth.',
    },
    failurePattern: {
      label: 'The Optimistic Pipeline',
      description: 'Weak reps accept surface-level interest as qualification. "They said they\'re interested" becomes a forecast commitment. No one asks whether there\'s budget, whether the decision-maker knows, or whether this actually solves a problem worth funding.',
      example: '"They loved the demo! The marketing manager wants to set up another call. I\'m putting this at 40% — should close by end of quarter."',
    },
    betterPattern: {
      label: 'Validate Before You Advance',
      description: 'Strong reps ask uncomfortable questions early: Is this funded? Who else needs to approve? What happens if you do nothing? They\'d rather kill a deal in week one than chase a ghost for three months.',
      example: '"You mentioned this is a priority — can you help me understand what happens if this doesn\'t get solved by Q3? And has your VP seen a business case for something like this before, or would this be the first time?"',
    },
    mechanism: 'The better version works because it tests two critical signals: urgency (what happens if you do nothing) and organizational readiness (has the VP seen this before). A "priority" without consequence isn\'t a priority. A VP who\'s never been pitched this type of solution means you\'re educating, not selling — very different motion, very different timeline.',
    microDrill: {
      prompt: 'A marketing manager says: "We definitely need something like this. Can you send me pricing?"',
      instruction: 'Before sharing pricing, ask ONE question that tests whether this is a real buying signal or polite interest.',
    },
    scoringDimensions: ['painValidation', 'stakeholderMapping', 'decisionProcess', 'disqualification'],
  },
};

export function getTrainingContent(skill: SkillFocus): TrainingContent | null {
  return TRAINING_CONTENT[skill] ?? null;
}
