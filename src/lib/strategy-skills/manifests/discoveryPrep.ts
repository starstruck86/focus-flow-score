import type { SkillManifest } from '../types';

export const discoveryPrepManifest: SkillManifest = {
  id: 'discovery-prep',
  label: 'Discovery Prep',
  description: 'Full discovery preparation artifact grounded in the library.',
  behaviorIntent: 'discovery_prep',
  workspace: 'artifacts',
  depth: 'artifact',
  sourceMode: 'library_required',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'standards', 'exemplars'],
    termBindings: ['${inputs.account}', '${inputs.persona}', '${inputs.stage}', '${inputs.topic}'],
    minRelevantItems: 3,
  },
  output: {
    shape: 'structured_artifact',
  },
  rubric: {
    mustHave: [
      'verified signals',
      'current state reasoning',
      'change vectors',
      'commercial insight',
      'strategic why',
      'friction',
      'cited sources',
    ],
    genericMarkers: ['build rapport', 'understand their needs', 'best practice'],
    maxGenericMarkers: 1,
  },
  version: '1',
};
