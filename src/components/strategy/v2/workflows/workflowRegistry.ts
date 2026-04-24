/**
 * workflowRegistry — single source of truth for every "Click → Configure → Run"
 * accelerator surfaced in the Strategy sidebar.
 *
 * Three families, one shape:
 *   • Mode pills        (Brainstorm / Deep Research / Refine)
 *   • Library workflows (create from your knowledge)
 *   • Artifact templates (reusable document templates)
 *
 * Each workflow declares:
 *   - id / label / description / icon hint
 *   - field schema (lightweight; no validation engine)
 *   - promptTemplate using {{Field Label}} interpolation
 *
 * Frontend-only. No backend, no engine changes. The compiled prompt is sent
 * through the existing Strategy composer/send path.
 */
export type FieldKind = 'text' | 'textarea' | 'select';

export interface WorkflowField {
  key: string;
  label: string;
  placeholder?: string;
  kind: FieldKind;
  required?: boolean;
  options?: string[];
  rows?: number;
}

export type WorkflowFamily = 'mode' | 'library' | 'artifact';

/** Output shape preferred by this pill - drives engine routing + prompt header. */
export type PillOutputType =
  | 'chat' | 'artifact' | 'word' | 'pdf' | 'excel' | 'powerpoint' | 'email' | 'task';

/** What happens when the user clicks a pill. */
export type PillRunMode = 'insert' | 'send';

export interface WorkflowDef {
  id: string;
  family: WorkflowFamily;
  groupId: string;
  label: string;
  description: string;
  formTitle?: string;
  fields: WorkflowField[];
  /** Tokens reference field labels in {{Title Case}} form. */
  promptTemplate: string;
  /** Hidden "system" instruction - prepended at run time. */
  instruction?: string;
  /** Default output shape - surfaced in prompt header so the engine knows. */
  outputType?: PillOutputType;
  /** Insert into composer (default) or send immediately on click. */
  runMode?: PillRunMode;
  /** Ask clarifying questions before generating. */
  askClarifying?: boolean;
  isCustom?: boolean;
  customPillId?: string;
}

// ──────────────────────────── MODE PILLS ────────────────────────────

const MODE_BRAINSTORM: WorkflowDef[] = [
  {
    id: 'brainstorm.angles',
    family: 'mode',
    groupId: 'brainstorm',
    label: 'Generate angles',
    description: 'Spin up multiple angles for a topic, audience, or message.',
    fields: [
      { key: 'topic', label: 'Topic', kind: 'text', placeholder: 'e.g. Outbound to Sephora marketing leadership', required: true },
      { key: 'audience', label: 'Audience', kind: 'text', placeholder: 'e.g. VP Loyalty, CMO, Head of CRM' },
      { key: 'count', label: 'How many angles?', kind: 'select', options: ['5', '8', '12'] },
    ],
    promptTemplate:
      'Generate {{How many angles?}} distinct angles I could take on this topic.\n\n' +
      'Topic: {{Topic}}\n' +
      'Audience: {{Audience}}\n\n' +
      'For each angle: a 1-line headline, the underlying insight, and why it would land with this audience. ' +
      'Push for variety — do not repeat the same idea in different words.',
  },
  {
    id: 'brainstorm.campaign_ideas',
    family: 'mode',
    groupId: 'brainstorm',
    label: 'Create campaign ideas',
    description: 'Brainstorm campaign concepts grounded in a specific goal.',
    fields: [
      { key: 'goal', label: 'Goal', kind: 'text', placeholder: 'e.g. Open 5 new enterprise retail logos in Q1', required: true },
      { key: 'segment', label: 'Segment / ICP', kind: 'text', placeholder: 'e.g. Enterprise beauty + apparel' },
      { key: 'constraints', label: 'Constraints', kind: 'textarea', rows: 3, placeholder: 'Budget, channels, timing…' },
    ],
    promptTemplate:
      'Brainstorm 6 campaign concepts for this goal.\n\n' +
      'Goal: {{Goal}}\n' +
      'Segment / ICP: {{Segment / ICP}}\n' +
      'Constraints: {{Constraints}}\n\n' +
      'For each concept: name, hypothesis, channel mix, and the one-line elevator pitch.',
  },
  {
    id: 'brainstorm.hooks',
    family: 'mode',
    groupId: 'brainstorm',
    label: 'Messaging hooks',
    description: 'Generate sharp hooks for outbound or content.',
    fields: [
      { key: 'product', label: 'What we sell', kind: 'text', required: true },
      { key: 'pain', label: 'Customer pain', kind: 'textarea', rows: 3, placeholder: 'What hurts today?' },
      { key: 'tone', label: 'Tone', kind: 'select', options: ['Direct', 'Curious', 'Bold', 'Quiet expertise'] },
    ],
    promptTemplate:
      'Generate 8 messaging hooks I could open with — short, punchy, no fluff.\n\n' +
      'What we sell: {{What we sell}}\n' +
      'Customer pain: {{Customer pain}}\n' +
      'Tone: {{Tone}}\n\n' +
      'Each hook: max 18 words. No corporate language.',
  },
  {
    id: 'brainstorm.pov',
    family: 'mode',
    groupId: 'brainstorm',
    label: 'Build POV',
    description: 'Develop a defensible point of view on a market or topic.',
    fields: [
      { key: 'topic', label: 'Topic', kind: 'text', required: true, placeholder: 'e.g. Why loyalty programs fail in beauty retail' },
      { key: 'evidence', label: 'Evidence I have', kind: 'textarea', rows: 4 },
    ],
    promptTemplate:
      'Help me build a defensible point of view on this topic.\n\n' +
      'Topic: {{Topic}}\n' +
      'Evidence I already have: {{Evidence I have}}\n\n' +
      'Structure: (1) the contrarian thesis in one line, (2) the 3 supporting pillars, ' +
      '(3) the strongest objection and how I rebut it, (4) the call to action.',
  },
];

const MODE_DEEP_RESEARCH: WorkflowDef[] = [
  {
    id: 'research.company',
    family: 'mode',
    groupId: 'deep_research',
    label: 'Research company',
    description: 'Build a research brief on a specific company.',
    fields: [
      { key: 'company', label: 'Company', kind: 'text', required: true },
      { key: 'why', label: 'Why I am researching', kind: 'textarea', rows: 3, placeholder: 'Outbound, expansion, renewal…' },
      { key: 'depth', label: 'Depth', kind: 'select', options: ['Quick scan', 'Standard brief', 'Deep dive'] },
    ],
    promptTemplate:
      'Research {{Company}} and produce a {{Depth}}.\n\n' +
      'Why I am researching: {{Why I am researching}}\n\n' +
      'Cover: business model, recent signals, leadership/buying committee, technology footprint, ' +
      'plausible pains, and the 3 angles most likely to land.',
  },
  {
    id: 'research.competitors',
    family: 'mode',
    groupId: 'deep_research',
    label: 'Analyze competitors',
    description: 'Map the competitive landscape for a deal or market.',
    fields: [
      { key: 'context', label: 'Context', kind: 'textarea', rows: 3, required: true, placeholder: 'Account, deal, or market context' },
      { key: 'competitors', label: 'Known competitors', kind: 'textarea', rows: 2 },
    ],
    promptTemplate:
      'Analyze the competitive landscape for this context.\n\n' +
      'Context: {{Context}}\n' +
      'Known competitors: {{Known competitors}}\n\n' +
      'For each: positioning, strengths, weaknesses, where I beat them, where I lose, ' +
      'and the trap-setting questions to ask the buyer.',
  },
  {
    id: 'research.account_brief',
    family: 'mode',
    groupId: 'deep_research',
    label: 'Build account brief',
    description: 'Compile a structured account brief.',
    fields: [
      { key: 'account', label: 'Account', kind: 'text', required: true },
      { key: 'objective', label: 'Objective', kind: 'text', placeholder: 'e.g. Land first meeting with VP' },
    ],
    promptTemplate:
      'Build a structured account brief for {{Account}}.\n\n' +
      'Objective: {{Objective}}\n\n' +
      'Sections: Snapshot · Strategic priorities · Buying committee · Recent signals · ' +
      'Pain hypotheses · Recommended approach · Risks.',
  },
  {
    id: 'research.risks_gaps',
    family: 'mode',
    groupId: 'deep_research',
    label: 'Find risks & gaps',
    description: 'Pressure-test a deal or plan for blind spots.',
    fields: [
      { key: 'subject', label: 'Deal or plan', kind: 'textarea', rows: 4, required: true },
    ],
    promptTemplate:
      'Pressure-test this deal/plan for risks and gaps.\n\n' +
      '{{Deal or plan}}\n\n' +
      'List: (1) the 5 most likely deal-killing risks, (2) the gaps in my information, ' +
      '(3) the questions I am avoiding, (4) what a skeptical CRO would push back on.',
  },
];

const MODE_REFINE: WorkflowDef[] = [
  {
    id: 'refine.email',
    family: 'mode',
    groupId: 'refine',
    label: 'Improve this email',
    description: 'Sharpen an email draft without losing voice.',
    fields: [
      { key: 'draft', label: 'Email draft', kind: 'textarea', rows: 8, required: true },
      { key: 'goal', label: 'What it should do', kind: 'text', placeholder: 'e.g. Get a 15-min meeting' },
    ],
    promptTemplate:
      'Improve this email. Keep my voice; cut filler; sharpen the ask.\n\n' +
      'Goal of the email: {{What it should do}}\n\n' +
      'Draft:\n{{Email draft}}\n\n' +
      'Return: the improved version + a 3-bullet rationale of what you changed and why.',
  },
  {
    id: 'refine.tighten',
    family: 'mode',
    groupId: 'refine',
    label: 'Tighten messaging',
    description: 'Cut bloat and sharpen any piece of messaging.',
    fields: [
      { key: 'text', label: 'Text', kind: 'textarea', rows: 8, required: true },
    ],
    promptTemplate:
      'Tighten this messaging. Same meaning, fewer words, sharper edge.\n\n' +
      '{{Text}}\n\n' +
      'Return only the tightened version. No commentary.',
  },
  {
    id: 'refine.executive',
    family: 'mode',
    groupId: 'refine',
    label: 'Make executive-ready',
    description: 'Reshape content for an executive audience.',
    fields: [
      { key: 'content', label: 'Content', kind: 'textarea', rows: 8, required: true },
      { key: 'audience', label: 'Executive audience', kind: 'text', placeholder: 'e.g. CMO of a Fortune 500 retailer' },
    ],
    promptTemplate:
      'Reshape this content for an executive audience.\n\n' +
      'Audience: {{Executive audience}}\n\n' +
      'Content:\n{{Content}}\n\n' +
      'Lead with the so-what. Keep it under one page. End with a clear ask.',
  },
  {
    id: 'refine.simplify',
    family: 'mode',
    groupId: 'refine',
    label: 'Simplify this doc',
    description: 'Strip jargon and make a doc human-readable.',
    fields: [
      { key: 'doc', label: 'Document', kind: 'textarea', rows: 10, required: true },
    ],
    promptTemplate:
      'Simplify this document. No jargon. No corporate filler. Same intent.\n\n' +
      '{{Document}}',
  },
];

// ──────────────────────────── LIBRARY WORKFLOWS ────────────────────────────

const LIBRARY_WORKFLOWS: WorkflowDef[] = [
  {
    id: 'library.ideas',
    family: 'library',
    groupId: 'library',
    label: 'Generate ideas from library',
    description: 'Use my resources to spark new ideas on a topic.',
    fields: [
      { key: 'topic', label: 'Topic / question', kind: 'textarea', rows: 3, required: true },
      { key: 'audience', label: 'Audience', kind: 'text' },
      { key: 'count', label: 'How many ideas?', kind: 'select', options: ['5', '8', '12'] },
    ],
    promptTemplate:
      'Using my Library (resources, KIs, prior thinking), generate {{How many ideas?}} ideas on this topic.\n\n' +
      'Topic / question: {{Topic / question}}\n' +
      'Audience: {{Audience}}\n\n' +
      'Ground every idea in a specific resource from my library where possible. ' +
      'Cite the source title for each idea. Push for variety.',
  },
  {
    id: 'library.framework',
    family: 'library',
    groupId: 'library',
    label: 'Create framework from library',
    description: 'Distill my library into a usable framework.',
    fields: [
      { key: 'goal', label: 'Framework goal', kind: 'text', required: true, placeholder: 'e.g. Qualifying enterprise retail deals' },
      { key: 'shape', label: 'Shape', kind: 'select', options: ['Checklist', 'Matrix', 'Decision tree', 'Step-by-step'] },
    ],
    promptTemplate:
      'Using my Library, create a {{Shape}} framework for: {{Framework goal}}.\n\n' +
      'Pull patterns from my resources. Cite the sources. Make it usable in a real call.',
  },
  {
    id: 'library.messaging',
    family: 'library',
    groupId: 'library',
    label: 'Build messaging from library',
    description: 'Generate messaging anchored to my library.',
    fields: [
      { key: 'audience', label: 'Audience', kind: 'text', required: true },
      { key: 'objective', label: 'Objective', kind: 'text', placeholder: 'e.g. Book a discovery call' },
      { key: 'format', label: 'Format', kind: 'select', options: ['Cold email', 'LinkedIn message', 'Voicemail script', 'Discovery opener'] },
    ],
    promptTemplate:
      'Using my Library, write {{Format}} messaging for {{Audience}}.\n\n' +
      'Objective: {{Objective}}\n\n' +
      'Anchor the message in 1–2 specific insights from my resources. ' +
      'Cite the source titles. Keep it human.',
  },
  {
    id: 'library.synthesis',
    family: 'library',
    groupId: 'library',
    label: 'Synthesize patterns from library',
    description: 'Find patterns across my resources.',
    fields: [
      { key: 'theme', label: 'Theme', kind: 'text', required: true, placeholder: 'e.g. Multithreading in late-stage deals' },
    ],
    promptTemplate:
      'Synthesize patterns across my Library on this theme: {{Theme}}.\n\n' +
      'Output: 5 recurring patterns + the 1–2 strongest source citations for each. ' +
      'Note any contradictions. End with what I should do differently.',
  },
];

// ──────────────────────────── ARTIFACT TEMPLATES ────────────────────────────

const ARTIFACT_TEMPLATES: WorkflowDef[] = [
  {
    id: 'artifact.discovery_prep',
    family: 'artifact',
    groupId: 'discovery_prep',
    label: 'Discovery Prep Template',
    description: 'Reusable template for any discovery call.',
    formTitle: 'Discovery Prep',
    fields: [
      { key: 'company', label: 'Company', kind: 'text', required: true },
      { key: 'objective', label: 'Meeting objective', kind: 'text', required: true },
      { key: 'participants', label: 'Participants', kind: 'textarea', rows: 2, placeholder: 'Names + titles' },
      { key: 'context', label: 'Notes / known context', kind: 'textarea', rows: 5 },
      { key: 'depth', label: 'Desired depth', kind: 'select', options: ['Quick prep', 'Standard prep', 'Executive prep'] },
      { key: 'style', label: 'Output style', kind: 'select', options: ['Tight bullets', 'Narrative brief', 'Talk track'] },
    ],
    promptTemplate:
      'Use the Discovery Prep template to create a discovery prep artifact for {{Company}}.\n\n' +
      'Meeting objective: {{Meeting objective}}\n' +
      'Participants: {{Participants}}\n' +
      'Notes / context: {{Notes / known context}}\n' +
      'Desired depth: {{Desired depth}}\n' +
      'Output style: {{Output style}}',
  },
  {
    id: 'artifact.deal_review',
    family: 'artifact',
    groupId: 'deal_review',
    label: 'Deal Review Template',
    description: 'Structured deal review for any opportunity.',
    formTitle: 'Deal Review',
    fields: [
      { key: 'deal', label: 'Deal / opportunity', kind: 'text', required: true },
      { key: 'stage', label: 'Stage', kind: 'text' },
      { key: 'commit', label: 'My current commit', kind: 'select', options: ['Commit', 'Best case', 'Pipeline', 'Omitted'] },
      { key: 'whats_true', label: 'What I know is true', kind: 'textarea', rows: 4 },
      { key: 'whats_unknown', label: 'What I do not know', kind: 'textarea', rows: 4 },
    ],
    promptTemplate:
      'Use the Deal Review template to review {{Deal / opportunity}}.\n\n' +
      'Stage: {{Stage}}\n' +
      'Current commit: {{My current commit}}\n' +
      'What I know is true: {{What I know is true}}\n' +
      'What I do not know: {{What I do not know}}\n\n' +
      'Sections: Health · Risks · Champion strength · Buying committee gaps · Next 3 moves.',
  },
  {
    id: 'artifact.outreach_plan',
    family: 'artifact',
    groupId: 'outreach_plan',
    label: 'Outreach Plan Template',
    description: 'Multichannel outreach plan for an account.',
    formTitle: 'Outreach Plan',
    fields: [
      { key: 'target', label: 'Target account / segment', kind: 'text', required: true },
      { key: 'personas', label: 'Personas', kind: 'textarea', rows: 2 },
      { key: 'duration', label: 'Sequence length', kind: 'select', options: ['1 week', '2 weeks', '4 weeks'] },
      { key: 'channels', label: 'Channels', kind: 'select', options: ['Email + LinkedIn', 'Email + Phone', 'All channels'] },
    ],
    promptTemplate:
      'Use the Outreach Plan template to build a plan for {{Target account / segment}}.\n\n' +
      'Personas: {{Personas}}\n' +
      'Sequence length: {{Sequence length}}\n' +
      'Channels: {{Channels}}\n\n' +
      'Day-by-day cadence, message intent per touch, and the asks.',
  },
  {
    id: 'artifact.demo_plan',
    family: 'artifact',
    groupId: 'demo_plan',
    label: 'Demo Plan Template',
    description: 'Structure a demo against discovery.',
    formTitle: 'Demo Plan',
    fields: [
      { key: 'company', label: 'Company', kind: 'text', required: true },
      { key: 'pains', label: 'Pains uncovered in discovery', kind: 'textarea', rows: 4, required: true },
      { key: 'attendees', label: 'Demo attendees', kind: 'textarea', rows: 2 },
      { key: 'duration', label: 'Length', kind: 'select', options: ['30 min', '45 min', '60 min'] },
    ],
    promptTemplate:
      'Use the Demo Plan template to plan a {{Length}} demo for {{Company}}.\n\n' +
      'Pains from discovery: {{Pains uncovered in discovery}}\n' +
      'Attendees: {{Demo attendees}}\n\n' +
      'Output: opening frame · the 3 things I will show and why · the proof points tied to each pain · ' +
      'planted questions · close.',
  },
  {
    id: 'artifact.followup_email',
    family: 'artifact',
    groupId: 'followup_email',
    label: 'Follow-up Email Template',
    description: 'Post-meeting follow-up email.',
    formTitle: 'Follow-up Email',
    fields: [
      { key: 'recipient', label: 'Recipient', kind: 'text', required: true },
      { key: 'meeting', label: 'What we discussed', kind: 'textarea', rows: 5, required: true },
      { key: 'next_step', label: 'Proposed next step', kind: 'text' },
      { key: 'tone', label: 'Tone', kind: 'select', options: ['Direct', 'Warm', 'Executive'] },
    ],
    promptTemplate:
      'Use the Follow-up Email template to write a post-meeting follow-up for {{Recipient}}.\n\n' +
      'What we discussed: {{What we discussed}}\n' +
      'Proposed next step: {{Proposed next step}}\n' +
      'Tone: {{Tone}}',
  },
  {
    id: 'artifact.custom',
    family: 'artifact',
    groupId: 'custom',
    label: 'Custom Template',
    description: 'Free-form template — describe what you want.',
    formTitle: 'Custom Output',
    fields: [
      { key: 'goal', label: 'What do you want to create?', kind: 'textarea', rows: 4, required: true },
      { key: 'context', label: 'Context', kind: 'textarea', rows: 4 },
      { key: 'format', label: 'Output format', kind: 'text', placeholder: 'e.g. one-pager, table, talk track' },
    ],
    promptTemplate:
      'Create the following:\n\n' +
      'Goal: {{What do you want to create?}}\n' +
      'Context: {{Context}}\n' +
      'Output format: {{Output format}}',
  },
];

// ──────────────────────────── PUBLIC API ────────────────────────────

export const MODE_PILLS: Record<'brainstorm' | 'deep_research' | 'refine', WorkflowDef[]> = {
  brainstorm: MODE_BRAINSTORM,
  deep_research: MODE_DEEP_RESEARCH,
  refine: MODE_REFINE,
};

export const LIBRARY_DEFS: WorkflowDef[] = LIBRARY_WORKFLOWS;
export const ARTIFACT_TEMPLATE_DEFS: WorkflowDef[] = ARTIFACT_TEMPLATES;

/** Compile a prompt template using the user-supplied values. */
export function compileWorkflowPrompt(def: WorkflowDef, values: Record<string, string>): string {
  let body = def.promptTemplate;
  for (const field of def.fields) {
    const raw = values[field.key]?.trim() ?? '';
    const replacement = raw.length > 0 ? raw : '(not specified)';
    // Replace ALL occurrences of the {{Label}} token.
    body = body.split(`{{${field.label}}}`).join(replacement);
  }
  body = body.trim();

  // Prepend instruction (custom-GPT style) when present.
  const instruction = def.instruction?.trim();
  if (instruction) {
    return `Instruction: ${instruction}\n\n${body}`.trim();
  }
  return body;
}
