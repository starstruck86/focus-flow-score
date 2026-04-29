import type { SkillManifest } from '../types';

export const commercialInsightManifest: SkillManifest = {
  id: 'commercial-insight',
  label: 'Commercial Insight',
  description: 'Sharpen a single commercial insight with full reasoning, compressed delivery.',
  behaviorIntent: 'pov_synthesis',
  workspace: 'refine',
  depth: 'standard',
  sourceMode: 'library_first',
  retrieval: {
    scopes: ['knowledge_items', 'standards', 'exemplars'],
    termBindings: ['${inputs.topic}', '${inputs.industry}', '${inputs.persona}'],
    minRelevantItems: 2,
  },
  output: {
    shape: 'prose',
    targetWords: { min: 60, max: 180 },
    forbid: ['headings', 'bullets'],
  },
  rubric: {
    mustHave: ['clear POV', 'specific to inputs', 'commercial insight', 'usable verbatim'],
    genericMarkers: ['it depends', 'best practice', 'leverage synergies', 'in today’s landscape'],
    maxGenericMarkers: 1,
  },
  version: '1',
};
