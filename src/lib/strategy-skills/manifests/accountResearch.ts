import type { SkillManifest } from '../types';

export const accountResearchManifest: SkillManifest = {
  id: 'account-research',
  label: 'Account Research',
  description: 'Deep, grounded research brief on an account or industry.',
  behaviorIntent: 'research_brief',
  workspace: 'deep_research',
  depth: 'deep',
  sourceMode: 'library_first',
  retrieval: {
    scopes: ['knowledge_items', 'standards', 'exemplars', 'patterns'],
    termBindings: ['${inputs.account}', '${inputs.industry}', '${inputs.topic}'],
    minRelevantItems: 3,
  },
  output: {
    shape: 'structured_artifact',
  },
  rubric: {
    mustHave: ['verified signals', 'change vectors', 'commercial insight', 'cited sources'],
    genericMarkers: ['industry leader', 'innovative solutions', 'cutting-edge'],
    maxGenericMarkers: 1,
  },
  version: '1',
};
