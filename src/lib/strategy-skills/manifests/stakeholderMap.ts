import type { SkillManifest } from '../types';

export const stakeholderMapManifest: SkillManifest = {
  id: 'stakeholder-map',
  label: 'Stakeholder Map',
  description: 'Map roles, motivations, and political dynamics for an account.',
  behaviorIntent: 'stakeholder_map',
  workspace: 'deep_research',
  depth: 'deep',
  sourceMode: 'library_first',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'patterns', 'standards'],
    termBindings: ['${inputs.account}', '${inputs.persona}', '${inputs.deal_type}'],
    minRelevantItems: 2,
  },
  output: {
    shape: 'structured_artifact',
    targetWords: { min: 200, max: 900 },
  },
  rubric: {
    mustHave: ['roles identified', 'motivations explicit', 'coalition logic', 'risk per stakeholder'],
    genericMarkers: ['key stakeholder', 'decision maker', 'influencer'],
    maxGenericMarkers: 2,
  },
  version: '1',
};
