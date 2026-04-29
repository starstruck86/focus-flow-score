import type { SkillManifest } from '../types';

export const discoveryQuestionsManifest: SkillManifest = {
  id: 'discovery-questions',
  label: 'Discovery Question Builder',
  description: 'Generate sharp, stage- and persona-fit discovery questions.',
  behaviorIntent: 'idea_generation',
  workspace: 'brainstorm',
  depth: 'standard',
  sourceMode: 'library_first',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'exemplars', 'patterns'],
    termBindings: ['${inputs.persona}', '${inputs.stage}', '${inputs.topic}', '${inputs.industry}'],
    minRelevantItems: 2,
  },
  output: {
    shape: 'list',
  },
  rubric: {
    mustHave: ['POV-bearing', 'specific to inputs', 'opens change vectors', 'avoids yes/no'],
    genericMarkers: ['tell me about your business', 'what keeps you up at night', 'walk me through'],
    maxGenericMarkers: 1,
  },
  version: '1',
};
