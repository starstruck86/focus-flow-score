import type { SkillManifest } from '../types';

export const followUpEmailManifest: SkillManifest = {
  id: 'follow-up-email',
  label: 'Follow-Up Email',
  description: 'Sharp, send-ready follow-up email with POV and clear next step.',
  behaviorIntent: 'refine_message',
  workspace: 'refine',
  depth: 'quick',
  sourceMode: 'library_first',
  retrieval: {
    scopes: ['knowledge_items', 'exemplars', 'standards'],
    termBindings: ['${inputs.account}', '${inputs.persona}', '${inputs.topic}', '${inputs.stage}'],
    minRelevantItems: 1,
  },
  output: {
    shape: 'prose',
    targetWords: { min: 60, max: 160 },
    forbid: ['headings', 'bullets'],
  },
  rubric: {
    mustHave: ['POV-bearing', 'specific to call context', 'clear next step', 'usable verbatim'],
    genericMarkers: ['just checking in', 'circling back', 'thought I would follow up', 'per our conversation'],
    maxGenericMarkers: 0,
  },
  version: '1',
};
