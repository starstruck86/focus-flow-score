import type { SkillManifest } from '../types';

export const discoveryPrepManifest: SkillManifest = {
  id: 'discovery-prep',
  label: 'Discovery Prep',
  description: 'Full discovery prep artifact via existing task pipeline (handoff only in later phase).',
  behaviorIntent: 'discovery_prep',
  workspace: 'artifacts',
  depth: 'artifact',
  sourceMode: 'library_required',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'standards'],
    termBindings: ['${inputs.account}', '${inputs.persona}', '${inputs.stage}', '${inputs.topic}'],
    minRelevantItems: 3,
  },
  output: {
    shape: 'structured_artifact',
    targetWords: { min: 600, max: 2500 },
  },
  rubric: {
    mustHave: ['cockpit complete', 'discovery questions specific', 'library grounded', 'redlines actionable'],
    genericMarkers: ['ask open ended questions', 'understand pain'],
    maxGenericMarkers: 1,
  },
  version: '1',
};
