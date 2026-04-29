import type { SkillManifest } from '../types';

export const researchManifest: SkillManifest = {
  id: 'research',
  label: 'Research',
  description: 'Targeted external + library research brief on an account or topic.',
  behaviorIntent: 'research_brief',
  workspace: 'deep_research',
  depth: 'deep',
  sourceMode: 'library_relevant',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'patterns'],
    termBindings: ['${inputs.account}', '${inputs.industry}', '${inputs.topic}'],
    minRelevantItems: 1,
  },
  output: {
    shape: 'structured_artifact',
    targetWords: { min: 250, max: 900 },
  },
  rubric: {
    mustHave: ['verified signals', 'cited sources', 'change vectors', 'commercial implications'],
    genericMarkers: ['according to public information', 'industry trends suggest'],
    maxGenericMarkers: 2,
  },
  version: '1',
};
