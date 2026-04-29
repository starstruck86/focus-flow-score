import type { SkillManifest } from '../types';

export const brainstormManifest: SkillManifest = {
  id: 'brainstorm',
  label: 'Brainstorm',
  description: 'Generate distinct, library-grounded angles or ideas.',
  behaviorIntent: 'idea_generation',
  workspace: 'brainstorm',
  depth: 'standard',
  sourceMode: 'library_relevant',
  retrieval: {
    scopes: ['knowledge_items', 'patterns', 'exemplars'],
    termBindings: ['${inputs.topic}', '${inputs.industry}', '${inputs.persona}'],
    minRelevantItems: 1,
  },
  output: {
    shape: 'list',
    targetWords: { min: 80, max: 350 },
  },
  rubric: {
    mustHave: ['distinct angles', 'specific to inputs', 'each idea actionable'],
    genericMarkers: ['think outside the box', 'leverage AI', 'synergies'],
    maxGenericMarkers: 1,
  },
  version: '1',
};
