/**
 * Skill Intelligence Layer — Skill Decomposition
 *
 * Defines the deep structure of each skill:
 * sub-skills, frameworks, mental models, elite behaviors, and cheats.
 *
 * This is the brain of the system — NOT UI, NOT scoring.
 * It sits above KIs, patterns, and curriculum.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';

export interface Framework {
  name: string;
  steps: string[];
  explanation: string;
  whenToUse: string;
  whatGoodLooksLike: string;
  commonFailures: string[];
}

export interface SubSkill {
  name: string;
  frameworks: Framework[];
  mentalModel: string;
  eliteBehavior: string;
  cheats: string[];
}

export interface SkillDecomposition {
  skill: SkillFocus;
  label: string;
  subSkills: SubSkill[];
}

// ── Discovery ─────────────────────────────────────────────────────

const DISCOVERY: SkillDecomposition = {
  skill: 'discovery',
  label: 'Discovery',
  subSkills: [
    {
      name: 'Pain Excavation',
      frameworks: [
        {
          name: 'Three Whys Drill',
          steps: [
            'Surface the stated problem',
            'Ask why it matters to them specifically',
            'Ask why solving it now is different from before',
          ],
          explanation:
            'Most buyers give you the symptom. Three Whys forces you past the symptom into the root cause — the thing that actually gets budget.',
          whenToUse:
            'Early discovery when the buyer gives you a surface-level problem statement.',
          whatGoodLooksLike:
            'The buyer pauses, thinks, and says something they haven\'t said to other vendors. You hear "honestly" or "the real issue is…"',
          commonFailures: [
            'Accepting the first answer as the real problem',
            'Stacking all three whys in one sentence instead of letting each breathe',
            'Moving to solution before the pain is fully articulated',
          ],
        },
        {
          name: 'Cost-of-Inaction Frame',
          steps: [
            'Identify the stated pain',
            'Quantify the cost of staying where they are',
            'Project that cost forward 6–12 months',
            'Let the buyer state the number, not you',
          ],
          explanation:
            'People don\'t buy because the future is better — they buy because the present is too expensive. This frame forces the buyer to calculate what doing nothing actually costs.',
          whenToUse:
            'Mid-discovery, after you have a real problem but before the buyer has admitted urgency.',
          whatGoodLooksLike:
            'The buyer calculates a dollar figure or time cost themselves. They become the one arguing for change.',
          commonFailures: [
            'You state the cost instead of letting them discover it',
            'Using made-up industry benchmarks instead of their actual numbers',
            'Rushing past the moment when the buyer is doing mental math',
          ],
        },
      ],
      mentalModel:
        'Pain is not what they tell you — it\'s what they discover while telling you. Your job is to create the space for that discovery, not to diagnose.',
      eliteBehavior:
        'Top reps never accept the first version of the problem. They treat every stated pain as an entry point, not a destination. They ask one question, then go silent — letting the buyer fill the space with the real answer.',
      cheats: [
        'No number = no problem',
        'If they can\'t quantify it, it won\'t get funded',
        'Silence after a good question is your best tool',
        'The real pain is always in the second answer',
      ],
    },
    {
      name: 'Depth Creation',
      frameworks: [
        {
          name: 'Peel-Back Layering',
          steps: [
            'Mirror the buyer\'s last statement back to them',
            'Ask "what does that actually look like day-to-day?"',
            'Ask "who else feels this?"',
            'Ask "what have you tried so far?"',
          ],
          explanation:
            'Surface answers are social performances. Depth comes from making the buyer describe their reality in operational detail — not concepts, but daily friction.',
          whenToUse:
            'When a buyer gives you a high-level, polished answer that sounds rehearsed.',
          whatGoodLooksLike:
            'The buyer shifts from abstract language ("we need better efficiency") to specific language ("my team spends 4 hours every Monday rebuilding reports that break").',
          commonFailures: [
            'Asking multiple questions at once instead of one at a time',
            'Jumping to your solution when you hear a keyword',
            'Not following up on emotional signals in the buyer\'s language',
          ],
        },
      ],
      mentalModel:
        'Every answer has a layer beneath it. Your job is to go one level deeper every time. Stop when you hit emotion or money — those are real.',
      eliteBehavior:
        'Elite reps ask singular questions. They never stack. They treat every response as an invitation to go deeper, not a prompt to pivot. They are comfortable sitting in ambiguity for much longer than average reps.',
      cheats: [
        'One question at a time — always',
        'If they talk fast, they\'re on the surface',
        'If they slow down, you\'re getting somewhere real',
        'Never interrupt depth — ride it',
      ],
    },
    {
      name: 'Business Impact Mapping',
      frameworks: [
        {
          name: 'Impact Chain',
          steps: [
            'Name the problem in their words',
            'Ask what team/function it affects',
            'Ask what metric it moves',
            'Ask who cares about that metric',
          ],
          explanation:
            'Problems only get funded when they connect to someone with authority and a metric they own. Impact Chain traces the problem to the person who has both budget and urgency.',
          whenToUse:
            'After you have real pain but need to tie it to a business outcome that justifies budget and executive attention.',
          whatGoodLooksLike:
            'The buyer says something like "yeah, that\'s exactly what my VP keeps asking about" — you\'ve connected pain to power.',
          commonFailures: [
            'Stopping at the team level without reaching the metric',
            'Assuming you know which metric matters instead of asking',
            'Mapping impact to your product\'s strengths instead of their org\'s priorities',
          ],
        },
        {
          name: 'Revenue / Risk / Time Triangulation',
          steps: [
            'Ask: how does this affect revenue?',
            'Ask: what\'s the risk if nothing changes?',
            'Ask: what\'s the timeline pressure?',
          ],
          explanation:
            'Every business problem sits at the intersection of revenue impact, risk exposure, and time pressure. If you can triangulate all three, the deal qualifies itself.',
          whenToUse:
            'Late discovery or qualification when you need to test whether the pain is real enough to close.',
          whatGoodLooksLike:
            'The buyer gives you specific answers on at least 2 of the 3 dimensions without needing to "check with their team."',
          commonFailures: [
            'Asking all three back-to-back like a checklist instead of a conversation',
            'Accepting vague answers ("it\'s important") without pushing for specifics',
            'Leading the witness with your own numbers',
          ],
        },
      ],
      mentalModel:
        'Pain without business impact is a complaint. Pain with business impact is a project. Your job is to turn complaints into projects.',
      eliteBehavior:
        'Top reps always connect every problem to either revenue, cost, or competitive risk. They never leave a discovery call without at least one quantified business impact — and they make the buyer state it, not themselves.',
      cheats: [
        'If it doesn\'t connect to money, it won\'t get funded',
        'The person who owns the metric owns the budget',
        'Pain + impact + timeline = deal',
        'Complaints don\'t close — projects do',
      ],
    },
    {
      name: 'Urgency Testing',
      frameworks: [
        {
          name: 'Trigger Event Probe',
          steps: [
            'Ask: "What changed recently that made this a priority now?"',
            'Probe: "What happens if this doesn\'t get resolved this quarter?"',
            'Test: "Is there a specific date or event driving the timeline?"',
          ],
          explanation:
            'Urgency is never about your timeline — it\'s about theirs. Trigger events are the moments when the status quo broke. If there\'s no trigger, there\'s no urgency — and the deal will stall.',
          whenToUse:
            'Any time you need to understand whether the buyer will actually move or just keep "evaluating."',
          whatGoodLooksLike:
            'The buyer names a specific event: a board meeting, a quarter-end, a competitor win, a key hire, a budget deadline.',
          commonFailures: [
            'Confusing interest with urgency',
            'Not probing when the buyer says "soon" or "sometime this quarter"',
            'Creating false urgency instead of discovering real urgency',
          ],
        },
      ],
      mentalModel:
        'Deals don\'t close because you push — they close because something in their world demands action. Your job is to find the forcing function, not create one.',
      eliteBehavior:
        'Elite reps test urgency early and directly. They are not afraid to hear "there\'s no real timeline" because that information saves them from chasing dead deals. They qualify out faster than average reps qualify in.',
      cheats: [
        'No trigger event = no urgency = no deal this quarter',
        'Interest is not intent',
        '"Soon" means never unless you make them define it',
        'The best discovery question: "What changed?"',
      ],
    },
    {
      name: 'Stakeholder Discovery',
      frameworks: [
        {
          name: 'Org Power Map',
          steps: [
            'Ask who else is involved in this decision',
            'Ask who has tried to solve this before',
            'Ask who would block this if they disagreed',
            'Ask who signs off on budget',
          ],
          explanation:
            'Deals die in rooms you\'re not in. Stakeholder discovery reveals the real decision structure — not the org chart, but the influence map.',
          whenToUse:
            'After initial pain is established and before you demo or propose.',
          whatGoodLooksLike:
            'You can name 3+ people involved, their roles in the decision, and where each one stands on the problem you\'re solving.',
          commonFailures: [
            'Only talking to one person and assuming they have authority',
            'Asking "are you the decision maker?" which is always answered yes',
            'Not mapping blockers — only champions',
          ],
        },
      ],
      mentalModel:
        'You are not selling to a person — you are selling into a system. Understand the system and you control the deal. Ignore the system and the deal controls you.',
      eliteBehavior:
        'Top reps map the org before they pitch. They know that the person who talks to them is rarely the person who decides. They multi-thread early and naturally — not as a tactic, but as standard operating procedure.',
      cheats: [
        'The person who called you is almost never the person who decides',
        'Ask "who else cares about this?" — not "are you the decision maker?"',
        'If you can\'t name the blocker, you don\'t know the deal',
        'Champions sell when you\'re not in the room — give them the words',
      ],
    },
  ],
};

// ── Objection Handling ────────────────────────────────────────────

const OBJECTION_HANDLING: SkillDecomposition = {
  skill: 'objection_handling',
  label: 'Objection Handling',
  subSkills: [
    {
      name: 'Containment',
      frameworks: [
        {
          name: 'Acknowledge-Isolate-Redirect',
          steps: [
            'Acknowledge the objection without agreeing or arguing',
            'Isolate: "Is that the main concern, or is there something else?"',
            'Redirect to the business impact behind the concern',
          ],
          explanation:
            'Objections are rarely the real concern. They\'re tests. Containment means you don\'t let the objection expand — you shrink it to its real size before addressing it.',
          whenToUse:
            'The first time an objection surfaces. Before you answer anything.',
          whatGoodLooksLike:
            'The buyer narrows their concern to one specific thing. You now know what to actually address instead of defending against everything.',
          commonFailures: [
            'Immediately defending or explaining',
            'Treating every objection as equally important',
            'Arguing instead of isolating',
            'Getting emotional or defensive in tone',
          ],
        },
      ],
      mentalModel:
        'Objections are not attacks — they are requests for more information disguised as resistance. Your job is to decode, not defend.',
      eliteBehavior:
        'Top reps welcome objections. They stay physically still, lower their voice, and ask a question before they answer anything. They treat objections as information, not threats.',
      cheats: [
        'Never answer an objection before you isolate it',
        'The first objection is never the real one',
        'Pause beats speed every time',
        'Calm is contagious — so is panic',
      ],
    },
    {
      name: 'Reframing',
      frameworks: [
        {
          name: 'Feature-to-Impact Reframe',
          steps: [
            'Identify the objection\'s surface topic (usually price, feature, timing)',
            'Acknowledge the topic',
            'Reframe to business impact: "The real question is…"',
            'Connect to the pain they already told you about',
          ],
          explanation:
            'Buyers object on the surface (price, features, timeline). The real concern is always about impact, risk, or trust. Reframing moves the conversation from features to outcomes.',
          whenToUse:
            'When the buyer objects on price, features, or competitive comparison.',
          whatGoodLooksLike:
            'The buyer says "that\'s a good point" or visibly reconsiders their position. The conversation shifts from what your product does to what it means for their business.',
          commonFailures: [
            'Reframing to your talking points instead of their stated pain',
            'Being too clever — the buyer feels manipulated',
            'Reframing without first acknowledging the objection',
          ],
        },
      ],
      mentalModel:
        'You don\'t overcome objections — you change the frame. The person who controls the frame controls the conversation. Price is never the issue. Value clarity is.',
      eliteBehavior:
        'Top reps don\'t answer objections — they reposition the conversation. They move from "does it have this feature?" to "what would it mean for your business if it did?" They never argue on the buyer\'s terms.',
      cheats: [
        'Price objections are value objections in disguise',
        'Never compete on features — compete on outcomes',
        '"The real question is…" is the most powerful reframe opener',
        'Confusion = opportunity to reframe',
      ],
    },
    {
      name: 'Proof Deployment',
      frameworks: [
        {
          name: 'Relevant Proof Anchor',
          steps: [
            'Choose a proof point that matches the buyer\'s industry, size, or pain',
            'State the metric: "Company X saw Y result in Z timeframe"',
            'Connect to their specific situation: "Given what you told me about…"',
            'Close: "Would that kind of result address your concern?"',
          ],
          explanation:
            'Generic proof fails. Relevant proof converts. The closer your proof point is to the buyer\'s actual situation, the more trust it builds.',
          whenToUse:
            'After you\'ve isolated and reframed. When the buyer needs evidence, not more logic.',
          whatGoodLooksLike:
            'The buyer leans forward, asks a follow-up question about the proof point, or says "that\'s actually very similar to our situation."',
          commonFailures: [
            'Dumping every case study you have',
            'Using proof from a different industry without bridging',
            'Stating metrics without connecting them to the buyer\'s specific pain',
            'Using proof too early — before the objection is fully understood',
          ],
        },
      ],
      mentalModel:
        'Proof is not about showing off your wins — it\'s about reducing the buyer\'s risk perception. The right proof at the right moment turns skepticism into confidence.',
      eliteBehavior:
        'Top reps carry 3–5 proof points they know cold. They deploy exactly one at a time. They always connect the proof to the buyer\'s specific situation — never generic "we have 500 customers."',
      cheats: [
        'One perfect proof point beats ten mediocre ones',
        'Match their industry, their size, their pain — in that order',
        'Proof without relevance is noise',
        'The best proof makes the buyer say "that sounds like us"',
      ],
    },
    {
      name: 'Commitment Recovery',
      frameworks: [
        {
          name: 'Micro-Commitment Close',
          steps: [
            'After addressing the objection, check: "Does that address your concern?"',
            'If yes: propose a specific next step with a date',
            'If no: ask "What would need to be true for you to move forward?"',
            'Lock the next action before ending the conversation',
          ],
          explanation:
            'Objection handling without commitment recovery is just a good conversation. The entire point of handling an objection is to move the deal forward — not just to win the argument.',
          whenToUse:
            'Immediately after successfully addressing an objection. Every time.',
          whatGoodLooksLike:
            'The call ends with a calendar invite, not a promise to "circle back." The buyer agrees to a specific action by a specific date.',
          commonFailures: [
            'Handling the objection perfectly but not asking for the next step',
            'Accepting "let me think about it" without defining what that means',
            'Celebrating the win internally and losing the momentum externally',
          ],
        },
      ],
      mentalModel:
        'An objection handled without a commitment gained is a performance, not a sale. Always convert resolution into forward motion.',
      eliteBehavior:
        'Top reps close on every objection — not the deal, but the next step. They never leave a resolved objection hanging. They immediately propose a concrete next action.',
      cheats: [
        'Objection resolved + no next step = wasted effort',
        '"Let me think about it" = you didn\'t close the objection',
        'Always propose: "Based on that, should we…?"',
        'The next step is more important than the answer',
      ],
    },
  ],
};

// ── Deal Control ──────────────────────────────────────────────────

const DEAL_CONTROL: SkillDecomposition = {
  skill: 'deal_control',
  label: 'Deal Control',
  subSkills: [
    {
      name: 'Next Step Discipline',
      frameworks: [
        {
          name: 'Time-Bound Action Lock',
          steps: [
            'State the proposed next step explicitly',
            'Assign a specific date and time',
            'Confirm who will do what before then',
            'Send a calendar invite before the call ends',
          ],
          explanation:
            'Deals stall when next steps are vague. Time-bound actions create accountability on both sides. If the buyer won\'t commit to a specific time, the deal isn\'t real.',
          whenToUse:
            'The last 3 minutes of every single call. No exceptions.',
          whatGoodLooksLike:
            'The buyer accepts a calendar invite with a clear agenda for the next conversation. Both sides know exactly what happens next.',
          commonFailures: [
            'Ending with "I\'ll send over some info" instead of a specific action',
            'Letting the buyer say "I\'ll get back to you" without a date',
            'Not sending the invite during the call',
          ],
        },
      ],
      mentalModel:
        'You don\'t control the deal — you control the next step. The deal is just a series of next steps. If any step is undefined, the deal is dying.',
      eliteBehavior:
        'Top reps never end a call without a locked next step. They send the calendar invite while still on the call. They treat "I\'ll follow up" as a failure state.',
      cheats: [
        'No calendar invite = no next step',
        'Vague next steps are how deals die quietly',
        'Send the invite while you\'re still talking',
        'If they won\'t commit to a time, they won\'t commit to a deal',
      ],
    },
    {
      name: 'Risk Naming',
      frameworks: [
        {
          name: 'Direct Risk Call-Out',
          steps: [
            'Name the pattern you see: "I\'m noticing X"',
            'State the risk: "In my experience, when X happens, deals tend to…"',
            'Ask: "Is that what\'s happening here, or am I reading this wrong?"',
            'Listen for the real answer — it\'s usually in what they don\'t say',
          ],
          explanation:
            'Most reps avoid naming risk because it feels confrontational. But unnamed risk doesn\'t go away — it just kills the deal later. Naming it gives you a chance to address it.',
          whenToUse:
            'When you notice deal drift: delayed responses, missing stakeholders, vague timelines, or changing requirements.',
          whatGoodLooksLike:
            'The buyer respects the directness and either confirms the risk (which you can now address) or explains what\'s really happening (which is even better).',
          commonFailures: [
            'Ignoring warning signs and hoping they resolve',
            'Being too aggressive or accusatory in tone',
            'Naming the risk but not giving the buyer a face-saving way to respond',
          ],
        },
      ],
      mentalModel:
        'The deals you lose are the ones where you saw the risk and said nothing. Courage to name what you see is the defining trait of deal control.',
      eliteBehavior:
        'Top reps name risk early and directly. They don\'t wait for the forecast review to admit a deal is in trouble. They treat directness as a service to the buyer, not a risk.',
      cheats: [
        'If you\'re afraid to say it, it\'s probably the most important thing to say',
        'Silence about risk is agreement with risk',
        '"I\'m noticing…" is the gentlest way to drop a truth bomb',
        'Deals don\'t stall in meetings — they stall between them',
      ],
    },
    {
      name: 'Mutual Action Planning',
      frameworks: [
        {
          name: 'Joint Commitment Map',
          steps: [
            'List what YOU will deliver and by when',
            'List what THEY will do and by when',
            'Identify the decision milestone and date',
            'Agree on what happens if either side slips',
          ],
          explanation:
            'A mutual action plan creates shared ownership of the deal timeline. It transforms "I\'m selling to you" into "we\'re working on this together." It also tests whether the buyer is actually committed.',
          whenToUse:
            'Mid-to-late stage deals, after discovery is done and before formal proposal.',
          whatGoodLooksLike:
            'Both sides have a shared document with names, dates, and actions. The buyer is actively contributing to the plan — not just receiving it.',
          commonFailures: [
            'Creating a plan but not getting the buyer to add their commitments',
            'Making it too detailed or formal for the deal stage',
            'Not revisiting the plan in subsequent calls',
          ],
        },
      ],
      mentalModel:
        'A deal you control is a deal where both sides have commitments. If only you have action items, you\'re not in a deal — you\'re in a hope.',
      eliteBehavior:
        'Top reps co-create the plan with the buyer. They use the plan as a diagnostic tool: if the buyer won\'t commit to their part, the deal isn\'t real. They check the plan at the start of every call.',
      cheats: [
        'If they won\'t plan with you, they won\'t buy from you',
        'Check the plan every call — not just when you create it',
        'Their commitments matter more than yours',
        'A plan the buyer didn\'t co-author is a wishlist',
      ],
    },
    {
      name: 'Urgency Creation',
      frameworks: [
        {
          name: 'Consequence Framing',
          steps: [
            'Reference the pain they\'ve already stated',
            'Project the cost of delay: "Every month this continues, you\'re…"',
            'Introduce a natural deadline: contract end, budget cycle, board meeting',
            'Ask: "Given that, does the current timeline still make sense?"',
          ],
          explanation:
            'Real urgency is never created by discounts or fake deadlines. It\'s created by helping the buyer see the cost of their own delay. The urgency already exists — you just need to make it visible.',
          whenToUse:
            'When a deal is drifting or the buyer says "let\'s revisit next quarter."',
          whatGoodLooksLike:
            'The buyer adjusts their timeline forward. They start talking about internal deadlines you didn\'t know about. They become the one pushing for speed.',
          commonFailures: [
            'Using discount deadlines as fake urgency',
            'Pressuring instead of framing',
            'Creating urgency without connecting to real business pain',
          ],
        },
      ],
      mentalModel:
        'You never create urgency — you reveal it. The urgency is already in their business. Your job is to make the cost of inaction undeniable.',
      eliteBehavior:
        'Top reps never discount for urgency. They connect delay to the buyer\'s own stated pain. They make the buyer feel the cost of waiting — not the pressure of being sold to.',
      cheats: [
        'Discounts create speed, not urgency — they\'re not the same',
        'The cost of delay is always bigger than the cost of action',
        'Ask "what happens if you wait?" — not "what if I give you 10% off?"',
        'If the buyer isn\'t urgent, you haven\'t found real pain yet',
      ],
    },
  ],
};

// ── Executive Response ────────────────────────────────────────────

const EXECUTIVE_RESPONSE: SkillDecomposition = {
  skill: 'executive_response',
  label: 'Executive Response',
  subSkills: [
    {
      name: 'Brevity Under Pressure',
      frameworks: [
        {
          name: 'Three-Sentence Rule',
          steps: [
            'Lead with the conclusion or metric',
            'Support with one specific proof point',
            'Close with a question or next step',
          ],
          explanation:
            'Executives don\'t listen past 3 sentences unless the first one earns their attention. Brevity signals confidence. Over-explaining signals uncertainty.',
          whenToUse:
            'Every interaction with a VP+ level buyer. Every voicemail. Every executive email.',
          whatGoodLooksLike:
            'The executive leans in, asks a follow-up question, or says "tell me more." You earned more time because you didn\'t waste the first 10 seconds.',
          commonFailures: [
            'Starting with context instead of the conclusion',
            'Hedging with "I think" or "maybe" or "potentially"',
            'Using 10 sentences when 3 would do',
            'Filling silence with more words instead of letting the point land',
          ],
        },
      ],
      mentalModel:
        'Brevity is not about saying less — it\'s about saying only what matters. Every extra word dilutes your message. Executives respect people who respect their time.',
      eliteBehavior:
        'Top reps speak in outcomes, not processes. They answer the question before explaining the reasoning. They are comfortable with the silence that follows a direct statement.',
      cheats: [
        'If you can\'t say it in 3 sentences, you don\'t understand it well enough',
        'Lead with the number, not the narrative',
        'Hedging words = instant credibility loss',
        'Silence after a strong statement is power — don\'t fill it',
      ],
    },
    {
      name: 'Executive Anchoring',
      frameworks: [
        {
          name: 'Priority-First Frame',
          steps: [
            'Research their top 2–3 public priorities before the call',
            'Open with: "I know [priority] is top of mind for you…"',
            'Connect your value directly to that priority',
            'Ask: "Is that still the top priority, or has something shifted?"',
          ],
          explanation:
            'Executives only care about their priorities — not your product. If your first sentence isn\'t about their world, you\'ve lost them. Anchoring to their priority earns you credibility instantly.',
          whenToUse:
            'The first 30 seconds of any executive meeting. The opening line of any executive email.',
          whatGoodLooksLike:
            'The executive nods, corrects you with something more specific (which is gold), or says "exactly — that\'s why I took this meeting."',
          commonFailures: [
            'Opening with your company\'s story instead of their priority',
            'Using generic priorities instead of specific, researched ones',
            'Not asking whether the priority has shifted — it often has',
          ],
        },
      ],
      mentalModel:
        'You earn executive time by proving you understand their world before asking them to understand yours. Research is not optional — it\'s the price of admission.',
      eliteBehavior:
        'Top reps spend more time preparing for executive calls than running them. They open with insights, not introductions. They make the executive feel understood before they ask to be understood.',
      cheats: [
        'If you don\'t know their priorities, you\'re not ready for the meeting',
        'Executives give you 30 seconds — make the first sentence about them',
        'An insight earns more trust than a pitch',
        'When they correct you, celebrate — corrections are engagement',
      ],
    },
    {
      name: 'Number-Led Communication',
      frameworks: [
        {
          name: 'Metric-Story-Ask',
          steps: [
            'Open with a specific, relevant metric',
            'Support with a one-sentence story that gives context',
            'Close with a direct ask',
          ],
          explanation:
            'Executives think in numbers. Starting with a metric signals that you speak their language. The story makes it memorable. The ask makes it actionable.',
          whenToUse:
            'Any time you need to convey value to an executive — emails, pitches, follow-ups.',
          whatGoodLooksLike:
            '"Companies like yours are losing $2.3M/year to [problem]. We helped [similar company] recover 40% of that in 6 months. Can I show you how?"',
          commonFailures: [
            'Using metrics that are impressive but irrelevant to the buyer',
            'Burying the number in a paragraph instead of leading with it',
            'Using the metric without a story — numbers without context are forgettable',
          ],
        },
      ],
      mentalModel:
        'Numbers are the language of executives. If you can\'t speak in numbers, you can\'t speak to executives. Every conversation should have at least one metric that the buyer remembers after the call.',
      eliteBehavior:
        'Top reps memorize 3–5 metrics and deploy them precisely. They never use a metric without connecting it to the buyer\'s specific situation. They let the number create the urgency, not their tone.',
      cheats: [
        'No number = no credibility at the exec level',
        'The metric goes first — always',
        'If you can\'t remember your key metric, neither will the buyer',
        'One perfect number beats a slide deck full of charts',
      ],
    },
    {
      name: 'Composure and Certainty',
      frameworks: [
        {
          name: 'Certainty Projection',
          steps: [
            'Answer the question directly — no preamble',
            'Use definitive language: "we will" not "we could"',
            'If you don\'t know, say "I\'ll get you that answer by [specific time]"',
            'Never apologize for your price, timeline, or approach',
          ],
          explanation:
            'Executives are pattern-matching for competence. Certainty signals competence. Hedging signals risk. The way you say something matters as much as what you say.',
          whenToUse:
            'Any time an executive challenges you, questions your approach, or pushes back.',
          whatGoodLooksLike:
            'The executive trusts you more after the challenge than before it. They stop testing and start collaborating.',
          commonFailures: [
            'Starting answers with "that\'s a great question" (stalling)',
            'Hedging with qualifiers',
            'Over-explaining to compensate for uncertainty',
            'Apologizing for things that don\'t require an apology',
          ],
        },
      ],
      mentalModel:
        'Executives don\'t buy products — they buy confidence. Your composure under pressure tells them whether you can handle their business.',
      eliteBehavior:
        'Top reps are most composed when the conversation is hardest. They answer directly, hold eye contact, and speak slower when others would speed up. They treat challenges as invitations to demonstrate competence.',
      cheats: [
        '"That\'s a great question" = I\'m stalling — delete it from your vocabulary',
        'Slower speech = more authority',
        'Certainty is a choice, not a feeling',
        'The exec is testing you, not attacking you — pass the test',
      ],
    },
  ],
};

// ── Qualification ─────────────────────────────────────────────────

const QUALIFICATION: SkillDecomposition = {
  skill: 'qualification',
  label: 'Qualification',
  subSkills: [
    {
      name: 'Pain Validation',
      frameworks: [
        {
          name: 'Pain Reality Test',
          steps: [
            'Ask what they\'ve already tried to solve this',
            'Ask how long they\'ve lived with it',
            'Ask what happens if they don\'t solve it this year',
            'If all three answers are weak → it\'s not real pain',
          ],
          explanation:
            'Not all pain is real. Some is conversational — the buyer mentions it because you asked, not because they feel it. The Pain Reality Test separates real pain from polite pain.',
          whenToUse:
            'Early qualification, before you invest significant time in the deal.',
          whatGoodLooksLike:
            'The buyer has tried other solutions, has lived with the pain for a meaningful period, and can articulate specific consequences of not solving it.',
          commonFailures: [
            'Assuming any stated problem is qualified pain',
            'Not testing whether the pain is new or chronic-but-tolerated',
            'Skipping the "what happens if you don\'t solve it" question',
          ],
        },
      ],
      mentalModel:
        'If they haven\'t tried to solve it before and there\'s no consequence to not solving it now — it\'s not pain. It\'s a conversation topic.',
      eliteBehavior:
        'Top reps qualify pain more aggressively than average reps qualify budget. They know that real pain creates budget, not the other way around. They\'d rather disqualify fast than chase slow.',
      cheats: [
        'If they haven\'t tried to fix it, they don\'t really feel it',
        'Pain that\'s been tolerated for years won\'t become urgent because you showed up',
        '"What happens if you don\'t solve this?" is the most important question in sales',
        'Real pain has a history of failed attempts',
      ],
    },
    {
      name: 'Stakeholder Mapping',
      frameworks: [
        {
          name: 'Decision Architecture Map',
          steps: [
            'Identify: who initiated the search',
            'Identify: who controls budget',
            'Identify: who has veto power',
            'Identify: who influences the decision maker',
            'Ask: "What\'s the last time your org bought something like this, and how did it get approved?"',
          ],
          explanation:
            'The org chart is not the decision map. Understanding how this specific organization actually makes buying decisions is worth more than knowing every feature of your product.',
          whenToUse:
            'After initial discovery, before you invest in demo or proposal.',
          whatGoodLooksLike:
            'You can draw the decision on a whiteboard: who wants it, who pays for it, who could kill it, and how the approval actually flows.',
          commonFailures: [
            'Only knowing the champion and assuming they\'ll "handle it internally"',
            'Not asking about past purchases — the best predictor of process',
            'Confusing job title with actual decision authority',
          ],
        },
      ],
      mentalModel:
        'You are not selling to a person — you are navigating a system. The system has rules you can learn if you ask. Most reps never ask.',
      eliteBehavior:
        'Top reps ask "how did your org buy the last thing like this?" in the first meeting. They treat the buying process as something to discover, not something to assume.',
      cheats: [
        'The person who talks to you is rarely the person who decides',
        'Ask about the last purchase — it reveals the process better than any question',
        'Title ≠ authority',
        'If you can\'t name the blocker, you don\'t know the deal',
      ],
    },
    {
      name: 'Pipeline Discipline',
      frameworks: [
        {
          name: 'Qualification Gate System',
          steps: [
            'Define 3 must-have criteria for each pipeline stage',
            'Before advancing any deal, verify all criteria are met',
            'If criteria are not met, keep the deal in current stage or remove',
            'Review pipeline weekly using criteria — not gut feeling',
          ],
          explanation:
            'Most pipeline is fiction. Deals sit in stages they haven\'t earned because reps don\'t want to move them backward. Gate criteria force honesty and prevent surprise losses.',
          whenToUse:
            'Every pipeline review. Every forecast. Every deal advancement decision.',
          whatGoodLooksLike:
            'Your pipeline is smaller but dramatically more accurate. You miss fewer deals and waste less time on deals that were never real.',
          commonFailures: [
            'Advancing deals based on buyer enthusiasm instead of verified criteria',
            'Never moving deals backward once they\'re in pipeline',
            'Having pipeline criteria but not actually checking them',
          ],
        },
      ],
      mentalModel:
        'A smaller, honest pipeline always outperforms a larger, fictional one. The courage to disqualify is the foundation of predictable revenue.',
      eliteBehavior:
        'Top reps actively remove deals from their pipeline. They treat disqualification as skill, not failure. They would rather have 10 real deals than 40 hopeful ones.',
      cheats: [
        'If you\'re afraid to lose the deal by qualifying harder, it probably isn\'t real',
        'Hope is not a pipeline stage',
        'The best reps have the smallest pipelines and the highest close rates',
        'Removing a bad deal is a win, not a loss',
      ],
    },
    {
      name: 'Budget and Priority Testing',
      frameworks: [
        {
          name: 'Budget Reality Probe',
          steps: [
            'Ask: "Has budget been allocated for this?"',
            'If no: "What would it take to get budget allocated?"',
            'Ask: "Where does this rank against your other priorities?"',
            'Ask: "If this isn\'t in the top 3 priorities, what would move it there?"',
          ],
          explanation:
            'Budget questions are often avoided because they feel awkward. But a deal without budget or priority ranking is not a deal — it\'s a conversation.',
          whenToUse:
            'Before investing significant time in proposals, demos, or custom work.',
          whatGoodLooksLike:
            'You know whether budget exists, where it comes from, and where this project ranks against competing priorities.',
          commonFailures: [
            'Never asking about budget because it feels too direct',
            'Accepting "we\'ll find the budget" without understanding the process',
            'Not asking about competing priorities — budget is finite',
          ],
        },
      ],
      mentalModel:
        'Budget follows pain, and pain follows priority. If your project isn\'t in the top 3, it won\'t get funded no matter how much they like you.',
      eliteBehavior:
        'Top reps ask about budget in the first meeting — not the last. They frame budget conversations as collaborative planning, not interrogation. They know that budget objections in late stages are qualification failures in early stages.',
      cheats: [
        'Budget that doesn\'t exist yet isn\'t real budget — it\'s potential',
        'If it\'s not a top-3 priority, you\'re competing against their own projects',
        'Ask early, ask directly, ask without apologizing',
        'Late-stage budget objections = early-stage qualification failure',
      ],
    },
  ],
};

// ── Master Registry ───────────────────────────────────────────────

export const SKILL_DECOMPOSITIONS: Record<SkillFocus, SkillDecomposition> = {
  discovery: DISCOVERY,
  objection_handling: OBJECTION_HANDLING,
  deal_control: DEAL_CONTROL,
  executive_response: EXECUTIVE_RESPONSE,
  qualification: QUALIFICATION,
};

// ── Helpers ───────────────────────────────────────────────────────

/** Get decomposition for a specific skill */
export function getSkillDecomposition(skill: SkillFocus): SkillDecomposition {
  return SKILL_DECOMPOSITIONS[skill];
}

/** Get all sub-skills across all decompositions */
export function getAllSubSkills(): Array<{ skill: SkillFocus; subSkill: SubSkill }> {
  const result: Array<{ skill: SkillFocus; subSkill: SubSkill }> = [];
  for (const [skill, decomp] of Object.entries(SKILL_DECOMPOSITIONS)) {
    for (const sub of decomp.subSkills) {
      result.push({ skill: skill as SkillFocus, subSkill: sub });
    }
  }
  return result;
}

/** Get all frameworks across all skills */
export function getAllFrameworksList(): Array<{ skill: SkillFocus; subSkillName: string; framework: Framework }> {
  const result: Array<{ skill: SkillFocus; subSkillName: string; framework: Framework }> = [];
  for (const [skill, decomp] of Object.entries(SKILL_DECOMPOSITIONS)) {
    for (const sub of decomp.subSkills) {
      for (const fw of sub.frameworks) {
        result.push({ skill: skill as SkillFocus, subSkillName: sub.name, framework: fw });
      }
    }
  }
  return result;
}

/** Get all cheats for a skill */
export function getCheatsForSkill(skill: SkillFocus): string[] {
  const decomp = SKILL_DECOMPOSITIONS[skill];
  return decomp.subSkills.flatMap(s => s.cheats);
}

/** Get all elite behaviors for a skill */
export function getEliteBehaviors(skill: SkillFocus): Array<{ subSkill: string; behavior: string }> {
  const decomp = SKILL_DECOMPOSITIONS[skill];
  return decomp.subSkills.map(s => ({ subSkill: s.name, behavior: s.eliteBehavior }));
}
