import type { SkillManifest } from '../types';

export const objectionManifest: SkillManifest = {
  id: 'objection',
  label: 'Objection Handling',
  description: 'Library-grounded response to a specific objection.',
  behaviorIntent: 'objection_handling',
  workspace: 'work',
  depth: 'quick',
  sourceMode: 'library_first',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'patterns'],
    termBindings: ['${inputs.objection}', '${inputs.persona}', '${inputs.stage}'],
    minRelevantItems: 2,
  },
  output: {
    shape: 'prose',
    targetWords: { min: 40, max: 160 },
    forbid: ['headings', 'bullets'],
  },
  rubric: {
    mustHave: ['acknowledges objection', 'reframes', 'specific next move'],
    genericMarkers: ['I hear you', 'great question', 'let me address that'],
    maxGenericMarkers: 0,
  },
  version: '1',
};
