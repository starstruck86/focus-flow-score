import type { SkillManifest } from '../types';

export const objectionStrategyManifest: SkillManifest = {
  id: 'objection-strategy',
  label: 'Objection Strategy',
  description: 'POV-led strategy for handling a specific objection in context.',
  behaviorIntent: 'objection_handling',
  workspace: 'work',
  depth: 'standard',
  sourceMode: 'library_first',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'standards', 'exemplars'],
    termBindings: ['${inputs.objection}', '${inputs.persona}', '${inputs.stage}', '${inputs.account}'],
    minRelevantItems: 2,
  },
  output: {
    shape: 'prose',
    targetWords: { min: 80, max: 200 },
    forbid: ['headings', 'bullets'],
  },
  rubric: {
    mustHave: ['root cause named', 'reframe with POV', 'evidence or proof', 'next-step move'],
    genericMarkers: ['feel felt found', 'i hear you', 'great question'],
    maxGenericMarkers: 0,
  },
  version: '1',
};
